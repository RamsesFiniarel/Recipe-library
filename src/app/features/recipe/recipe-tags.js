import { RECIPE_TAGS, resolveTags, withTag, withoutTag } from "@shared/recipe-tags.js";
import { t } from "../../shared/i18n/i18n.js";
import { el } from "../../shared/utils/dom.js";

/** The recipe's tags under its title, in italics ("repas, végé, en
 * famille"). Computed by the server, corrected here: a hovered tag is
 * struck through and a click removes it; the "+" lists the others,
 * settings tags (`customTags`) last. Only corrections are saved (see
 * shared/recipe-tags.js). The refresh button clears them and recomputes
 * (`recompute()`, resolving to the tags or null), which come in one by
 * one. */

// The tags fade out before the new ones come in (see .recipe-tags-list).
const LEAVE_MS = 140;

/** `onChange(overrides)` gets the new corrections (null for none). */
export function createRecipeTags(root, { autoTags, overrides, customTags = [], onChange, recompute }) {
  const customLabels = new Map(customTags.map((tag) => [tag.key, tag.label]));
  const tagLabel = (key) => customLabels.get(key) ?? t(`tag.${key}`);
  const allKeys = [...RECIPE_TAGS.map((tag) => tag.key), ...customLabels.keys()];
  const list = root.querySelector("[data-tags-list]");
  const addButton = root.querySelector("[data-tags-add]");
  const refreshButton = root.querySelector("[data-tags-refresh]");
  const menu = root.querySelector("[data-tags-menu]");
  let auto = autoTags;
  let current = overrides;

  const shown = () => resolveTags(auto, current);

  /** `entering`: the tags come in from the left, one after the other. */
  function render({ entering = false } = {}) {
    const keys = shown();
    const nodes = [];
    keys.forEach((key, i) => {
      if (i > 0) nodes.push(" ");
      const tag = el("button", "recipe-tag", tagLabel(key));
      tag.type = "button";
      tag.dataset.tag = key;
      tag.title = t("recipe.tags.remove");
      tag.setAttribute("aria-label", t("recipe.tags.removeNamed", { tag: tagLabel(key) }));
      // Each with its comma, to come in together.
      const item = el("span", entering ? "recipe-tags-item is-entering" : "recipe-tags-item", "");
      item.style.setProperty("--i", i);
      item.append(tag, i < keys.length - 1 ? "," : "");
      nodes.push(item);
    });
    list.replaceChildren(...nodes);
    root.classList.toggle("is-empty", keys.length === 0);
    // Every tag on: nothing for the "+" to offer.
    addButton.hidden = keys.length === allKeys.length;
  }

  function apply(next) {
    current = next;
    render();
    onChange(current);
  }

  function openMenu() {
    const keys = shown();
    const option = (className, label) => {
      const item = el("button", className, label);
      item.type = "button";
      item.setAttribute("role", "menuitem");
      return item;
    };
    const items = allKeys.filter((key) => !keys.includes(key)).map((key) => {
      const item = option("recipe-tags-option", tagLabel(key));
      item.dataset.tag = key;
      return item;
    });
    menu.replaceChildren(...items);
    menu.hidden = false;
    root.classList.add("is-open");
    addButton.setAttribute("aria-expanded", "true");
    items[0]?.focus({ preventScroll: true });
  }

  function closeMenu({ focus = false } = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
    root.classList.remove("is-open");
    addButton.setAttribute("aria-expanded", "false");
    if (focus) addButton.focus({ preventScroll: true });
  }

  // Removing a tag by keyboard moves focus to the next one (or the "+").
  list.addEventListener("click", (event) => {
    const tag = event.target.closest(".recipe-tag");
    if (!tag) return;
    const index = [...list.querySelectorAll(".recipe-tag")].indexOf(tag);
    const hadFocus = document.activeElement === tag;
    apply(withoutTag(current, auto, tag.dataset.tag));
    if (!hadFocus) return;
    const tags = list.querySelectorAll(".recipe-tag");
    (tags[Math.min(index, tags.length - 1)] ?? addButton).focus({ preventScroll: true });
  });

  addButton.addEventListener("click", () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  menu.addEventListener("click", (event) => {
    const item = event.target.closest(".recipe-tags-option");
    if (!item) return;
    apply(withTag(current, auto, item.dataset.tag));
    closeMenu({ focus: true });
  });

  // Corrections cleared and tags recomputed: old ones fade, new ones come in
  // while the arrows turn.
  let refreshing = false;
  refreshButton.addEventListener("click", async () => {
    if (refreshing) return;
    refreshing = true;
    closeMenu();
    refreshButton.classList.remove("is-turning");
    void refreshButton.offsetWidth;
    refreshButton.classList.add("is-turning");
    current = null;
    onChange(null);
    list.classList.add("is-leaving");
    const [next] = await Promise.all([
      recompute().catch((err) => {
        console.error(err);
        return null;
      }),
      new Promise((resolve) => setTimeout(resolve, LEAVE_MS)),
    ]);
    if (next) auto = next;
    list.classList.remove("is-leaving");
    render({ entering: true });
    refreshing = false;
  });
  refreshButton.addEventListener("animationend", () => refreshButton.classList.remove("is-turning"));

  // Up/down move through the list, Escape closes it.
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll(".recipe-tags-option")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ focus: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : items.length - 1;
      items[(index + step) % items.length]?.focus();
    }
  });

  // A click or the focus going anywhere else closes it.
  function onDocumentPointerDown(event) {
    if (!root.contains(event.target)) closeMenu();
  }
  document.addEventListener("pointerdown", onDocumentPointerDown);
  root.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !root.contains(event.relatedTarget)) closeMenu();
  });

  render();

  return {
    /** The tags shown, as they read. */
    labels() {
      return shown().map(tagLabel);
    },
    /** New automatic tags, the recipe having changed. */
    setAutoTags(next) {
      auto = next;
      render();
    },
    dispose() {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
    },
  };
}
