import { exec } from "child_process";

export function playAlarmSound(level: "info" | "warning" | "critical"): void {
  let psCommand: string;
  switch (level) {
    case "critical":
      // 3 high-pitched beeps
      psCommand = `
        [console]::beep(1000, 300);
        Start-Sleep -Milliseconds 100;
        [console]::beep(1000, 300);
        Start-Sleep -Milliseconds 100;
        [console]::beep(1000, 500)
      `;
      break;
    case "warning":
      // 2 medium beeps
      psCommand = `
        [console]::beep(750, 300);
        Start-Sleep -Milliseconds 150;
        [console]::beep(750, 300)
      `;
      break;
    default:
      // 1 gentle beep
      psCommand = `[console]::beep(500, 200)`;
      break;
  }

  exec(`powershell -NoProfile -Command "${psCommand.replace(/\n/g, " ")}"`, () => {});
}
