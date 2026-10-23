import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { db, replaceDatabase } from "../db.js";
import { BACKUP_DIR, BACKUPS_KEPT, DB_PATH } from "../config.js";
import { HttpError } from "../utils/http-error.js";

/** Database copies: one at start-up then daily, the last BACKUPS_KEPT kept
 * in BACKUP_DIR (no login, so a wrong click or a hostile device can empty
 * the library). The settings page can also copy now, export the library
 * and import a file (the current library kept aside first). */

const DAY_MS = 24 * 60 * 60 * 1000;
// Only these are ever deleted from the folder.
const COPY_NAME = /^cuisine-(\d{4}-\d{2}-\d{2})\.db$/;
// The library just before the last import, apart from the daily copies.
const BEFORE_IMPORT_NAME = "cuisine-avant-import.db";

const day = (date) => date.toISOString().slice(0, 10);

// A consistent snapshot, even while the app writes.
function snapshot(target) {
  rmSync(target, { force: true });
  db.prepare("VACUUM INTO ?").run(target);
}

// A file of our own next to the database (same disk: it's moved over it).
function scratchFile(kind) {
  return path.join(path.dirname(DB_PATH), `.${kind}-${randomBytes(6).toString("hex")}.db`);
}

/** Today's copy (made unless present, or again with `replace`), older ones
 * past BACKUPS_KEPT removed. Returns its path. */
export function backUpDatabase({ now = new Date(), replace = false } = {}) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const copy = path.join(BACKUP_DIR, `cuisine-${day(now)}.db`);
  if (replace || !existsSync(copy)) snapshot(copy);
  const copies = readdirSync(BACKUP_DIR)
    .filter((name) => COPY_NAME.test(name))
    .sort();
  for (const name of copies.slice(0, -BACKUPS_KEPT)) rmSync(path.join(BACKUP_DIR, name));
  return copy;
}

export function scheduleBackups() {
  const run = () => {
    try {
      backUpDatabase();
    } catch (err) {
      console.error("Sauvegarde de la base impossible :", err);
    }
  };
  run();
  setInterval(run, DAY_MS).unref();
}

/** The copies, latest first: { kept, copies: [{ day, savedAt, size }],
 * beforeImport: { savedAt, size } | null }. */
export function listBackups() {
  const describe = (name) => {
    const { mtime, size } = statSync(path.join(BACKUP_DIR, name));
    return { savedAt: mtime.toISOString(), size };
  };
  const names = existsSync(BACKUP_DIR) ? readdirSync(BACKUP_DIR) : [];
  return {
    kept: BACKUPS_KEPT,
    copies: names
      .filter((name) => COPY_NAME.test(name))
      .sort()
      .reverse()
      .map((name) => ({ day: COPY_NAME.exec(name)[1], ...describe(name) })),
    beforeImport: names.includes(BEFORE_IMPORT_NAME) ? describe(BEFORE_IMPORT_NAME) : null,
  };
}

/** The whole library as a file, for the caller to send and delete. */
export function exportDatabase() {
  const file = scratchFile("export");
  snapshot(file);
  return file;
}

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");
// Only the app's tables and their indexes: a trigger or view would run with
// the app's own queries.
const LIBRARY_TABLES = new Set(["books", "recipes", "custom_tags"]);
const REQUIRED_COLUMNS = {
  books: ["id", "title", "color_token"],
  recipes: ["id", "book_id", "title", "ingredients", "instructions"],
};

function notALibrary() {
  return new HttpError(400, "Ce fichier n'est pas une sauvegarde de la bibliothèque");
}

/** { books, recipes } if `file` is a sound library copy, else a 400.
 * Opened read-only. */
function checkLibraryFile(file) {
  let source;
  try {
    source = new DatabaseSync(file, { readOnly: true });
  } catch {
    throw notALibrary();
  }
  try {
    if (source.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw notALibrary();
    for (const { type, name, tbl_name: table } of source.prepare("SELECT type, name, tbl_name FROM sqlite_master").all()) {
      const known = type === "table" ? LIBRARY_TABLES.has(name) : type === "index" && LIBRARY_TABLES.has(table);
      if (!known) throw notALibrary();
    }
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const present = new Set(source.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
      if (!columns.every((column) => present.has(column))) throw notALibrary();
    }
    const count = (table) => source.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    return { books: count("books"), recipes: count("recipes") };
  } catch (err) {
    throw err instanceof HttpError ? err : notALibrary();
  } finally {
    source.close();
  }
}

/** Replaces the library with the checked copy in `content` (file bytes),
 * keeping the current one as cuisine-avant-import.db. Returns { books,
 * recipes }. */
export function importDatabase(content) {
  if (!Buffer.isBuffer(content) || !content.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
    throw notALibrary();
  }
  const file = scratchFile("import");
  writeFileSync(file, content);
  try {
    const counts = checkLibraryFile(file);
    mkdirSync(BACKUP_DIR, { recursive: true });
    snapshot(path.join(BACKUP_DIR, BEFORE_IMPORT_NAME));
    replaceDatabase(file);
    return counts;
  } finally {
    rmSync(file, { force: true });
  }
}
