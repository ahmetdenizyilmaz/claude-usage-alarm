import { scanAllSessions } from "../session-scanner.js";
import { readStatsCache } from "../stats-reader.js";

export async function get5hWindowUsage(windowHours: number = 5) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

  const result = await scanAllSessions({ cutoffTime: cutoff });

  // Calculate average for comparison
  let dailyAvg = 0;
  try {
    const stats = await readStatsCache();
    const recentDays = stats.dailyModelTokens.slice(-7);
    const totalRecent = recentDays.reduce(
      (sum, d) =>
        sum + Object.values(d.tokensByModel).reduce((a, b) => a + b, 0),
      0
    );
    dailyAvg = recentDays.length > 0 ? totalRecent / recentDays.length : 0;
  } catch { /* ignore */ }

  const fiveHourAvg = (dailyAvg / 24) * windowHours;

  return {
    window: {
      hours: windowHours,
      from: cutoff.toISOString(),
      to: now.toISOString(),
    },
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationTokens: result.cacheCreationTokens,
      cacheReadTokens: result.cacheReadTokens,
      totalTokens: result.totalTokens,
      messageCount: result.messageCount,
    },
    byModel: result.byModel,
    comparison: {
      averageForWindow: Math.round(fiveHourAvg),
      ratioVsAverage:
        fiveHourAvg > 0
          ? Math.round((result.totalTokens / fiveHourAvg) * 100) / 100
          : 0,
    },
  };
}
