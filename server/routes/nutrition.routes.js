import { Router } from "express";
import { analyzeRecipe, listFoods } from "../services/nutrition.service.js";
import { computeAutoTags } from "../services/tags.service.js";
import * as booksService from "../services/books.service.js";
import {
  requireIngredientLines,
  optionalServings,
  optionalMinutes,
  optionalEnum,
  requireTitle,
  assertValidId,
} from "../middleware/validate.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

export const nutritionRouter = Router();

// Stateless: computed from the lines on screen, saved or not; food names
// follow the interface language.
nutritionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const lines = requireIngredientLines(req.body?.ingredients);
    const servings = optionalServings(req.body?.servings) ?? null;
    const language = optionalEnum(req.body?.language, ["fr", "en"], "language") ?? "fr";
    const analysis = analyzeRecipe(lines, servings, { language });
    if (!analysis) throw new HttpError(503, "Base nutritionnelle absente : lancer npm run nutrition:build");
    res.json(analysis);
  })
);

// The whole table, per 100 g, for the settings' database page.
nutritionRouter.get(
  "/foods",
  asyncHandler(async (req, res) => {
    const language = optionalEnum(req.query.language, ["fr", "en"], "language") ?? "fr";
    const table = listFoods(language);
    if (!table) throw new HttpError(503, "Base nutritionnelle absente : lancer npm run nutrition:build");
    res.json(table);
  })
);

// Automatic tags of a recipe being edited (saved or not).
nutritionRouter.post(
  "/tags",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const bookId = assertValidId(body.bookId, "bookId");
    const book = booksService.getBookWithRecipes(bookId);
    if (!book) throw new HttpError(404, "Livre introuvable");
    const autoTags = computeAutoTags({
      title: requireTitle(body.title),
      ingredients: requireIngredientLines(body.ingredients),
      servings: optionalServings(body.servings) ?? null,
      prepMinutes: optionalMinutes(body.prepMinutes) ?? null,
      bookTitle: book.title,
    });
    res.json({ autoTags });
  })
);
