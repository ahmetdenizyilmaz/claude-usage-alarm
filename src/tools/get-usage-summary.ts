import {
  readStatsCache,
  getDateRange,
  filterByDateRange,
  sumTokensByModel,
  sumActivity,
} from "../stats-reader.js";
import { readLimitsConfig, getWeekWindow } from "../limits.js";

export async function getUsageSummary(period: string = "today") {
  const stats = await readStatsCache();
  const limits = await readLimitsConfig();

  if (period === "all") {
    const modelBreakdown: Record<string, object> = {};
    let grandTotal = 0;
    for (const [model, usage] of Object.entries(stats.modelUsage)) {
      const total =
        usage.inputTokens +
        usage.outputTokens +
        usage.cacheReadInputTokens +
        usage.cacheCreationInputTokens;
      grandTotal += total;
      modelBreakdown[model] = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        total,
      };
    }
    return {
      period: "all",
      since: stats.firstSessionDate,
      lastUpdated: stats.lastComputedDate,
      totalTokens: grandTotal,
      byModel: modelBreakdown,
      activity: {
        totalSessions: stats.totalSessions,
        totalMessages: stats.totalMessages,
      },
    };
  }

  const validPeriods = ["today", "week", "month"] as const;
  const p = validPeriods.includes(period as any)
    ? (period as "today" | "week" | "month")
    : "today";

  // For the weekly period, honour the configured reset anchor so the window
  // matches what `/usage` shows, not a raw calendar/rolling 7-day slice.
  let weekWindowSource: "anchor" | "rolling" | undefined;
  let weekWindowEndISO: string | undefined;
  let dateRange: [string, string];
  if (p === "week") {
    const ww = getWeekWindow(limits.weekReset.anchorISO);
    weekWindowSource = ww.source;
    weekWindowEndISO = ww.end.toISOString();
    dateRange = getDateRange(p, { weekStartOverride: ww.start });
  } else {
    dateRange = getDateRange(p);
  }
  const [start, end] = dateRange;
  const tokenEntries = filterByDateRange(stats.dailyModelTokens, start, end);
  const activityEntries = filterByDateRange(stats.dailyActivity, start, end);

  const byModel = sumTokensByModel(tokenEntries);
  const grandTotal = Object.values(byModel).reduce((a, b) => a + b, 0);
  const activity = sumActivity(activityEntries);

  return {
    period: p,
    dateRange: { start, end },
    ...(p === "week"
      ? { weekWindowSource, nextResetISO: weekWindowEndISO }
      : {}),
    lastUpdated: stats.lastComputedDate,
    totalTokens: grandTotal,
    byModel,
    activity,
  };
}
