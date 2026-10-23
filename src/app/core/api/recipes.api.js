import { http } from "./http.js";

const encode = encodeURIComponent;

export const recipesApi = {
  get: (bookId, recipeId) => http.get(`/books/${encode(bookId)}/recipes/${encode(recipeId)}`),
  create: (bookId, title) => http.post(`/books/${encode(bookId)}/recipes`, { title }),
  update: (bookId, recipeId, patch) =>
    http.patch(`/books/${encode(bookId)}/recipes/${encode(recipeId)}`, patch),
  remove: (bookId, recipeId) => http.del(`/books/${encode(bookId)}/recipes/${encode(recipeId)}`),
  /** A new recipe from the text read on photos (see recipe-photo-reader.js). */
  importPages: (bookId, pages) => http.post(`/books/${encode(bookId)}/recipes/import`, { pages }),
  /** A new recipe read by the server from the web page at `url`. */
  importWeb: (bookId, url) => http.post(`/books/${encode(bookId)}/recipes/import-web`, { url }),
};
