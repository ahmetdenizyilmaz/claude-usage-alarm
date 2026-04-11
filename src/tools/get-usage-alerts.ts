import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getUsageSummary } from "./get-usage-summary.js";
import { getUsageRate } from "./get-usage-rate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGACY_PATH = join(__dirname, "..", "..", "legacy-budgets.json");

const DEFAULTS = {
  dailyBudget: 5_000_000,
  weeklyBudget: 25_000_000,
  monthlyBudget: 80_000_000,
  fiveHourBudget: 5_000_000,
  thresholds: [50, 75, 90] as number[],
  spikeMultiplier: 2.0,
};

async function readLegacy() {
  try {
    const raw = await readFile(LEGACY_PATH, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

interface Alert {
  level: "info" | "warning" | "critical";
  period: string;
  message: string;
  percentUsed: number;
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

export async function getUsageAlerts() {
  const config = await readLegacy();
  const alerts: Alert[] = [];

  const periods = [
    { name: "today", budget: config.dailyBudget },
    { name: "week", budget: config.weeklyBudget },
    { name: "month", budget: config.monthlyBudget },
  ] as const;

  for (const { name, budget } of periods) {
    const summary = await getUsageSummary(name);
    const percent = (summary.totalTokens / budget) * 100;

    for (const threshold of config.thresholds.sort((a: number, b: number) => b - a)) {
      if (percent >= threshold) {
        alerts.push({
          level: getLevel(percent),
          period: name,
          message: `${name} usage at ${percent.toFixed(1)}% of budget (${formatTokens(summary.totalTokens)} / ${formatTokens(budget)})`,
          percentUsed: Math.round(percent * 10) / 10,
        });
        break;
      }
    }
  }

  const rate = await getUsageRate();
  if (rate.spike.detected) {
    alerts.push({
      level: "warning",
      period: "today",
      message: `Usage spike detected: ${rate.spike.ratio}x the ${rate.average.windowDays}-day average`,
      percentUsed: rate.spike.ratio * 100,
    });
  }

  return {
    alerts,
    status: alerts.length === 0 ? "All clear - no alerts triggered." : undefined,
    hint: "For the new alarm system with sound and per-model tracking, use add_alarm and check_alarms.",
  };
}
