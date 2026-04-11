import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface DailyModelTokens {
  date: string;
  tokensByModel: Record<string, number>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
}

export interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, ModelUsage>;
  totalSessions: number;
  totalMessages: number;
  hourCounts: Record<string, number>;
  firstSessionDate: string;
}

const STATS_PATH = join(homedir(), ".claude", "stats-cache.json");

export async function readStatsCache(): Promise<StatsCache> {
  const raw = await readFile(STATS_PATH, "utf-8");
  return JSON.parse(raw);
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getDateRange(period: "today" | "week" | "month"): [string, string] {
  const today = new Date();
  const end = formatDate(today);
  let start: string;
  switch (period) {
    case "today":
      start = end;
      break;
    case "week": {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 6);
      start = formatDate(weekAgo);
      break;
    }
    case "month":
      start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
      break;
  }
  return [start, end];
}

export function filterByDateRange<T extends { date: string }>(
  entries: T[],
  start: string,
  end: string
): T[] {
  return entries.filter((e) => e.date >= start && e.date <= end);
}

export function sumTokensByModel(
  entries: DailyModelTokens[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const entry of entries) {
    for (const [model, tokens] of Object.entries(entry.tokensByModel)) {
      totals[model] = (totals[model] ?? 0) + tokens;
    }
  }
  return totals;
}

export function sumActivity(entries: DailyActivity[]) {
  let messages = 0,
    sessions = 0,
    toolCalls = 0;
  for (const e of entries) {
    messages += e.messageCount;
    sessions += e.sessionCount;
    toolCalls += e.toolCallCount;
  }
  return { messages, sessions, toolCalls };
}
