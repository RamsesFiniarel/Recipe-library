import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAutoTags } from "../server/services/tags.service.js";

// A hand-written nutrition analysis: rules tested without the database.
const row = (name, grams, family) => ({ name, grams, food: family ? { name, family } : null, values: family ? {} : null });
const analysis = (rows, total, perServing) => ({ rows, total, perServing });

const crepes = analysis(
  [row("farine", 250, "produits céréaliers"), row("sucre", 60, "sucres, miels et assimilés"), row("lait", 290, "lait et produits laitiers")],
  { sugars: 75, salt: 1, energy_kcal: 1600 },
  { energy_kcal: 400 }
);

test("a savoury plate's worth is a meal; its people, its portion tag", () => {
  const meal = analysis(
    [row("poulet", 400, "viandes cuites"), row("pommes de terre", 600, "légumes")],
    { sugars: 20, salt: 5, energy_kcal: 2400 },
    { energy_kcal: 600 }
  );
  assert.deepEqual(computeAutoTags({ title: "Poulet rôti", servings: 4, prepMinutes: 30 }, meal), [
    "rapide",
    "repas",
    "famille",
  ]);
});

test("sweetened, sweet enough and nothing savoury is a dessert", () => {
  assert.deepEqual(computeAutoTags({ title: "Crêpes", servings: 4, prepMinutes: 60 }, crepes), [
    "vege",
    "dessert",
    "leger",
    "famille",
  ]);
});

test("a drink is neither a meal nor a dessert", () => {
  assert.deepEqual(computeAutoTags({ title: "Limonade", bookTitle: "Boissons", servings: 4 }, crepes), ["vege"]);
});

test("chili makes it spicy", () => {
  const rice = analysis(
    [row("piment rouge", 20, "légumes"), row("riz", 600, "produits céréaliers")],
    { sugars: 5, salt: 2, energy_kcal: 2000 },
    { energy_kcal: 1000 }
  );
  assert.deepEqual(computeAutoTags({ title: "Riz pimenté", servings: 2 }, rice), ["vege", "epice", "repas", "copieux", "pour2"]);
});

test("meat named in a line without a food is still meat; too few lines known, no calorie tag", () => {
  const pasta = analysis(
    [row("lardons fumés", 200, null), row("pâtes", 500, "produits céréaliers")],
    { sugars: 10, salt: 3, energy_kcal: 2000 },
    { energy_kcal: 1000 }
  );
  assert.deepEqual(computeAutoTags({ title: "Pâtes", servings: 2 }, pasta), ["repas", "pour2"]);
});

test("no ingredient, no tag", () => {
  assert.deepEqual(computeAutoTags({ title: "Vide" }, analysis([], {}, {})), []);
});
