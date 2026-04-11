import { readdir, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

interface SessionEntry {
  sessionId: string;
  cwd: string;
  startedAt: number;
  name?: string;
  kind?: string;
}

export async function getSessionHistory(limit: number = 10) {
  const sessionsDir = join(homedir(), ".claude", "sessions");
  const sessions: SessionEntry[] = [];

  try {
    const files = await readdir(sessionsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(sessionsDir, file), "utf-8");
        const data = JSON.parse(raw);
        if (data.sessionId && data.startedAt) {
          sessions.push({
            sessionId: data.sessionId,
            cwd: data.cwd ?? "unknown",
            startedAt: data.startedAt,
            name: data.name,
            kind: data.kind,
          });
        }
      } catch {
        // skip unparseable files
      }
    }
  } catch {
    return { sessions: [], error: "Could not read sessions directory." };
  }

  // Sort by most recent first
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  const recent = sessions.slice(0, limit);

  return {
    total: sessions.length,
    showing: recent.length,
    sessions: recent.map((s) => ({
      sessionId: s.sessionId,
      project: s.cwd,
      startedAt: new Date(s.startedAt).toISOString(),
      name: s.name,
      kind: s.kind,
    })),
  };
}
