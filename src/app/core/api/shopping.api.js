import { http } from "./http.js";

/** The groceries basket (see server/routes/shopping.routes.js): each call
 * answers with the whole basket, { recipes: [{ id, title, servings, bookId,
 * lines }], hidden: [key] }. */
export const shoppingApi = {
  get: () => http.get("/shopping"),
  add: (recipeId) => http.post("/shopping/recipes", { recipeId }),
  remove: (recipeId) => http.del(`/shopping/recipes/${encodeURIComponent(recipeId)}`),
  /** Takes a thing (its key) off the list. */
  hide: (key) => http.post("/shopping/hidden", { key }),
};
