import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { NUTRITION_DB_PATH } from "../config.js";
import { foldForSearch } from "../../shared/text.js";
import {
  findUnit,
  getUnit,
  parseQuantity,
  isHeading,
  isEmptyLine,
  formatIngredientLine,
  foodTokens,
  indexOfRun,
  ingredientLabel,
} from "../../shared/ingredients.js";

/** Recipe nutrition from its ingredient lines and data/nutrition.db: each
 * line is matched to a Ciqual food, converted to grams and scaled from the
 * per-100 g values. Lines may be French or English; food names follow the
 * interface language. */

// The recipe table's columns: the main four, then the expanded detail.
const NUTRIENT_COLUMNS = [
  { key: "energy_kcal", label: "Calories", digits: 0, main: true },
  { key: "carbohydrates", label: "Glucides", digits: 1, main: true },
  { key: "protein", label: "Protéines", digits: 1, main: true },
  { key: "fat", label: "Lipides", digits: 1, main: true },
  { key: "sugars", label: "Sucres", digits: 1 },
  { key: "fiber", label: "Fibres", digits: 1 },
  { key: "fa_saturated", label: "AG saturés", digits: 1 },
  { key: "salt", label: "Sel", digits: 2 },
  { key: "calcium", label: "Calcium", digits: 0 },
  { key: "iron", label: "Fer", digits: 1 },
  { key: "magnesium", label: "Magnésium", digits: 0 },
  { key: "potassium", label: "Potassium", digits: 0 },
  { key: "zinc", label: "Zinc", digits: 1 },
  { key: "vitamin_a", label: "Vitamine A", digits: 0 },
  { key: "vitamin_d", label: "Vitamine D", digits: 1 },
  { key: "vitamin_e", label: "Vitamine E", digits: 1 },
  { key: "vitamin_c", label: "Vitamine C", digits: 1 },
  { key: "vitamin_b1", label: "Vitamine B1", digits: 2 },
  { key: "vitamin_b2", label: "Vitamine B2", digits: 2 },
  { key: "vitamin_b3", label: "Vitamine B3", digits: 1 },
  { key: "vitamin_b6", label: "Vitamine B6", digits: 2 },
  { key: "vitamin_b9", label: "Vitamine B9", digits: 0 },
  { key: "vitamin_b12", label: "Vitamine B12", digits: 1 },
];
const NUTRIENT_KEYS = NUTRIENT_COLUMNS.map((column) => column.key);
// Fallback nutrient names, in order (vitamin E is often alpha-tocopherol only).
const FALLBACK_KEYS = {
  energy_kcal: ["energy_jones_kcal"],
  vitamin_e: ["alpha_tocopherol"],
  vitamin_b9: ["vitamin_b9_dfe", "folates_natural"],
};
const QUERIED_KEYS = [...NUTRIENT_KEYS, ...Object.values(FALLBACK_KEYS).flat()];

// Household units each measure may use ("" = a count: "2 oignons").
const HOUSEHOLD_UNITS = {
  "": ["piece", "head", "ear"],
  "c.a.s": ["tbsp"],
  "c.a.c": ["tsp"],
  tasse: ["cup"],
  verre: ["glass"],
  pincée: ["pinch"],
};

// Fallback weight of a pinch when the food has none of its own.
const GENERIC_GRAMS = { pincée: 0.4 };

// Counted forms in the name ("3 gousses d'ail", "2 cloves of garlic"), used
// as the measure when there is no unit: the food's own household weight,
// else a typical weight or volume.
const CLOVE = { household: ["clove"], grams: 4 };
const SLICE = { household: ["slice"], grams: 30 };
const LEAF = { household: ["leaf"], grams: 0.3 };
const SPRIG = { household: ["sprig", "stalk"], grams: 2 };
const CAN = { household: ["can"], grams: 400 };
const SACHET = { household: ["piece"], grams: 10 };
const NAME_UNITS = {
  gousse: CLOVE,
  tranche: SLICE,
  feuille: LEAF,
  branche: SPRIG,
  tete: { household: ["head"] },
  boite: CAN,
  sachet: SACHET,
  bouquet: { grams: 20 },
  botte: { grams: 100 },
  poignee: { grams: 25 },
  morceau: { grams: 15 },
  carre: { grams: 5 },
  baton: { grams: 3 },
  clou: { grams: 0.1 },
  grain: { grams: 0.05 },
  zeste: { grams: 2 },
  zest: { grams: 2 },
  tablette: { grams: 100 },
  bloc: { grams: 200 },
  // A yogurt pot, the classic measure of gâteau au yaourt.
  pot: { ml: 125 },
  goutte: { ml: 0.05 },
  bouchon: { ml: 10 },
  bouteille: { ml: 750 },
  // English.
  clove: CLOVE,
  slice: SLICE,
  leaf: LEAF,
  leave: LEAF,
  sprig: SPRIG,
  stalk: SPRIG,
  stick: SPRIG,
  head: { household: ["head"] },
  can: CAN,
  tin: CAN,
  packet: SACHET,
  bag: SACHET,
  bunch: { grams: 20 },
  handful: { grams: 25 },
  piece: { grams: 15 },
  square: { grams: 5 },
  knob: { grams: 10 },
  dash: { ml: 1 },
  drop: { ml: 0.05 },
  bottle: { ml: 750 },
  splash: { ml: 10 },
};

const SIZE_WORDS = {
  bon: null, bonne: null, beau: "large", belle: "large", belles: "large",
  gros: "large", grosse: "large", grosses: "large", grand: "large", grande: "large", grands: "large", grandes: "large",
  petit: "small", petite: "small", petits: "small", petites: "small",
  good: null, medium: "medium", large: "large", big: "large", small: "small",
};

const singular = (word) => (word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word);

/** The counted form a word is, if any: "gousses", "bunches" ("-es"). */
function nameUnit(word) {
  const key = foldForSearch(word);
  return NAME_UNITS[key] ?? NAME_UNITS[singular(key)] ?? NAME_UNITS[key.replace(/es$/, "")] ?? null;
}

let reference;

/** The reference table, opened on first use; null when it hasn't been built. */
function openReference() {
  if (reference !== undefined) return reference;
  if (!existsSync(NUTRITION_DB_PATH)) return (reference = null);

  const db = new DatabaseSync(NUTRITION_DB_PATH, { readOnly: true });
  const foods = db.prepare(`SELECT code, name, name_en AS nameEn, subgroup_name AS family FROM foods`).all();
  const foodByCode = new Map(foods.map((food) => [food.code, food]));
  for (const food of foods) {
    food.tokens = foodTokens(food.name);
    food.tokensEn = food.nameEn ? foodTokens(food.nameEn) : [];
  }

  const aliases = db
    .prepare(`SELECT alias, food_code AS code, ratio, piece_grams AS pieceGrams FROM aliases`)
    .all()
    .map(({ alias, code, ratio, pieceGrams }) => ({
      label: alias,
      tokens: foodTokens(alias),
      food: foodByCode.get(code),
      ratio,
      pieceGrams,
    }))
    .sort((a, b) => b.tokens.length - a.tokens.length);

  const units = new Map(db.prepare(`SELECT key, unit FROM nutrients`).all().map((row) => [row.key, row.unit]));

  reference = {
    db,
    foods,
    aliases,
    columns: NUTRIENT_COLUMNS.map((column) => ({ ...column, unit: units.get(column.key) })),
    weights: db.prepare(`SELECT unit, size, grams FROM unit_weights WHERE food_code = ?`),
    values: db.prepare(
      `SELECT n.key, fn.value, fn.qualifier
       FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
       WHERE fn.food_code = ? AND n.key IN (${QUERIED_KEYS.map(() => "?").join(", ")})`
    ),
  };
  return reference;
}

/** The Ciqual food a name refers to, { food, ratio, pieceGrams }: the
 * longest alias it contains, else the food sharing its first word and most
 * words. */
function matchFood(ref, name) {
  const tokens = foodTokens(name);
  if (tokens.length === 0) return null;

  let best = null;
  for (const alias of ref.aliases) {
    if (best && alias.tokens.length < best.alias.tokens.length) break;
    const index = indexOfRun(tokens, alias.tokens);
    if (index >= 0 && (!best || index < best.index)) best = { alias, index };
  }
  if (best) return best.alias;

  // Unknown names fall back on Ciqual's wording if the first word (and, for
  // long names, a second) match, raw foods preferred.
  let fallback = null;
  for (const food of ref.foods) {
    for (const [words, raw] of [[food.tokens, "cru"], [food.tokensEn, "raw"]]) {
      if (words[0] !== tokens[0]) continue;
      const shared = tokens.filter((word) => words.includes(word)).length;
      if (shared < Math.min(2, tokens.length)) continue;
      const score = shared + (words.includes(raw) ? 0.5 : 0) - words.length * 0.01;
      if (!fallback || score > fallback.score) fallback = { food, score };
    }
  }
  return fallback ? { food: fallback.food, ratio: 1, pieceGrams: null } : null;
}

// An article in place of a number: one ("une pincée de sel", "an onion").
const ARTICLES = new Set(["un", "une", "a", "an"]);

/** Splits the amount the name states from the food: "gousses d'ail" ->
 * cloves, "gros oignon" -> a large one, "an onion" -> one. */
function readName(name) {
  const words = name.trim().split(/\s+/);
  const one = words.length > 1 && ARTICLES.has(foldForSearch(words[0]));
  if (one) words.shift();
  let size = null;
  while (words.length > 1 && foldForSearch(words[0]) in SIZE_WORDS) size = SIZE_WORDS[foldForSearch(words.shift())] ?? size;
  const read = readMeasure(words);
  return { ...read, size, one };
}

/** The measure the words start with, if any, and the food after it. */
function readMeasure(words) {
  // The longest run of leading words that spells a unit ("cuillère à soupe").
  for (let count = Math.min(4, words.length - 1); count > 0; count -= 1) {
    const unit = findUnit(words.slice(0, count).join(" "));
    if (unit) return { unit: unit.key, food: words.slice(count).join(" ") };
  }
  const counted = words.length > 1 ? nameUnit(words[0]) : null;
  if (counted) return { nameUnit: counted, food: words.slice(1).join(" ") };
  return { unit: null, food: words.join(" ") };
}

function householdGrams(ref, food, units, size) {
  const weights = ref.weights.all(food.code);
  for (const unit of units) {
    const candidates = weights.filter((weight) => weight.unit === unit);
    const pick =
      candidates.find((weight) => weight.size === size) ??
      candidates.find((weight) => weight.size === "medium") ??
      candidates.find((weight) => weight.size === null) ??
      candidates[0];
    if (pick) return pick.grams;
  }
  return null;
}

/** Grams per ml, from the food's cup or spoon weights, else water's. */
function density(ref, food) {
  const weights = ref.weights.all(food.code);
  for (const [unit, ml] of [["cup", 240], ["tbsp", 15], ["tsp", 5]]) {
    const weight = weights.find((entry) => entry.unit === unit && entry.size !== "powder");
    if (weight) return weight.grams / ml;
  }
  return 1;
}

/** Grams of one unit of `unitKey` of this food, or null if it can't be told. */
function gramsPerUnit(ref, food, unitKey, size) {
  const unit = getUnit(unitKey);
  if (unit?.grams) return unit.grams;
  const household = householdGrams(ref, food, HOUSEHOLD_UNITS[unitKey ?? ""] ?? [], size);
  if (household !== null) return household;
  if (unit?.ml) return unit.ml * density(ref, food);
  return GENERIC_GRAMS[unitKey] ?? null;
}

/** The food's values for this many grams; null where Ciqual has no value. */
function valuesFor(ref, food, grams) {
  const per100 = {};
  for (const row of ref.values.all(food.code, ...QUERIED_KEYS)) {
    // Traces count as nothing, "below the detection limit" as half of it.
    per100[row.key] = row.qualifier === "traces" ? 0 : row.qualifier === "<" ? row.value / 2 : row.value;
  }
  for (const [key, fallbacks] of Object.entries(FALLBACK_KEYS)) {
    for (const fallback of fallbacks) per100[key] ??= per100[fallback];
  }
  return Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, per100[key] === undefined ? null : (per100[key] * grams) / 100])
  );
}

// "le jus d'un citron", "juice of half a lemon": that many fruits' juice.
const FRENCH_JUICE = /^(?:le |la )?jus d['’ ]\s*(?:une? |(\d+(?:[.,]\d+)?(?:\/\d+)?) ?)(.+)$/;
const ENGLISH_JUICE = /^(?:the )?juice (?:of|from) (?:(?:an?|one) |(half) (?:an? )?|(\d+(?:[.,]\d+)?(?:\/\d+)?) ?)(.+)$/;

/** { quantity, food (the name it's known by) } for a juice line, else null. */
function readJuice(name) {
  const folded = foldForSearch(name);
  const french = folded.match(FRENCH_JUICE);
  if (french) return { quantity: french[1] ? parseQuantity(french[1]) : 1, food: `jus de ${french[2]}` };
  const english = folded.match(ENGLISH_JUICE);
  if (english) return { quantity: english[1] ? 0.5 : english[2] ? parseQuantity(english[2]) : 1, food: `${english[3]} juice` };
  return null;
}

/** The line's quantity and the grams of one of its unit (null when unknown). */
function weigh(ref, line, match, read, juice) {
  const { food } = match;
  if (juice) return { quantity: juice.quantity, perUnit: householdGrams(ref, food, ["juice"], null) };
  const unitKey = line.unit || read.unit || "";
  // A unit without a number ("pincée de sel") means one of it.
  const quantity = parseQuantity(line.quantity) ?? (unitKey || read.nameUnit || read.one ? 1 : null);
  if (!line.unit && read.nameUnit) {
    const { household, grams, ml } = read.nameUnit;
    const own = household ? householdGrams(ref, food, household, read.size) : null;
    return { quantity, perUnit: own ?? grams ?? (ml ? ml * density(ref, food) : null) };
  }
  if (!unitKey && match.pieceGrams) return { quantity, perUnit: match.pieceGrams };
  return { quantity, perUnit: gramsPerUnit(ref, food, unitKey, read.size) };
}

/** One table row per ingredient line, the food named in `language`. */
function analyzeLine(ref, line, language) {
  const name = formatIngredientLine(line, language);
  const juice = readJuice(line.name);
  const read = juice ? { size: null, food: juice.food } : readName(line.name);

  const match = matchFood(ref, read.food);
  // The line's food in a word or two, for the ingredient search.
  const ingredient = match?.label ?? ingredientLabel(read.food);
  if (!match) return { name, ingredient, food: null, grams: null, values: null, issue: "food" };

  const { quantity, perUnit } = weigh(ref, line, match, read, juice);
  const issue = quantity === null ? "quantity" : perUnit === null ? "unit" : null;
  const grams = issue ? null : quantity * perUnit;
  return {
    name,
    ingredient,
    // family: Ciqual subgroup ("viandes crues"...), read by tags.service.js.
    food: {
      code: match.food.code,
      name: language === "en" ? (match.food.nameEn ?? match.food.name) : match.food.name,
      family: match.food.family,
    },
    grams,
    values: issue ? null : valuesFor(ref, match.food, grams * match.ratio),
    issue,
  };
}

/** The recipe's nutrition table, or null without the reference table;
 * `language` ("fr" or "en") names foods and units. */
export function analyzeRecipe(lines, servings, { language = "fr" } = {}) {
  const ref = openReference();
  if (!ref) return null;

  const rows = lines
    .filter((line) => !isHeading(line) && !isEmptyLine(line))
    .map((line) => analyzeLine(ref, line, language));
  const counted = rows.filter((row) => row.values);
  const total = Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, counted.reduce((sum, row) => sum + (row.values[key] ?? 0), 0)])
  );
  // Totals that leave out an ingredient whose value Ciqual doesn't give.
  const partial = NUTRIENT_KEYS.filter((key) => counted.some((row) => row.values[key] === null));
  const perServing = servings
    ? Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, total[key] / servings]))
    : null;
  return { columns: ref.columns, rows, total, perServing, partial, servings: servings ?? null };
}

// --- The whole table (the settings' database page) --------------------------

const foodTables = new Map();

/** Every food, for the settings' database page, named in `language`, with
 * its subgroup, group code and per-100 g values: a number, null if unknown,
 * or [qualifier, value] ("<" detection limit, "traces"). Cached per
 * language; null without the reference table. */
export function listFoods(language = "fr") {
  const ref = openReference();
  if (!ref) return null;
  if (!foodTables.has(language)) foodTables.set(language, buildFoodTable(ref, language));
  return foodTables.get(language);
}

function buildFoodTable(ref, language) {
  const en = language === "en";
  const own = new Map();
  const rows = ref.db
    .prepare(
      `SELECT fn.food_code AS code, n.key, fn.value, fn.qualifier
       FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
       WHERE n.key IN (${QUERIED_KEYS.map(() => "?").join(", ")})`
    )
    .all(...QUERIED_KEYS);
  for (const { code, key, value, qualifier } of rows) {
    if (!own.has(code)) own.set(code, {});
    own.get(code)[key] = qualifier ? [qualifier, value] : value;
  }
  const valueOf = (values, key) =>
    values[key] !== undefined ? values[key] : (FALLBACK_KEYS[key] ?? []).map((other) => values[other]).find((v) => v !== undefined) ?? null;

  const collator = new Intl.Collator(language, { sensitivity: "base", numeric: true });
  const foods = ref.db
    .prepare(
      `SELECT code, name, name_en AS nameEn, group_code AS groupCode, group_name AS groupName,
              group_name_en AS groupNameEn, subgroup_name AS family, subgroup_name_en AS familyEn
       FROM foods`
    )
    .all();
  const groups = new Map();
  for (const food of foods) groups.set(food.groupCode, en ? (food.groupNameEn ?? food.groupName) : food.groupName);

  const meta = Object.fromEntries(ref.db.prepare(`SELECT key, value FROM meta`).all().map((row) => [row.key, row.value]));
  return {
    columns: ref.columns.map(({ key, unit, digits }) => ({ key, unit, digits })),
    groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => ({ code, name })),
    foods: foods
      .map((food) => {
        const values = own.get(food.code) ?? {};
        return {
          code: food.code,
          name: en ? (food.nameEn ?? food.name) : food.name,
          family: en ? (food.familyEn ?? food.family) : food.family,
          group: food.groupCode,
          values: NUTRIENT_KEYS.map((key) => valueOf(values, key)),
        };
      })
      .sort((a, b) => collator.compare(a.name, b.name)),
    source: `${meta.source} - ${meta.source_version}`,
  };
}
