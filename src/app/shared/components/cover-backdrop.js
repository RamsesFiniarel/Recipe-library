import { hexForColorToken } from "@shared/palette.js";

/** A book's cover as a blurred, darkened backdrop: the book page's
 * background, and a copy bridging the library-to-book transition. The copy
 * lives outside the router's container (index.html), so it survives the
 * page swap and fades out once the book page's identical backdrop is
 * ready: one crossfade, no flash. */

const HIDE_DURATION_MS = 200;

function transitionLayer() {
  return document.querySelector(".cover-backdrop--transition");
}

/** The front cover picture's URL if the book uses pictures, else its colour. */
export function paintCoverBackdrop(element, book) {
  element.style.backgroundColor = book.coverColor || hexForColorToken(book.colorToken);
  element.style.backgroundImage =
    book.coverStyle === "texture" && book.coverTextureUrl ? `url("${book.coverTextureUrl}")` : "none";
}

/** Resolves once the picture is decoded (at once without one), so it never
 * shows as a flat colour first. */
export function coverBackdropReady(book) {
  if (book.coverStyle !== "texture" || !book.coverTextureUrl) return Promise.resolve();
  const image = new Image();
  image.src = book.coverTextureUrl;
  return image.decode().catch(() => {});
}

/** Paints the bridging layer for `book` while hidden, decoding its picture
 * ahead of showTransitionBackdrop(). */
export function prepareTransitionBackdrop(book) {
  const layer = transitionLayer();
  if (!layer) return Promise.resolve();
  paintCoverBackdrop(layer, book);
  return coverBackdropReady(book);
}

export function showTransitionBackdrop(durationMs) {
  const layer = transitionLayer();
  if (!layer) return;
  layer.style.setProperty("--cover-backdrop-fade", `${durationMs}ms`);
  layer.classList.add("is-visible");
}

export function hideTransitionBackdrop() {
  const layer = transitionLayer();
  if (!layer || !layer.classList.contains("is-visible")) return;
  layer.style.setProperty("--cover-backdrop-fade", `${HIDE_DURATION_MS}ms`);
  layer.classList.remove("is-visible");
}
