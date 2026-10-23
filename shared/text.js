/** Text helpers shared by server and client, so both fold accents alike. */

// Combining diacritical marks, i.e. what NFD splits accented letters into.
const COMBINING_MARKS = /[̀-ͯ]/g;

/** "Été" -> "Ete" (case preserved). */
function stripDiacritics(value) {
  return value.normalize("NFD").replace(COMBINING_MARKS, "");
}

/** Case- and accent-insensitive form for comparisons. Ligatures are spelled
 * out (NFD keeps them): "Œufs" matches "oeufs". */
export function foldForSearch(value) {
  return stripDiacritics(value).toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae");
}
