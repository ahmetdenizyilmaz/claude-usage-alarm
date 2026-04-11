import {
  readStatsCache,
  getDateRange,
  filterByDateRange,
  sumTokensByModel,
  sumActivity,
} from "../stats-reader.js";

export async function getUsageSummary(period: string = "today") {
  const stats = await readStatsCache();

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

  const [start, end] = getDateRange(p);
  const tokenEntries = filterByDateRange(stats.dailyModelTokens, start, end);
  const activityEntries = filterByDateRange(stats.dailyActivity, start, end);

  const byModel = sumTokensByModel(tokenEntries);
  const grandTotal = Object.values(byModel).reduce((a, b) => a + b, 0);
  const activity = sumActivity(activityEntries);

  return {
    period: p,
    dateRange: { start, end },
    lastUpdated: stats.lastComputedDate,
    totalTokens: grandTotal,
    byModel,
    activity,
  };
}
