import { recipesApi } from "../../core/api/recipes.api.js";
import { booksApi } from "../../core/api/books.api.js";
import { nutritionApi } from "../../core/api/nutrition.api.js";
import { tagsApi } from "../../core/api/tags.api.js";
import { ApiError } from "../../core/api/http.js";
import { confirmDialog } from "../../shared/components/confirm-dialog.js";
import { createSaveIndicator } from "../../shared/components/save-indicator.js";
import { renderLoading, renderNotFound } from "../../shared/components/page-message.js";
import { paintCoverBackdrop, coverBackdropReady } from "../../shared/components/cover-backdrop.js";
import { autosizeTextarea } from "../../shared/utils/autosize-textarea.js";
import { debounce } from "../../shared/utils/debounce.js";
import { DURATION_CHARS, formatDuration, parseDuration } from "../../shared/utils/duration.js";
import { bindEscapeBack } from "../../shared/utils/escape-back.js";
import { bindHatMenu } from "../../shared/utils/hat-menu.js";
import { mountTemplate } from "../../shared/utils/dom.js";
import { PHONE_LAYOUT } from "../../shared/utils/media.js";
import { keepSingleLine } from "../../shared/utils/single-line.js";
import { t } from "../../shared/i18n/i18n.js";
import { hexForPageColorToken } from "@shared/palette.js";
import { createIngredientList } from "./ingredient-list.js";
import { createNutritionTable } from "./nutrition-table.js";
import { createRecipeTags } from "./recipe-tags.js";
import template from "./recipe.page.html?raw";
import "./recipe.page.css";

const SAVE_DELAY_MS = 700;
// The nutrition table follows the ingredients as they're typed, a little behind.
const NUTRITION_DELAY_MS = 400;
// ...and so do the automatic tags.
const TAGS_DELAY_MS = 600;

export async function render(container, params, navigate) {
  const { bookId, recipeId } = params;
  const bookHref = `/${encodeURIComponent(bookId)}`;

  renderLoading(container);

  // The book gives the page its paper colour and its cover frame.
  let recipe;
  let book;
  let customTags;
  try {
    [recipe, book, customTags] = await Promise.all([
      recipesApi.get(bookId, recipeId),
      booksApi.get(bookId),
      // The tags added in the settings: without them, only the automatic ones.
      tagsApi.list().catch(() => []),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      renderNotFound(container, { title: t("recipe.notFound"), linkHref: bookHref, linkLabel: t("common.backToBook") });
      return;
    }
    throw err;
  }

  mountTemplate(container, template);

  const pageEl = container.querySelector(".recipe-page");
  const titleInput = container.querySelector('[data-field="title"]');
  keepSingleLine(titleInput);
  const titleField = container.querySelector("[data-title-field]");
  const servingsInput = container.querySelector('[data-field="servings"]');
  const servingsItem = container.querySelector(".recipe-meta-item--servings");
  const servingsSteps = [...container.querySelectorAll("[data-servings-step]")];
  const prepInput = container.querySelector('[data-field="prepTime"]');
  const ingredientsField = container.querySelector("[data-ingredients-field]");
  const instructionsInput = container.querySelector('[data-field="instructions"]');
  const nutritionEl = container.querySelector("[data-nutrition]");
  const indicator = createSaveIndicator(container.querySelector("[data-save-indicator]"));

  for (const link of container.querySelectorAll("[data-book-link]")) {
    link.setAttribute("href", bookHref);
  }
  paintCoverBackdrop(container.querySelector("[data-book-bg]"), book);
  pageEl.style.setProperty("--page-color", hexForPageColorToken(book.pageColorToken));

  // The field's hidden copy of the text sizes it (see .title-field).
  function syncTitleWidth() {
    titleField.dataset.value = titleInput.value;
  }
  titleInput.value = recipe.title;
  syncTitleWidth();
  servingsInput.value = recipe.servings ?? "";
  prepInput.value = formatDuration(recipe.prepMinutes);
  instructionsInput.value = recipe.instructions;

  autosizeTextarea(instructionsInput);

  // Edits pile up in a single patch, sent once typing pauses (or on blur).
  let pendingPatch = {};

  async function flush() {
    if (Object.keys(pendingPatch).length === 0) return;
    const patch = pendingPatch;
    pendingPatch = {};
    indicator.saving();
    try {
      await recipesApi.update(bookId, recipeId, patch);
      if (patch.title) recipe.title = patch.title;
      indicator.saved();
    } catch (err) {
      console.error(err);
      indicator.error();
    }
  }

  const scheduleSave = debounce(flush, SAVE_DELAY_MS);

  function queueChange(field, value) {
    pendingPatch[field] = value;
    scheduleSave();
  }

  // An emptied title would be rejected by the API: keep the last valid one.
  titleInput.addEventListener("input", () => {
    syncTitleWidth();
    queueChange("title", titleInput.value.trim() || recipe.title);
    scheduleTags();
  });
  instructionsInput.addEventListener("input", () => queueChange("instructions", instructionsInput.value));
  // Saved servings; the field may show another number for a while
  // (showServings).
  let savedServings = recipe.servings ?? null;
  servingsInput.addEventListener("input", () => {
    savedServings = servingsInput.value === "" ? null : Number(servingsInput.value);
    queueChange("servings", savedServings);
    syncServingsSteps();
    scheduleNutrition();
    scheduleTags();
  });

  // Preparation time, typed freely ("1h30", "2j 3h"), written back as
  // "1h 30min" on blur.
  prepInput.addEventListener("beforeinput", (event) => {
    if (event.data && !DURATION_CHARS.test(event.data)) event.preventDefault();
  });
  prepInput.addEventListener("input", () => {
    queueChange("prepMinutes", parseDuration(prepInput.value));
    scheduleTags();
  });
  prepInput.addEventListener("blur", () => {
    prepInput.value = formatDuration(parseDuration(prepInput.value));
  });

  const ingredients = createIngredientList(container.querySelector("[data-ingredients]"), {
    lines: recipe.ingredients,
    onChange(lines) {
      queueChange("ingredients", lines);
      scheduleNutrition();
      scheduleTags();
    },
  });
  container.querySelector('[data-action="add-ingredient"]').addEventListener("click", () => ingredients.addLine());

  // ---------------------------------------------------------------------
  // Servings arrows: a temporary number, quantities in ochre (.is-scaled),
  // nothing saved. Editing the field or an ingredient, or reloading,
  // restores the recipe's own.
  // ---------------------------------------------------------------------
  let shownServings = null;

  function syncServingsSteps() {
    const n = shownServings ?? savedServings;
    servingsSteps[0].disabled = !savedServings || n >= 999;
    servingsSteps[1].disabled = !savedServings || n <= 1;
  }

  function showServings(n) {
    shownServings = n === savedServings ? null : n;
    servingsInput.value = shownServings ?? savedServings ?? "";
    servingsItem.classList.toggle("is-scaled", shownServings !== null);
    servingsItem.title = shownServings !== null ? t("recipe.servingsScaled", { n: savedServings }) : t("recipe.servings");
    ingredients.setScale(shownServings !== null ? shownServings / savedServings : null);
    syncServingsSteps();
  }

  for (const step of servingsSteps) {
    step.addEventListener("click", () => {
      const n = (shownServings ?? savedServings) + Number(step.dataset.servingsStep);
      showServings(Math.min(999, Math.max(1, n)));
    });
  }
  const unscale = () => {
    if (shownServings !== null) showServings(savedServings);
  };
  servingsInput.addEventListener("focus", unscale);
  ingredientsField.addEventListener("focusin", unscale);
  syncServingsSteps();
  // The box is taller than its lines: a click below them continues the list.
  ingredientsField.addEventListener("mousedown", (event) => {
    if (event.target.closest(".ingredient-line, .ingredient-add")) return;
    event.preventDefault();
    ingredients.focusEnd();
  });

  const saveNow = () => {
    scheduleSave.cancel();
    flush();
  };
  for (const field of [titleInput, servingsInput, prepInput, instructionsInput]) {
    field.addEventListener("blur", saveNow);
  }
  ingredientsField.addEventListener("focusout", (event) => {
    if (!ingredientsField.contains(event.relatedTarget)) saveNow();
  });

  // ---------------------------------------------------------------------
  // Tags: automatic ones follow what's on screen; corrections save at once.
  // ---------------------------------------------------------------------
  const tags = createRecipeTags(container.querySelector("[data-recipe-tags]"), {
    autoTags: recipe.autoTags,
    overrides: recipe.tagOverrides,
    customTags,
    onChange(overrides) {
      queueChange("tagOverrides", overrides);
      saveNow();
    },
    recompute() {
      scheduleTags.cancel();
      return fetchAutoTags();
    },
  });
  let tagsRequest = 0;

  // A late answer to an older request comes back null, never overwriting.
  async function fetchAutoTags() {
    const request = (tagsRequest += 1);
    const { autoTags } = await nutritionApi.tags({
      bookId,
      title: titleInput.value.trim() || recipe.title,
      ingredients: ingredients.getLines(),
      servings: savedServings,
      prepMinutes: parseDuration(prepInput.value),
    });
    return request === tagsRequest ? autoTags : null;
  }

  async function refreshTags() {
    try {
      const autoTags = await fetchAutoTags();
      if (autoTags) tags.setAutoTags(autoTags);
    } catch (err) {
      console.error(err);
    }
  }
  const scheduleTags = debounce(refreshTags, TAGS_DELAY_MS);

  // ---------------------------------------------------------------------
  // Method / Nutrition tabs for the right column.
  // ---------------------------------------------------------------------
  const tabs = [...container.querySelectorAll("[data-tab]")];
  const nutritionPanel = container.querySelector('[data-panel="nutrition"]');
  const bodyEl = container.querySelector(".recipe-body");
  // Room below the table (sheet margin, cover frame), so the box ends with
  // the sheet's text.
  const nutritionTable = createNutritionTable(nutritionEl, {
    reserveBelow: () =>
      parseFloat(getComputedStyle(nutritionPanel).paddingBottom) +
      parseFloat(getComputedStyle(bodyEl).paddingBottom) +
      parseFloat(getComputedStyle(pageEl).paddingBottom),
  });
  const onResize = () => nutritionTable.fit();
  window.addEventListener("resize", onResize);
  const panels = [...container.querySelectorAll("[data-panel]")];
  let nutritionShown = false;
  let nutritionRequest = 0;

  // From the lines on screen; late answers to older requests are ignored.
  async function refreshNutrition() {
    if (!nutritionShown) return;
    const request = (nutritionRequest += 1);
    nutritionEl.setAttribute("aria-busy", "true");
    try {
      const analysis = await nutritionApi.analyze(ingredients.getLines(), savedServings);
      if (request !== nutritionRequest) return;
      if (analysis.rows.length === 0) nutritionTable.message(t("recipe.noIngredients"));
      else nutritionTable.render(analysis);
    } catch (err) {
      if (request !== nutritionRequest) return;
      console.error(err);
      nutritionTable.message(
        t(err instanceof ApiError && err.status === 503 ? "recipe.nutritionMissing" : "recipe.nutritionFailed")
      );
    } finally {
      if (request === nutritionRequest) nutritionEl.removeAttribute("aria-busy");
    }
  }
  const scheduleNutrition = debounce(refreshNutrition, NUTRITION_DELAY_MS);

  // On a phone the ingredients are a tab too: shown by .recipe-body's
  // data-tab, the other panels hidden.
  function selectTab(name) {
    for (const tab of tabs) {
      const selected = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
    bodyEl.dataset.tab = name;
    nutritionShown = name === "nutrition";
    if (nutritionShown) {
      scheduleNutrition.cancel();
      refreshNutrition();
    }
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    // Arrow keys move between the tabs shown (WAI-ARIA tabs pattern).
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const shown = tabs.filter((other) => other.offsetParent !== null);
      const next = shown[(shown.indexOf(tab) + (event.key === "ArrowRight" ? 1 : shown.length - 1)) % shown.length];
      next.focus();
      selectTab(next.dataset.tab);
    });
  }

  // A phone opens on the ingredients; leaving the phone layout on them, the
  // method takes over (the ingredients are always shown there).
  const phoneQuery = window.matchMedia(PHONE_LAYOUT);
  selectTab(phoneQuery.matches ? "ingredients" : "steps");
  function onPhoneChange() {
    if (!phoneQuery.matches && bodyEl.dataset.tab === "ingredients") selectTab("steps");
  }
  phoneQuery.addEventListener("change", onPhoneChange);

  // The hat's menu (see hat-menu.js): its link goes back to the book.
  const unbindHatMenu = bindHatMenu(
    container.querySelector("[data-recipe-menu]"),
    container.querySelector("[data-recipe-menu-toggle]")
  );

  // Escape goes back to the book, as the back button does.
  const unbindEscape = bindEscapeBack(() => navigate(bookHref, { transition: "crossfade" }));

  container.querySelector('[data-action="delete-recipe"]').addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: t("recipe.deleteConfirm.title"),
      message: t("recipe.deleteConfirm.message", { title: recipe.title }),
      confirmLabel: t("common.delete"),
      // The book page's dialogs'.
      glass: "dark",
    });
    if (!confirmed) return;
    await recipesApi.remove(bookId, recipeId);
    navigate(bookHref, { transition: "crossfade" });
  });

  // The recipe as on screen, for the people shown, as a PDF (jsPDF loads on
  // the first download).
  const pdfButton = container.querySelector('[data-action="download-pdf"]');
  pdfButton.addEventListener("click", async () => {
    pdfButton.disabled = true;
    try {
      const { downloadRecipePdf } = await import("./recipe-pdf.js");
      downloadRecipePdf({
        title: titleInput.value.trim() || recipe.title,
        bookTitle: book.title,
        pageColor: hexForPageColorToken(book.pageColorToken),
        tags: tags.labels(),
        servings: shownServings ?? savedServings,
        prepMinutes: parseDuration(prepInput.value),
        ingredients: ingredients.getShownLines(),
        instructions: instructionsInput.value,
      });
    } catch (err) {
      console.error(err);
    } finally {
      pdfButton.disabled = false;
    }
  });

  // The page shows as soon as render() resolves: the backdrop must be
  // painted by then.
  await coverBackdropReady(book);

  return () => {
    scheduleSave.cancel();
    scheduleNutrition.cancel();
    scheduleTags.cancel();
    tags.dispose();
    window.removeEventListener("resize", onResize);
    phoneQuery.removeEventListener("change", onPhoneChange);
    unbindHatMenu();
    unbindEscape();
    flush();
    indicator.dispose();
  };
}
