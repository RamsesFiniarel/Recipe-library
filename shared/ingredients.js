/** Structured ingredient lines, shared by the recipe editor, the server
 * (validation, nutrition) and free-text imports. A line is
 * { quantity, unit, name }:
 * - quantity: the number as typed ("250", "1,5", "1/2", "4-5"), or "";
 * - unit: a UNITS key ("g", "mL", "c.a.s"...) or "", shown in the interface
 *   language ("c.a.s" reads "tbsp" in English);
 * - name: free text, "de"/"d'" kept ("de farine"); counted forms ("gousses
 *   d'ail") stay in it and act as the measure for nutrition.
 * A name-only line ending with ":" is a heading ("Pour la sauce :"). */
import { foldForSearch } from "./text.js";

/** Units: masses, volumes, spoons and other kitchen measures. `grams`/`ml`
 * convert; a pinch weighs per ingredient (see the nutrition service).
 * `en`/`enPlural`: English label where different. */
const UNITS = [
  { key: "g", grams: 1, aliases: ["g", "gr", "gramme", "grammes", "gram", "grams"] },
  { key: "kg", grams: 1000, aliases: ["kg", "kilo", "kilos", "kilogramme", "kilogrammes", "kilogram", "kilograms"] },
  { key: "mg", grams: 0.001, aliases: ["mg", "milligramme", "milligrammes", "milligram", "milligrams"] },
  { key: "oz", grams: 28.35, aliases: ["oz", "ounce", "ounces"] },
  { key: "lb", grams: 453.6, aliases: ["lb", "lbs", "pound", "pounds"] },
  { key: "mL", ml: 1, aliases: ["ml", "millilitre", "millilitres", "milliliter", "milliliters"] },
  { key: "cL", ml: 10, aliases: ["cl", "centilitre", "centilitres", "centiliter", "centiliters"] },
  { key: "dL", ml: 100, aliases: ["dl", "decilitre", "decilitres", "deciliter", "deciliters"] },
  { key: "L", ml: 1000, aliases: ["l", "litre", "litres", "liter", "liters"] },
  {
    key: "c.a.s",
    en: "tbsp",
    ml: 15,
    aliases: ["cas", "cs", "tbsp", "tbs", "casoupe", "cuillereasoupe", "cuilleresasoupe", "tablespoon", "tablespoons"],
  },
  {
    key: "c.a.c",
    en: "tsp",
    ml: 5,
    aliases: [
      "cac", "cc", "tsp", "cacafe", "cathe", "cuillereacafe", "cuilleresacafe", "cuillereathe", "cuilleresathe",
      "teaspoon", "teaspoons",
    ],
  },
  { key: "tasse", plural: "tasses", en: "cup", enPlural: "cups", ml: 240, aliases: ["tasse", "tasses", "cup", "cups"] },
  {
    key: "verre",
    plural: "verres",
    en: "glass",
    enPlural: "glasses",
    ml: 200,
    aliases: ["verre", "verres", "glass", "glasses"],
  },
  {
    key: "pincée",
    plural: "pincées",
    en: "pinch",
    enPlural: "pinches",
    aliases: ["pincee", "pincees", "pinch", "pinches"],
  },
];

const UNIT_BY_KEY = new Map(UNITS.map((unit) => [unit.key, unit]));
const UNIT_BY_ALIAS = new Map(UNITS.flatMap((unit) => unit.aliases.map((alias) => [alias, unit])));
const ALIASES = [...UNIT_BY_ALIAS.keys()];
// The longest alias, in words ("cuillère à soupe" is three).
const MAX_UNIT_WORDS = 4;

export const MAX_QUANTITY_LENGTH = 16;
export const MAX_NAME_LENGTH = 500;
export const MAX_LINES = 200;
// Quantity characters: digits, decimal comma or point, fraction bar, range
// dash.
export const QUANTITY_CHARS = /^[0-9.,/-]*$/;

/** A typed unit without case, accents, dots or spaces ("c. à s." = "cas"). */
function normalizeUnitText(text) {
  return foldForSearch(text).replace(/[.\s]/g, "");
}

export function getUnit(key) {
  return UNIT_BY_KEY.get(key) ?? null;
}

/** The unit `text` spells out exactly, or null. */
export function findUnit(text) {
  return UNIT_BY_ALIAS.get(normalizeUnitText(text)) ?? null;
}

/** Whether `text` could still become a unit as more is typed. */
export function isUnitPrefix(text) {
  const normalized = normalizeUnitText(text);
  return normalized !== "" && ALIASES.some((alias) => alias.startsWith(normalized));
}

/** The quantity's value ("1,5" -> 1.5, "1/2" -> 0.5, a range -> its middle),
 * or null. */
export function parseQuantity(text) {
  const value = String(text ?? "").replace(/,/g, ".").trim();
  if (!value) return null;
  const range = value.split("-").filter(Boolean);
  if (range.length > 1) {
    const bounds = range.map(parseQuantity);
    return bounds.every((bound) => bound !== null) ? bounds.reduce((sum, b) => sum + b, 0) / bounds.length : null;
  }
  const [numerator, denominator] = value.split("/");
  const num = Number(numerator);
  if (denominator === undefined) return Number.isFinite(num) ? num : null;
  const den = Number(denominator);
  return Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? num / den : null;
}

// Measured by spoon, cup or hand: rounded to the half, like counted things.
const KITCHEN_MEASURES = new Set(["c.a.s", "c.a.c", "tasse", "verre", "pincée"]);
const FRACTIONS = new Map([
  [0.25, "1/4"],
  [0.5, "1/2"],
  [0.75, "3/4"],
]);

function roundScaled(value, metric) {
  const step = metric
    ? value >= 1000 ? 10 : value >= 100 ? 5 : value >= 10 ? 1 : value >= 1 ? 0.1 : 0.05
    : value >= 10 ? 1 : value >= 1 ? 0.5 : 0.25;
  return Math.max(step, Math.round(value / step) * step);
}

function formatScaled(value, metric, language) {
  const rounded = Math.round(value * 100) / 100;
  if (!metric && FRACTIONS.has(rounded)) return FRACTIONS.get(rounded);
  const text = String(rounded);
  return language === "fr" ? text.replace(".", ",") : text;
}

/** The quantity for `factor` times the servings ("1,5" x 2 -> "3"),
 * rounded as it's measured: weights and volumes to about two figures,
 * spoons, cups and counts to the half (quarter below one). Ranges scale
 * both ends; null if not a number. */
export function scaleQuantity(text, factor, unitKey, language = "fr") {
  const values = String(text ?? "").split("-").map(parseQuantity);
  if (values.some((value) => value === null)) return null;
  const metric = Boolean(unitKey) && !KITCHEN_MEASURES.has(unitKey);
  const bounds = values.map((value) => formatScaled(roundScaled(value * factor, metric), metric, language));
  return [...new Set(bounds)].join("-");
}

/** The unit's label after this quantity in "fr" or "en" ("tasses" from 2,
 * "cups" in English). */
export function unitLabel(key, quantity, language = "fr") {
  const unit = getUnit(key);
  if (!unit) return key ?? "";
  const many = (parseQuantity(quantity) ?? 0) >= 2;
  if (language === "en" && unit.en) return many && unit.enPlural ? unit.enPlural : unit.en;
  return many && unit.plural ? unit.plural : unit.key;
}

export function isHeading(line) {
  return !line.quantity && !line.unit && /:\s*$/.test(line.name);
}

export function isEmptyLine(line) {
  return !line.quantity && !line.unit && !line.name.trim();
}

const UNICODE_FRACTIONS = { "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3" };
const NUMBER = String.raw`\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?`;
const QUANTITY_PATTERN = new RegExp(`^(${NUMBER})(?:\\s*(?:-|–|—|à|ou|to|or)\\s*(${NUMBER}))?`);

/** Parses a written line ("- 250g de farine", "2 c. à soupe d'huile");
 * the name keeps the rest as is. */
export function parseIngredientLine(raw) {
  let text = String(raw ?? "")
    .replace(/[½¼¾⅓⅔]/g, (char) => UNICODE_FRACTIONS[char])
    .replace(/^\s*[-•*–]\s*/, "")
    .trim();

  let quantity = "";
  const match = text.match(QUANTITY_PATTERN);
  if (match) {
    quantity = match[1].replace(/\s+/g, "") + (match[2] ? `-${match[2].replace(/\s+/g, "")}` : "");
    text = text.slice(match[0].length).trimStart();
  }

  let unit = "";
  if (quantity) {
    // The longest run of leading words that spells a unit ("c. à soupe").
    const words = text.split(/\s+/);
    for (let count = Math.min(MAX_UNIT_WORDS, words.length); count > 0; count -= 1) {
      const found = findUnit(words.slice(0, count).join(""));
      if (found) {
        unit = found.key;
        text = words.slice(count).join(" ");
        break;
      }
    }
  }

  return { quantity, unit, name: text.trim() };
}

/** One line per non-empty row of a pasted or imported text. */
export function parseIngredientText(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((row) => row.replace(/^\s*[-•*–]?\s*/, "").trim())
    .map(parseIngredientLine);
}

/** Converts the former free-text format: "- " rows are ingredients, others
 * headings; a "Pour 4 personnes" row repeating the servings is dropped. */
export function importIngredientText(text, { servings = null } = {}) {
  const lines = [];
  for (const row of String(text ?? "").split(/\r?\n/)) {
    const trimmed = row.trim();
    if (!trimmed) continue;
    if (/^[-•*–]/.test(trimmed)) {
      const line = parseIngredientLine(trimmed);
      if (!isEmptyLine(line)) lines.push(line);
      continue;
    }
    const servingsRow = trimmed.match(/^pour\s+(\d+)\s+personnes?\s*[:;]?$/i);
    if (servingsRow && Number(servingsRow[1]) === servings) continue;
    lines.push({ quantity: "", unit: "", name: `${trimmed.replace(/\s*[:;]$/, "")} :` });
  }
  return lines;
}

/** The line as plain text, its unit in this language. */
export function formatIngredientLine(line, language = "fr") {
  return [line.quantity, line.unit ? unitLabel(line.unit, line.quantity, language) : "", line.name]
    .filter(Boolean)
    .join(" ");
}

// Linking words ("pommes de terre", "cloves of garlic"). Not "the": folded,
// it's French tea ("thé").
const LINK_WORDS = new Set([
  "de", "d", "du", "des", "la", "le", "les", "l", "a", "au", "aux", "en", "et", "un", "une",
  "of", "an", "and", "some",
]);

// "oignons" -> "oignon", "tomatoes" -> "tomato".
function singular(word) {
  if (word.length <= 3) return word;
  if (word.endsWith("oes")) return word.slice(0, -2);
  return /[sx]$/.test(word) ? word.slice(0, -1) : word;
}

/** Comparable words of a name: no case, accents, linking words, plurals or
 * bracketed asides ("Pommes de terre (grosses)" -> ["pomme", "terre"]).
 * Names share an ingredient when one's words appear, in order, in the
 * other's. */
export function ingredientWords(text) {
  return foldForSearch(text)
    .replace(/[’']/g, " ")
    .replace(/\([^)]*\)?/g, " ")
    .split(/[^a-z0-9%]+/)
    .filter((word) => word && !LINK_WORDS.has(word))
    .map(singular);
}

/** The words of the main food in a name, alternatives and asides removed
 * ("de pois chiches (rincés), ou ..." -> ["poi", "chiche"]). */
export function foodTokens(text) {
  const main = foldForSearch(text)
    .replace(/[’']/g, " ")
    .replace(/\([^)]*\)?/g, " ")
    .split(/,|\/|=>|\b(?:ou|pour|si|avec|comme|que|or|for|if|with|like)\b/)[0];
  return ingredientWords(main);
}

/** Index of `needle` as a run of consecutive words in `haystack`, or -1. */
export function indexOfRun(haystack, needle) {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, i) => haystack[start + i] === word)) return start;
  }
  return -1;
}

/** A food name as listed: lower case, no leading "de"/"d'", asides or
 * alternatives ("d'Huile d'olive (vierge)" -> "huile d'olive"). */
export function ingredientLabel(text) {
  return text
    .replace(/\([^)]*\)?/g, " ")
    .split(/,|\/|=>|\s(?:ou|pour|si|avec|comme|que|or|for|if|with|like)\s/i)[0]
    .replace(/^\s*(?:(?:de|du|des|la|le|les|of|the)\s+|[dl][’']\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr");
}
