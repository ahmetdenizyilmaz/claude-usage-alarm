import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { scanAllSessions } from "./session-scanner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIMITS_PATH = join(__dirname, "..", "limits-config.json");

// Hardcoded estimates per plan (output tokens per 5h window)
// Based on community analysis (Claude-Code-Usage-Monitor project)
// Hardcoded estimates per plan (output tokens)
// These are rough estimates — use recalculate_limits to refine via P90 analysis
// or manually adjust via set_plan_limits after observing /usage %
const PLAN_DEFAULTS: Record<string, PlanLimits> = {
  pro: {
    sessionOutputTokens: 45_000,
    weeklyOutputTokens: 225_000,
    sonnetSessionOutputTokens: 45_000,
  },
  max5: {
    sessionOutputTokens: 175_000,
    weeklyOutputTokens: 875_000,
    sonnetSessionOutputTokens: 175_000,
  },
  max20: {
    sessionOutputTokens: 375_000,
    weeklyOutputTokens: 2_500_000,
    sonnetSessionOutputTokens: 375_000,
  },
};

export interface PlanLimits {
  sessionOutputTokens: number;
  weeklyOutputTokens: number;
  sonnetSessionOutputTokens: number;
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
 * Get the effective limits — adaptive if available and enabled, otherwise hardcoded
 */
export async function getEffectiveLimits(): Promise<PlanLimits & { source: "hardcoded" | "adaptive" }> {
  const config = await readLimitsConfig();

  if (
    config.useAdaptive &&
    config.adaptive.sessionOutputTokens !== null &&
    config.adaptive.sampleCount >= 3
  ) {
    return {
      sessionOutputTokens: config.adaptive.sessionOutputTokens,
      weeklyOutputTokens: config.adaptive.weeklyOutputTokens ?? config.hardcoded.weeklyOutputTokens,
      sonnetSessionOutputTokens:
        config.adaptive.sonnetSessionOutputTokens ?? config.hardcoded.sonnetSessionOutputTokens,
      source: "adaptive",
    };
  }

  return { ...config.hardcoded, source: "hardcoded" };
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
 * Get current session output tokens and weekly output tokens for percentage calculation
 */
export async function getCurrentUsageForPercent() {
  const now = new Date();

  // Session = last 5 hours
  const sessionCutoff = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const sessionBucket = await scanAllSessions({ cutoffTime: sessionCutoff });

  // Weekly = last 7 days
  const weeklyCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weeklyBucket = await scanAllSessions({ cutoffTime: weeklyCutoff });

  // Sonnet session = last 5 hours, sonnet only
  const sonnetBucket = await scanAllSessions({
    cutoffTime: sessionCutoff,
    model: "claude-sonnet-4-6",
  });

  return {
    sessionOutputTokens: sessionBucket.outputTokens,
    weeklyOutputTokens: weeklyBucket.outputTokens,
    sonnetSessionOutputTokens: sonnetBucket.outputTokens,
    sessionDetails: {
      totalTokens: sessionBucket.totalTokens,
      messageCount: sessionBucket.messageCount,
      byModel: sessionBucket.byModel,
    },
  };
}
