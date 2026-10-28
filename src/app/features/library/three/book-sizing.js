import { stableUnitFromId } from "@shared/palette.js";

// A book's width unless set in the edit panel: the same for every book,
// whatever its number of recipes.
export const DEFAULT_WIDTH_MULTIPLIER = 1;

const HEIGHT_VARIATION = 0.1;

/** Stable +/-10% height jitter: identical from one visit to the next. */
export function heightMultiplierForId(id) {
  const unit = stableUnitFromId(id, "height"); // [0, 1)
  return 1 + (unit * 2 - 1) * HEIGHT_VARIATION;
}
