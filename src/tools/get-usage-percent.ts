import { getEffectiveLimits, getCurrentUsageForPercent } from "../limits.js";

function progressBar(percent: number, width: number = 38): string {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = "\u2588".repeat(filled) + " ".repeat(empty);

  return `${bar}  ${Math.round(percent)}% used`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export async function getUsagePercent() {
  const [limits, usage] = await Promise.all([
    getEffectiveLimits(),
    getCurrentUsageForPercent(),
  ]);

  const sessionPercent = limits.sessionOutputTokens > 0
    ? (usage.sessionOutputTokens / limits.sessionOutputTokens) * 100
    : 0;

  const weeklyPercent = limits.weeklyOutputTokens > 0
    ? (usage.weeklyOutputTokens / limits.weeklyOutputTokens) * 100
    : 0;

  const sonnetPercent = limits.sonnetSessionOutputTokens > 0
    ? (usage.sonnetSessionOutputTokens / limits.sonnetSessionOutputTokens) * 100
    : 0;

  let text = "";

  text += `  Current session\n`;
  text += `  ${progressBar(sessionPercent)}\n`;
  text += `  ${formatTokens(usage.sessionOutputTokens)} / ${formatTokens(limits.sessionOutputTokens)} output tokens\n\n`;

  text += `  Current week (all models)\n`;
  text += `  ${progressBar(weeklyPercent)}\n`;
  text += `  ${formatTokens(usage.weeklyOutputTokens)} / ${formatTokens(limits.weeklyOutputTokens)} output tokens\n\n`;

  text += `  Current week (Sonnet only)\n`;
  text += `  ${progressBar(sonnetPercent)}\n`;
  text += `  ${formatTokens(usage.sonnetSessionOutputTokens)} / ${formatTokens(limits.sonnetSessionOutputTokens)} output tokens\n\n`;

  if (usage.sessionWindow) {
    const resetTime = new Date(usage.sessionWindow.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    text += `  Session window: ${new Date(usage.sessionWindow.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${resetTime}\n`;
  }
  text += `  ${limits.isPeak ? "Peak hours (tokens cost 2x)" : "Off-peak (full rate)"}\n`;
  text += `  Limits source: ${limits.source}\n`;

  return {
    text,
    session: {
      used: usage.sessionOutputTokens,
      limit: limits.sessionOutputTokens,
      percent: Math.round(sessionPercent * 10) / 10,
    },
    weekly: {
      used: usage.weeklyOutputTokens,
      limit: limits.weeklyOutputTokens,
      percent: Math.round(weeklyPercent * 10) / 10,
    },
    sonnet: {
      used: usage.sonnetSessionOutputTokens,
      limit: limits.sonnetSessionOutputTokens,
      percent: Math.round(sonnetPercent * 10) / 10,
    },
    limitsSource: limits.source,
  };
}
