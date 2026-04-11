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
