import { readAlertConfig, writeAlertConfig, type Alarm } from "../alert-config.js";

export async function addAlarm(alarm: Alarm) {
  const config = await readAlertConfig();

  // Replace if same name exists
  config.alarms = config.alarms.filter((a) => a.name !== alarm.name);
  config.alarms.push(alarm);

  await writeAlertConfig(config);
  return {
    message: `Alarm "${alarm.name}" added.`,
    alarm,
    totalAlarms: config.alarms.length,
  };
}
