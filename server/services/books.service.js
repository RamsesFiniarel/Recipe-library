import { db, withTransaction } from "../db.js";
import { generateId } from "../utils/ids.js";
import { colorTokenForId, DEFAULT_PAGE_COLOR_TOKEN } from "../../shared/palette.js";
import { recipeFacets } from "./search.service.js";
import { listCustomTags } from "./custom-tags.service.js";

// SQLite has no locale-aware collation: sort in JS so accents sort as in
// French ("Épices" next to "Epices"). Used for recipes and the search
// index's alphabetical book list.
function sortByTitleFr(rows) {
  return [...rows].sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
}

// Shelf order: row, side, position within the side. Unplaced books (null
// row/side, until three/scene.js places them) come last.
export const TEXTURE_FACES = ["cover", "spine", "back"];

// Textures never travel in the JSON (tens of KB each): each is a URL to the
// picture (getBookTexture()), versioned by the book's last update.
function textureUrls(bookId, updatedAt, { hasCover, hasSpine, hasBack }) {
  const url = (face) => `/api/books/${encodeURIComponent(bookId)}/textures/${face}?v=${encodeURIComponent(updatedAt)}`;
  return {
    coverTextureUrl: hasCover ? url("cover") : null,
    spineTextureUrl: hasSpine ? url("spine") : null,
    backTextureUrl: hasBack ? url("back") : null,
  };
}

export function listBooks() {
  return db
    .prepare(
      `SELECT b.id, b.title, b.color_token AS colorToken, b.cover_color AS coverColor,
              b.page_color_token AS pageColorToken, b.cover_style AS coverStyle,
              b.cover_gloss AS coverGloss, b.width_multiplier AS widthMultiplier,
              b.height_multiplier AS heightMultiplier, b.shelf_row AS shelfRow,
              b.shelf_side AS shelfSide, b.sort_order AS sortOrder, b.created_at AS createdAt,
              b.updated_at AS updatedAt,
              b.cover_texture IS NOT NULL AS hasCover, b.spine_texture IS NOT NULL AS hasSpine,
              b.back_texture IS NOT NULL AS hasBack,
              (SELECT COUNT(*) FROM recipes r WHERE r.book_id = b.id) AS recipeCount
       FROM books b
       ORDER BY (b.shelf_row IS NULL), b.shelf_row, b.shelf_side, b.sort_order`
    )
    .all()
    .map(({ hasCover, hasSpine, hasBack, updatedAt, ...book }) => ({
      ...book,
      ...textureUrls(book.id, updatedAt, { hasCover, hasSpine, hasBack }),
    }));
}

/** One face's picture as { type, data }, or null. */
export function getBookTexture(bookId, face) {
  const column = { cover: "cover_texture", spine: "spine_texture", back: "back_texture" }[face];
  const row = db.prepare(`SELECT ${column} AS dataUrl FROM books WHERE id = ?`).get(bookId);
  const match = row?.dataUrl?.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  return match ? { type: match[1], data: Buffer.from(match[2], "base64") } : null;
}

// Flat index for the library search: titles plus what rendering, navigation
// and the filters need (time, servings, tags, ingredients; see
// search.service.js).
export function listSearchIndex() {
  const books = db.prepare(`SELECT id, title, color_token AS colorToken FROM books`).all();
  const recipes = db
    .prepare(
      `SELECT r.id, r.title, r.servings, r.prep_minutes AS prepMinutes, r.book_id AS bookId,
              b.title AS bookTitle, r.ingredients, r.tag_overrides AS tagOverrides, r.updated_at AS updatedAt
       FROM recipes r JOIN books b ON b.id = r.book_id`
    )
    .all()
    .map(({ ingredients, tagOverrides, updatedAt, ...recipe }) => ({
      ...recipe,
      ...recipeFacets({ ...recipe, ingredients, tagOverrides, updatedAt }),
    }));

  // The tags added in the settings, for the search's tag filter.
  return { books: sortByTitleFr(books), recipes: sortByTitleFr(recipes), customTags: listCustomTags() };
}

export function getBookWithRecipes(bookId) {
  const book = db
    .prepare(
      `SELECT id, title, color_token AS colorToken, cover_color AS coverColor,
              page_color_token AS pageColorToken, cover_style AS coverStyle,
              cover_gloss AS coverGloss, width_multiplier AS widthMultiplier,
              height_multiplier AS heightMultiplier, created_at AS createdAt, updated_at AS updatedAt,
              cover_texture IS NOT NULL AS hasCover, spine_texture IS NOT NULL AS hasSpine,
              back_texture IS NOT NULL AS hasBack
       FROM books WHERE id = ?`
    )
    .get(bookId);
  if (!book) return null;

  const { hasCover, hasSpine, hasBack, updatedAt, ...fields } = book;
  const recipes = db.prepare(`SELECT id, title, servings FROM recipes WHERE book_id = ?`).all(bookId);
  return {
    ...fields,
    ...textureUrls(book.id, updatedAt, { hasCover, hasSpine, hasBack }),
    recipes: sortByTitleFr(recipes),
  };
}

export function bookExists(bookId) {
  return Boolean(db.prepare(`SELECT 1 FROM books WHERE id = ?`).get(bookId));
}

// The id (and URL) stays stable through edits. `fields` holds only the keys
// to change.
export function updateBook(
  bookId,
  { title, coverColor, pageColorToken, coverStyle, coverGloss, coverTexture, spineTexture, backTexture, widthMultiplier, heightMultiplier }
) {
  const sets = ["updated_at = datetime('now')"];
  const params = [];
  const set = (column, value) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (title !== undefined) set("title", title);
  if (coverColor !== undefined) set("cover_color", coverColor);
  if (pageColorToken !== undefined) set("page_color_token", pageColorToken);
  if (coverStyle !== undefined) set("cover_style", coverStyle);
  if (coverGloss !== undefined) set("cover_gloss", coverGloss);
  if (coverTexture !== undefined) set("cover_texture", coverTexture);
  if (spineTexture !== undefined) set("spine_texture", spineTexture);
  if (backTexture !== undefined) set("back_texture", backTexture);
  if (widthMultiplier !== undefined) set("width_multiplier", widthMultiplier);
  if (heightMultiplier !== undefined) set("height_multiplier", heightMultiplier);
  params.push(bookId);

  const result = db.prepare(`UPDATE books SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  if (result.changes === 0) return null;
  return getBookWithRecipes(bookId);
}

export function createBook({ title }) {
  // An opaque id, like a recipe's: the URL stays put when the book is renamed.
  const id = generateId();
  const colorToken = colorTokenForId(id);
  // Appended after the shelves' current content, unplaced until
  // three/scene.js gives it a spot (saved through reorderBooks()).
  const { nextOrder } = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM books`).get();

  db.prepare(
    `INSERT INTO books (id, title, color_token, page_color_token, sort_order) VALUES (?, ?, ?, ?, ?)`
  ).run(id, title, colorToken, DEFAULT_PAGE_COLOR_TOKEN, nextOrder);

  return {
    id,
    title,
    colorToken,
    coverColor: null,
    pageColorToken: DEFAULT_PAGE_COLOR_TOKEN,
    coverStyle: "color",
    coverGloss: 0,
    coverTexture: null,
    spineTexture: null,
    backTexture: null,
    widthMultiplier: null,
    heightMultiplier: null,
    shelfRow: null,
    shelfSide: null,
    recipeCount: 0,
  };
}

export function deleteBook(bookId) {
  return db.prepare(`DELETE FROM books WHERE id = ?`).run(bookId).changes > 0;
}

// Saves the full shelf layout in one transaction (see shelfSideLists in
// three/scene.js). Unknown ids are skipped.
export function reorderBooks(rows) {
  const setPlacement = db.prepare(
    `UPDATE books SET shelf_row = ?, shelf_side = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`
  );
  withTransaction(() => {
    rows.forEach(({ left, right }, rowIndex) => {
      left.forEach((id, index) => setPlacement.run(rowIndex, "left", index, id));
      right.forEach((id, index) => setPlacement.run(rowIndex, "right", index, id));
    });
  });
  return listBooks();
}
