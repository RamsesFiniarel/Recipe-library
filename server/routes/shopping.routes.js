import { Router } from "express";
import * as shopping from "../services/shopping.service.js";
import { assertValidId } from "../middleware/validate.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

/** The groceries basket (see shopping.service.js); each change answers with
 * the whole basket. */
export const shoppingRouter = Router();

shoppingRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(shopping.getBasket());
  })
);

shoppingRouter.post(
  "/recipes",
  asyncHandler(async (req, res) => {
    if (!shopping.addToBasket(assertValidId(req.body?.recipeId, "recipeId"))) {
      throw new HttpError(404, "Recette introuvable");
    }
    res.json(shopping.getBasket());
  })
);

// A thing's key (see search.service.js): "f" and a food code, or "n" and words.
const MAX_KEY_LENGTH = 200;

shoppingRouter.post(
  "/hidden",
  asyncHandler(async (req, res) => {
    const key = req.body?.key;
    if (typeof key !== "string" || !key || key.length > MAX_KEY_LENGTH) throw new HttpError(400, "key invalide");
    shopping.hideItem(key);
    res.json(shopping.getBasket());
  })
);

shoppingRouter.delete(
  "/recipes/:recipeId",
  asyncHandler(async (req, res) => {
    shopping.removeFromBasket(assertValidId(req.params.recipeId, "recipeId"));
    res.json(shopping.getBasket());
  })
);
