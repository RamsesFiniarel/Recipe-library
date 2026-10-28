import { db } from "../db.js";
import { shoppingLines } from "./search.service.js";

/** The groceries basket: recipes picked on the groceries page, one basket
 * for every device, and the things taken off its list (by key, see
 * search.service.js). The list itself is merged by the page (see
 * shared/shopping.js) from each recipe's lines to buy. */

const RECIPE_COLUMNS = `r.id, r.title, r.servings, r.prep_minutes AS prepMinutes, r.book_id AS bookId,
  b.title AS bookTitle, r.ingredients, r.tag_overrides AS tagOverrides, r.updated_at AS updatedAt`;

/** { recipes: [{ id, title, servings, bookId, lines }], hidden: [key] },
 * the recipes in the order picked. */
export function getBasket() {
  const recipes = db
    .prepare(
      `SELECT ${RECIPE_COLUMNS}
       FROM shopping_recipes s
       JOIN recipes r ON r.id = s.recipe_id
       JOIN books b ON b.id = r.book_id
       ORDER BY s.rowid`
    )
    .all();
  return {
    recipes: recipes.map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      servings: recipe.servings,
      bookId: recipe.bookId,
      lines: shoppingLines(recipe),
    })),
    hidden: db.prepare(`SELECT key FROM shopping_hidden`).all().map((row) => row.key),
  };
}

/** Puts a recipe in the basket (once); what it needs comes back on the list
 * if it had been taken off. Returns false if there's no such recipe. */
export function addToBasket(recipeId) {
  const recipe = db
    .prepare(`SELECT ${RECIPE_COLUMNS} FROM recipes r JOIN books b ON b.id = r.book_id WHERE r.id = ?`)
    .get(recipeId);
  if (!recipe) return false;
  db.prepare(`INSERT OR IGNORE INTO shopping_recipes (recipe_id) VALUES (?)`).run(recipeId);
  const unhide = db.prepare(`DELETE FROM shopping_hidden WHERE key = ?`);
  for (const line of shoppingLines(recipe)) unhide.run(line.key);
  return true;
}

/** Takes a recipe out; an empty basket starts its list afresh. */
export function removeFromBasket(recipeId) {
  db.prepare(`DELETE FROM shopping_recipes WHERE recipe_id = ?`).run(recipeId);
  if (!db.prepare(`SELECT 1 FROM shopping_recipes`).get()) db.exec(`DELETE FROM shopping_hidden`);
}

/** Takes a thing off the list (already at home, say). */
export function hideItem(key) {
  db.prepare(`INSERT OR IGNORE INTO shopping_hidden (key) VALUES (?)`).run(key);
}
