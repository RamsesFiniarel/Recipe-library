import {
  getUnit,
  ingredientLabel,
  ingredientWords,
  isKitchenMeasure,
  parseQuantity,
  scaleQuantity,
  unitLabel,
} from "./ingredients.js";

/** The groceries list, from the basket's recipes ({ id, title, lines }, a
 * line being { quantity, unit, name, key }, see search.service.js): one row
 * per thing to buy (lines sharing a key), its quantities added up.
 * A row is { key, label, segments: [{ amount, label }], recipes: [{ id,
 * title }] }, read "200 g + 2 tbsp butter" or "5 garlic cloves + 1 head
 * garlic". Rows come sorted by label. */
export function shoppingList(recipes, language = "fr") {
  const items = new Map();
  for (const recipe of recipes) {
    for (const line of recipe.lines) {
      const item = items.get(line.key) ?? { key: line.key, parts: [], recipes: new Map() };
      const label = ingredientLabel(line.name) || line.name;
      item.parts.push({ label, words: ingredientWords(label).join(" "), unit: line.unit, amount: bounds(line.quantity) });
      item.recipes.set(recipe.id, { id: recipe.id, title: recipe.title });
      items.set(line.key, item);
    }
  }
  const collator = new Intl.Collator(language, { sensitivity: "base", numeric: true });
  return [...items.values()].map((item) => toRow(item, language)).sort((a, b) => collator.compare(a.label, b.label));
}

// "4-5" -> { min: 4, max: 5 }; null without a number.
function bounds(quantity) {
  const values = String(quantity ?? "").split("-").map(parseQuantity);
  if (values.some((value) => value === null)) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

// How a unit adds up: weights in grams, volumes in millilitres; spoons,
// cups, pinches and counts each on their own.
function dimension(unitKey) {
  const unit = getUnit(unitKey);
  if (!unitKey || !unit || isKitchenMeasure(unitKey)) return { key: unitKey ?? "", factor: 1 };
  return unit.grams ? { key: "g", factor: unit.grams } : { key: "mL", factor: unit.ml };
}

/** The parts' quantities, one per dimension ("250 g", "2 tbsp"): a single
 * unit throughout stays ("30 cL"), mixed ones become grams or millilitres,
 * kilos or litres from 1000. */
function addUp(parts, language) {
  const sums = new Map();
  for (const { unit, amount } of parts) {
    const { key, factor } = dimension(unit);
    const sum = sums.get(key) ?? { min: 0, max: 0, units: new Set() };
    sum.min += amount.min * factor;
    sum.max += amount.max * factor;
    sum.units.add(unit);
    sums.set(key, sum);
  }
  return [...sums].map(([key, { min, max, units }]) => {
    let unit = units.size === 1 ? [...units][0] : key;
    if (units.size > 1 && min >= 1000) unit = key === "g" ? "kg" : "L";
    const divisor = key === "g" || key === "mL" ? dimension(unit).factor : 1;
    const range = min === max ? String(min / divisor) : `${min / divisor}-${max / divisor}`;
    const quantity = scaleQuantity(range, 1, unit, language);
    return unit ? `${quantity} ${unitLabel(unit, quantity, language)}` : quantity;
  });
}

// The label most parts have, the shortest on a tie.
function mostFrequent(parts) {
  const counts = new Map();
  for (const { label } of parts) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
}

// A one-word name made plural ("oignon" -> "oignons", "tomato" ->
// "tomatoes"); longer names stay as written.
function plural(label) {
  if (/\s/.test(label) || /[sxz]$/.test(label)) return label;
  if (/(?:au|eu)$/.test(label)) return `${label}x`;
  if (/(?:ch|sh)$/.test(label) || /[^aeiou]o$/.test(label)) return `${label}es`;
  if (/[^aeiou]y$/.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

// Counted lines' name: as written where most were counted, plural when the
// total is.
function countedLabel(parts) {
  const largest = parts.reduce((best, part) => (part.amount.max > best.amount.max ? part : best));
  const total = parts.reduce((sum, part) => sum + part.amount.min, 0);
  return total > 1 && largest.amount.max <= 1 ? plural(largest.label) : largest.label;
}

function toRow(item, language) {
  const segments = [];
  // Weighed or measured: added up whatever the name says.
  const measured = item.parts.filter((part) => part.amount && part.unit);
  if (measured.length) segments.push({ amount: addUp(measured, language).join(" + "), label: mostFrequent(measured) });
  // Counted: by name, "3 cloves" and "1 head" of garlic being different things.
  const counted = new Map();
  for (const part of item.parts.filter((part) => part.amount && !part.unit)) {
    counted.set(part.words, [...(counted.get(part.words) ?? []), part]);
  }
  for (const parts of counted.values()) segments.push({ amount: addUp(parts, language)[0], label: countedLabel(parts) });
  // No quantity ("salt and pepper"): only for a name nothing else measures.
  const said = new Set(item.parts.filter((part) => part.amount).map((part) => part.words));
  for (const part of item.parts.filter((part) => !part.amount)) {
    if (said.has(part.words)) continue;
    said.add(part.words);
    segments.push({ amount: "", label: part.label });
  }
  return { key: item.key, label: mostFrequent(item.parts), segments, recipes: [...item.recipes.values()] };
}
