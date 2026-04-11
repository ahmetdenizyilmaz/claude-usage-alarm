import { readAlertConfig, type Alarm } from "../alert-config.js";
import {
  readStatsCache,
  getDateRange,
  filterByDateRange,
  sumTokensByModel,
} from "../stats-reader.js";
import { scanAllSessions, getLatestSessionId } from "../session-scanner.js";
import { playAlarmSound } from "../sound.js";

interface TriggeredAlarm {
  name: string;
  level: "info" | "warning" | "critical";
  message: string;
  currentValue: number;
  threshold: number;
  sound: boolean;
}

function getLevel(percent: number): "info" | "warning" | "critical" {
  if (percent >= 90) return "critical";
  if (percent >= 75) return "warning";
  return "info";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

async function evaluateAlarm(alarm: Alarm): Promise<TriggeredAlarm | null> {
  if (!alarm.enabled) return null;

  let currentValue = 0;
  let context = "";

  switch (alarm.type) {
    case "session": {
      const sessionId = await getLatestSessionId();
      if (!sessionId) return null;
      const bucket = await scanAllSessions({ sessionId });
      if (alarm.metric === "tokens") {
        currentValue = bucket.totalTokens;
        context = `Session tokens: ${formatTokens(bucket.totalTokens)}`;
      } else if (alarm.metric === "percent" && alarm.budget) {
        currentValue = (bucket.totalTokens / alarm.budget) * 100;
        context = `Session: ${formatTokens(bucket.totalTokens)} / ${formatTokens(alarm.budget)} (${currentValue.toFixed(1)}%)`;
      } else if (alarm.metric === "tokens-per-hour") {
        if (bucket.firstTimestamp && bucket.lastTimestamp) {
          const duration =
            (new Date(bucket.lastTimestamp).getTime() -
              new Date(bucket.firstTimestamp).getTime()) /
            3600000;
          currentValue = duration > 0 ? bucket.totalTokens / duration : 0;
          context = `Session burn: ${formatTokens(Math.round(currentValue))}/hr`;
        }
      }
      break;
    }

    case "5h-window": {
      const cutoff = new Date(Date.now() - 5 * 60 * 60 * 1000);
      const bucket = await scanAllSessions({ cutoffTime: cutoff });
      if (alarm.metric === "tokens") {
        currentValue = bucket.totalTokens;
        context = `5h window: ${formatTokens(bucket.totalTokens)}`;
      } else if (alarm.metric === "percent" && alarm.budget) {
        currentValue = (bucket.totalTokens / alarm.budget) * 100;
        context = `5h window: ${formatTokens(bucket.totalTokens)} / ${formatTokens(alarm.budget)} (${currentValue.toFixed(1)}%)`;
      } else if (alarm.metric === "tokens-per-hour") {
        currentValue = bucket.totalTokens / 5;
        context = `5h avg burn: ${formatTokens(Math.round(currentValue))}/hr`;
      }
      break;
    }

    case "daily":
    case "weekly":
    case "monthly": {
      const periodMap = { daily: "today", weekly: "week", monthly: "month" } as const;
      const period = periodMap[alarm.type];
      const stats = await readStatsCache();
      const [start, end] = getDateRange(period);
      const entries = filterByDateRange(stats.dailyModelTokens, start, end);
      const byModel = sumTokensByModel(entries);
      const total = Object.values(byModel).reduce((a, b) => a + b, 0);

      if (alarm.metric === "tokens") {
        currentValue = total;
        context = `${alarm.type}: ${formatTokens(total)}`;
      } else if (alarm.metric === "percent" && alarm.budget) {
        currentValue = (total / alarm.budget) * 100;
        context = `${alarm.type}: ${formatTokens(total)} / ${formatTokens(alarm.budget)} (${currentValue.toFixed(1)}%)`;
      }
      break;
    }

    case "model": {
      if (!alarm.model) return null;
      const stats = await readStatsCache();
      const modelData = stats.modelUsage[alarm.model];
      if (!modelData) return null;

      const total =
        modelData.inputTokens +
        modelData.outputTokens +
        modelData.cacheCreationInputTokens +
        modelData.cacheReadInputTokens;

      if (alarm.metric === "tokens") {
        currentValue = total;
        context = `${alarm.model}: ${formatTokens(total)} all-time`;
      } else if (alarm.metric === "percent" && alarm.budget) {
        currentValue = (total / alarm.budget) * 100;
        context = `${alarm.model}: ${formatTokens(total)} / ${formatTokens(alarm.budget)} (${currentValue.toFixed(1)}%)`;
      }

      // Also check recent usage for this model via session scanning
      if (alarm.metric === "tokens-per-hour") {
        const cutoff = new Date(Date.now() - 1 * 60 * 60 * 1000);
        const bucket = await scanAllSessions({ cutoffTime: cutoff, model: alarm.model });
        currentValue = bucket.totalTokens;
        context = `${alarm.model} last 1h: ${formatTokens(bucket.totalTokens)}/hr`;
      }
      break;
    }

    case "burn-rate": {
      const cutoff = new Date(Date.now() - 1 * 60 * 60 * 1000);
      const bucket = await scanAllSessions({ cutoffTime: cutoff });
      currentValue = bucket.totalTokens;
      context = `Burn rate: ${formatTokens(currentValue)}/hr`;
      break;
    }
  }

  if (currentValue >= alarm.threshold) {
    const level = alarm.metric === "percent" ? getLevel(currentValue) :
                  currentValue >= alarm.threshold * 1.5 ? "critical" : "warning";
    return {
      name: alarm.name,
      level,
      message: `ALARM "${alarm.name}": ${context} (threshold: ${alarm.metric === "percent" ? alarm.threshold + "%" : formatTokens(alarm.threshold)})`,
      currentValue: Math.round(currentValue * 100) / 100,
      threshold: alarm.threshold,
      sound: alarm.sound,
    };
  }

  return null;
}

export async function checkAlarms() {
  const config = await readAlertConfig();

  if (config.alarms.length === 0) {
    return {
      triggered: [],
      total: 0,
      message: "No alarms configured. Use add_alarm to create one.",
    };
  }

  const triggered: TriggeredAlarm[] = [];
  let worstLevel: "info" | "warning" | "critical" = "info";

  for (const alarm of config.alarms) {
    const result = await evaluateAlarm(alarm);
    if (result) {
      triggered.push(result);
      if (result.level === "critical") worstLevel = "critical";
      else if (result.level === "warning" && worstLevel !== "critical") worstLevel = "warning";
    }
  }

  // Play sound for the worst triggered alarm
  if (triggered.length > 0 && config.soundEnabled) {
    const shouldSound = triggered.some((t) => t.sound);
    if (shouldSound) {
      playAlarmSound(worstLevel);
    }
  }

  // Build summary text
  let text = "";
  if (triggered.length === 0) {
    text = "All clear - no alarms triggered.";
  } else {
    text = `${triggered.length} alarm(s) triggered:\n\n`;
    for (const t of triggered) {
      const icon = t.level === "critical" ? "\u{1F6A8}" : t.level === "warning" ? "\u26a0\ufe0f" : "\u2139\ufe0f";
      text += `${icon} ${t.message}\n`;
    }
    if (config.soundEnabled && triggered.some((t) => t.sound)) {
      text += "\n\ud83d\udd0a Sound alarm played.";
    }
  }

  return {
    text,
    triggered,
    total: triggered.length,
    soundPlayed: config.soundEnabled && triggered.some((t) => t.sound),
  };
}
