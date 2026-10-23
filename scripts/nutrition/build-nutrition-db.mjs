/** Builds data/nutrition.db (food composition per 100 g of edible part,
 * plus household unit weights) from ./sources only, so it rebuilds offline:
 *
 * - Ciqual 2025 (Anses), https://ciqual.anses.fr/cms/fr/telechargement,
 *   Licence Ouverte, credit required ("Anses. 2025. Table de composition
 *   nutritionnelle des aliments Ciqual"). Values from the spreadsheet,
 *   English names from the XML release (https://doi.org/10.57745/RDMHWY).
 * - unit-weights.json: unit weights from USDA FoodData Central (public
 *   domain) or standard French packaging, each with its source.
 * - food-aliases.json / food-aliases-en.json: recipe wordings mapped to
 *   Ciqual codes; optional `ratio` (food grams per gram written, e.g. a
 *   stock cube) and `piece` (grams of one, for lighter variants).
 *
 * Usage: npm run nutrition:build (replaces nutrition.db). */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { NUTRITION_DB_PATH } from "../../server/config.js";
import { foldForSearch } from "../../shared/text.js";
import { readWorkbook } from "./xlsx.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIQUAL_FILE = path.join(__dirname, "sources", "ciqual-2025-11-03.xlsx");
const CIQUAL_NAMES_FILE = path.join(__dirname, "sources", "ciqual-2025-11-03-aliments.xml");
const CIQUAL_GROUPS_FILE = path.join(__dirname, "sources", "ciqual-2025-11-03-groupes.xml");
const UNIT_WEIGHTS_FILE = path.join(__dirname, "sources", "unit-weights.json");
const ALIASES_FILES = ["food-aliases.json", "food-aliases-en.json"].map((name) => path.join(__dirname, "sources", name));
const CIQUAL_VERSION = "Ciqual 2025 (2025-11-03)";

// Ingredients only: no ready meals, desserts, snacks, baby food, diet
// products or branded waters.
const EXCLUDED_GROUPS = new Set([
  "01", // starters and mixed dishes
  "08", // ice creams and sorbets
  "11", // baby food
]);
const EXCLUDED_SUBGROUPS = new Set([
  "0303", // savoury snack biscuits
  "0703", // non-chocolate sweets
  "0705", // pastries
  "0708", // cereal bars
  "0709", // cakes
  "1008", // special-diet foods
]);
const EXCLUDED_SUBSUBGROUPS = new Set([
  "050203", // dairy desserts
  "050204", // other desserts
  "050205", // plant-based desserts
  "060203", // soft drinks
  "060204", // milk drinks
  "060304", // cocktails
]);
const WATERS_SUBGROUP = "0601";

function isIngredient(food) {
  if (!food.groupCode || food.groupCode === "00" || EXCLUDED_GROUPS.has(food.groupCode)) return false;
  if (EXCLUDED_SUBGROUPS.has(food.subgroupCode) || EXCLUDED_SUBSUBGROUPS.has(food.subsubgroupCode)) return false;
  // Brand-name waters carry their brand in brackets; averages say "(aliment moyen)".
  if (food.subgroupCode === WATERS_SUBGROUP && food.name.includes("(") && !food.name.includes("aliment moyen")) return false;
  return true;
}

// Stable keys for Ciqual's 74 constituents, by constituent code (INFOODS
// tags repeat: four energy values share ENERC).
const NUTRIENT_KEYS = {
  327: "energy_kj", 328: "energy_kcal", 332: "energy_jones_kj", 333: "energy_jones_kcal",
  400: "water", 25000: "protein", 25003: "protein_n625", 31000: "carbohydrates", 40000: "fat",
  32000: "sugars", 32210: "fructose", 32220: "galactose", 32250: "glucose", 32410: "lactose",
  32430: "maltose", 32480: "sucrose", 33110: "starch", 34100: "fiber", 34000: "polyols",
  10000: "ash", 60000: "alcohol", 65000: "organic_acids",
  40302: "fa_saturated", 40303: "fa_monounsaturated", 40304: "fa_polyunsaturated",
  40400: "fa_butyric", 40600: "fa_caproic", 40800: "fa_caprylic", 41000: "fa_capric",
  41200: "fa_lauric", 41400: "fa_myristic", 41600: "fa_palmitic", 41800: "fa_stearic",
  41819: "fa_oleic", 41826: "fa_linoleic", 41833: "fa_alpha_linolenic", 42046: "fa_arachidonic",
  42053: "fa_epa", 42263: "fa_dha", 75100: "cholesterol", 10004: "salt",
  10200: "calcium", 10170: "chloride", 10290: "copper", 10260: "iron", 10530: "iodine",
  10120: "magnesium", 10251: "manganese", 10150: "phosphorus", 10190: "potassium",
  10340: "selenium", 10110: "sodium", 10300: "zinc",
  51104: "vitamin_a", 51200: "retinol", 51330: "beta_carotene", 52100: "vitamin_d",
  52200: "vitamin_d2", 52300: "vitamin_d3", 71010: "alpha_tocopherol", 53100: "vitamin_e",
  54101: "vitamin_k1", 54104: "vitamin_k2", 55100: "vitamin_c", 56100: "vitamin_b1",
  56200: "vitamin_b2", 56310: "vitamin_b3", 56400: "vitamin_b5", 56500: "vitamin_b6",
  56702: "vitamin_b9_dfe", 56700: "vitamin_b9", 56704: "folates_natural", 56708: "folic_acid",
  56600: "vitamin_b12",
};

// Headers and the constituents sheet differ in line breaks and slashes
// ("(kJ\r\n100 g)" vs "(kJ/100 g)").
const normalizeName = (name) => String(name).replace(/[\s/]+/g, "");

// Ciqual writes values as text: "0,48", "< 0,5", "traces", or "-" (unknown).
function parseValue(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return { value: raw, qualifier: null };
  const text = raw.trim();
  if (text === "" || text === "-") return null;
  if (text.toLowerCase() === "traces") return { value: null, qualifier: "traces" };
  const below = text.match(/^<\s*([\d.,]+)$/);
  if (below) return { value: Number(below[1].replace(",", ".")), qualifier: "<" };
  const value = Number(text.replace(",", "."));
  if (!Number.isFinite(value)) throw new Error(`Valeur Ciqual inattendue : « ${text} »`);
  return { value, qualifier: null };
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => XML_ENTITIES[name]);

/** Ciqual's English food names, by food code, from its XML release. */
function readEnglishNames(file) {
  const names = new Map();
  const xml = readFileSync(file, "utf-8");
  for (const [, code, name] of xml.matchAll(/<alim_code>\s*(\d+)\s*<\/alim_code>[\s\S]*?<alim_nom_eng>\s*([\s\S]*?)\s*<\/alim_nom_eng>/g)) {
    names.set(Number(code), unescapeXml(name));
  }
  return names;
}

/** Ciqual's English group and subgroup names, by code. */
function readEnglishGroups(file) {
  const groups = new Map();
  const xml = readFileSync(file, "utf-8");
  const field = (entry, tag) => entry.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`))?.[1];
  for (const [entry] of xml.matchAll(/<ALIM_GRP>[\s\S]*?<\/ALIM_GRP>/g)) {
    groups.set(field(entry, "alim_grp_code"), unescapeXml(field(entry, "alim_grp_nom_eng")));
    groups.set(field(entry, "alim_ssgrp_code"), unescapeXml(field(entry, "alim_ssgrp_nom_eng")));
  }
  return groups;
}

const sheets = readWorkbook(CIQUAL_FILE);
const englishNames = readEnglishNames(CIQUAL_NAMES_FILE);
const englishGroups = readEnglishGroups(CIQUAL_GROUPS_FILE);
const [header, ...dataRows] = sheets.get("composition nutritionnelle");
const [, ...constituentRows] = sheets.get("codes INFOODS");

const columnByName = new Map(header.map((name, index) => [normalizeName(name), index]));
const nutrients = constituentRows
  .filter((row) => row[1] !== undefined)
  .map(([infoods, ciqualCode, name]) => {
    const key = NUTRIENT_KEYS[ciqualCode];
    if (!key) throw new Error(`Constituant Ciqual sans clé : ${ciqualCode} ${name}`);
    const column = columnByName.get(normalizeName(name));
    if (column === undefined) throw new Error(`Colonne introuvable pour « ${name} »`);
    return {
      id: ciqualCode,
      key,
      name: name.replace(/\s*\([^()]*\/100 g\)$/, ""),
      unit: name.match(/\(([^()/]+)\/100 g\)$/)[1],
      infoods: infoods ?? null,
      column,
    };
  })
  .sort((a, b) => a.column - b.column);

const foods = dataRows
  .filter((row) => row[6] !== undefined)
  .map((row) => ({
    code: Number(row[6]),
    name: String(row[7]).trim(),
    nameEn: englishNames.get(Number(row[6])) ?? null,
    scientificName: row[8] ? String(row[8]).trim() : null,
    groupCode: row[0], subgroupCode: row[1], subsubgroupCode: row[2],
    groupName: row[3], subgroupName: row[4], subsubgroupName: row[5],
    row,
  }))
  .filter(isIngredient);
const foodCodes = new Set(foods.map((food) => food.code));

const unitWeights = JSON.parse(readFileSync(UNIT_WEIGHTS_FILE, "utf-8"));
for (const unit of unitWeights) {
  if (!foodCodes.has(unit.ciqual)) throw new Error(`Poids d'unité pour un aliment absent : ${unit.ciqual} ${unit.food}`);
}
const aliases = ALIASES_FILES.flatMap((file) => JSON.parse(readFileSync(file, "utf-8")));
const aliasNames = new Set();
for (const alias of aliases) {
  if (!foodCodes.has(alias.ciqual)) throw new Error(`Alias pour un aliment absent : ${alias.ciqual} ${alias.alias}`);
  if (aliasNames.has(alias.alias)) throw new Error(`Alias en double : ${alias.alias}`);
  aliasNames.add(alias.alias);
}

mkdirSync(path.dirname(NUTRITION_DB_PATH), { recursive: true });
rmSync(NUTRITION_DB_PATH, { force: true });
const db = new DatabaseSync(NUTRITION_DB_PATH);
db.exec(`
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- One row per Ciqual food (alim_code), ingredients only (see isIngredient).
  CREATE TABLE foods (
    code INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_en TEXT,                    -- Ciqual's own English name
    -- Lowercase, accents and ligatures folded (shared/text.js), for search.
    name_search TEXT NOT NULL,
    scientific_name TEXT,
    group_code TEXT NOT NULL,
    group_name TEXT NOT NULL,
    group_name_en TEXT,
    subgroup_code TEXT,
    subgroup_name TEXT,
    subgroup_name_en TEXT,
    subsubgroup_code TEXT,
    subsubgroup_name TEXT
  );

  CREATE TABLE nutrients (
    id INTEGER PRIMARY KEY,          -- Ciqual constituent code
    key TEXT NOT NULL UNIQUE,        -- stable programmatic key, e.g. energy_kcal
    name TEXT NOT NULL,
    unit TEXT NOT NULL,              -- per 100 g: kJ, kcal, g, mg or µg
    infoods TEXT,
    sort_order INTEGER NOT NULL
  );

  -- Per 100 g of edible part. No row = unknown ("-" in Ciqual).
  -- qualifier: NULL = measured value, '<' = below \`value\` (detection
  -- limit), 'traces' = present but not quantified (value NULL).
  CREATE TABLE food_nutrients (
    food_code INTEGER NOT NULL REFERENCES foods(code),
    nutrient_id INTEGER NOT NULL REFERENCES nutrients(id),
    value REAL,
    qualifier TEXT CHECK (qualifier IN ('<', 'traces')),
    PRIMARY KEY (food_code, nutrient_id)
  ) WITHOUT ROWID;

  -- Grams of edible part for one household unit of a food.
  -- unit: piece, clove, slice, leaf, sprig, stalk, head, floret, ear, juice,
  -- can, tbsp, tsp, cup (240 ml), glass (20 cl) or pinch.
  CREATE TABLE unit_weights (
    id INTEGER PRIMARY KEY,
    food_code INTEGER NOT NULL REFERENCES foods(code),
    unit TEXT NOT NULL,
    size TEXT,                       -- small | medium | large | powder
    label TEXT NOT NULL,
    grams REAL NOT NULL,
    source TEXT NOT NULL
  );
  CREATE INDEX unit_weights_food ON unit_weights(food_code);

  -- Names recipes use for a food, French or English (matched word by word,
  -- see server/services/nutrition.service.js).
  CREATE TABLE aliases (
    alias TEXT PRIMARY KEY,
    food_code INTEGER NOT NULL REFERENCES foods(code),
    ratio REAL NOT NULL DEFAULT 1,   -- grams of the food per gram written
    piece_grams REAL                 -- grams of one, when counted
  );
`);

db.exec("BEGIN");
try {
  const insertNutrient = db.prepare(
    `INSERT INTO nutrients (id, key, name, unit, infoods, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
  );
  nutrients.forEach((n, index) => insertNutrient.run(n.id, n.key, n.name, n.unit, n.infoods, index));

  const insertFood = db.prepare(
    `INSERT INTO foods (code, name, name_en, name_search, scientific_name, group_code, group_name, group_name_en,
                        subgroup_code, subgroup_name, subgroup_name_en, subsubgroup_code, subsubgroup_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertValue = db.prepare(
    `INSERT INTO food_nutrients (food_code, nutrient_id, value, qualifier) VALUES (?, ?, ?, ?)`
  );
  const dash = (value) => (value === "-" || value === "000000" || value === "0000" ? null : value ?? null);
  let valueCount = 0;
  for (const food of foods) {
    insertFood.run(
      food.code, food.name, food.nameEn, foldForSearch(food.name), food.scientificName,
      food.groupCode, food.groupName, englishGroups.get(food.groupCode) ?? null,
      dash(food.subgroupCode), dash(food.subgroupName), englishGroups.get(food.subgroupCode) ?? null,
      dash(food.subsubgroupCode), dash(food.subsubgroupName)
    );
    for (const nutrient of nutrients) {
      const parsed = parseValue(food.row[nutrient.column]);
      if (!parsed) continue;
      insertValue.run(food.code, nutrient.id, parsed.value, parsed.qualifier);
      valueCount += 1;
    }
  }

  const insertUnit = db.prepare(
    `INSERT INTO unit_weights (food_code, unit, size, label, grams, source) VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const unit of unitWeights) {
    insertUnit.run(unit.ciqual, unit.unit, unit.size ?? null, unit.label, unit.grams, unit.source);
  }

  const insertAlias = db.prepare(`INSERT INTO aliases (alias, food_code, ratio, piece_grams) VALUES (?, ?, ?, ?)`);
  for (const alias of aliases) {
    insertAlias.run(alias.alias, alias.ciqual, alias.ratio ?? 1, alias.piece ?? null);
  }

  const insertMeta = db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`);
  for (const [key, value] of Object.entries({
    source: "Anses. 2025. Table de composition nutritionnelle des aliments Ciqual",
    source_version: CIQUAL_VERSION,
    source_doi: "https://doi.org/10.57745/RDMHWY",
    english_names: "Ciqual 2025, alim_2025_11_03.xml (alim_nom_eng), alim_grp_2025_11_03.xml",
    source_license: "Licence Ouverte (Etalab) - mention de la source et de la version obligatoire",
    unit_weights_sources:
      "USDA FoodData Central, portions mesurées SR Legacy (2018-04) et FNDDS (2021-2023), domaine public ; conditionnements standard du commerce en France",
    scope: "Ingrédients uniquement : plats composés, desserts, viennoiseries, biscuits apéritifs, confiseries, glaces, sodas, cocktails, aliments infantiles, produits diététiques et eaux de marque exclus",
    values_per: "100 g de partie comestible",
    built_at: new Date().toISOString(),
  })) {
    insertMeta.run(key, value);
  }
  db.exec("COMMIT");
  console.log(
    `${NUTRITION_DB_PATH} : ${foods.length} aliments, ${nutrients.length} constituants, ` +
      `${valueCount} valeurs, ${unitWeights.length} poids d'unité, ${aliases.length} alias.`
  );
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
} finally {
  db.close();
}
