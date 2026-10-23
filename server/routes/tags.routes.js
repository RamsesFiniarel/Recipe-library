import { Router } from "express";
import * as customTags from "../services/custom-tags.service.js";
import { assertTagKey, requireTagLabel } from "../middleware/validate.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

/** The tags added by hand in the settings (see custom-tags.service.js). */
export const tagsRouter = Router();

tagsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(customTags.listCustomTags());
  })
);

tagsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const tag = customTags.createCustomTag(requireTagLabel(req.body?.label));
    if (!tag) throw new HttpError(409, "Ce tag existe déjà");
    res.status(201).json(tag);
  })
);

tagsRouter.delete(
  "/:key",
  asyncHandler(async (req, res) => {
    if (!customTags.deleteCustomTag(assertTagKey(req.params.key))) throw new HttpError(404, "Tag introuvable");
    res.status(204).end();
  })
);
