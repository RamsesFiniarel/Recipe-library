import { analyzeRecipe } from "./nutrition.service.js";
import { computeAutoTags } from "./tags.service.js";
import { readIngredients } from "./recipes.service.js";
import { foodTokens, ingredientLabel, ingredientWords, isEmptyLine, isHeading } from "../../shared/ingredients.js";
import { resolveTags } from "../../shared/recipe-tags.js";

/** What the search filters read besides the title: tags (with corrections),
 * ingredient names and the foods the lines are about ("ail" for "gousses
 * d'ail"); and for the groceries page, the lines to buy. Derived from the
 * nutrition analysis, so cached per recipe until it (or its book's title)
 * changes. */

const cache = new Map();

// The aliases spell "oe" out; a list reads better with "œ" (œuf, bœuf, cœur).
const prettyLabel = (label) => label.replace(/oe(?=u[fr])/g, "œ");

// Never bought (but "eau de fleur d'oranger" is).
const NOT_BOUGHT = new Set(["eau", "water"]);

/** What two lines share when they're the same thing to buy: the food the
 * nutrition table matched ("3 gousses d'ail" and "1 tête d'ail"), else the
 * food's words. */
function shoppingKey(line, row) {
  if (row?.food) return `f${row.food.code}`;
  return `n${(row ? ingredientWords(row.ingredient) : foodTokens(line.name)).join(" ")}`;
}

function analyze(recipe) {
  const stamp = `${recipe.updatedAt}|${recipe.bookTitle}`;
  const cached = cache.get(recipe.id);
  if (cached?.stamp === stamp) return cached;

  const lines = readIngredients(recipe.ingredients, recipe.servings);
  const analysis = analyzeRecipe(lines, recipe.servings);
  const overrides = recipe.tagOverrides ? JSON.parse(recipe.tagOverrides) : null;
  // The analysis has a row per food line, in order.
  const foodLines = lines.filter((line) => !isHeading(line) && !isEmptyLine(line));
  const shopping = [];
  // The foods, once each: { key, label }, the key shared by lines about the
  // same food (for the ingredient filter and the groceries' counts).
  const foods = new Map();
  foodLines.forEach((line, index) => {
    const row = analysis?.rows[index];
    if (NOT_BOUGHT.has((row ? ingredientWords(row.ingredient) : foodTokens(line.name)).join(" "))) return;
    const key = shoppingKey(line, row);
    shopping.push({ quantity: line.quantity, unit: line.unit, name: line.name, key });
    const label = prettyLabel(row?.ingredient || ingredientLabel(line.name));
    if (label && !foods.has(key)) foods.set(key, { key, label });
  });
  const facets = {
    tags: resolveTags(computeAutoTags({ ...recipe, ingredients: lines }, analysis), overrides),
    ingredients: foodLines.map((line) => line.name),
    foods: [...foods.values()],
  };
  const entry = { stamp, facets, shopping };
  cache.set(recipe.id, entry);
  return entry;
}

export function recipeFacets(recipe) {
  return analyze(recipe).facets;
}

/** The recipe's lines to buy: { quantity, unit, name, key }, water left out. */
export function shoppingLines(recipe) {
  return analyze(recipe).shopping;
}
