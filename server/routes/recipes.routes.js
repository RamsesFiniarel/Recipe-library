import { Router } from "express";
import * as booksService from "../services/books.service.js";
import * as recipesService from "../services/recipes.service.js";
import { parseRecipePages } from "../services/recipe-import.service.js";
import { readRecipePageApart } from "../services/recipe-web.worker.js";
import { fetchPage } from "../services/page-fetch.service.js";
import { findWebAddress } from "../../shared/web-address.js";
import { customTagKeys } from "../services/custom-tags.service.js";
import { TAG_KEYS } from "../../shared/recipe-tags.js";
import {
  assertValidId,
  requireTitle,
  optionalText,
  optionalServings,
  optionalMinutes,
  optionalTagOverrides,
  requireIngredientLines,
  requireReadPages,
} from "../middleware/validate.js";
import { asyncHandler } from "../utils/async-handler.js";
import { MAX_NAME_LENGTH, MAX_QUANTITY_LENGTH, QUANTITY_CHARS } from "../../shared/ingredients.js";
import { HttpError } from "../utils/http-error.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { IMPORTS_PER_MINUTE } from "../config.js";

// mergeParams: the parent router owns :bookId, mounted under /:bookId/recipes.
export const recipesRouter = Router({ mergeParams: true });

// A recipe read from photos without a title gets this one, to be changed.
const DEFAULT_IMPORTED_TITLE = "Nouvelle recette";
const MAX_IMPORTED_LINES = 200;
const MAX_IMPORTED_TEXT = 20000;

/** Creates a recipe from an import's draft, trimmed to what a recipe holds
 * rather than refused. */
function createImported(bookId, draft) {
  // A quantity the editor wouldn't take goes back into the name.
  const lines = draft.ingredients.slice(0, MAX_IMPORTED_LINES).map((line) => {
    const quantity = line.quantity.length <= MAX_QUANTITY_LENGTH && QUANTITY_CHARS.test(line.quantity) ? line.quantity : "";
    const name = (quantity === line.quantity ? line.name : `${line.quantity} ${line.name}`).slice(0, MAX_NAME_LENGTH);
    return { quantity, unit: line.unit, name };
  });
  const recipe = recipesService.createRecipe(bookId, {
    title: requireTitle((draft.title || DEFAULT_IMPORTED_TITLE).slice(0, 200)),
  });
  return recipesService.updateRecipe(bookId, recipe.id, {
    servings: draft.servings >= 1 && draft.servings <= 999 ? draft.servings : null,
    prepMinutes: draft.prepMinutes >= 1 ? optionalMinutes(Math.min(draft.prepMinutes, 99 * 24 * 60)) : null,
    ingredients: requireIngredientLines(lines),
    instructions: draft.instructions.slice(0, MAX_IMPORTED_TEXT),
  });
}

recipesRouter.use((req, res, next) => {
  req.bookId = assertValidId(req.params.bookId, "bookId");
  next();
});

recipesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!booksService.bookExists(req.bookId)) throw new HttpError(404, "Livre introuvable");
    const title = requireTitle(req.body?.title);
    res.status(201).json(recipesService.createRecipe(req.bookId, { title }));
  })
);

// From photos: the browser reads them (recipe-photo-reader.js) and sends
// the text lines with their positions; recipe-import.service.js sorts them.
recipesRouter.post(
  "/import",
  rateLimit({ windowMs: 60_000, max: IMPORTS_PER_MINUTE, label: "import de photos" }),
  asyncHandler(async (req, res) => {
    if (!booksService.bookExists(req.bookId)) throw new HttpError(404, "Livre introuvable");
    const draft = parseRecipePages(requireReadPages(req.body?.pages));
    if (!draft.title && draft.ingredients.length === 0 && !draft.instructions) {
      throw new HttpError(422, "Aucune recette lisible sur ces photos");
    }
    res.status(201).json(createImported(req.bookId, draft));
  })
);

// From a web page: fetched and parsed by the server, never the browser
// (page-fetch.service.js, recipe-web.service.js).
recipesRouter.post(
  "/import-web",
  rateLimit({ windowMs: 60_000, max: IMPORTS_PER_MINUTE, label: "import de pages web" }),
  asyncHandler(async (req, res) => {
    if (!booksService.bookExists(req.bookId)) throw new HttpError(404, "Livre introuvable");
    const address = typeof req.body?.url === "string" ? findWebAddress(req.body.url.slice(0, 4096)) : null;
    if (!address) throw new HttpError(400, "Adresse invalide", "invalid-address");
    const page = await fetchPage(address);
    const draft = await readRecipePageApart(page.html, page.url);
    if (!draft) throw new HttpError(422, "Aucune recette trouvée sur cette page", "no-recipe");
    res.status(201).json(createImported(req.bookId, draft));
  })
);

recipesRouter.get(
  "/:recipeId",
  asyncHandler(async (req, res) => {
    const recipeId = assertValidId(req.params.recipeId, "recipeId");
    const recipe = recipesService.getRecipe(req.bookId, recipeId);
    if (!recipe) throw new HttpError(404, "Recette introuvable");
    res.json(recipe);
  })
);

recipesRouter.patch(
  "/:recipeId",
  asyncHandler(async (req, res) => {
    const recipeId = assertValidId(req.params.recipeId, "recipeId");
    const body = req.body ?? {};

    // Partial patches: only the fields present are touched.
    const patch = {};
    if (body.title !== undefined) patch.title = requireTitle(body.title);
    if (body.ingredients !== undefined) patch.ingredients = requireIngredientLines(body.ingredients);
    if (body.instructions !== undefined) {
      patch.instructions = optionalText(body.instructions, { label: "instructions" }) ?? "";
    }
    if (body.servings !== undefined) patch.servings = optionalServings(body.servings);
    if (body.prepMinutes !== undefined) patch.prepMinutes = optionalMinutes(body.prepMinutes);
    if (body.tagOverrides !== undefined) {
      patch.tagOverrides = optionalTagOverrides(body.tagOverrides, [...TAG_KEYS, ...customTagKeys()]);
    }

    const recipe = recipesService.updateRecipe(req.bookId, recipeId, patch);
    if (!recipe) throw new HttpError(404, "Recette introuvable");
    res.json(recipe);
  })
);

recipesRouter.delete(
  "/:recipeId",
  asyncHandler(async (req, res) => {
    const recipeId = assertValidId(req.params.recipeId, "recipeId");
    if (!recipesService.deleteRecipe(req.bookId, recipeId)) {
      throw new HttpError(404, "Recette introuvable");
    }
    res.status(204).end();
  })
);
