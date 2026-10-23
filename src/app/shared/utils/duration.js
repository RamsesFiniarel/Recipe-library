import { t } from "../i18n/i18n.js";

/** Durations as recipes write them ("30min", "1h30", "2j 3h 50min", "2d" in
 * English), read as minutes and written back in that short form. */

const UNIT_MINUTES = { j: 24 * 60, h: 60, min: 1 };

/** Characters a duration field accepts: digits and j (or d), h, min. */
export const DURATION_CHARS = /^[0-9 .,jdhminJDHMIN]*$/;

/** Minutes in `text`, or null. A bare number after hours, or alone, is
 * minutes ("1h30"). */
export function parseDuration(text) {
  let minutes = 0;
  let found = false;
  let previousUnit = null;
  for (const [, number, letter] of String(text ?? "").toLowerCase().matchAll(/(\d+(?:[.,]\d+)?)\s*([a-z]?)/g)) {
    // Read by the unit's first letter: "j" / "d", "h", "m" / "min".
    const unit = { j: "j", d: "j", h: "h", m: "min" }[letter] ?? (previousUnit === "j" ? "h" : "min");
    minutes += Number(number.replace(",", ".")) * UNIT_MINUTES[unit];
    found = true;
    previousUnit = unit;
  }
  return found && minutes > 0 ? Math.round(minutes) : null;
}

/** 90 -> "1h 30min", 3110 -> "2j 3h 50min" ("2d 3h 50min"). */
export function formatDuration(minutes) {
  if (!minutes) return "";
  const days = Math.floor(minutes / UNIT_MINUTES.j);
  const hours = Math.floor((minutes % UNIT_MINUTES.j) / UNIT_MINUTES.h);
  const rest = minutes % UNIT_MINUTES.h;
  return [days && `${days}${t("duration.days")}`, hours && `${hours}h`, rest && `${rest}min`].filter(Boolean).join(" ");
}
