import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export interface Alarm {
  name: string;
  type: "session" | "5h-window" | "daily" | "weekly" | "monthly" | "model" | "burn-rate";
  metric: "tokens" | "percent" | "tokens-per-hour";
  threshold: number;
  budget?: number;
  model?: string;
  sound: boolean;
  enabled: boolean;
}

export interface AlertConfig {
  soundEnabled: boolean;
  alarms: Alarm[];
}

const DEFAULT_CONFIG: AlertConfig = {
  soundEnabled: true,
  alarms: [],
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "alert-config.json");

export async function readAlertConfig(): Promise<AlertConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeAlertConfig(config: AlertConfig): Promise<AlertConfig> {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  return config;
}
