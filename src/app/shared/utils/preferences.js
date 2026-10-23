/** Per-device preferences (localStorage): interface language and shelf
 * objects. Blocked or full storage falls back on the defaults. */

const SHELF_OBJECTS_KEY = "library-shelf-objects";
const LANGUAGE_KEY = "cuisine-language";

/** Shelf objects, in the settings' order (labels: shelfObject.<key>). */
export const SHELF_OBJECTS = [{ key: "saltPepper" }, { key: "oliveOil" }];

export const LANGUAGES = [
  { key: "fr", label: "Français" },
  { key: "en", label: "English" },
];

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best effort: the choice just doesn't outlive the visit.
  }
}

/** { [object key]: shown? }, every object shown unless turned off. */
export function loadShelfObjects() {
  const saved = read(SHELF_OBJECTS_KEY) ?? {};
  return Object.fromEntries(SHELF_OBJECTS.map(({ key }) => [key, saved[key] ?? true]));
}

export function saveShelfObject(key, shown) {
  write(SHELF_OBJECTS_KEY, { ...loadShelfObjects(), [key]: shown });
}

export function loadLanguage() {
  const saved = read(LANGUAGE_KEY);
  return LANGUAGES.some(({ key }) => key === saved) ? saved : LANGUAGES[0].key;
}

export function saveLanguage(key) {
  write(LANGUAGE_KEY, key);
}
