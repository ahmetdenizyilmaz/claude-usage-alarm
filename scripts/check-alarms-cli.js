// Lightweight standalone alarm checker — runs after every Claude response via Stop hook
// Reads config and session files directly (no MCP server needed)

import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "alert-config.json");
const LIMITS_PATH = join(__dirname, "..", "limits-config.json");

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

function playSound(level) {
  let cmd;
  if (level === "critical") {
    cmd = `[console]::beep(1000,300); Start-Sleep -Milliseconds 100; [console]::beep(1000,300); Start-Sleep -Milliseconds 100; [console]::beep(1000,500)`;
  } else if (level === "warning") {
    cmd = `[console]::beep(750,300); Start-Sleep -Milliseconds 150; [console]::beep(750,300)`;
  } else {
    cmd = `[console]::beep(500,200)`;
  }
  exec(`powershell -NoProfile -Command "${cmd}"`, () => {});
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

async function scanSessionOutputTokens(cutoffTime, filterModel) {
  const projectsDir = join(homedir(), ".claude", "projects");
  let total = 0;

  let projectDirs;
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return 0;
  }

  for (const projDir of projectDirs) {
    const projPath = join(projectsDir, projDir);
    let files;
    try {
      files = await readdir(projPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      try {
        const raw = await readFile(join(projPath, file), "utf-8");
        const lines = raw.split("\n");

        // Skip old files
        if (lines.length > 1) {
          try {
            const last = JSON.parse(lines[lines.length - 2] || lines[lines.length - 1]);
            if (last.timestamp && new Date(last.timestamp) < cutoffTime) continue;
          } catch {}
        }

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "assistant" || !entry.message?.usage || !entry.timestamp) continue;
            if (new Date(entry.timestamp) < cutoffTime) continue;
            if (filterModel && (entry.message.model ?? "") !== filterModel) continue;
            total += entry.message.usage.output_tokens ?? 0;
          } catch {}
        }
      } catch {}
    }
  }
  return total;
}

async function main() {
  const alertConfig = await readJson(CONFIG_PATH);
  if (!alertConfig || !alertConfig.alarms || alertConfig.alarms.length === 0) {
    process.exit(0);
  }

  const limitsConfig = await readJson(LIMITS_PATH);
  const limits = limitsConfig?.hardcoded ?? {
    sessionOutputTokens: 375000,
    weeklyOutputTokens: 2500000,
    sonnetSessionOutputTokens: 375000,
  };

  const now = new Date();
  const fiveHourCutoff = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const weeklyCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Cache scans — only run what alarms need
  let sessionTokens = null;
  let weeklyTokens = null;
  let sonnetTokens = null;

  const triggered = [];

  for (const alarm of alertConfig.alarms) {
    if (!alarm.enabled) continue;

    let currentValue = 0;
    let label = "";

    if (alarm.type === "session" || alarm.type === "5h-window") {
      if (sessionTokens === null) sessionTokens = await scanSessionOutputTokens(fiveHourCutoff);
      if (alarm.metric === "tokens") {
        currentValue = sessionTokens;
        label = `Session: ${formatTokens(sessionTokens)} output tokens`;
      } else if (alarm.metric === "percent" && alarm.budget) {
        currentValue = (sessionTokens / alarm.budget) * 100;
        label = `Session: ${currentValue.toFixed(0)}% of ${formatTokens(alarm.budget)}`;
      }
    } else if (alarm.type === "weekly") {
      if (weeklyTokens === null) weeklyTokens = await scanSessionOutputTokens(weeklyCutoff);
      if (alarm.metric === "tokens") {
        currentValue = weeklyTokens;
        label = `Weekly: ${formatTokens(weeklyTokens)} output tokens`;
      } else if (alarm.metric === "percent" && alarm.budget) {
        currentValue = (weeklyTokens / alarm.budget) * 100;
        label = `Weekly: ${currentValue.toFixed(0)}% of ${formatTokens(alarm.budget)}`;
      }
    } else if (alarm.type === "model" && alarm.model) {
      if (alarm.model.includes("sonnet")) {
        if (sonnetTokens === null) sonnetTokens = await scanSessionOutputTokens(fiveHourCutoff, "claude-sonnet-4-6");
        currentValue = alarm.metric === "tokens" ? sonnetTokens :
          alarm.budget ? (sonnetTokens / alarm.budget) * 100 : 0;
        label = `Sonnet: ${formatTokens(sonnetTokens)} output tokens`;
      }
    } else if (alarm.type === "burn-rate") {
      if (sessionTokens === null) sessionTokens = await scanSessionOutputTokens(fiveHourCutoff);
      currentValue = sessionTokens / 5; // tokens per hour over 5h
      label = `Burn rate: ${formatTokens(Math.round(currentValue))}/hr`;
    }

    if (currentValue >= alarm.threshold) {
      const level = currentValue >= alarm.threshold * 1.5 ? "critical" : "warning";
      triggered.push({ name: alarm.name, level, label, sound: alarm.sound });
    }
  }

  if (triggered.length > 0) {
    const lines = triggered.map(t => {
      const icon = t.level === "critical" ? "\u{1F6A8}" : "\u26a0\ufe0f";
      return `${icon} ALARM "${t.name}": ${t.label}`;
    });
    const output = "\n" + lines.join("\n") + "\n";
    process.stdout.write(output);
    process.stderr.write(output);

    // Play sound for worst level
    if (alertConfig.soundEnabled !== false) {
      const shouldSound = triggered.some(t => t.sound !== false);
      if (shouldSound) {
        const worst = triggered.some(t => t.level === "critical") ? "critical" : "warning";
        playSound(worst);
      }
    }
  }
}

main().catch(() => process.exit(0));
