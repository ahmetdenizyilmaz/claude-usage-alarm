import { readAlertConfig, writeAlertConfig } from "../alert-config.js";

interface LegacyParams {
  dailyBudget?: number;
  weeklyBudget?: number;
  monthlyBudget?: number;
  fiveHourBudget?: number;
  thresholds?: number[];
  spikeMultiplier?: number;
}

// Legacy budget store (separate from the new alarm system)
import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGACY_PATH = join(__dirname, "..", "..", "legacy-budgets.json");

const DEFAULTS = {
  dailyBudget: 5_000_000,
  weeklyBudget: 25_000_000,
  monthlyBudget: 80_000_000,
  fiveHourBudget: 5_000_000,
  thresholds: [50, 75, 90],
  spikeMultiplier: 2.0,
};

async function readLegacy(): Promise<typeof DEFAULTS> {
  try {
    const raw = await readFile(LEGACY_PATH, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setAlertThreshold(params: LegacyParams) {
  const current = await readLegacy();
  const updated = { ...current, ...params };
  await writeFile(LEGACY_PATH, JSON.stringify(updated, null, 2), "utf-8");
  return { message: "Legacy budget config updated.", config: updated };
}
