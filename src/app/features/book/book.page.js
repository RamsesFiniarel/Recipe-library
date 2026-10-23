import { booksApi } from "../../core/api/books.api.js";
import { ApiError } from "../../core/api/http.js";
import { confirmDialog } from "../../shared/components/confirm-dialog.js";
import { createSaveIndicator } from "../../shared/components/save-indicator.js";
import { renderLoading, renderNotFound } from "../../shared/components/page-message.js";
import { debounce } from "../../shared/utils/debounce.js";
import { bindEscapeBack } from "../../shared/utils/escape-back.js";
import { bindHatMenu } from "../../shared/utils/hat-menu.js";
import { cloneTemplate, mountTemplate } from "../../shared/utils/dom.js";
import { t, tn } from "../../shared/i18n/i18n.js";
import { hexForPageColorToken } from "@shared/palette.js";
import { paintCoverBackdrop, coverBackdropReady, hideTransitionBackdrop } from "../../shared/components/cover-backdrop.js";
import { foldForSearch } from "@shared/text.js";
import { newRecipeDialog } from "./new-recipe-dialog.js";
import template from "./book.page.html?raw";
import "./book.page.css";

const SAVE_DELAY_MS = 700;
const NO_SERVINGS = "—";

export async function render(container, params, navigate) {
  renderLoading(container);

  let book;
  try {
    book = await booksApi.get(params.bookId);
  } catch (err) {
    // An error page must not stay hidden under the library's bridging layer.
    hideTransitionBackdrop();
    if (err instanceof ApiError && err.status === 404) {
      renderNotFound(container, { title: t("book.notFound"), linkLabel: t("common.backToLibrary") });
      return;
    }
    throw err;
  }

  mountTemplate(container, template);

  const pageEl = container.querySelector(".book-page");
  const titleInput = container.querySelector('[data-field="title"]');
  const titleField = container.querySelector("[data-title-field]");
  const cardGrid = container.querySelector("[data-card-grid]");
  const addButton = container.querySelector('[data-action="add-recipe"]');
  const indicator = createSaveIndicator(container.querySelector("[data-save-indicator]"));


  // Backdrop: the cover, blurred and darkened (decoded before render()
  // resolves, see below).
  paintCoverBackdrop(container.querySelector("[data-book-bg]"), book);
  pageEl.style.setProperty("--page-color", hexForPageColorToken(book.pageColorToken));

  // The field's hidden copy of the text sizes it (see .title-field).
  function syncTitleWidth() {
    titleField.dataset.value = titleInput.value;
  }
  titleInput.value = book.title;
  syncTitleWidth();

  // Cards keep their rank in --stagger: the CSS spreads their entrance delays.
  const cards = [];
  book.recipes.forEach((recipe, index) => {
    const card = cloneTemplate(container, "recipe-card");
    card.style.setProperty("--stagger", index);
    card.setAttribute("href", `/${encodeURIComponent(book.id)}/${encodeURIComponent(recipe.id)}`);
    card.querySelector(".recipe-card-title").textContent = recipe.title;
    card.querySelector(".recipe-card-meta").textContent = recipe.servings
      ? t("people.short", { n: recipe.servings })
      : NO_SERVINGS;
    cardGrid.append(card);
    cards.push({ card, folded: foldForSearch(recipe.title) });
  });

  // Live filter: cards not matching (accents and case ignored) are hidden in
  // place.
  const searchInput = container.querySelector("[data-search-input]");
  const searchEmpty = container.querySelector("[data-search-empty]");
  function applySearch() {
    cardGrid.classList.add("is-filtering");
    const needle = foldForSearch(searchInput.value.trim());
    let shown = 0;
    for (const { card, folded } of cards) {
      card.hidden = needle !== "" && !folded.includes(needle);
      if (!card.hidden) shown += 1;
    }
    searchEmpty.hidden = shown > 0 || cards.length === 0;
  }
  searchInput.addEventListener("input", applySearch);
  // Escape clears a search first; on an empty one it goes back (see below).
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || searchInput.value === "") return;
    event.preventDefault();
    searchInput.value = "";
    applySearch();
  });
  // "/" from anywhere on the page goes to the search (as in the library).
  function onPageKeydown(event) {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    searchInput.focus();
  }
  window.addEventListener("keydown", onPageKeydown);
  // Escape goes back to the library, like the hat's link.
  const unbindEscape = bindEscapeBack(() => navigate("/"));
  const unbindHatMenu = bindHatMenu(
    container.querySelector("[data-book-menu]"),
    container.querySelector("[data-book-menu-toggle]")
  );

  async function saveTitle() {
    const value = titleInput.value.trim();
    if (!value) {
      titleInput.value = book.title;
      syncTitleWidth();
      return;
    }
    if (value === book.title) return;
    indicator.saving();
    try {
      await booksApi.update(book.id, { title: value });
      book.title = value;
      indicator.saved();
    } catch (err) {
      console.error(err);
      indicator.error();
    }
  }

  const scheduleSave = debounce(saveTitle, SAVE_DELAY_MS);
  titleInput.addEventListener("input", () => {
    syncTitleWidth();
    scheduleSave();
  });
  titleInput.addEventListener("blur", () => {
    scheduleSave.cancel();
    saveTitle();
  });

  // Whatever the way in, on to the new recipe's page.
  addButton.addEventListener("click", async () => {
    const recipe = await newRecipeDialog(book.id);
    if (recipe) navigate(`/${book.id}/${recipe.id}`, { transition: "crossfade" });
  });

  container.querySelector('[data-action="delete-book"]').addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: t("book.deleteConfirm.title"),
      message: t("book.deleteConfirm.message", { title: book.title, recipes: tn("count.recipe", book.recipes.length) }),
      confirmLabel: t("common.delete"),
      // The new recipe dialog's.
      glass: "dark",
    });
    if (!confirmed) return;
    await booksApi.remove(book.id);
    navigate("/", { transition: "veil" });
  });

  // Resolve only once the backdrop is decoded: the page shows as soon as
  // render() resolves, and the library's bridging copy lifts now, unseen.
  await coverBackdropReady(book);
  hideTransitionBackdrop();

  return () => {
    window.removeEventListener("keydown", onPageKeydown);
    unbindEscape();
    unbindHatMenu();
    scheduleSave.cancel();
    indicator.dispose();
  };
}
