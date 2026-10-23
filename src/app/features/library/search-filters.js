import { mountIcons } from "../../shared/icons.js";
import { DURATION_CHARS, formatDuration, parseDuration } from "../../shared/utils/duration.js";
import { el } from "../../shared/utils/dom.js";
import { foldForSearch } from "@shared/text.js";
import { ingredientWords, indexOfRun } from "@shared/ingredients.js";
import { RECIPE_TAGS } from "@shared/recipe-tags.js";
import { locale, t } from "../../shared/i18n/i18n.js";

/** Library search filters, typed as commands: "/i" ingredient, "/t" tag,
 * "/c" longest time, "/p" people. A command becomes a chip awaiting its
 * value, typed in the bar with suggestions below; Enter, Tab or a click
 * settles it. Ingredients and tags add up; time and people replace. "/"
 * alone, or hovering the hero bar's "/" hint, lists the commands. */

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
];

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

function matchesFilter(recipe, { type, value, words }) {
  if (type === "ingredient") return hasIngredient(recipe, words);
  if (type === "tag") return recipe.tags?.includes(value) ?? false;
  if (type === "time") return recipe.prepMinutes != null && recipe.prepMinutes <= value;
  return recipe.servings != null && Math.abs(recipe.servings - value) <= 1;
}

/** Whether a recipe passes every filter. */
export function matchesFilters(recipe, filters) {
  return filters.every((filter) => matchesFilter(recipe, filter));
}

// The tags added in the settings, by key (see createSearchFilters()).
let customTagLabels = new Map();
const tagLabel = (key) => customTagLabels.get(key) ?? t(`tag.${key}`);

function chipText({ type, value }) {
  if (type === "ingredient") return value;
  if (type === "tag") return tagLabel(value);
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

  // The tags added in the settings, as the search index has them.
  function syncCustomTags() {
    customTagLabels = new Map((getCustomTags() ?? []).map((tag) => [tag.key, tag.label]));
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

  function addChip(type, value) {
    const chip = { type, value, words: type === "ingredient" ? ingredientWords(value) : null };
    if (type === "time" || type === "people") chips = chips.filter((other) => other.type !== type);
    const duplicate = chips.some((other) =>
      type === "ingredient" ? other.type === type && other.words.join(" ") === chip.words.join(" ") : other.type === type && other.value === value
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

  function settle(value) {
    addChip(pending.type, value);
    endPending();
  }

  /** Enter (or Tab without suggestions) while typing a value: the highlighted
   * suggestion, else the first one, else the typed text if valid for the
   * filter. Returns whether something settled. */
  function settleFromInput() {
    const typed = input.value.trim();
    const option = options[active] ?? (typed ? options[0] : undefined);
    if (option?.value !== undefined) {
      settle(option.value);
      return true;
    }
    if (!typed || pending.type === "tag") return false;
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

  function countLabel(count) {
    return el("span", "library-search-idea-count", String(count));
  }

  // A pill: the idea and how many recipes it leaves.
  function pill(text, value, count) {
    const node = el("button", "library-search-pill", text);
    node.type = "button";
    node.append(countLabel(count));
    return { node, value };
  }

  // Ingredient suggestions from the remaining recipes, most common first,
  // prefix matches ahead.
  let labelsSource = null;
  let labels = [];
  function allLabels() {
    const recipes = getRecipes() ?? [];
    if (labelsSource === recipes) return labels;
    const byKey = new Map();
    for (const recipe of recipes) {
      for (const label of recipe.ingredientLabels ?? []) {
        const words = ingredientWords(label);
        const key = words.join(" ");
        if (!key) continue;
        const entry = byKey.get(key) ?? { words, forms: new Map() };
        entry.forms.set(label, (entry.forms.get(label) ?? 0) + 1);
        byKey.set(key, entry);
      }
    }
    labels = [...byKey.values()].map(({ words, forms }) => ({
      words,
      label: [...forms].sort((a, b) => b[1] - a[1])[0][0],
    }));
    labelsSource = recipes;
    return labels;
  }

  function ingredientOptions(base, typed) {
    const needle = foldForSearch(typed);
    const chosen = new Set(chips.filter((chip) => chip.type === "ingredient").map((chip) => chip.words.join(" ")));
    const ideas = [];
    for (const { words, label } of allLabels()) {
      if (chosen.has(words.join(" "))) continue;
      const folded = foldForSearch(label);
      const rank = !needle ? (PANTRY.has(folded) ? -1 : 0) : folded.startsWith(needle) ? 0 : folded.includes(` ${needle}`) ? 1 : -1;
      if (rank < 0) continue;
      const count = base.filter((recipe) => hasIngredient(recipe, words)).length;
      if (count) ideas.push({ label, rank, count });
    }
    ideas.sort((a, b) => a.rank - b.rank || b.count - a.count || a.label.localeCompare(b.label, locale));
    return ideas.slice(0, INGREDIENT_IDEAS).map(({ label, count }) => {
      const node = el("button", "library-search-idea");
      node.type = "button";
      const text = el("span", "library-search-idea-text");
      // What's typed, picked out at the start of the name.
      if (needle && foldForSearch(label.slice(0, needle.length)) === needle) {
        text.append(el("mark", null, label.slice(0, needle.length)), label.slice(needle.length));
      } else {
        text.textContent = label;
      }
      node.append(text, countLabel(count));
      return { node, value: label };
    });
  }

  function renderValues() {
    const base = baseRecipes();
    const typed = input.value.trim();
    let list;
    let body;
    let title;
    if (pending.type === "ingredient") {
      title = t(typed ? "search.menu.ingredients" : "search.menu.frequent");
      list = ingredientOptions(base, typed);
      body = el("div", "library-search-ideas");
    } else {
      body = el("div", "library-search-pills");
      if (pending.type === "tag") {
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
      settle(option.value);
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
