// Outer cross-section of book-rigged.glb (local x/z), from the back board's
// fore-edge round the spine to its apex; the cover side mirrors it. Face
// pictures follow this outline, neighbours sharing a point.
const HALF_OUTLINE = [
  [-0.147, -0.665],
  [-0.147, 0.4484],
  [-0.1395, 0.4821],
  [-0.147, 0.5158],
  [-0.147, 0.5798],
  [-0.1448, 0.607],
  [-0.138, 0.6222],
  [-0.1271, 0.6363],
  [-0.1124, 0.6486],
  [-0.0945, 0.6587],
  [-0.074, 0.6663],
  [-0.0519, 0.6709],
  [-0.0288, 0.6726],
  [0, 0.6727],
];
// Index in HALF_OUTLINE where the board ends and the rounded spine starts.
const SPINE_START = 5;

export const OUTLINE = [...HALF_OUTLINE, ...HALF_OUTLINE.slice(0, -1).reverse().map(([x, z]) => [-x, z])];
export const SPINE_START_INDEX = SPINE_START;
export const SPINE_END_INDEX = OUTLINE.length - 1 - SPINE_START;

function length(points, widthScale) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot((points[i][0] - points[i - 1][0]) * widthScale, points[i][1] - points[i - 1][1]);
  }
  return total;
}

/** Lengths (model units) of a board and of the spine along the outline once
 * the width multiplier applies; with the height (1.883 x multiplier), a
 * face picture's aspect. */
export function faceLengths(widthMultiplier = 1) {
  return {
    board: length(OUTLINE.slice(0, SPINE_START_INDEX + 1), widthMultiplier),
    spine: length(OUTLINE.slice(SPINE_START_INDEX, SPINE_END_INDEX + 1), widthMultiplier),
    height: 1.883,
  };
}
