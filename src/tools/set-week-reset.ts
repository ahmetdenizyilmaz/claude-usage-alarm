import { setWeekReset } from "../limits.js";

export interface SetWeekResetParams {
  nextReset?: string | null;
  sonnetNextReset?: string | null;
}

export async function setWeekResetTool(params: SetWeekResetParams) {
  const { nextReset, sonnetNextReset } = params;

  // `null` explicitly clears; `undefined` leaves untouched.
  if (nextReset !== undefined && nextReset !== null) {
    const d = new Date(nextReset);
    if (isNaN(d.getTime())) {
      throw new Error(
        `Invalid nextReset: ${nextReset}. Expected ISO datetime like "2026-04-20T15:00:00+03:00".`
      );
    }
  }
  if (sonnetNextReset !== undefined && sonnetNextReset !== null) {
    const d = new Date(sonnetNextReset);
    if (isNaN(d.getTime())) {
      throw new Error(
        `Invalid sonnetNextReset: ${sonnetNextReset}. Expected ISO datetime.`
      );
    }
  }

  const config = await setWeekReset({
    anchorISO: nextReset === null ? null : nextReset,
    sonnetAnchorISO: sonnetNextReset === null ? null : sonnetNextReset,
  });

  return {
    message:
      "Week reset anchors saved. The weekly budget window now rolls forward 7 days at a time from this anchor.",
    weekReset: config.weekReset,
  };
}
