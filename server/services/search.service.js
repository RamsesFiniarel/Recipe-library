import { analyzeRecipe } from "./nutrition.service.js";
import { computeAutoTags } from "./tags.service.js";
import { readIngredients } from "./recipes.service.js";
import { isEmptyLine, isHeading } from "../../shared/ingredients.js";
import { resolveTags } from "../../shared/recipe-tags.js";

/** What the search filters read besides the title: tags (with corrections),
 * ingredient names and the food each line is about ("ail" for "gousses
 * d'ail"). Derived from the nutrition analysis, so cached per recipe until
 * it (or its book's title) changes. */

const cache = new Map();

// The aliases spell "oe" out; a list reads better with "œ" (œuf, bœuf, cœur).
const prettyLabel = (label) => label.replace(/oe(?=u[fr])/g, "œ");

export function recipeFacets(recipe) {
  const stamp = `${recipe.updatedAt}|${recipe.bookTitle}`;
  const cached = cache.get(recipe.id);
  if (cached?.stamp === stamp) return cached.facets;

  const lines = readIngredients(recipe.ingredients, recipe.servings);
  const analysis = analyzeRecipe(lines, recipe.servings);
  const overrides = recipe.tagOverrides ? JSON.parse(recipe.tagOverrides) : null;
  const facets = {
    tags: resolveTags(computeAutoTags({ ...recipe, ingredients: lines }, analysis), overrides),
    ingredients: lines.filter((line) => !isHeading(line) && !isEmptyLine(line)).map((line) => line.name),
    ingredientLabels: [...new Set((analysis?.rows ?? []).map((row) => row.ingredient).filter(Boolean).map(prettyLabel))],
  };
  cache.set(recipe.id, { stamp, facets });
  return facets;
}
