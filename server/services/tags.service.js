import { analyzeRecipe } from "./nutrition.service.js";
import { foldForSearch } from "../../shared/text.js";

/** A recipe's automatic tags (see shared/recipe-tags.js), from its
 * ingredients' Ciqual groups, nutrition per serving, time, servings and
 * book. Corrections are applied by the client; nothing is stored. */

const RAPIDE_MAX_MINUTES = 45;
// Meal: savoury (sugars under this share of the weight), a plateful each.
const REPAS_MAX_SUGAR_SHARE = 0.08;
const REPAS_MIN_GRAMS = 150;
// Dessert: sweetened (an ingredient of these groups), enough sugars, nothing
// savoury...
const SWEET_FAMILIES = /sucres, miels|chocolat|confitures/;
const DESSERT_MIN_SUGAR_SHARE = 0.04;
// ...and never this salty (a sugar-and-salt cure isn't a dessert).
const DESSERT_MAX_SALT_SHARE = 0.03;
const LEGER_MAX_KCAL = 450;
const COPIEUX_MIN_KCAL = 800;
// Light/copious are only told when nutrition covers this share of the lines.
const KCAL_MIN_COVERAGE = 0.7;

const MEAT_FISH_FAMILIES = /viande|charcut|poisson|mollusque|crustac/;
// Savoury signs that rule a dessert out.
const SAVOURY_FAMILIES = /viande|charcut|poisson|mollusque|crustac|légumineuses|sauces|condiments/;

// Animal products in other groups (stocks, gelatine) and, for unmatched
// lines, meat or fish named in them.
const HIDDEN_MEAT = /bouillon (cube )?(de )?(boeuf|volaille|poulet|veau)|bouillon cube|fond de (veau|volaille)|gelatine|sauce poisson|nuoc|anchois/;
// (English too: recipes read from photos keep their language.)
const MEAT_WORDS =
  /\b(poulet|boeuf|porc|veau|agneau|canard|dinde|coq|lardons?|jambon|bacon|saucisses?|chorizo|merguez|steak|viande|echine|aileron|saumon|thon|cabillaud|poisson|crevettes?|moules?|calamars?|chicken|beef|pork|veal|lamb|duck|turkey|ham|sausages?|meat|mince|fish|salmon|tuna|cod|prawns?|shrimps?|mussels?|squid|anchov(?:y|ies))\b/;
const SPICY_WORDS = /piment|chili|gochugaru|harissa|cayenne|sriracha|tabasco|jalapeno|chipotle|sambal|pili.pili/;

// Books of things that aren't eaten as a meal or a dessert.
const NOT_A_DISH_BOOKS = /boisson|smoothie|cocktail|confiture|sauce|condiment|fermentation|pickle|decoration/;
// Drinks, and preparations that are a base for something else.
const NOT_A_DISH_TITLES = /^(jus|fond|bouillon|pate a|pate brisee|pate feuilletee)\b|\b(lassi|smoothie|milkshake|the|ice tea|mojito|cocktail|limonade|sirop)\b/;

function portionTag(servings) {
  if (!servings) return null;
  if (servings === 1) return "solo";
  if (servings === 2) return "pour2";
  return servings >= 8 ? "tablee" : "famille";
}

/** `analysis`: the recipe's analyzeRecipe(), when already at hand. */
export function computeAutoTags(
  { title = "", ingredients, servings, prepMinutes, bookTitle = "" },
  analysis = analyzeRecipe(ingredients, servings)
) {
  if (!analysis || analysis.rows.length === 0) return [];
  const { rows, total } = analysis;
  const perServing = analysis.perServing ?? total;

  const families = rows.filter((row) => row.food).map((row) => row.food.family ?? "");
  const names = rows.map((row) => foldForSearch(`${row.name} ${row.food?.name ?? ""}`));
  const unmatchedNames = rows.filter((row) => !row.food).map((row) => foldForSearch(row.name));
  const grams = rows.reduce((sum, row) => sum + (row.grams ?? 0), 0);
  const coverage = rows.filter((row) => row.values).length / rows.length;
  const book = foldForSearch(bookTitle);

  const tags = new Set();

  const meat =
    families.some((family) => MEAT_FISH_FAMILIES.test(family)) ||
    names.some((name) => HIDDEN_MEAT.test(name)) ||
    unmatchedNames.some((name) => MEAT_WORDS.test(name));
  if (!meat) tags.add("vege");

  if (prepMinutes && prepMinutes <= RAPIDE_MAX_MINUTES) tags.add("rapide");
  if (names.some((name) => SPICY_WORDS.test(name))) tags.add("epice");

  const aDish = !NOT_A_DISH_BOOKS.test(book) && !NOT_A_DISH_TITLES.test(foldForSearch(title));
  // Told apart, not against each other: sweet crêpes are a meal and a dessert.
  if (aDish && grams > 0) {
    const sugarShare = total.sugars / grams;
    const dessert =
      !families.some((family) => SAVOURY_FAMILIES.test(family)) &&
      families.some((family) => SWEET_FAMILIES.test(family)) &&
      sugarShare >= DESSERT_MIN_SUGAR_SHARE &&
      (total.salt ?? 0) / grams < DESSERT_MAX_SALT_SHARE;
    if (dessert) tags.add("dessert");
    if (sugarShare < REPAS_MAX_SUGAR_SHARE && grams / (servings || 1) >= REPAS_MIN_GRAMS) tags.add("repas");
  }

  // Lightness and portions only mean something for a meal or a dessert.
  if (tags.has("repas") || tags.has("dessert")) {
    if (coverage >= KCAL_MIN_COVERAGE) {
      if (perServing.energy_kcal < LEGER_MAX_KCAL) tags.add("leger");
      else if (perServing.energy_kcal > COPIEUX_MIN_KCAL) tags.add("copieux");
    }
    const portion = portionTag(servings);
    if (portion) tags.add(portion);
  }

  return [...tags];
}
