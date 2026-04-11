import { readAlertConfig } from "../alert-config.js";

export async function listAlarms() {
  const config = await readAlertConfig();

  if (config.alarms.length === 0) {
    return {
      soundEnabled: config.soundEnabled,
      alarms: [],
      message: "No alarms configured. Use add_alarm to create one.",
    };
  }

  return {
    soundEnabled: config.soundEnabled,
    alarms: config.alarms.map((a) => ({
      name: a.name,
      type: a.type,
      metric: a.metric,
      threshold: a.threshold,
      budget: a.budget,
      model: a.model,
      sound: a.sound,
      enabled: a.enabled,
    })),
  };
}
