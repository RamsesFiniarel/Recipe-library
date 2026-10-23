import { db } from "../db.js";
import { generateId } from "../utils/ids.js";
import { importIngredientText } from "../../shared/ingredients.js";
import { computeAutoTags } from "./tags.service.js";

// Columns a PATCH may set, with their SQL names: guards the dynamic SET.
const PATCHABLE_COLUMNS = {
  title: "title",
  servings: "servings",
  prepMinutes: "prep_minutes",
  tagOverrides: "tag_overrides",
  ingredients: "ingredients",
  instructions: "instructions",
};

/** Stored ingredient lines: a JSON array, or the former free text,
 * converted on the fly. */
export function readIngredients(value, servings) {
  if (value.trimStart().startsWith("[")) return JSON.parse(value);
  return importIngredientText(value, { servings });
}

export function getRecipe(bookId, recipeId) {
  const recipe = db
    .prepare(
      // The book title comes along for the page header, saving a request.
      `SELECT r.id, r.book_id AS bookId, b.title AS bookTitle, r.title, r.servings,
              r.prep_minutes AS prepMinutes, r.tag_overrides AS tagOverrides, r.ingredients, r.instructions,
              r.created_at AS createdAt, r.updated_at AS updatedAt
       FROM recipes r
       JOIN books b ON b.id = r.book_id
       WHERE r.id = ? AND r.book_id = ?`
    )
    .get(recipeId, bookId);
  if (!recipe) return recipe;
  recipe.ingredients = readIngredients(recipe.ingredients, recipe.servings);
  recipe.tagOverrides = recipe.tagOverrides ? JSON.parse(recipe.tagOverrides) : null;
  recipe.autoTags = computeAutoTags(recipe);
  return recipe;
}

export function createRecipe(bookId, { title }) {
  const id = generateId();
  db.prepare(
    `INSERT INTO recipes (id, book_id, title, servings, ingredients, instructions)
     VALUES (?, ?, ?, NULL, '[]', '')`
  ).run(id, bookId, title);
  return getRecipe(bookId, id);
}

export function updateRecipe(bookId, recipeId, patch) {
  const entries = Object.entries(patch).filter(([key]) => key in PATCHABLE_COLUMNS);
  if (entries.length === 0) return getRecipe(bookId, recipeId);

  const setClause = entries.map(([key]) => `${PATCHABLE_COLUMNS[key]} = ?`).join(", ");
  // Ingredient lines and tag corrections are stored as JSON.
  const asJson = new Set(["ingredients", "tagOverrides"]);
  const values = entries.map(([key, value]) => (asJson.has(key) && value !== null ? JSON.stringify(value) : value));

  const result = db
    .prepare(
      `UPDATE recipes SET ${setClause}, updated_at = datetime('now')
       WHERE id = ? AND book_id = ?`
    )
    .run(...values, recipeId, bookId);

  if (result.changes === 0) return null;
  return getRecipe(bookId, recipeId);
}

export function deleteRecipe(bookId, recipeId) {
  return db.prepare(`DELETE FROM recipes WHERE id = ? AND book_id = ?`).run(recipeId, bookId).changes > 0;
}
