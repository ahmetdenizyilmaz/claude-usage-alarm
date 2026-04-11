import {
  readStatsCache,
  formatDate,
  filterByDateRange,
  sumTokensByModel,
} from "../stats-reader.js";

const DEFAULT_SPIKE_MULTIPLIER = 2.0;

export async function getUsageRate(windowDays: number = 7) {
  const stats = await readStatsCache();

  const today = new Date();
  const todayStr = formatDate(today);

  // Window for average calculation (excluding today)
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - windowDays);
  const windowStartStr = formatDate(windowStart);

  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = formatDate(yesterdayDate);

  const windowEntries = filterByDateRange(
    stats.dailyModelTokens,
    windowStartStr,
    yesterdayStr
  );
  const windowTokens = Object.values(sumTokensByModel(windowEntries));
  const windowTotal = windowTokens.reduce((a, b) => a + b, 0);
  const daysInWindow = Math.max(windowEntries.length, 1);
  const avgTokensPerDay = windowTotal / daysInWindow;

  // Today's usage
  const todayEntries = filterByDateRange(
    stats.dailyModelTokens,
    todayStr,
    todayStr
  );
  const todayByModel = sumTokensByModel(todayEntries);
  const todayTotal = Object.values(todayByModel).reduce((a, b) => a + b, 0);

  // Extrapolate today's rate
  const hoursElapsed = today.getHours() + today.getMinutes() / 60;
  const projectedDaily =
    hoursElapsed > 0 ? (todayTotal / hoursElapsed) * 24 : 0;

  // Spike detection
  const spikeRatio = avgTokensPerDay > 0 ? projectedDaily / avgTokensPerDay : 0;
  const spikeDetected = spikeRatio > DEFAULT_SPIKE_MULTIPLIER;

  return {
    today: {
      tokensSoFar: todayTotal,
      hoursElapsed: Math.round(hoursElapsed * 10) / 10,
      projectedDaily: Math.round(projectedDaily),
      byModel: todayByModel,
    },
    average: {
      tokensPerDay: Math.round(avgTokensPerDay),
      windowDays: daysInWindow,
      windowTotal,
    },
    spike: {
      detected: spikeDetected,
      ratio: Math.round(spikeRatio * 100) / 100,
      threshold: DEFAULT_SPIKE_MULTIPLIER,
    },
    note:
      todayStr > stats.lastComputedDate
        ? `Stats were last updated on ${stats.lastComputedDate}. Today's data may not be available yet.`
        : undefined,
  };
}
