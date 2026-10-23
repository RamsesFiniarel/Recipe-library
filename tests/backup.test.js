import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A database and backup folder of its own (each test file is its own process).
const dir = mkdtempSync(path.join(tmpdir(), "cuisine-backup-test-"));
process.env.DB_PATH = path.join(dir, "cuisine.db");
process.env.BACKUP_DIR = path.join(dir, "backups");
const { backUpDatabase, exportDatabase, importDatabase, listBackups } = await import("../server/services/backup.service.js");
// Read through the module: an import replaces the connection it holds.
const database = await import("../server/db.js");
const { DatabaseSync } = await import("node:sqlite");

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("a day's copy is a readable database, and the last 7 are kept", () => {
  const backups = process.env.BACKUP_DIR;
  const first = backUpDatabase({ now: new Date("2026-10-01T08:00:00Z") });
  const copy = new DatabaseSync(first, { readOnly: true });
  assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.ok(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'books'").get());
  copy.close();

  // Another file in the folder is never touched.
  writeFileSync(path.join(backups, "notes.txt"), "à garder");
  for (let day = 2; day <= 9; day += 1) backUpDatabase({ now: new Date(`2026-10-0${day}T08:00:00Z`) });
  // Twice the same day: still one copy.
  backUpDatabase({ now: new Date("2026-10-09T20:00:00Z") });

  assert.deepEqual(readdirSync(backups).sort(), [
    "cuisine-2026-10-03.db",
    "cuisine-2026-10-04.db",
    "cuisine-2026-10-05.db",
    "cuisine-2026-10-06.db",
    "cuisine-2026-10-07.db",
    "cuisine-2026-10-08.db",
    "cuisine-2026-10-09.db",
    "notes.txt",
  ]);
});

test("an exported library comes back whole, the one it replaces kept aside", () => {
  const count = () => database.db.prepare("SELECT COUNT(*) AS n FROM books").get().n;
  database.db.prepare("INSERT INTO books (id, title, color_token) VALUES ('livre-1', 'Livre', 'taupe')").run();
  database.db.prepare("INSERT INTO recipes (id, book_id, title) VALUES ('recette-1', 'livre-1', 'Recette')").run();
  const file = exportDatabase();
  const content = readFileSync(file);
  rmSync(file);

  database.db.prepare("DELETE FROM books").run();
  assert.equal(count(), 0);
  assert.deepEqual(importDatabase(content), { books: 1, recipes: 1 });
  // The binding now reads the imported file.
  assert.equal(count(), 1);
  assert.ok(listBackups().beforeImport);
});

test("only a sound copy of the library is taken in", () => {
  const refused = (content) => assert.throws(() => importDatabase(content), { status: 400 });
  refused(Buffer.from("pas une base"));
  refused(Buffer.alloc(0));

  // A library with a trigger, which would run with the app's own requests.
  const file = exportDatabase();
  const copy = new DatabaseSync(file);
  copy.exec("CREATE TRIGGER t AFTER UPDATE ON books BEGIN DELETE FROM recipes; END;");
  copy.close();
  refused(readFileSync(file));
  rmSync(file);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS n FROM books").get().n, 1);
});
