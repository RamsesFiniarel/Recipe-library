import { Router } from "express";
import * as booksService from "../services/books.service.js";
import { recipesRouter } from "./recipes.routes.js";
import {
  assertValidId,
  requireTitle,
  optionalHexColor,
  optionalEnum,
  requireShelfRows,
  optionalTextureDataUrl,
  optionalMultiplier,
} from "../middleware/validate.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { PAGE_COLOR_TOKENS } from "../../shared/palette.js";
import {
  WIDTH_MULTIPLIER_MIN,
  WIDTH_MULTIPLIER_MAX,
  HEIGHT_MULTIPLIER_MIN,
  HEIGHT_MULTIPLIER_MAX,
  GLOSS_MIN,
  GLOSS_MAX,
} from "../../shared/book-size.js";

const COVER_STYLES = ["color", "texture"];

export const booksRouter = Router();

booksRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(booksService.listBooks());
  })
);

booksRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const title = requireTitle(req.body?.title);
    res.status(201).json(booksService.createBook({ title }));
  })
);

// Above "/:bookId", which would otherwise match these paths.
booksRouter.get(
  "/search-index",
  asyncHandler(async (req, res) => {
    res.json(booksService.listSearchIndex());
  })
);

// The whole shelf layout, sent once per drop (one drag can move many books)
// or after placing unplaced books (see three/scene.js).
booksRouter.patch(
  "/reorder",
  asyncHandler(async (req, res) => {
    const rows = requireShelfRows(req.body?.rows);
    res.json(booksService.reorderBooks(rows));
  })
);

// A cover face as an image, cached for good (its URL changes with the book).
booksRouter.get(
  "/:bookId/textures/:face",
  asyncHandler(async (req, res) => {
    const bookId = assertValidId(req.params.bookId, "bookId");
    const face = optionalEnum(req.params.face, booksService.TEXTURE_FACES, "face");
    const texture = booksService.getBookTexture(bookId, face);
    if (!texture) throw new HttpError(404, "Texture introuvable");
    res.set("Cache-Control", "public, max-age=31536000, immutable").type(texture.type).send(texture.data);
  })
);

booksRouter.get(
  "/:bookId",
  asyncHandler(async (req, res) => {
    const bookId = assertValidId(req.params.bookId, "bookId");
    const book = booksService.getBookWithRecipes(bookId);
    if (!book) throw new HttpError(404, "Livre introuvable");
    res.json(book);
  })
);

booksRouter.patch(
  "/:bookId",
  asyncHandler(async (req, res) => {
    const bookId = assertValidId(req.params.bookId, "bookId");
    const title = req.body?.title === undefined ? undefined : requireTitle(req.body.title);
    const coverColor = optionalHexColor(req.body?.coverColor);
    const pageColorToken = optionalEnum(req.body?.pageColorToken, PAGE_COLOR_TOKENS, "pageColorToken");
    const coverStyle = optionalEnum(req.body?.coverStyle, COVER_STYLES, "coverStyle");
    // Always set (never "cleared"): a null is ignored like a missing field.
    const coverGloss =
      optionalMultiplier(req.body?.coverGloss, { min: GLOSS_MIN, max: GLOSS_MAX, label: "coverGloss" }) ?? undefined;
    const coverTexture = optionalTextureDataUrl(req.body?.coverTexture, "coverTexture");
    const spineTexture = optionalTextureDataUrl(req.body?.spineTexture, "spineTexture");
    const backTexture = optionalTextureDataUrl(req.body?.backTexture, "backTexture");
    const widthMultiplier = optionalMultiplier(req.body?.widthMultiplier, {
      min: WIDTH_MULTIPLIER_MIN,
      max: WIDTH_MULTIPLIER_MAX,
      label: "widthMultiplier",
    });
    const heightMultiplier = optionalMultiplier(req.body?.heightMultiplier, {
      min: HEIGHT_MULTIPLIER_MIN,
      max: HEIGHT_MULTIPLIER_MAX,
      label: "heightMultiplier",
    });
    const book = booksService.updateBook(bookId, {
      title,
      coverColor,
      pageColorToken,
      coverStyle,
      coverGloss,
      coverTexture,
      spineTexture,
      backTexture,
      widthMultiplier,
      heightMultiplier,
    });
    if (!book) throw new HttpError(404, "Livre introuvable");
    res.json(book);
  })
);

booksRouter.delete(
  "/:bookId",
  asyncHandler(async (req, res) => {
    const bookId = assertValidId(req.params.bookId, "bookId");
    if (!booksService.deleteBook(bookId)) throw new HttpError(404, "Livre introuvable");
    res.status(204).end();
  })
);

booksRouter.use("/:bookId/recipes", recipesRouter);
