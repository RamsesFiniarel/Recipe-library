import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findUnit,
  formatIngredientLine,
  importIngredientText,
  isHeading,
  parseIngredientLine,
  parseQuantity,
  scaleQuantity,
  unitLabel,
} from "../shared/ingredients.js";

test("parseQuantity reads commas, fractions and ranges", () => {
  assert.equal(parseQuantity("1,5"), 1.5);
  assert.equal(parseQuantity("2.5"), 2.5);
  assert.equal(parseQuantity("1/2"), 0.5);
  assert.equal(parseQuantity("4-5"), 4.5);
  assert.equal(parseQuantity(""), null);
  assert.equal(parseQuantity("abc"), null);
});

test("parseIngredientLine splits quantity, unit and name", () => {
  assert.deepEqual(parseIngredientLine("250 g de farine"), { quantity: "250", unit: "g", name: "de farine" });
  assert.deepEqual(parseIngredientLine("3 c. à soupe d'huile d'olive"), {
    quantity: "3",
    unit: "c.a.s",
    name: "d'huile d'olive",
  });
  // Counted things keep their word in the name: units are measures only.
  assert.deepEqual(parseIngredientLine("2 gousses d'ail"), { quantity: "2", unit: "", name: "gousses d'ail" });
  assert.deepEqual(parseIngredientLine("4-5 pommes"), { quantity: "4-5", unit: "", name: "pommes" });
  // Ranges of fractions, and with a dash as typeset.
  assert.deepEqual(parseIngredientLine("1/4 to 1/2 teaspoon salt"), { quantity: "1/4-1/2", unit: "c.a.c", name: "salt" });
  assert.deepEqual(parseIngredientLine("4–6 garlic cloves"), { quantity: "4-6", unit: "", name: "garlic cloves" });
  assert.deepEqual(parseIngredientLine("Sel"), { quantity: "", unit: "", name: "Sel" });
});

test("findUnit knows the units by any of their names, in French and English", () => {
  assert.equal(findUnit("c. à s.")?.key, "c.a.s");
  assert.equal(findUnit("grammes")?.key, "g");
  assert.equal(findUnit("tbsp")?.key, "c.a.s");
  assert.equal(findUnit("cups")?.key, "tasse");
  assert.equal(findUnit("xyz"), null);
});

test("unitLabel agrees with the quantity, in each language", () => {
  assert.equal(unitLabel("tasse", "1"), "tasse");
  assert.equal(unitLabel("tasse", "2"), "tasses");
  assert.equal(unitLabel("tasse", "2", "en"), "cups");
  assert.equal(unitLabel("c.a.s", "1", "en"), "tbsp");
  assert.equal(formatIngredientLine({ quantity: "2", unit: "tasse", name: "de lait" }), "2 tasses de lait");
  assert.equal(formatIngredientLine({ quantity: "1", unit: "c.a.s", name: "olive oil" }, "en"), "1 tbsp olive oil");
});

test("scaleQuantity rounds the way each thing is measured", () => {
  // Weights and volumes: to two figures or so.
  assert.equal(scaleQuantity("1,5", 8 / 5, "kg"), "2,4");
  assert.equal(scaleQuantity("100", 8 / 5, "g"), "160");
  assert.equal(scaleQuantity("1.5", 2, "kg", "en"), "3");
  // Things counted: to the half, the quarter under one, as fractions.
  assert.equal(scaleQuantity("3", 8 / 5, ""), "5");
  assert.equal(scaleQuantity("1/2", 8 / 5, ""), "3/4");
  assert.equal(scaleQuantity("1", 0.5, ""), "1/2");
  // A range scales both ends.
  assert.equal(scaleQuantity("5-6", 8 / 5, ""), "8-9,5");
  assert.equal(scaleQuantity("", 2, ""), null);
});

test("importIngredientText turns the former free text into lines", () => {
  const lines = importIngredientText("Pour 4 personnes\n- 200 g de farine\nSauce :\n- 1 oeuf", { servings: 4 });
  assert.deepEqual(lines, [
    { quantity: "200", unit: "g", name: "de farine" },
    { quantity: "", unit: "", name: "Sauce :" },
    { quantity: "1", unit: "", name: "oeuf" },
  ]);
  assert.equal(isHeading(lines[1]), true);
  assert.equal(isHeading({ quantity: "1", unit: "", name: "Pâte :" }), false);
});
