import { mountIcons } from "../icons.js";
import { DURATION_CHARS, formatDuration, parseDuration } from "../utils/duration.js";
import { el } from "../utils/dom.js";
import { foldForSearch } from "@shared/text.js";
import { ingredientWords, indexOfRun } from "@shared/ingredients.js";
import { RECIPE_TAGS } from "@shared/recipe-tags.js";
import { locale, t } from "../i18n/i18n.js";
import "./search-filters.css";

/** Search filters (library and groceries pages), typed as commands: "/i"
 * ingredient, "/t" tag, "/c" longest time, "/p" people, "/b" book. A
 * command becomes a chip awaiting its value, typed in the bar with
 * suggestions below; Enter, Tab or a click settles it. Ingredients and tags
 * add up; time, people and book replace. "/" alone, or hovering the bar's
 * "/" hint, lists the commands. */

const searchFilter = (key, type, icon) => ({
  key,
  type,
  icon,
  label: t(`search.${type}.label`),
  hint: t(`search.${type}.hint`),
  placeholder: t(`search.${type}.placeholder`),
});

const SEARCH_FILTERS = [
  searchFilter("i", "ingredient", "carrot"),
  searchFilter("t", "tag", "tag"),
  searchFilter("c", "time", "clock"),
  searchFilter("p", "people", "users"),
  searchFilter("b", "book", "book"),
];

// One of each: a new one replaces the chip.
const SINGLE_TYPES = new Set(["time", "people", "book"]);

const FILTER_BY_TYPE = new Map(SEARCH_FILTERS.map((filter) => [filter.type, filter]));

const TIME_IDEAS = [15, 30, 45, 60, 90, 120];
const PEOPLE_IDEAS = [1, 2, 4, 6, 8];
const INGREDIENT_IDEAS = 8;
// Everywhere, so no use as ideas (still found when typed).
const PANTRY = new Set(["sel", "poivre", "eau", "salt", "pepper", "water"]);

// --- Matching -------------------------------------------------------------------

// The words of each recipe's ingredient lines, worked out once.
const lineWordsCache = new WeakMap();
function lineWords(recipe) {
  if (!lineWordsCache.has(recipe)) lineWordsCache.set(recipe, (recipe.ingredients ?? []).map(ingredientWords));
  return lineWordsCache.get(recipe);
}

function hasIngredient(recipe, words) {
  return words.length === 0 || lineWords(recipe).some((line) => indexOfRun(line, words) >= 0);
}

// One of the foods the recipe's lines are about (see search.service.js).
function hasFood(recipe, key) {
  return recipe.foods?.some((food) => food.key === key) ?? false;
}

// An ingredient picked among the suggestions is a food (`key`): "clove"
// isn't "garlic clove". Typed freely, its words are looked for in the lines.
function matchesFilter(recipe, { type, value, words, key }) {
  if (type === "ingredient") return key ? hasFood(recipe, key) : hasIngredient(recipe, words);
  if (type === "tag") return recipe.tags?.includes(value) ?? false;
  if (type === "time") return recipe.prepMinutes != null && recipe.prepMinutes <= value;
  if (type === "book") return recipe.bookId === value;
  return recipe.servings != null && Math.abs(recipe.servings - value) <= 1;
}

/** Whether a recipe passes every filter. */
export function matchesFilters(recipe, filters) {
  return filters.every((filter) => matchesFilter(recipe, filter));
}

/** How well a folded title matches the text: whole title, its start, a
 * word's start, anywhere (-1: not at all). */
export function matchRank(folded, needle) {
  if (folded === needle) return 0;
  if (folded.startsWith(needle)) return 1;
  for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + 1)) {
    if (!/[\p{L}\p{N}]/u.test(folded[at - 1])) return 2;
  }
  return folded.includes(needle) ? 3 : -1;
}

// The tags added in the settings, by key, and the books' titles by id (see
// createSearchFilters()).
let customTagLabels = new Map();
const tagLabel = (key) => customTagLabels.get(key) ?? t(`tag.${key}`);
let bookTitles = new Map();

function chipText({ type, value }) {
  if (type === "ingredient") return value;
  if (type === "tag") return tagLabel(value);
  if (type === "book") return bookTitles.get(value) ?? "";
  if (type === "time") return `≤ ${formatDuration(value)}`;
  return t("people.range", { min: Math.max(1, value - 1), max: value + 1 });
}

function iconSlot(name) {
  const slot = el("i");
  slot.dataset.icon = name;
  return slot;
}

// --- Controller -----------------------------------------------------------------

/** `box`: the bar (holds chips and menu); `input`: its field;
 * `getRecipes()`: the search index's recipes; `getCustomTags()`: settings
 * tags; `onChange()`: filters or text changed. Set up before the page's
 * own listeners: keys used here are preventDefault-ed. */
export function createSearchFilters({ box, input, getRecipes, getCustomTags = () => [], onChange }) {
  const chipsEl = el("div", "library-search-chips");
  const menuEl = el("div", "library-search-menu");
  menuEl.id = "library-search-menu";
  menuEl.setAttribute("role", "listbox");
  menuEl.hidden = true;
  box.append(chipsEl, menuEl);
  input.setAttribute("aria-controls", menuEl.id);
  input.setAttribute("aria-expanded", "false");
  const defaultPlaceholder = input.placeholder;

  let chips = [];
  // The filter being given a value, and the free text set aside meanwhile.
  let pending = null;
  let stash = "";
  // Menu mode ("commands", "help" or "values"), its options and the
  // highlighted one.
  let menuMode = null;
  let options = [];
  let active = -1;
  const freeText = () => (pending ? stash : input.value);

  // Recipes suggestions are counted on: those the other filters and text keep.
  function baseRecipes() {
    const needle = foldForSearch(freeText().trim());
    return (getRecipes() ?? []).filter((recipe) => recipe.folded.includes(needle) && matchesFilters(recipe, chips));
  }

  // --- Chips ---

  // The tags added in the settings, as the search index has them, and the
  // books the recipes are in.
  function syncCustomTags() {
    customTagLabels = new Map((getCustomTags() ?? []).map((tag) => [tag.key, tag.label]));
    bookTitles = new Map((getRecipes() ?? []).map((recipe) => [recipe.bookId, recipe.bookTitle]));
  }

  function renderChips() {
    syncCustomTags();
    const nodes = chips.map((chip, index) => {
      const node = el("span", "library-search-chip");
      node.dataset.type = chip.type;
      node.append(iconSlot(FILTER_BY_TYPE.get(chip.type).icon), el("span", "library-search-chip-text", chipText(chip)));
      const remove = el("button", "library-search-chip-remove");
      remove.type = "button";
      remove.tabIndex = -1;
      remove.dataset.remove = String(index);
      remove.setAttribute("aria-label", t("search.chip.remove", { label: chipText(chip) }));
      remove.append(iconSlot("close"));
      node.append(remove);
      return node;
    });
    if (pending) {
      const node = el("span", "library-search-chip is-pending");
      node.dataset.type = pending.type;
      node.append(iconSlot(pending.icon), el("span", "library-search-chip-text", pending.label));
      nodes.push(node);
    }
    chipsEl.replaceChildren(...nodes);
    mountIcons(chipsEl);
    // The field's text starts after them.
    box.style.setProperty("--chips-width", nodes.length ? `${chipsEl.offsetWidth + 6}px` : "0px");
    chipsEl.scrollLeft = chipsEl.scrollWidth;
    markScrolled();
  }

  // Scrolled along: the first chips fade out at the left edge.
  function markScrolled() {
    chipsEl.classList.toggle("is-scrolled", chipsEl.scrollLeft > 0);
  }

  // `key`: the food of an ingredient picked among the suggestions.
  function addChip(type, value, key = null) {
    const chip = { type, value, key, words: type === "ingredient" ? ingredientWords(value) : null };
    if (SINGLE_TYPES.has(type)) chips = chips.filter((other) => other.type !== type);
    const sameIngredient = (other) => (key || other.key ? other.key === key : other.words.join(" ") === chip.words.join(" "));
    const duplicate = chips.some(
      (other) => other.type === type && (type === "ingredient" ? sameIngredient(other) : other.value === value)
    );
    if (!duplicate) chips.push(chip);
  }

  function removeChip(index) {
    chips.splice(index, 1);
    renderChips();
    if (menuMode === "values") renderValues();
    onChange();
  }

  // --- Typing a value ---

  function startPending(filter, before) {
    pending = filter;
    stash = before.trimEnd();
    input.value = "";
    input.placeholder = filter.placeholder;
    box.classList.add("is-pending");
    renderChips();
    renderValues();
    onChange();
  }

  function endPending() {
    const text = stash;
    pending = null;
    stash = "";
    input.value = text ? `${text} ` : "";
    input.setSelectionRange(input.value.length, input.value.length);
    input.placeholder = defaultPlaceholder;
    box.classList.remove("is-pending");
    closeMenu();
    renderChips();
    onChange();
  }

  function settle(value, key) {
    addChip(pending.type, value, key);
    endPending();
  }

  /** Enter (or Tab without suggestions) while typing a value: the highlighted
   * suggestion, else the first one, else the typed text if valid for the
   * filter. Returns whether something settled. */
  function settleFromInput() {
    const typed = input.value.trim();
    const option = options[active] ?? (typed ? options[0] : undefined);
    if (option?.value !== undefined) {
      settle(option.value, option.key);
      return true;
    }
    if (!typed || pending.type === "tag" || pending.type === "book") return false;
    if (pending.type === "ingredient") {
      settle(typed);
      return true;
    }
    const value = pending.type === "time" ? parseDuration(typed) : Number.parseInt(typed, 10);
    if (!value || value < 1) return false;
    settle(value);
    return true;
  }

  // --- Menu ---

  // -1: none highlighted.
  function setActive(index) {
    active = index >= 0 && index < options.length ? index : -1;
    options.forEach((option, i) => option.node.classList.toggle("is-active", i === active));
    const node = options[active]?.node;
    if (node) {
      input.setAttribute("aria-activedescendant", node.id);
      node.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function showMenu(mode, nodes, list, activeIndex) {
    menuMode = mode;
    options = list;
    options.forEach((option, i) => {
      option.node.id = `library-search-option-${i}`;
      option.node.setAttribute("role", "option");
      option.node.dataset.option = String(i);
      // Reached with the keys while the field keeps the focus (see Tab).
      option.node.tabIndex = -1;
    });
    menuEl.replaceChildren(...nodes);
    mountIcons(menuEl);
    menuEl.hidden = false;
    menuEl.classList.toggle("is-help", mode === "help");
    box.classList.add("is-menu-open");
    input.setAttribute("aria-expanded", "true");
    setActive(activeIndex);
  }

  function closeMenu() {
    if (menuEl.hidden) return;
    menuMode = null;
    options = [];
    active = -1;
    menuEl.hidden = true;
    menuEl.replaceChildren();
    box.classList.remove("is-menu-open");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function heading(text) {
    return el("p", "library-search-menu-label", text);
  }

  function showCommands(mode = "commands") {
    const list = SEARCH_FILTERS.map((filter) => {
      const node = el("button", "library-search-command");
      node.type = "button";
      node.dataset.type = filter.type;
      const icon = el("span", "library-search-command-icon");
      icon.append(iconSlot(filter.icon));
      const text = el("span", "library-search-command-text");
      text.append(el("span", "library-search-command-label", filter.label), el("span", "library-search-command-hint", filter.hint));
      node.append(icon, text, el("kbd", "library-search-command-key", `/${filter.key}`));
      return { node, filter };
    });
    showMenu(mode, [heading(t("search.menu.filter")), ...list.map((option) => option.node)], list, mode === "help" ? -1 : 0);
  }

  // A pill: the idea and how many recipes it leaves.
  function pill(text, value, count) {
    const node = el("button", "library-search-pill", text);
    node.type = "button";
    node.append(el("span", "library-search-pill-count", String(count)));
    return { node, value };
  }

  // Ingredient suggestions: one per food the recipes' lines are about, named
  // by its shortest label ("garlic" for "garlic clove" too) but found by any.
  let foodsSource = null;
  let foods = [];
  function allFoods() {
    const recipes = getRecipes() ?? [];
    if (foodsSource === recipes) return foods;
    const byKey = new Map();
    for (const recipe of recipes) {
      for (const { key, label } of recipe.foods ?? []) {
        const forms = byKey.get(key) ?? new Map();
        forms.set(label, (forms.get(label) ?? 0) + 1);
        byKey.set(key, forms);
      }
    }
    foods = [...byKey].map(([key, forms]) => ({
      key,
      labels: [...forms].sort((a, b) => a[0].length - b[0].length || b[1] - a[1]).map(([label]) => label),
    }));
    foodsSource = recipes;
    return foods;
  }

  // From the remaining recipes, most common first, prefix matches ahead; a
  // food shows under the label the text matches.
  function ingredientOptions(base, typed) {
    const needle = foldForSearch(typed);
    const chosen = new Set(chips.filter((chip) => chip.type === "ingredient").map((chip) => chip.key));
    const rankOf = (label) => {
      const folded = foldForSearch(label);
      if (!needle) return 0;
      return folded.startsWith(needle) ? 0 : folded.includes(` ${needle}`) ? 1 : -1;
    };
    const ideas = [];
    for (const { key, labels } of allFoods()) {
      if (chosen.has(key)) continue;
      // Salt, pepper, water: everywhere, so suggested only when typed.
      if (!needle && PANTRY.has(foldForSearch(labels[0]))) continue;
      const ranked = labels.map((label) => ({ label, rank: rankOf(label) })).filter(({ rank }) => rank >= 0);
      if (!ranked.length) continue;
      const { label, rank } = ranked.reduce((best, next) => (next.rank < best.rank ? next : best));
      const count = base.filter((recipe) => hasFood(recipe, key)).length;
      if (count) ideas.push({ key, label, rank, count });
    }
    ideas.sort((a, b) => a.rank - b.rank || b.count - a.count || a.label.localeCompare(b.label, locale));
    return ideas.slice(0, INGREDIENT_IDEAS).map(({ key, label, count }) => ({ ...pill(label, label, count), key }));
  }

  // Book suggestions: the titles the text starts or has a word starting
  // with, alphabetical, counted on the recipes the other filters keep.
  function bookOptions(typed) {
    syncCustomTags();
    const needle = foldForSearch(typed);
    const others = chips.filter((chip) => chip.type !== "book");
    const pool = (getRecipes() ?? []).filter(
      (recipe) => recipe.folded.includes(foldForSearch(freeText().trim())) && matchesFilters(recipe, others)
    );
    return [...bookTitles]
      .filter(([, title]) => {
        const folded = foldForSearch(title);
        return !needle || folded.startsWith(needle) || folded.includes(` ${needle}`);
      })
      .map(([id, title]) => ({ id, title, count: pool.filter((recipe) => recipe.bookId === id).length }))
      .filter(({ count }) => count > 0)
      .sort((a, b) => a.title.localeCompare(b.title, locale))
      .map(({ id, title, count }) => pill(title, id, count));
  }

  function renderValues() {
    const base = baseRecipes();
    const typed = input.value.trim();
    let list;
    let title;
    const body = el("div", "library-search-pills");
    if (pending.type === "ingredient") {
      title = t(typed ? "search.menu.ingredients" : "search.menu.frequent");
      list = ingredientOptions(base, typed);
    } else if (pending.type === "book") {
      title = t("search.menu.books");
      list = bookOptions(typed);
    } else if (pending.type === "tag") {
      title = t("search.menu.tags");
      const needle = foldForSearch(typed);
      const chosen = chips.filter((chip) => chip.type === "tag").map((chip) => chip.value);
      syncCustomTags();
      list = [...RECIPE_TAGS.map((tag) => tag.key), ...customTagLabels.keys()]
        .filter((key) => !chosen.includes(key) && foldForSearch(tagLabel(key)).startsWith(needle))
        .map((key) => ({ key, count: base.filter((recipe) => recipe.tags?.includes(key)).length }))
        .filter(({ count }) => count > 0)
        .map(({ key, count }) => pill(tagLabel(key), key, count));
    } else {
      const time = pending.type === "time";
      title = t(time ? "search.menu.time" : "search.menu.people");
      const typedValue = typed ? (time ? parseDuration(typed) : Number.parseInt(typed, 10)) : null;
      const ideas = time ? TIME_IDEAS : PEOPLE_IDEAS;
      // What's typed comes first, so Enter takes it.
      const values = typedValue > 0 ? [typedValue, ...ideas.filter((value) => value !== typedValue)] : ideas;
      const others = chips.filter((chip) => chip.type !== pending.type);
      const pool = (getRecipes() ?? []).filter(
        (recipe) => recipe.folded.includes(foldForSearch(freeText().trim())) && matchesFilters(recipe, others)
      );
      list = values
        .map((value) => ({ value, count: pool.filter((recipe) => matchesFilter(recipe, { type: pending.type, value })).length }))
        .filter(({ value, count }) => count > 0 || value === typedValue)
        .map(({ value, count }) => pill(time ? `≤ ${formatDuration(value)}` : t("people.short", { n: value }), value, count));
    }
    const nodes = [heading(title)];
    if (list.length) {
      body.append(...list.map((option) => option.node));
      nodes.push(body);
    } else {
      const empty =
        pending.type === "ingredient" && typed ? t("search.menu.enterToSearch", { typed }) : t("search.menu.noIdea");
      nodes.push(el("p", "library-search-menu-empty", empty));
    }
    // Nothing highlighted until Tab or arrows (Enter takes the first anyway).
    showMenu("values", nodes, list, -1);
  }

  function choose(option) {
    if (option.filter) {
      input.focus();
      const before = input.value.replace(/(^|\s)\/[a-z]?$/i, "$1");
      startPending(option.filter, before);
    } else if (option.value !== undefined && pending) {
      settle(option.value, option.key);
    }
  }

  // --- Events ---

  input.addEventListener("beforeinput", (event) => {
    if (!pending || !event.data) return;
    const allowed = pending.type === "time" ? DURATION_CHARS : pending.type === "people" ? /^\d*$/ : null;
    if (allowed && !allowed.test(event.data)) event.preventDefault();
  });

  input.addEventListener("input", () => {
    if (pending) {
      renderValues();
      return;
    }
    // "/" at the end of the text opens the commands; a command letter right
    // after starts that filter.
    const command = input.value.match(/(^|\s)\/([a-z]?)$/i);
    if (!command) {
      closeMenu();
      return;
    }
    const filter = SEARCH_FILTERS.find((candidate) => candidate.key === command[2].toLowerCase());
    const before = input.value.slice(0, command.index + command[1].length);
    if (filter) startPending(filter, before);
    else if (command[2]) closeMenu();
    else showCommands();
  });

  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    const menuOpen = !menuEl.hidden;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (!menuOpen || !options.length) return;
        event.preventDefault();
        {
          const step = event.key === "ArrowDown" ? 1 : -1;
          const count = options.length;
          setActive(active < 0 ? (step > 0 ? 0 : count - 1) : (active + step + count) % count);
        }
        return;
      case "Tab":
        // Through the options (Shift: backwards), focus staying in the field;
        // without options, settles what's typed.
        if (menuOpen && options.length) {
          event.preventDefault();
          const step = event.shiftKey ? -1 : 1;
          const count = options.length;
          setActive(active < 0 ? (step > 0 ? 0 : count - 1) : (active + step + count) % count);
        } else if (pending && settleFromInput()) {
          event.preventDefault();
        }
        return;
      case "Enter":
        if (pending) {
          event.preventDefault();
          settleFromInput();
        } else if (menuOpen && options[active]) {
          event.preventDefault();
          choose(options[active]);
        }
        return;
      case "Escape":
        if (pending) {
          event.preventDefault();
          endPending();
        } else if (menuOpen) {
          event.preventDefault();
          closeMenu();
        }
        return;
      case "Backspace":
        if (!atStart) return;
        if (pending) {
          event.preventDefault();
          endPending();
        } else if (chips.length) {
          event.preventDefault();
          removeChip(chips.length - 1);
        }
        return;
      default:
    }
  });

  // Clicks keep the focus in the field (losing it would close the search).
  for (const node of [menuEl, chipsEl]) node.addEventListener("mousedown", (event) => event.preventDefault());
  menuEl.addEventListener("click", (event) => {
    const node = event.target.closest("[data-option]");
    if (node) choose(options[Number(node.dataset.option)]);
  });
  menuEl.addEventListener("pointermove", (event) => {
    const node = event.target.closest("[data-option]");
    if (node && Number(node.dataset.option) !== active) setActive(Number(node.dataset.option));
  });
  chipsEl.addEventListener("scroll", markScrolled);
  chipsEl.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    if (remove) removeChip(Number(remove.dataset.remove));
  });

  // The hero bar's "/" hint lists the commands while hovered; a click starts
  // a command.
  let helpTimer = null;
  function bindHelp(hint) {
    const leave = () => {
      clearTimeout(helpTimer);
      helpTimer = setTimeout(() => {
        if (menuMode === "help") closeMenu();
      }, 180);
    };
    hint.addEventListener("pointerenter", () => {
      clearTimeout(helpTimer);
      if (!menuMode) showCommands("help");
    });
    hint.addEventListener("pointerleave", leave);
    menuEl.addEventListener("pointerenter", () => clearTimeout(helpTimer));
    menuEl.addEventListener("pointerleave", () => {
      if (menuMode === "help") leave();
    });
    hint.addEventListener("mousedown", (event) => event.preventDefault());
    hint.addEventListener("click", () => {
      closeMenu();
      input.focus();
      input.value = /\S$/.test(input.value) ? `${input.value} /` : `${input.value}/`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  return {
    /** The settled filters. */
    filters: () => chips,
    /** The text searched in titles (set aside while a value is typed). */
    text: freeText,
    /** Whether any filter is set or being typed. */
    isActive: () => chips.length > 0 || pending !== null,
    bindHelp,
    /** Back to an empty bar. */
    clear() {
      chips = [];
      pending = null;
      stash = "";
      input.placeholder = defaultPlaceholder;
      box.classList.remove("is-pending");
      closeMenu();
      renderChips();
    },
  };
}
