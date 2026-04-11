import { readAlertConfig, writeAlertConfig } from "../alert-config.js";

export async function removeAlarm(name: string) {
  const config = await readAlertConfig();
  const before = config.alarms.length;
  config.alarms = config.alarms.filter((a) => a.name !== name);

  if (config.alarms.length === before) {
    return { message: `Alarm "${name}" not found.`, removed: false };
  }

  await writeAlertConfig(config);
  return { message: `Alarm "${name}" removed.`, removed: true, remaining: config.alarms.length };
}
