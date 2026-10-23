import { db, withTransaction } from "../db.js";
import { generateId } from "../utils/ids.js";
import { RECIPE_TAGS } from "../../shared/recipe-tags.js";
import { foldForSearch } from "../../shared/text.js";

/** Tags added in the settings, next to the automatic ones (see
 * shared/recipe-tags.js): put on recipes by hand only. Keys start with "c-"
 * so they never clash with automatic ones; only these can be deleted. */

export function listCustomTags() {
  return db.prepare(`SELECT key, label FROM custom_tags ORDER BY created_at, label`).all();
}

export function customTagKeys() {
  return db.prepare(`SELECT key FROM custom_tags`).all().map((row) => row.key);
}

/** The new tag, or null if one already has that name (automatic ones
 * included, ignoring case and accents). */
export function createCustomTag(label) {
  const folded = foldForSearch(label);
  const taken = [...RECIPE_TAGS.map((tag) => tag.label), ...listCustomTags().map((tag) => tag.label)].some(
    (other) => foldForSearch(other) === folded
  );
  if (taken) return null;
  const tag = { key: `c-${generateId()}`, label };
  db.prepare(`INSERT INTO custom_tags (key, label) VALUES (?, ?)`).run(tag.key, tag.label);
  return tag;
}

/** Deletes a tag and removes it from its recipes. Returns whether it existed. */
export function deleteCustomTag(key) {
  return withTransaction(() => {
    if (db.prepare(`DELETE FROM custom_tags WHERE key = ?`).run(key).changes === 0) return false;
    const update = db.prepare(`UPDATE recipes SET tag_overrides = ?, updated_at = datetime('now') WHERE id = ?`);
    const tagged = db
      .prepare(`SELECT id, tag_overrides AS tagOverrides FROM recipes WHERE tag_overrides LIKE ?`)
      .all(`%"${key}"%`);
    for (const { id, tagOverrides } of tagged) {
      const overrides = JSON.parse(tagOverrides);
      const add = (overrides.add ?? []).filter((other) => other !== key);
      const remove = (overrides.remove ?? []).filter((other) => other !== key);
      update.run(add.length || remove.length ? JSON.stringify({ add, remove }) : null, id);
    }
    return true;
  });
}
