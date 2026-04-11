import { readAlertConfig, writeAlertConfig } from "../alert-config.js";

export async function toggleSound(enabled?: boolean) {
  const config = await readAlertConfig();
  config.soundEnabled = enabled ?? !config.soundEnabled;
  await writeAlertConfig(config);
  return {
    soundEnabled: config.soundEnabled,
    message: config.soundEnabled ? "Sound alarms enabled." : "Sound alarms disabled.",
  };
}
