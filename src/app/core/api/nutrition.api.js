import { http } from "./http.js";
import { language } from "../../shared/i18n/i18n.js";

export const nutritionApi = {
  /** Nutrition table for these lines, foods named in the interface language. */
  analyze: (ingredients, servings) => http.post("/nutrition", { ingredients, servings, language }),
  /** The whole reference table per 100 g (settings' database page). */
  foods: () => http.get(`/nutrition/foods?language=${language}`),
  /** Automatic tags of a recipe being edited: { bookId, title, ingredients,
   * servings, prepMinutes }. */
  tags: (recipe) => http.post("/nutrition/tags", recipe),
};
