import { readdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

// Peak hours: 13:00-19:00 UTC on weekdays (Mon-Fri)
// Tokens during peak count as ~2x against your budget
const PEAK_START_UTC = 13;
const PEAK_END_UTC = 19;
const PEAK_MULTIPLIER = 2.0;

function getMultiplierForTimestamp(ts: Date): number {
  const utcHour = ts.getUTCHours();
  const utcDay = ts.getUTCDay(); // 0=Sun, 6=Sat
  const isWeekday = utcDay >= 1 && utcDay <= 5;
  const isPeakHour = utcHour >= PEAK_START_UTC && utcHour < PEAK_END_UTC;
  return (isWeekday && isPeakHour) ? PEAK_MULTIPLIER : 1.0;
}

export interface WeightedUsage {
  rawOutputTokens: number;
  weightedOutputTokens: number;
  peakOutputTokens: number;
  offPeakOutputTokens: number;
  messageCount: number;
  byModel: Record<string, { raw: number; weighted: number }>;
}

interface WeightedScanOptions {
  cutoffTime: Date;
  model?: string;
}

export async function scanWeightedUsage(options: WeightedScanOptions): Promise<WeightedUsage> {
  const projectsDir = join(homedir(), ".claude", "projects");
  const result: WeightedUsage = {
    rawOutputTokens: 0,
    weightedOutputTokens: 0,
    peakOutputTokens: 0,
    offPeakOutputTokens: 0,
    messageCount: 0,
    byModel: {},
  };

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    return result;
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
        const raw = await readFile(join(projPath, file), "utf-8");
        const lines = raw.split("\n");

        // Skip old files
        if (lines.length > 1) {
          for (let i = lines.length - 1; i >= 0; i--) {
            if (!lines[i].trim()) continue;
            try {
              const last = JSON.parse(lines[i]);
              if (last.timestamp && new Date(last.timestamp) < options.cutoffTime) {
                // File is too old, skip entirely
                break;
              }
            } catch {}
            break;
          }
        }

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "assistant" || !entry.message?.usage || !entry.timestamp) continue;

            const ts = new Date(entry.timestamp);
            if (ts < options.cutoffTime) continue;

            const model: string = entry.message.model ?? "unknown";
            if (options.model && model !== options.model) continue;

            const outputTokens = entry.message.usage.output_tokens ?? 0;
            if (outputTokens === 0) continue;

            const multiplier = getMultiplierForTimestamp(ts);
            const weighted = outputTokens * multiplier;

            result.rawOutputTokens += outputTokens;
            result.weightedOutputTokens += weighted;
            result.messageCount += 1;

            if (multiplier > 1) {
              result.peakOutputTokens += outputTokens;
            } else {
              result.offPeakOutputTokens += outputTokens;
            }

            // Per-model tracking
            if (!result.byModel[model]) {
              result.byModel[model] = { raw: 0, weighted: 0 };
            }
            result.byModel[model].raw += outputTokens;
            result.byModel[model].weighted += weighted;
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }

  return result;
}
