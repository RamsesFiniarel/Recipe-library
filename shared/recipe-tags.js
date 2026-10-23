/** Recipe tags: computed from the recipe (see tags.service.js), then
 * corrected by hand. Only corrections are stored, { add, remove }, so the
 * automatic tags keep following the recipe. */

// In display order: what kind of dish, then what it's like, then for how many.
export const RECIPE_TAGS = [
  { key: "repas", label: "Repas" },
  { key: "dessert", label: "Dessert" },
  { key: "vege", label: "Végé" },
  { key: "rapide", label: "Rapide" },
  { key: "epice", label: "Épicé" },
  { key: "leger", label: "Léger" },
  { key: "copieux", label: "Copieux" },
  { key: "solo", label: "Solo" },
  { key: "pour2", label: "Pour 2" },
  { key: "famille", label: "En famille" },
  { key: "tablee", label: "Grande tablée" },
];

export const TAG_KEYS = RECIPE_TAGS.map((tag) => tag.key);

/** The tags shown: automatic ones with corrections applied, in display
 * order, settings tags (keys not in TAG_KEYS) last in the order added. */
export function resolveTags(autoTags, overrides) {
  const add = overrides?.add ?? [];
  const remove = overrides?.remove ?? [];
  const shown = new Set([...autoTags, ...add].filter((key) => !remove.includes(key)));
  return [...TAG_KEYS.filter((key) => shown.has(key)), ...add.filter((key) => !TAG_KEYS.includes(key) && shown.has(key))];
}

function corrections(add, remove) {
  const kept = { add: [...new Set(add)], remove: [...new Set(remove)].filter((key) => !add.includes(key)) };
  return kept.add.length || kept.remove.length ? kept : null;
}

/** The corrections once `key` is taken off the shown tags. */
export function withoutTag(overrides, autoTags, key) {
  const add = (overrides?.add ?? []).filter((other) => other !== key);
  const remove = overrides?.remove ?? [];
  return corrections(add, autoTags.includes(key) ? [...remove, key] : remove);
}

/** The corrections once `key` is added: a forced tag never removes another
 * ("Pour 2" and "En famille" together). */
export function withTag(overrides, autoTags, key) {
  const add = overrides?.add ?? [];
  const remove = (overrides?.remove ?? []).filter((other) => other !== key);
  return corrections(autoTags.includes(key) ? add : [...add, key], remove);
}
