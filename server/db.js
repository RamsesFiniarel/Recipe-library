import { DatabaseSync } from "node:sqlite";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./config.js";

mkdirSync(dirname(DB_PATH), { recursive: true });

/** The library's database. Reassigned by replaceDatabase(): always read
 * it through this binding. */
export let db = openDatabase();

function openDatabase() {
  const connection = new DatabaseSync(DB_PATH);
  connection.exec("PRAGMA foreign_keys = ON;");
  connection.exec("PRAGMA journal_mode = WAL;");
  migrate(connection);
  return connection;
}

/** Swaps the database for the file at `path` (checked by the caller, same
 * disk) in one go, then migrates it. */
export function replaceDatabase(path) {
  db.close();
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  renameSync(path, DB_PATH);
  db = openDatabase();
}

// The tables, then every change made to them since the first release.
function migrate(connection) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      color_token TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      servings INTEGER,
      ingredients TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_recipes_book_id ON recipes(book_id);
  `);

  // Columns added after the first release: CREATE TABLE IF NOT EXISTS never
  // alters an existing file, and ADD COLUMN fails if the column exists.
  const bookColumns = new Set(connection.prepare(`PRAGMA table_info(books)`).all().map((row) => row.name));
  if (!bookColumns.has("cover_color")) {
    connection.exec(`ALTER TABLE books ADD COLUMN cover_color TEXT`);
  }
  if (!bookColumns.has("page_color_token")) {
    connection.exec(`ALTER TABLE books ADD COLUMN page_color_token TEXT NOT NULL DEFAULT 'creme'`);
  }
  if (!bookColumns.has("sort_order")) {
    connection.exec(`ALTER TABLE books ADD COLUMN sort_order INTEGER`);
    // One-time backfill: existing libraries keep their alphabetical order;
    // drag-reordering (three/scene.js) changes it from then on.
    const rows = connection.prepare(`SELECT id, title FROM books`).all();
    rows.sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
    const setOrder = connection.prepare(`UPDATE books SET sort_order = ? WHERE id = ?`);
    rows.forEach((row, index) => setOrder.run(index, row.id));
  }
  // A book's exact shelf (row, left/right cluster); sort_order is then its
  // position within that cluster. Null means "unplaced": three/scene.js lays
  // such books out as before and saves the result on first load.
  if (!bookColumns.has("shelf_row")) {
    connection.exec(`ALTER TABLE books ADD COLUMN shelf_row INTEGER`);
  }
  if (!bookColumns.has("shelf_side")) {
    connection.exec(`ALTER TABLE books ADD COLUMN shelf_side TEXT`);
  }
  // Cover shine, 0 (matte) to 1 (see book-asset.js). Replaces cover_finish:
  // "glossy" books keep their look.
  if (!bookColumns.has("cover_gloss")) {
    connection.exec(`ALTER TABLE books ADD COLUMN cover_gloss REAL NOT NULL DEFAULT 0`);
    if (bookColumns.has("cover_finish")) {
      connection.exec(`UPDATE books SET cover_gloss = 0.85 WHERE cover_finish = 'glossy'`);
    }
  }
  if (bookColumns.has("cover_finish")) {
    connection.exec(`ALTER TABLE books DROP COLUMN cover_finish`);
  }
  // Which cover is in effect, colour or textures: switching back to a colour
  // keeps the uploaded textures.
  if (!bookColumns.has("cover_style")) {
    connection.exec(`ALTER TABLE books ADD COLUMN cover_style TEXT NOT NULL DEFAULT 'color'`);
  }
  // data: URLs (validated in validate.js): small enough to live in the row.
  if (!bookColumns.has("cover_texture")) {
    connection.exec(`ALTER TABLE books ADD COLUMN cover_texture TEXT`);
  }
  if (!bookColumns.has("spine_texture")) {
    connection.exec(`ALTER TABLE books ADD COLUMN spine_texture TEXT`);
  }
  if (!bookColumns.has("back_texture")) {
    connection.exec(`ALTER TABLE books ADD COLUMN back_texture TEXT`);
  }
  // Overrides of the automatic width and height multipliers (book-sizing.js);
  // null keeps the automatic value.
  if (!bookColumns.has("width_multiplier")) {
    connection.exec(`ALTER TABLE books ADD COLUMN width_multiplier REAL`);
  }
  if (!bookColumns.has("height_multiplier")) {
    connection.exec(`ALTER TABLE books ADD COLUMN height_multiplier REAL`);
  }

  const recipeColumns = new Set(connection.prepare(`PRAGMA table_info(recipes)`).all().map((row) => row.name));
  // Preparation time in minutes; null when not given.
  if (!recipeColumns.has("prep_minutes")) {
    connection.exec(`ALTER TABLE recipes ADD COLUMN prep_minutes INTEGER`);
  }
  // Corrections to the automatic tags, JSON { add, remove } (see
  // shared/recipe-tags.js); null when none.
  if (!recipeColumns.has("tag_overrides")) {
    connection.exec(`ALTER TABLE recipes ADD COLUMN tag_overrides TEXT`);
  }
  // Tags added in the settings (see custom-tags.service.js).
  connection.exec(`
    CREATE TABLE IF NOT EXISTS custom_tags (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Recipes in the groceries basket, in the order picked, and the things
  // taken off its list (see shopping.service.js).
  connection.exec(`
    CREATE TABLE IF NOT EXISTS shopping_recipes (
      recipe_id TEXT PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shopping_hidden (
      key TEXT PRIMARY KEY
    )
  `);
}

/** Closes the database when the server stops (no-op if already closed). */
export function closeDatabase() {
  try {
    db.close();
  } catch {
    // Closed already.
  }
}

/** Runs a function inside a transaction, rolling back on any error. */
export function withTransaction(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
