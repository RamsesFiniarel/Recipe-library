import "./app/shared/styles/fonts.css";
import "./app/shared/styles/tokens.css";
import "./app/shared/styles/base.css";
import "./app/shared/styles/components.css";
import { registerRoute, startRouter } from "./app/core/router/router.js";
import { language, t } from "./app/shared/i18n/i18n.js";
import { resumeLanguageSwitch } from "./app/shared/components/language-switch.js";

document.documentElement.lang = language;
document.title = t("app.title");

// Pages load on demand: only the library pulls in Three.js.
registerRoute("/", () => import("./app/features/library/library.page.js"));
// Before "/:bookId", which would take it for a book.
registerRoute("/parametres", () => import("./app/features/settings/settings.page.js"));
registerRoute("/courses", () => import("./app/features/shopping/shopping.page.js"));
// Before "/:bookId/:recipeId", likewise.
registerRoute("/parametres/nutrition", () => import("./app/features/foods/foods.page.js"));
registerRoute("/:bookId", () => import("./app/features/book/book.page.js"));
registerRoute("/:bookId/:recipeId", () => import("./app/features/recipe/recipe.page.js"));

// Just switched language: the cover stays until the page is back.
resumeLanguageSwitch(startRouter(document.getElementById("app")));
