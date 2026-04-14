import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { scanAllSessions, detectSessionWindowStart } from "./session-scanner.js";
import { scanWeightedUsage } from "./weighted-scanner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIMITS_PATH = join(__dirname, "..", "limits-config.json");

// Hardcoded estimates per plan (output tokens per 5h window)
// Based on community analysis (Claude-Code-Usage-Monitor project)
// Base estimates per plan (output tokens) — these are OFF-PEAK limits.
// During peak hours (13:00-19:00 UTC, weekdays), tokens consume at ~2x rate,
// so effective limit is halved.
const PLAN_DEFAULTS: Record<string, PlanLimits> = {
  pro: {
    sessionOutputTokens: 90_000,
    weeklyOutputTokens: 450_000,
    sonnetSessionOutputTokens: 90_000,
  },
  max5: {
    sessionOutputTokens: 350_000,
    weeklyOutputTokens: 1_750_000,
    sonnetSessionOutputTokens: 350_000,
  },
  max20: {
    sessionOutputTokens: 750_000,
    weeklyOutputTokens: 5_000_000,
    sonnetSessionOutputTokens: 750_000,
  },
};

// Peak hours: 13:00-19:00 UTC on weekdays (Mon-Fri)
// During peak, tokens count ~2x against your budget
const PEAK_START_UTC = 13;
const PEAK_END_UTC = 19;
const PEAK_MULTIPLIER = 2.0;

export function getCurrentMultiplier(): { multiplier: number; isPeak: boolean; peakHoursUTC: string } {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay(); // 0=Sun, 6=Sat

  const isWeekday = utcDay >= 1 && utcDay <= 5;
  const isPeakHour = utcHour >= PEAK_START_UTC && utcHour < PEAK_END_UTC;
  const isPeak = isWeekday && isPeakHour;

  return {
    multiplier: isPeak ? PEAK_MULTIPLIER : 1.0,
    isPeak,
    peakHoursUTC: `${PEAK_START_UTC}:00-${PEAK_END_UTC}:00 UTC (weekdays)`,
  };
}

export interface PlanLimits {
  sessionOutputTokens: number;
  weeklyOutputTokens: number;
  sonnetSessionOutputTokens: number;
}

export interface WeekResetConfig {
  /**
   * Any known future reset time as an ISO datetime.
   * The tracker rolls this forward in 7-day increments to find the current week window.
   * Example: "2026-04-20T15:00:00+03:00" (Monday 3pm Europe/Istanbul).
   */
  anchorISO: string | null;
  /**
   * Optional separate anchor for the Sonnet-only weekly budget (some plans reset it on a different schedule).
   */
  sonnetAnchorISO: string | null;
}

export interface LimitsConfig {
  plan: string;
  hardcoded: PlanLimits;
  adaptive: {
    sessionOutputTokens: number | null;
    weeklyOutputTokens: number | null;
    sonnetSessionOutputTokens: number | null;
    sampleCount: number;
    lastCalculated: string | null;
  };
  useAdaptive: boolean;
  weekReset: WeekResetConfig;
}

function defaultConfig(): LimitsConfig {
  return {
    plan: "max20",
    hardcoded: { ...PLAN_DEFAULTS.max20 },
    adaptive: {
      sessionOutputTokens: null,
      weeklyOutputTokens: null,
      sonnetSessionOutputTokens: null,
      sampleCount: 0,
      lastCalculated: null,
    },
    useAdaptive: true,
    weekReset: {
      anchorISO: null,
      sonnetAnchorISO: null,
    },
  };
}

export async function readLimitsConfig(): Promise<LimitsConfig> {
  try {
    const raw = await readFile(LIMITS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...defaultConfig(), ...parsed };
  } catch {
    return defaultConfig();
  }
}

export async function writeLimitsConfig(config: LimitsConfig): Promise<void> {
  await writeFile(LIMITS_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function setPlan(plan: string): Promise<LimitsConfig> {
  const config = await readLimitsConfig();
  const planKey = plan.toLowerCase().replace(/\s+/g, "");
  if (!(planKey in PLAN_DEFAULTS)) {
    throw new Error(`Unknown plan: ${plan}. Valid plans: ${Object.keys(PLAN_DEFAULTS).join(", ")}`);
  }
  config.plan = planKey;
  config.hardcoded = { ...PLAN_DEFAULTS[planKey] };
  await writeLimitsConfig(config);
  return config;
}

export async function setCustomLimits(limits: Partial<PlanLimits>): Promise<LimitsConfig> {
  const config = await readLimitsConfig();
  if (limits.sessionOutputTokens !== undefined) config.hardcoded.sessionOutputTokens = limits.sessionOutputTokens;
  if (limits.weeklyOutputTokens !== undefined) config.hardcoded.weeklyOutputTokens = limits.weeklyOutputTokens;
  if (limits.sonnetSessionOutputTokens !== undefined) config.hardcoded.sonnetSessionOutputTokens = limits.sonnetSessionOutputTokens;
  await writeLimitsConfig(config);
  return config;
}


/**
 * Compute the current week window [start, end] based on a known reset anchor.
 */
export function getWeekWindow(
  anchorISO: string | null,
  now: Date = new Date()
): { start: Date; end: Date; source: "anchor" | "rolling" } {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  if (!anchorISO) {
    return { start: new Date(now.getTime() - WEEK_MS), end: now, source: "rolling" };
  }
  const anchor = new Date(anchorISO);
  if (isNaN(anchor.getTime())) {
    return { start: new Date(now.getTime() - WEEK_MS), end: now, source: "rolling" };
  }
  let nextReset = new Date(anchor.getTime());
  while (nextReset.getTime() <= now.getTime()) {
    nextReset = new Date(nextReset.getTime() + WEEK_MS);
  }
  while (nextReset.getTime() - WEEK_MS > now.getTime()) {
    nextReset = new Date(nextReset.getTime() - WEEK_MS);
  }
  const start = new Date(nextReset.getTime() - WEEK_MS);
  return { start, end: nextReset, source: "anchor" };
}

export async function setWeekReset(opts: {
  anchorISO?: string | null;
  sonnetAnchorISO?: string | null;
}): Promise<LimitsConfig> {
  const config = await readLimitsConfig();
  if (opts.anchorISO !== undefined) config.weekReset.anchorISO = opts.anchorISO;
  if (opts.sonnetAnchorISO !== undefined) config.weekReset.sonnetAnchorISO = opts.sonnetAnchorISO;
  await writeLimitsConfig(config);
  return config;
}

/**
 * Get the base limits — no multiplier adjustment here.
 * Tokens are weighted at scan time instead (peak tokens count as 2x).
 */
export async function getEffectiveLimits(): Promise<PlanLimits & { source: "hardcoded" | "adaptive"; isPeak: boolean; multiplier: number }> {
  const config = await readLimitsConfig();
  const { multiplier, isPeak } = getCurrentMultiplier();

  let baseLimits: PlanLimits;
  let source: "hardcoded" | "adaptive";

  if (
    config.useAdaptive &&
    config.adaptive.sessionOutputTokens !== null &&
    config.adaptive.sampleCount >= 3
  ) {
    baseLimits = {
      sessionOutputTokens: config.adaptive.sessionOutputTokens,
      weeklyOutputTokens: config.adaptive.weeklyOutputTokens ?? config.hardcoded.weeklyOutputTokens,
      sonnetSessionOutputTokens:
        config.adaptive.sonnetSessionOutputTokens ?? config.hardcoded.sonnetSessionOutputTokens,
    };
    source = "adaptive";
  } else {
    baseLimits = { ...config.hardcoded };
    source = "hardcoded";
  }

  return {
    ...baseLimits,
    source,
    isPeak,
    multiplier,
  };
}

/**
 * P90 adaptive calculation:
 * Scan historical sessions, find ones that likely hit the rate limit
 * (sessions where token output plateaued or was near max),
 * then take the 90th percentile as the estimated cap.
 */
export async function recalculateAdaptiveLimits(): Promise<LimitsConfig> {
  const config = await readLimitsConfig();
  const { homedir } = await import("os");
  const { readdir, readFile: rf } = await import("fs/promises");

  const projectsDir = join(homedir(), ".claude", "projects");
  const sessionOutputTotals: number[] = [];
  const sonnetOutputTotals: number[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return config;
  }

  for (const projDir of projectDirs) {
    const projPath = join(projectsDir, projDir);
    let files: string[];
    try {
      files = await readdir(projPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      try {
        const raw = await rf(join(projPath, file), "utf-8");
        const lines = raw.split("\n").filter((l) => l.trim());

        // Group messages into 5-hour blocks
        const blocks: Map<string, { output: number; sonnetOutput: number }> = new Map();

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "assistant" || !entry.message?.usage || !entry.timestamp) continue;

            const ts = new Date(entry.timestamp);
            // Block key: 5-hour window from start of day
            const blockIndex = Math.floor(ts.getHours() / 5);
            const blockKey = `${ts.toISOString().slice(0, 10)}-${blockIndex}`;

            const current = blocks.get(blockKey) ?? { output: 0, sonnetOutput: 0 };
            const output = entry.message.usage.output_tokens ?? 0;
            current.output += output;

            const model: string = entry.message.model ?? "";
            if (model.includes("sonnet")) {
              current.sonnetOutput += output;
            }

            blocks.set(blockKey, current);
          } catch { /* skip */ }
        }

        for (const block of blocks.values()) {
          if (block.output > 0) {
            sessionOutputTotals.push(block.output);
          }
          if (block.sonnetOutput > 0) {
            sonnetOutputTotals.push(block.sonnetOutput);
          }
        }
      } catch { /* skip */ }
    }
  }

  // Filter to high-usage blocks only (top 25%) — these are the ones
  // that likely approached the rate limit. Then take P90 of those.
  if (sessionOutputTotals.length >= 3) {
    sessionOutputTotals.sort((a, b) => a - b);
    const topQuartileStart = Math.floor(sessionOutputTotals.length * 0.75);
    const topBlocks = sessionOutputTotals.slice(topQuartileStart);
    const p90Index = Math.floor(topBlocks.length * 0.9);
    config.adaptive.sessionOutputTokens = topBlocks[p90Index];
    config.adaptive.sampleCount = sessionOutputTotals.length;
  }

  if (sonnetOutputTotals.length >= 3) {
    sonnetOutputTotals.sort((a, b) => a - b);
    const topQuartileStart = Math.floor(sonnetOutputTotals.length * 0.75);
    const topBlocks = sonnetOutputTotals.slice(topQuartileStart);
    const p90Index = Math.floor(topBlocks.length * 0.9);
    config.adaptive.sonnetSessionOutputTokens = topBlocks[p90Index];
  }

  // Weekly = roughly session limit * (7 days * 24h / 5h window) but scaled down
  // since you won't be using Claude 24/7. Use 5x session as a rough weekly cap.
  if (config.adaptive.sessionOutputTokens !== null) {
    config.adaptive.weeklyOutputTokens = config.adaptive.sessionOutputTokens * 5;
  }

  config.adaptive.lastCalculated = new Date().toISOString();
  await writeLimitsConfig(config);
  return config;
}

/**
 * Get current usage with per-token peak/off-peak weighting.
 * Each token is multiplied by the rate at the time it was consumed:
 *   - Peak (13:00-19:00 UTC weekdays): 2x
 *   - Off-peak: 1x
 * The weighted total divided by the base (off-peak) budget gives accurate %.
 */
export async function getCurrentUsageForPercent() {
  const now = new Date();
  const config = await readLimitsConfig();

  // Detect actual session window via gap analysis
  const sessionWindow = await detectSessionWindowStart();

  // Weekly windows use the configured anchors (if any) so the tracker matches
  // the plan-specific reset time shown by `/usage`, instead of a raw 7-day slice.
  const weekWindow = getWeekWindow(config.weekReset.anchorISO, now);
  const sonnetWeekWindow = getWeekWindow(
    config.weekReset.sonnetAnchorISO ?? config.weekReset.anchorISO,
    now
  );

  // Weighted scans — each token multiplied by its time-of-day rate
  const [sessionWeighted, weeklyWeighted, sonnetWeighted] = await Promise.all([
    scanWeightedUsage({ cutoffTime: sessionWindow.start }),
    scanWeightedUsage({ cutoffTime: weekWindow.start }),
    scanWeightedUsage({ cutoffTime: sonnetWeekWindow.start, model: "claude-sonnet-4-6" }),
  ]);

  return {
    // Use weighted tokens for percentage calculation
    sessionOutputTokens: sessionWeighted.weightedOutputTokens,
    weeklyOutputTokens: weeklyWeighted.weightedOutputTokens,
    sonnetSessionOutputTokens: sonnetWeighted.weightedOutputTokens,
    sessionWindow: {
      start: sessionWindow.start.toISOString(),
      end: sessionWindow.end.toISOString(),
    },
    weekWindow: {
      start: weekWindow.start.toISOString(),
      end: weekWindow.end.toISOString(),
      source: weekWindow.source,
    },
    sonnetWeekWindow: {
      start: sonnetWeekWindow.start.toISOString(),
      end: sonnetWeekWindow.end.toISOString(),
      source: sonnetWeekWindow.source,
    },
    sessionDetails: {
      rawOutputTokens: sessionWeighted.rawOutputTokens,
      weightedOutputTokens: sessionWeighted.weightedOutputTokens,
      peakTokens: sessionWeighted.peakOutputTokens,
      offPeakTokens: sessionWeighted.offPeakOutputTokens,
      messageCount: sessionWeighted.messageCount,
    },
  };
}
