import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIngredientLine } from "../shared/ingredients.js";
import { shoppingList } from "../shared/shopping.js";

// A basket recipe from written lines; `key` stands for the matched food.
const recipe = (id, lines) => ({
  id,
  title: `Recipe ${id}`,
  lines: lines.map(([text, key]) => ({ ...parseIngredientLine(text), key })),
});

const read = (row) => row.segments.map(({ amount, label }) => [amount, label].filter(Boolean).join(" ")).join(" + ");

test("weights and spoons of a food add up, each in its own measure", () => {
  const [row] = shoppingList(
    [
      recipe("a", [["200 g butter", "f1"]]),
      recipe("b", [["2 tbsp butter, melted", "f1"], ["50 g butter", "f1"]]),
    ],
    "en"
  );
  assert.equal(read(row), "250 g + 2 tbsp butter");
  assert.deepEqual(row.recipes.map((r) => r.id), ["a", "b"]);
});

test("one unit throughout stays; mixed ones become grams or millilitres, then kilos or litres", () => {
  const list = shoppingList(
    [
      recipe("a", [["20 cL cream", "f1"], ["500 g flour", "f2"], ["10 cL milk", "f3"]]),
      recipe("b", [["10 cL cream", "f1"], ["1 kg flour", "f2"], ["100 mL milk", "f3"]]),
    ],
    "fr"
  );
  assert.deepEqual(list.map(read), ["30 cL cream", "1,5 kg flour", "200 mL milk"]);
});

test("counted things add up by name, made plural when the total is", () => {
  const list = shoppingList(
    [
      recipe("a", [["3 garlic cloves", "f1"], ["1 onion", "f2"], ["4-5 tomatoes", "f3"]]),
      recipe("b", [["2 garlic cloves, crushed", "f1"], ["1 head garlic", "f1"], ["1 onion, chopped", "f2"], ["2 tomatoes", "f3"]]),
    ],
    "en"
  );
  assert.deepEqual(list.map(read), ["5 garlic cloves + 1 head garlic", "2 onions", "6-7 tomatoes"]);
});

test("a line without a quantity shows once, unless another measures it", () => {
  const list = shoppingList(
    [
      recipe("a", [["Salt and pepper", "n salt pepper"], ["Butter, for greasing", "f1"]]),
      recipe("b", [["Salt and pepper", "n salt pepper"], ["30 g butter", "f1"]]),
    ],
    "en"
  );
  assert.deepEqual(list.map(read), ["30 g butter", "salt and pepper"]);
  assert.equal(list[1].recipes.length, 2);
});
