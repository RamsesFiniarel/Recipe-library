import { test } from "node:test";
import assert from "node:assert/strict";
import { readRecipePage } from "../server/services/recipe-web.service.js";
import { readRecipePageApart } from "../server/services/recipe-web.worker.js";

const URL = "https://www.example.com/recettes/gratin?utm_source=newsletter#avis";
const page = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const line = (quantity, unit, name) => ({ quantity, unit, name });

test("a recipe described as JSON-LD, wherever it's nested", () => {
  const recipe = readRecipePage(
    page(
      jsonLd({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebPage", name: "Gratin" },
          {
            "@type": ["Recipe", "NewsArticle"],
            name: "Gratin dauphinois &amp; salade",
            recipeYield: ["4", "4 servings"],
            // A total that left out the cooking: the sum is kept.
            totalTime: "PT0H15M",
            prepTime: "PT15M",
            cookTime: "PT1H",
            recipeIngredient: ["Ingrédients", "1 1/2 cups milk", "2½–3 lb potatoes", "½ tsp salt", "For the salad:", "1 lettuce,"],
            recipeInstructions: [
              { "@type": "HowToSection", name: "Gratin", itemListElement: [{ "@type": "HowToStep", text: "<p>Slice the potatoes.</p><p>Bake 1 hour.</p>" }] },
              { "@type": "HowToSection", name: "Salad :", itemListElement: [{ "@type": "HowToStep", name: "Step 1", text: "Step 1: Wash the lettuce." }] },
            ],
          },
        ],
      })
    ),
    URL
  );
  assert.deepEqual(recipe, {
    title: "Gratin dauphinois & salade",
    servings: 4,
    prepMinutes: 75,
    ingredients: [
      line("1,5", "tasse", "milk"),
      line("2,5-3", "lb", "potatoes"),
      line("1/2", "c.a.c", "salt"),
      line("", "", "For the salad :"),
      line("1", "", "lettuce"),
    ],
    instructions: "Gratin :\nSlice the potatoes.\nBake 1 hour.\n\nSalad :\nWash the lettuce.\n\nSource : https://www.example.com/recettes/gratin",
  });
});

test("JSON-LD that isn't quite JSON, with a total time written out", () => {
  const block = `<script type="application/ld+json"><!--{"@type":"Recipe","name":"Soupe","totalTime":"45 minutes (plus resting)","recipeYield":"Serves 6","recipeIngredient":["1 leek"],"recipeInstructions":"Cook	it.
Serve."}--></script>`;
  const recipe = readRecipePage(page(block), URL);
  assert.equal(recipe.prepMinutes, 45);
  assert.equal(recipe.servings, 6);
  assert.equal(recipe.instructions.split("\n")[0], "Cook it. Serve.");
});

test("the page's own list gives the data's ingredients their sub-headings", () => {
  const data = jsonLd({
    "@type": "Recipe",
    name: "Tarte",
    recipeIngredient: ["200 g flour", "100 g butter", "3 apples"],
    recipeInstructions: ["Make the dough.", "Bake."],
  });
  const card = `<div class="wprm-recipe-ingredients-container">
    <h3 class="wprm-recipe-header">Ingredients</h3>
    <div class="wprm-recipe-ingredient-group"><h4 class="wprm-recipe-group-name">Pastry</h4>
      <ul><li class="wprm-recipe-ingredient">▢ <span>200</span> <span>g</span> <span>flour</span></li>
      <li class="wprm-recipe-ingredient">▢ 100 g butter</li></ul></div>
    <div class="wprm-recipe-ingredient-group"><h4 class="wprm-recipe-group-name">Filling</h4>
      <ul><li class="wprm-recipe-ingredient">▢ 3 apples</li></ul></div></div>`;
  const recipe = readRecipePage(page(data, card), URL);
  assert.deepEqual(recipe.ingredients, [
    line("", "", "Pastry :"),
    line("200", "g", "flour"),
    line("100", "g", "butter"),
    line("", "", "Filling :"),
    line("3", "", "apples"),
  ]);
});

test("microdata, its steps in an element named after them (Jetpack)", () => {
  const body = `<div itemscope itemtype="https://schema.org/Recipe">
    <h3 itemprop="name">SPAGHETTI AGLIO E OLIO</h3>
    <time itemprop="totalTime" datetime="P0DT0H20M0S">20 minutes</time>
    <ul><li itemprop="recipeIngredient">8 ounces spaghetti</li><li itemprop="recipeIngredient">1/4 to 1/2 teaspoon pepper flakes</li></ul>
    <div class="jetpack-recipe-directions"><p>Boil the spaghetti until it is two minutes shy of done, then drain it.</p></div>
  </div>`;
  const recipe = readRecipePage(page("<title>Spaghetti | Smitten Kitchen</title>", body), URL);
  assert.equal(recipe.title, "Spaghetti aglio e olio");
  assert.equal(recipe.prepMinutes, 20);
  assert.deepEqual(recipe.ingredients, [line("8", "oz", "spaghetti"), line("1/4-1/2", "c.a.c", "pepper flakes")]);
  assert.match(recipe.instructions, /^Boil the spaghetti/);
});

test("a page without any data: the lines under its headings", () => {
  const body = `<nav><h2>Ingrédients de saison</h2><ul><li>Menu</li><li>Recherche</li></ul></nav>
    <h1>Recette – Blanquette de veau</h1>
    <p>Nombre de personnes :</p><p>6</p>
    <p>Temps de préparation : 30 min</p><p>Temps de cuisson : 2 h</p>
    <h2>Ingrédients</h2>
    1,5 kg de veau,

    Gros sel

    <strong>Sauce</strong>

    Beurre - 70 grammes

    Farina 00 70 g
    <h2>Préparation pour [titre]</h2>
    <h3>Étape 1</h3><p>Rincer la viande à l'eau froide.</p>
    <h3>Cuisson</h3><p>Cuire 1 h 30 à frémissement.</p>
    <h2>Commentaires</h2><p>Délicieux !</p>`;
  const recipe = readRecipePage(page("", body), URL);
  assert.deepEqual(recipe, {
    title: "Blanquette de veau",
    servings: 6,
    prepMinutes: 150,
    ingredients: [
      line("1,5", "kg", "de veau"),
      line("", "", "Gros sel"),
      line("", "", "Sauce :"),
      line("70", "g", "Beurre"),
      line("70", "g", "Farina 00"),
    ],
    instructions: "Rincer la viande à l'eau froide.\n\nCuisson :\nCuire 1 h 30 à frémissement.\n\nSource : https://www.example.com/recettes/gratin",
  });
});

test("read on a thread of its own, the same recipe; elements nested past reason are left", async () => {
  const html = page(jsonLd({ "@type": "Recipe", name: "Soupe", recipeIngredient: ["1 leek"], recipeInstructions: "Cook." }));
  assert.deepEqual(await readRecipePageApart(html, URL), readRecipePage(html, URL));
  // Deeper than a browser would nest: no stack overflow, nothing found.
  assert.equal(readRecipePage(page("", `${"<div>".repeat(5000)}<h2>Ingrédients</h2><ul><li>1 g</li><li>2 g</li></ul>`), URL), null);
});

test("a page with no recipe on it gives nothing", () => {
  assert.equal(readRecipePage(page("<title>Résultats</title>", "<h1>Recherche</h1><p>10 résultats</p>"), URL), null);
  // Paragraphs under an "Ingrédients" heading aren't a list of them.
  const article = `<h2>Ingrédients et préparation</h2><p>${"Une longue phrase qui raconte la recette sans liste. ".repeat(4)}</p><p>${"Et encore une autre phrase. ".repeat(6)}</p>`;
  assert.equal(readRecipePage(page("", article), URL), null);
});
