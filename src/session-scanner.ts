import { readdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface TokenBucket {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  messageCount: number;
  byModel: Record<string, number>;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

export function emptyBucket(): TokenBucket {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    messageCount: 0,
    byModel: {},
  };
}

interface ScanOptions {
  cutoffTime?: Date;
  sessionId?: string;
  model?: string;
}

export async function scanAllSessions(options: ScanOptions = {}): Promise<TokenBucket> {
  const projectsDir = join(homedir(), ".claude", "projects");
  const result = emptyBucket();

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

      // If filtering by sessionId, skip non-matching files
      // (session JSONL filenames are {sessionId}.jsonl)
      if (options.sessionId && !file.startsWith(options.sessionId)) continue;

      try {
        const raw = await readFile(join(projPath, file), "utf-8");
        const lines = raw.split("\n").filter((l) => l.trim());

        // Optimization: skip old files
        if (options.cutoffTime && lines.length > 0) {
          try {
            const lastLine = JSON.parse(lines[lines.length - 1]);
            if (lastLine.timestamp && new Date(lastLine.timestamp) < options.cutoffTime) {
              continue;
            }
          } catch { /* scan anyway */ }
        }

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "assistant") continue;
            if (!entry.message?.usage) continue;

            const ts = entry.timestamp ? new Date(entry.timestamp) : null;
            if (options.cutoffTime && ts && ts < options.cutoffTime) continue;

            const model: string = entry.message.model ?? "unknown";
            if (options.model && model !== options.model) continue;

            const usage = entry.message.usage;
            const input = usage.input_tokens ?? 0;
            const output = usage.output_tokens ?? 0;
            const cacheCreation = usage.cache_creation_input_tokens ?? 0;
            const cacheRead = usage.cache_read_input_tokens ?? 0;
            const msgTotal = input + output + cacheCreation + cacheRead;

            result.inputTokens += input;
            result.outputTokens += output;
            result.cacheCreationTokens += cacheCreation;
            result.cacheReadTokens += cacheRead;
            result.totalTokens += msgTotal;
            result.messageCount += 1;
            result.byModel[model] = (result.byModel[model] ?? 0) + msgTotal;

            const tsStr = entry.timestamp as string | undefined;
            if (tsStr) {
              if (!result.firstTimestamp || tsStr < result.firstTimestamp) {
                result.firstTimestamp = tsStr;
              }
              if (!result.lastTimestamp || tsStr > result.lastTimestamp) {
                result.lastTimestamp = tsStr;
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }

  return result;
}

/**
 * Detect the current session window start time.
 * Scans recent messages across all sessions, finds the last gap >= 5 hours,
 * and rounds the first post-gap message to the nearest UTC hour.
 * This matches how Anthropic's rate limit window works.
 */
export async function detectSessionWindowStart(): Promise<{ start: Date; end: Date }> {
  const SESSION_DURATION_MS = 5 * 60 * 60 * 1000;
  const now = new Date();
  // Look back up to 24 hours for activity
  const lookback = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const projectsDir = join(homedir(), ".claude", "projects");
  const allTimestamps: number[] = [];

  let projectDirs: string[];
  try {
    projectDirs = await readdir(projectsDir);
  } catch {
    // Fallback: round current hour - 5h
    const fallbackStart = roundToHour(new Date(now.getTime() - SESSION_DURATION_MS));
    return { start: fallbackStart, end: new Date(fallbackStart.getTime() + SESSION_DURATION_MS) };
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

        // Quick skip: check last line timestamp
        for (let i = lines.length - 1; i >= 0; i--) {
          if (!lines[i].trim()) continue;
          try {
            const last = JSON.parse(lines[i]);
            if (last.timestamp && new Date(last.timestamp) < lookback) break;
          } catch {}
          break;
        }

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== "assistant" || !entry.timestamp) continue;
            const ts = new Date(entry.timestamp).getTime();
            if (ts >= lookback.getTime()) {
              allTimestamps.push(ts);
            }
          } catch {}
        }
      } catch {}
    }
  }

  if (allTimestamps.length === 0) {
    const fallbackStart = roundToHour(now);
    return { start: fallbackStart, end: new Date(fallbackStart.getTime() + SESSION_DURATION_MS) };
  }

  // Sort chronologically
  allTimestamps.sort((a, b) => a - b);

  // Walk backwards from the end, find the last gap >= 5 hours
  let sessionStartTs = allTimestamps[0];
  for (let i = allTimestamps.length - 1; i > 0; i--) {
    const gap = allTimestamps[i] - allTimestamps[i - 1];
    if (gap >= SESSION_DURATION_MS) {
      // Gap found — session starts at the message after the gap
      sessionStartTs = allTimestamps[i];
      break;
    }
  }

  let start = roundToHour(new Date(sessionStartTs));
  let end = new Date(start.getTime() + SESSION_DURATION_MS);

  // If we've passed the window end, advance to the current window.
  // Anthropic resets windows on a fixed schedule, so each window is
  // exactly 5 hours after the previous one started.
  while (end.getTime() <= now.getTime()) {
    start = new Date(start.getTime() + SESSION_DURATION_MS);
    end = new Date(start.getTime() + SESSION_DURATION_MS);
  }

  return { start, end };
}

function roundToHour(d: Date): Date {
  const rounded = new Date(d);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

export async function getLatestSessionId(): Promise<string | null> {
  const sessionsDir = join(homedir(), ".claude", "sessions");
  try {
    const files = await readdir(sessionsDir);
    let latest: { sessionId: string; startedAt: number } | null = null;

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(sessionsDir, file), "utf-8");
        const data = JSON.parse(raw);
        if (data.sessionId && data.startedAt) {
          if (!latest || data.startedAt > latest.startedAt) {
            latest = { sessionId: data.sessionId, startedAt: data.startedAt };
          }
        }
      } catch { /* skip */ }
    }
    return latest?.sessionId ?? null;
  } catch {
    return null;
  }
}
