import { stableUnitFromId } from "@shared/palette.js";

// Spine width tiers by recipe count: 0.7x (one recipe) to 2.5x (20+).
const WIDTH_TIERS = [
  { max: 1, multiplier: 0.7 },
  { max: 3, multiplier: 0.85 },
  { max: 6, multiplier: 1.05 },
  { max: 9, multiplier: 1.3 },
  { max: 13, multiplier: 1.6 },
  { max: 17, multiplier: 2.0 },
  { max: Infinity, multiplier: 2.5 },
];

const HEIGHT_VARIATION = 0.1;

export function widthMultiplierForRecipeCount(recipeCount) {
  const count = Math.max(0, recipeCount || 0);
  return WIDTH_TIERS.find((tier) => count <= tier.max).multiplier;
}

/** Stable +/-10% height jitter: identical from one visit to the next. */
export function heightMultiplierForId(id) {
  const unit = stableUnitFromId(id, "height"); // [0, 1)
  return 1 + (unit * 2 - 1) * HEIGHT_VARIATION;
}
