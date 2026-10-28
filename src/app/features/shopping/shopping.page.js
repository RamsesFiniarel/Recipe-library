import { booksApi } from "../../core/api/books.api.js";
import { shoppingApi } from "../../core/api/shopping.api.js";
import { mountWindowLight } from "../../shared/components/window-light.js";
import { createSearchFilters, matchesFilters, matchRank } from "../../shared/components/search-filters.js";
import { bindEscapeBack } from "../../shared/utils/escape-back.js";
import { cloneTemplate, el, mountTemplate } from "../../shared/utils/dom.js";
import { mountIcons } from "../../shared/icons.js";
import { PHONE_LAYOUT } from "../../shared/utils/media.js";
import { language, locale, t } from "../../shared/i18n/i18n.js";
import { foldForSearch } from "@shared/text.js";
import { hexForPageColorToken } from "@shared/palette.js";
import { shoppingList } from "@shared/shopping.js";
import template from "./shopping.page.html?raw";
import "./shopping.page.css";

// The shelf and the bar moving between the page's middle and its top (keep
// in step with .shopping-basket's transition).
const LAYOUT_MOVE_MS = 600;
const LAYOUT_MOVE_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
// Where the page has two columns, the only place they're centred at rest.
const TWO_COLUMNS = "(min-width: 861px)";

/** Groceries page: at rest, the shelf and the search bar in the left
 * column's middle; searching, they go up and the results show below.
 * Picking a recipe puts it in the basket (on the server, one basket for every device; on a
 * computer, a 3D shelf it flies to, see basket-scene.js), whose lines merge
 * into the shopping list (shared/shopping.js). A pick shows at once; the
 * list follows the server's answer. */
export async function render(container, _params, navigate) {
  mountTemplate(container, template);
  mountWindowLight(container.querySelector("[data-window-light]"));

  const searchBox = container.querySelector("[data-search-box]");
  const searchInput = container.querySelector("[data-search-input]");
  const cardsEl = container.querySelector("[data-cards]");
  const cardsMessage = container.querySelector("[data-cards-message]");
  const basketEl = container.querySelector("[data-basket]");
  const basketEmpty = container.querySelector("[data-basket-empty]");
  const basketError = container.querySelector("[data-basket-error]");
  const listEl = container.querySelector("[data-list]");
  const mainEl = container.querySelector(".shopping-main");
  const tabButtons = [...container.querySelectorAll("[data-shopping-tab]")];
  const listCount = container.querySelector("[data-list-count]");
  const shareButton = container.querySelector("[data-share]");
  const pageEl = container.querySelector(".shopping-page");
  const basketSection = container.querySelector(".shopping-basket");
  const pickSection = container.querySelector(".shopping-pick");
  const searchSlot = container.querySelector(".shopping-search");
  const phoneQuery = window.matchMedia(PHONE_LAYOUT);
  // The shelf (computers only), once loaded.
  let basketScene = null;

  let disposed = false;
  // The search index's recipes (foodKeys: the foods each one needs).
  let recipes = [];
  let customTags = [];
  const recipeById = new Map();
  const pageColorByBook = new Map();
  // The basket: its recipes in the order picked, and their lines once the
  // server has sent them.
  let picked = [];
  const linesById = new Map();
  // Things taken off the list (keys), and the list as last shown.
  let hidden = new Set();
  let shownRows = [];

  const titleCollator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });

  // --- Recipes to pick ---

  const searchFilters = createSearchFilters({
    box: searchBox,
    input: searchInput,
    getRecipes: () => recipes,
    getCustomTags: () => customTags,
    onChange: renderCards,
  });
  searchFilters.bindHelp(container.querySelector("[data-search-kbd]"));

  // Best title matches first, then alphabetical.
  function results() {
    const needle = foldForSearch(searchFilters.text().trim());
    const filters = searchFilters.filters();
    return recipes
      .filter((recipe) => matchesFilters(recipe, filters))
      .map((recipe) => ({ recipe, rank: needle ? matchRank(recipe.folded, needle) : 0 }))
      .filter(({ rank }) => rank >= 0)
      .sort((a, b) => a.rank - b.rank || titleCollator.compare(a.recipe.title, b.recipe.title))
      .map(({ recipe }) => recipe);
  }

  // The share of a recipe's ingredients already on the list: red for none,
  // yellow for half, green for all.
  function haveColor(share) {
    return share <= 0.5
      ? `color-mix(in oklch, var(--have-none), var(--have-half) ${share * 200}%)`
      : `color-mix(in oklch, var(--have-half), var(--have-all) ${(share - 0.5) * 200}%)`;
  }

  // Built once per recipe, then only updated and reordered.
  const cardById = new Map();

  function pickCard(recipe) {
    if (cardById.has(recipe.id)) return cardById.get(recipe.id);
    const card = cloneTemplate(container, "pick-card");
    card.style.setProperty("--page-color", pageColorByBook.get(recipe.bookId));
    card.querySelector(".recipe-card-title").textContent = recipe.title;
    card.querySelector(".recipe-card-meta").textContent = recipe.servings ? t("people.short", { n: recipe.servings }) : "—";
    card.dataset.recipe = recipe.id;
    cardById.set(recipe.id, card);
    return card;
  }

  // A card's state: picked or not, and how much of it the list has.
  function updateCard(card, recipe, pickedIds, pickedKeys) {
    const isPicked = pickedIds.has(recipe.id);
    card.classList.toggle("is-picked", isPicked);
    card.setAttribute("aria-pressed", String(isPicked));
    card.setAttribute("aria-label", t(isPicked ? "shopping.remove" : "shopping.add", { title: recipe.title }));
    const total = recipe.foodKeys.length;
    const have = recipe.foodKeys.filter((key) => pickedKeys.has(key)).length;
    const haveEl = card.querySelector(".shopping-card-have");
    haveEl.textContent = total ? t("shopping.have", { have, total }) : "";
    haveEl.style.color = total ? haveColor(have / total) : "";
  }

  // Puts `nodes` in `parent`, in order, moving only what must (a moved
  // node replays its animations).
  function placeChildren(parent, nodes) {
    nodes.forEach((node, index) => {
      if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null);
    });
    while (parent.children.length > nodes.length) parent.lastElementChild.remove();
  }

  const isSearching = () => searchFilters.text().trim() !== "" || searchFilters.filters().length > 0;

  function renderCards() {
    searchBox.classList.toggle("has-value", searchInput.value.trim() !== "" || searchFilters.isActive());
    // Nothing until searched or filtered.
    const searching = isSearching();
    const shown = searching ? results() : [];
    const pickedIds = new Set(picked);
    const pickedKeys = new Set(picked.flatMap((id) => recipeById.get(id)?.foodKeys ?? []));
    for (const recipe of shown) updateCard(pickCard(recipe), recipe, pickedIds, pickedKeys);
    placeChildren(cardsEl, shown.map((recipe) => cardById.get(recipe.id)));
    const query = searchFilters.text().trim();
    cardsMessage.textContent = query ? t("library.results.none", { query }) : t("library.results.noneFiltered");
    cardsMessage.hidden = !searching || shown.length > 0;
    updateResting();
  }

  // --- At rest (nothing searched, the bar not in use): the shelf and the bar
  // in the column's middle; else at its top, the results below ---

  let searchFocused = false;

  function updateResting() {
    const resting = !searchFocused && !searchInput.value.trim() && !searchFilters.isActive();
    if (resting === pageEl.classList.contains("is-resting")) return;
    pageEl.classList.toggle("is-resting", resting);
    basketScene?.slide(restShift(), LAYOUT_MOVE_MS, LAYOUT_MOVE_EASING);
  }

  // The shelf's move down at rest (0 when searching or in one column).
  const twoColumns = window.matchMedia(TWO_COLUMNS);
  function restShift() {
    if (!pageEl.classList.contains("is-resting") || !twoColumns.matches) return 0;
    return parseFloat(pageEl.style.getPropertyValue("--rest-offset")) || 0;
  }

  // How far down the shelf and the bar sit to be centred (offsets ignore
  // the move itself).
  function placeResting() {
    // The bar opens the recipes' section: its top is the section's (read on
    // the section, whose own entrance animation doesn't shift it).
    const top = basketSection.offsetTop;
    const bottom = pickSection.offsetTop + pickSection.offsetHeight;
    const block = pickSection.offsetTop + searchSlot.offsetHeight - top;
    const offset = `${Math.max(0, Math.round((bottom - top - block) / 2))}px`;
    if (pageEl.style.getPropertyValue("--rest-offset") === offset) return;
    // Placed at once, not moved there (a move under way left alone).
    pageEl.classList.add("is-placing");
    pageEl.style.setProperty("--rest-offset", offset);
    void pageEl.offsetWidth;
    pageEl.classList.remove("is-placing");
    basketScene?.refit();
  }
  // The page's and the shelf's sizes.
  const restObserver = new ResizeObserver(placeResting);
  for (const element of [mainEl, basketSection]) restObserver.observe(element);

  searchInput.addEventListener("focus", () => {
    searchFocused = true;
    updateResting();
  });
  searchInput.addEventListener("blur", () => {
    searchFocused = false;
    updateResting();
  });

  // --- Basket and list ---

  function basketCard(recipe) {
    const card = cloneTemplate(container, "basket-card");
    card.style.setProperty("--page-color", pageColorByBook.get(recipe.bookId));
    card.querySelector(".recipe-card-title").textContent = recipe.title;
    card.querySelector(".recipe-card-meta").textContent = recipe.servings ? t("people.short", { n: recipe.servings }) : "—";
    card.setAttribute("aria-label", t("shopping.remove", { title: recipe.title }));
    card.dataset.recipe = recipe.id;
    return card;
  }

  // "200 g + 2 tbsp butter" as plain text.
  const rowText = ({ segments }) => segments.map(({ amount, label }) => [amount, label].filter(Boolean).join(" ")).join(" + ");

  // "200 g + 2 tbsp butter", amounts in bold, the recipes it's for, and a
  // cross taking it off the list.
  function listRow({ key, label, segments, recipes: usedBy }) {
    const row = el("li", "shopping-item");
    const what = el("span", "shopping-item-what");
    segments.forEach(({ amount, label: name }, index) => {
      if (index) what.append(" + ");
      if (amount) what.append(el("b", "shopping-item-amount", amount), " ");
      what.append(name);
    });
    const recipesEl = el("span", "shopping-item-recipes", usedBy.map((recipe) => recipe.title).join(", "));
    const remove = el("button", "shopping-item-remove");
    remove.type = "button";
    remove.dataset.key = key;
    remove.setAttribute("aria-label", t("shopping.removeItem", { item: label }));
    const icon = el("i");
    icon.dataset.icon = "close";
    remove.append(icon);
    row.append(what, recipesEl, remove);
    mountIcons(row);
    return row;
  }

  // Built once per recipe, and the row only touched where it changes: a
  // card that stays never replays its entrance (a list change, say).
  const basketCardById = new Map();
  function renderBasketCards(inBasket) {
    const wanted = new Set(inBasket.map((recipe) => recipe.id));
    for (const [id, card] of basketCardById) {
      if (wanted.has(id)) continue;
      card.remove();
      basketCardById.delete(id);
    }
    inBasket.forEach((recipe, index) => {
      if (!basketCardById.has(recipe.id)) basketCardById.set(recipe.id, basketCard(recipe));
      const card = basketCardById.get(recipe.id);
      if (basketEl.children[index] !== card) basketEl.insertBefore(card, basketEl.children[index] ?? null);
    });
  }

  function renderBasket() {
    const inBasket = picked.map((id) => recipeById.get(id)).filter(Boolean);
    renderBasketCards(inBasket);
    basketScene?.sync(
      inBasket.map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
        meta: recipe.servings ? t("people.short", { n: recipe.servings }) : "",
        color: pageColorByBook.get(recipe.bookId),
      }))
    );
    basketEmpty.hidden = inBasket.length > 0;
    listCount.textContent = inBasket.length ? String(inBasket.length) : "";
    const withLines = inBasket
      .filter((recipe) => linesById.has(recipe.id))
      .map((recipe) => ({ id: recipe.id, title: recipe.title, lines: linesById.get(recipe.id) }));
    shownRows = shoppingList(withLines, language).filter((row) => !hidden.has(row.key));
    listEl.replaceChildren(...shownRows.map(listRow));
    shareButton.hidden = !canShare || shownRows.length === 0;
  }

  function refresh() {
    renderCards();
    renderBasket();
  }

  // The server's basket: lines always kept; the order only once no change
  // is on its way (answers come in turn, the last one is up to date).
  let changesInFlight = 0;
  function receive(basket) {
    for (const recipe of basket.recipes) linesById.set(recipe.id, recipe.lines);
    if (changesInFlight > 0) return;
    picked = basket.recipes.map((recipe) => recipe.id);
    hidden = new Set(basket.hidden ?? []);
    refresh();
  }

  // A change shown at once (`apply`), then sent (`send`): one at a time,
  // the queue never left rejected.
  let queue = Promise.resolve();
  function change(apply, send) {
    apply();
    basketError.hidden = true;
    refresh();
    changesInFlight += 1;
    queue = queue.then(async () => {
      let basket = null;
      try {
        basket = await send();
      } catch (err) {
        console.error(err);
        if (!disposed) basketError.hidden = false;
      }
      changesInFlight -= 1;
      if (disposed) return;
      try {
        // After a failure, back to what the server holds.
        receive(basket ?? (changesInFlight === 0 ? await shoppingApi.get() : { recipes: [] }));
      } catch (err) {
        console.error(err);
      }
    });
  }

  // As the server does: an added recipe's needs come back on the list, an
  // empty basket starts it afresh.
  function toggle(recipeId) {
    const removing = picked.includes(recipeId);
    change(
      () => {
        picked = removing ? picked.filter((id) => id !== recipeId) : [...picked, recipeId];
        if (!removing) for (const key of recipeById.get(recipeId)?.foodKeys ?? []) hidden.delete(key);
        if (!picked.length) hidden.clear();
      },
      () => (removing ? shoppingApi.remove(recipeId) : shoppingApi.add(recipeId))
    );
  }

  listEl.addEventListener("click", (event) => {
    const key = event.target.closest("[data-key]")?.dataset.key;
    if (key) change(() => hidden.add(key), () => shoppingApi.hide(key));
  });

  // A phone's share sheet (messages, WhatsApp...), with the list as dashes.
  const canShare = typeof navigator.share === "function";
  shareButton.addEventListener("click", async () => {
    try {
      await navigator.share({ title: t("shopping.list"), text: shownRows.map((row) => `- ${rowText(row)}`).join("\n") });
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  });

  // A recipe picked from its card: on a computer, its sheet flies from it.
  function onCardClick(event) {
    const card = event.target.closest("[data-recipe]");
    if (!card) return;
    if (!picked.includes(card.dataset.recipe)) basketScene?.flyFrom(card.dataset.recipe, card.getBoundingClientRect());
    toggle(card.dataset.recipe);
  }
  cardsEl.addEventListener("click", onCardClick);
  basketEl.addEventListener("click", (event) => {
    const card = event.target.closest("[data-recipe]");
    if (card) toggle(card.dataset.recipe);
  });

  // --- Phone tabs (the halves side by side otherwise) ---

  function showTab(name) {
    mainEl.dataset.tab = name;
    for (const button of tabButtons) button.setAttribute("aria-selected", String(button.dataset.shoppingTab === name));
  }
  for (const button of tabButtons) button.addEventListener("click", () => showTab(button.dataset.shoppingTab));

  // --- Keys ---

  searchInput.addEventListener("input", renderCards);
  searchInput.addEventListener("keydown", (event) => {
    // Already used by the filters (their menu, a chip); an empty bar lets
    // Escape go back to the library.
    if (event.defaultPrevented || event.key !== "Escape") return;
    if (!searchInput.value.trim() && !searchFilters.isActive()) return;
    event.preventDefault();
    searchInput.value = "";
    searchFilters.clear();
    renderCards();
  });

  // "/" puts the cursor in the bar, unless typing somewhere.
  function onPageKeydown(event) {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest?.("input, textarea, [contenteditable]")) return;
    event.preventDefault();
    searchInput.focus();
  }
  window.addEventListener("keydown", onPageKeydown);
  // Crossing the phone width: the page again, in the other layout.
  const onPhoneChange = () => navigate("/courses");
  phoneQuery.addEventListener("change", onPhoneChange);
  const unbindEscape = bindEscapeBack(() => navigate("/", { transition: "crossfade" }));

  // Back on the page: the basket may have changed on another device.
  function onVisibilityChange() {
    if (document.visibilityState !== "visible" || changesInFlight > 0) return;
    shoppingApi.get().then((basket) => !disposed && receive(basket), console.error);
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // --- Loading ---

  try {
    const [books, index, basket] = await Promise.all([booksApi.list(), booksApi.searchIndex(), shoppingApi.get()]);
    if (!disposed) {
      for (const book of books) pageColorByBook.set(book.id, hexForPageColorToken(book.pageColorToken));
      recipes = index.recipes.map((recipe) => ({
        ...recipe,
        folded: foldForSearch(recipe.title),
        foodKeys: recipe.foods.map((food) => food.key),
      }));
      for (const recipe of recipes) recipeById.set(recipe.id, recipe);
      customTags = index.customTags ?? [];
      receive(basket);
      placeResting();
      // On a phone, straight to the list when there's one.
      showTab(picked.length ? "list" : "recipes");
    }
  } catch (err) {
    console.error(err);
    if (!disposed) {
      cardsMessage.textContent = t("shopping.loadFailed");
      cardsMessage.hidden = false;
    }
  }

  // On a computer, the basket's shelf (Three.js, loaded for it, the page
  // already up); the cards stay if it can't be drawn.
  async function loadShelf() {
    pageEl.classList.add("has-shelf");
    try {
      const { createBasketScene } = await import("./basket-scene.js");
      if (disposed) return;
      const scene = await createBasketScene({
        container: pageEl,
        area: basketSection,
        onRemove: (recipeId) => toggle(recipeId),
        removeLabel: (recipeId) => t("shopping.remove", { title: recipeById.get(recipeId)?.title ?? "" }),
      });
      if (disposed) {
        scene.dispose();
        return;
      }
      basketScene = scene;
      renderBasket();
    } catch (err) {
      console.error(err);
      pageEl.classList.remove("has-shelf");
    }
  }
  if (!phoneQuery.matches && !disposed) loadShelf();

  return () => {
    disposed = true;
    basketScene?.dispose();
    restObserver.disconnect();
    window.removeEventListener("keydown", onPageKeydown);
    phoneQuery.removeEventListener("change", onPhoneChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    unbindEscape();
  };
}
