import { booksApi } from "../../core/api/books.api.js";
import { promptDialog } from "../../shared/components/prompt-dialog.js";
import { mountIcons } from "../../shared/icons.js";
import { mountWindowLight } from "../../shared/components/window-light.js";
import {
  prepareTransitionBackdrop,
  showTransitionBackdrop,
  hideTransitionBackdrop,
} from "../../shared/components/cover-backdrop.js";
import { debounce } from "../../shared/utils/debounce.js";
import { bindHatMenu } from "../../shared/utils/hat-menu.js";
import { cloneTemplate, mountTemplate } from "../../shared/utils/dom.js";
import { locale, t, tn } from "../../shared/i18n/i18n.js";
import { foldForSearch } from "@shared/text.js";
import {
  hexForColorToken,
  hexForPageColorToken,
  darken,
  PAGE_COLOR_TOKENS,
  PAGE_COLORS,
  DEFAULT_PAGE_COLOR_TOKEN,
} from "@shared/palette.js";
import {
  WIDTH_MULTIPLIER_MIN,
  WIDTH_MULTIPLIER_MAX,
  HEIGHT_MULTIPLIER_MIN,
  HEIGHT_MULTIPLIER_MAX,
  GLOSS_MIN,
  GLOSS_MAX,
} from "@shared/book-size.js";
import { widthMultiplierForRecipeCount, heightMultiplierForId } from "./three/book-sizing.js";
import { faceLengths } from "./three/book-outline.js";
import { createSearchFilters, matchesFilters } from "./search-filters.js";
import { loadShelfObjects } from "../../shared/utils/preferences.js";
import template from "./library.page.html?raw";
import "./library.page.css";

const MAX_SEARCH_RESULTS = 8;
// Hero results: cards sliding to new places as the query changes, new ones
// entering one by one.
const HERO_CARD_MOVE_MS = 360;
const HERO_CARD_ENTER_MS = 520;
const HERO_CARD_STAGGER_MS = 60;
const HERO_CARD_LEAVE_MS = 220;
// The cards' height to width (see .recipe-card--paper).
const HERO_CARD_RATIO = 1.3;
const SAVE_DELAY_MS = 700;
const PICTURE_TYPES = ["image/jpeg", "image/png"];
// Longest side of an uploaded cover picture: screen size is enough, and it
// keeps uploads within the request limit.
const MAX_PICTURE_SIDE = 1024;
const PATTERN_ZONES = [
  { key: "backTexture", label: t("library.textures.back"), face: "cover" },
  { key: "spineTexture", label: t("library.textures.spine"), face: "spine" },
  { key: "coverTexture", label: t("library.textures.front"), face: "cover" },
];

// Hover popup: offset from the pointer, on the side covering the shelves
// least (placePopup()), kept off the screen and header edges. Fixed size
// (room for two words, no mid-transition measuring); keep in sync with
// .library-hover-popup.
const POPUP_OFFSET_PX = 40;
const POPUP_MARGIN_PX = 16;
const POPUP_WIDTH_PX = 192;
const POPUP_HEIGHT_PX = 72;
// How fast the popup chases the pointer (higher = snappier).
const POPUP_FOLLOW_DAMPING = 5;
// The leader line's points chase their targets much faster, still eased.
const POPUP_LINE_FOLLOW_DAMPING = 12;
// Delay before hiding, so moving between neighbouring books doesn't flicker.
const POPUP_HIDE_DELAY_MS = 500;
// How far the leader line's elbow leans past the midpoint, towards the
// book's nearest screen edge.
const POPUP_LINE_LEAN_PX = 16;

// Idle wobble of the leader line's elbow while hovering, purely visual.
const ELBOW_IDLE_AMPLITUDE_PX = 2;
const ELBOW_IDLE_SPEED = 0.21;

// Landing hero: the title at twice its header size, the search bar a third
// longer, capped at this share of the window. The move back to the header
// takes --hero-duration, scene included.
const HERO_TITLE_SCALE = 2;
const HERO_SEARCH_TO_TITLE_WIDTH = 1.33;
// ...but at least this many title font sizes wide, for short titles.
const HERO_SEARCH_MIN_EM = 7;
const HERO_MAX_WIDTH_RATIO = 0.92;
const HERO_DURATION_MS = 1100;
// Keys that scroll a page: on the hero they leave it instead.
const HERO_EXIT_KEYS = new Set([" ", "ArrowDown", "PageDown"]);
// The hero bar's placeholder: recipe names, one every few seconds.
const HERO_HINT_INTERVAL_MS = 3000;
const HERO_HINT_COUNT = 8;
const HERO_HINT_DEFAULT = t("library.search.placeholder");
// The first arrival's entrance (title out of a blur, the rest after it).
const HERO_INTRO_MS = 2000;
// The opening loader never waits on the cover pictures longer than this.
const LOADER_MAX_WAIT_MS = 8000;

// The hero greets the first library visit per page load; coming back from
// a book lands on the shelves.
let heroSeen = false;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Frame-rate independent exponential smoothing towards target.
function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

// A loose Lissajous wander (x and y at slightly different frequencies).
function idleOffset(nowSeconds, amplitude, speed) {
  return {
    x: amplitude * Math.sin(nowSeconds * speed * Math.PI * 2),
    y: amplitude * Math.sin(nowSeconds * speed * Math.PI * 2 * 1.3 + 1.7),
  };
}

export async function render(container, params, navigate) {
  // Back from a book before its page finished loading: drop the bridge.
  hideTransitionBackdrop();
  mountTemplate(container, template);
  mountWindowLight(container.querySelector("[data-window-light]"));

  const canvas = container.querySelector(".library-canvas");
  const canvasWrap = container.querySelector(".library-canvas-wrap");
  const topbarEl = container.querySelector(".topbar");
  const popupEl = container.querySelector("[data-hover-popup]");
  const popupBoxEl = container.querySelector("[data-hover-popup-box]");
  const popupTitleEl = container.querySelector("[data-hover-title]");
  const popupMetaEl = container.querySelector("[data-hover-meta]");
  const lineEl = container.querySelector("[data-hover-line]");
  const lineAEl = container.querySelector("[data-hover-line-a]");
  const lineBEl = container.querySelector("[data-hover-line-b]");
  const dotBookEl = container.querySelector("[data-hover-dot-book]");
  const dotElbowEl = container.querySelector("[data-hover-dot-elbow]");
  const addButton = container.querySelector('[data-action="add-book"]');
  const searchWrap = container.querySelector(".library-search");
  const searchInput = container.querySelector("[data-search-input]");
  const searchResults = container.querySelector("[data-search-results]");
  const heroResultsEl = container.querySelector("[data-hero-results]");
  const heroResultsEmpty = container.querySelector("[data-hero-results-empty]");
  const libraryPageEl = container.querySelector(".library-page");
  const editButton = container.querySelector('[data-action="toggle-edit"]');
  // The chef's-hat menu; the hat is the edit button (see hat-menu.js).
  const unbindHatMenu = bindHatMenu(container.querySelector("[data-library-menu]"), editButton);
  const editPanel = container.querySelector("[data-edit-panel]");
  const editEmptyEl = container.querySelector("[data-edit-empty]");
  const editBookEl = container.querySelector("[data-edit-book]");
  const editTitleInput = container.querySelector("[data-edit-title]");
  const editCoverColorInput = container.querySelector("[data-edit-cover-color]");
  const editCoverTexturesButton = container.querySelector("[data-edit-cover-textures]");
  const editPageColorGroup = container.querySelector("[data-edit-page-color-group]");
  const editWidthSlider = container.querySelector("[data-edit-width-slider]");
  const editHeightSlider = container.querySelector("[data-edit-height-slider]");
  const editGlossSlider = container.querySelector("[data-edit-gloss-slider]");
  const editCoverConfirm = container.querySelector("[data-edit-cover-confirm]");
  const editPreviewCanvas = container.querySelector("[data-edit-preview]");
  const texturePopover = container.querySelector("[data-texture-popover]");
  const bookCardEl = container.querySelector(".library-edit-card--book");
  editWidthSlider.min = WIDTH_MULTIPLIER_MIN;
  editWidthSlider.max = WIDTH_MULTIPLIER_MAX;
  editHeightSlider.min = HEIGHT_MULTIPLIER_MIN;
  editHeightSlider.max = HEIGHT_MULTIPLIER_MAX;
  editGlossSlider.min = GLOSS_MIN;
  editGlossSlider.max = GLOSS_MAX;

  let sceneHandle = null;
  let disposed = false;
  // { books: [{ type, id, title, colorToken, folded }],
  //   recipes: [{ type, id, title, servings, prepMinutes, bookId, bookTitle,
  //               tags, ingredients, ingredientLabels, folded }] }
  let searchEntries = null;

  // --- Landing hero -----------------------------------------------------------

  const heroTitleEl = container.querySelector(".topbar-title h1");
  const searchBox = container.querySelector("[data-search-box]");
  const searchHint = container.querySelector("[data-search-hint]");
  const searchGo = container.querySelector("[data-search-go]");
  const heroEl = container.querySelector("[data-hero]");
  const heroTitleSlot = container.querySelector("[data-hero-title-slot]");
  const heroSearchSlot = container.querySelector("[data-hero-search-slot]");
  const heroCountEl = container.querySelector("[data-hero-count]");
  const heroQuestionEl = container.querySelector("[data-hero-question]");
  let heroActive = !heroSeen;
  heroSeen = true;
  let heroHints = [];
  let heroHintTimer = null;
  let heroEndTimer = null;
  libraryPageEl.style.setProperty("--hero-duration", `${HERO_DURATION_MS}ms`);

  /** Lays the hero out: sizes its slots from the header title, then moves the
   * title and search bar onto them by transforms. Expects the hero state. */
  function placeHero() {
    const moving = [heroTitleEl, searchBox];
    // Measured untransformed, transitions off, so placing never animates.
    for (const el of moving) {
      el.style.transition = "none";
      el.style.transform = "none";
    }

    const title = heroTitleEl.getBoundingClientRect();
    const maxWidth = libraryPageEl.clientWidth * HERO_MAX_WIDTH_RATIO;
    const titleScale = Math.min(HERO_TITLE_SCALE, maxWidth / title.width);
    libraryPageEl.style.setProperty("--hero-title-w", `${title.width * titleScale}px`);
    libraryPageEl.style.setProperty("--hero-title-h", `${title.height * titleScale}px`);
    const titleFontSize = parseFloat(getComputedStyle(heroTitleEl).fontSize);
    const searchWidth = Math.max(title.width * HERO_SEARCH_TO_TITLE_WIDTH, titleFontSize * HERO_SEARCH_MIN_EM) * titleScale;
    libraryPageEl.style.setProperty("--hero-search-width", `${Math.min(searchWidth, maxWidth)}px`);

    const box = searchBox.getBoundingClientRect();
    const titleSlot = heroTitleSlot.getBoundingClientRect();
    const searchSlot = heroSearchSlot.getBoundingClientRect();
    const offset = (from, to) =>
      `${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px`;
    libraryPageEl.style.setProperty("--hero-title-transform", `translate(${offset(title, titleSlot)}) scale(${titleScale})`);
    libraryPageEl.style.setProperty("--hero-search-transform", `translate(${offset(box, searchSlot)})`);

    for (const el of moving) el.style.transform = "";
    void heroTitleEl.offsetWidth; // take the new places before transitions come back
    for (const el of moving) el.style.transition = "";
  }

  // "Qu'est-ce qu'on cuisine ce soir ?" - the moment follows the clock.
  function heroQuestion() {
    const hour = new Date().getHours();
    return t(hour >= 17 ? "library.hero.evening" : hour >= 11 && hour < 15 ? "library.hero.noon" : "library.hero.day");
  }

  function shuffled(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** Changes the placeholder to `text`: sliding up (hero) or in place. */
  function showHint(text, { slide = true } = {}) {
    const current = searchHint.querySelector(":scope > span:not(.is-leaving):not(.is-fading-out)");
    if (current?.textContent === text) return;
    for (const old of searchHint.querySelectorAll(":scope > span:not(.is-leaving):not(.is-fading-out)")) {
      old.className = slide ? "is-leaving" : "is-fading-out";
      old.addEventListener("animationend", () => old.remove(), { once: true });
    }
    const next = document.createElement("span");
    next.className = slide ? "is-entering" : "is-fading-in";
    next.textContent = text;
    searchHint.append(next);
  }

  function startHintCycle() {
    clearInterval(heroHintTimer);
    if (!heroHints.length) return;
    let index = 0;
    heroHintTimer = setInterval(() => {
      if (!heroActive || document.hidden || searchBox.classList.contains("has-value")) return;
      showHint(heroHints[index % heroHints.length]);
      index += 1;
    }, HERO_HINT_INTERVAL_MS);
  }

  /** Fills the hero once the library loads: counts and the recipe names the
   * placeholder cycles through. */
  function fillHero(books, recipes) {
    heroCountEl.textContent = t("library.hero.count", {
      recipes: tn("count.recipe", recipes.length),
      books: tn("count.book", books.length),
    });
    heroHints = shuffled(recipes).slice(0, HERO_HINT_COUNT).map((recipe) => `${recipe.title}…`);
    if (heroActive) startHintCycle();
  }

  /** To the shelves: title and search glide to the header, buttons fade in,
   * the scene comes into focus. */
  function exitHero() {
    if (!heroActive) return;
    heroActive = false;
    clearInterval(heroHintTimer);
    clearTimeout(heroEndTimer);
    // The placeholder settles back on the field's own words for the move.
    if (!searchBox.classList.contains("has-value")) showHint(HERO_HINT_DEFAULT, { slide: false });
    hideHeroResults();
    libraryPageEl.classList.add("is-hero-transition");
    libraryPageEl.classList.remove("is-hero", "is-hero-intro");
    sceneHandle?.setHero(false);
    heroEndTimer = setTimeout(() => {
      libraryPageEl.classList.remove("is-hero-transition");
      searchHint.replaceChildren();
    }, HERO_DURATION_MS + 50);
  }

  /** Back to the hero (scrolling up past the shelves): the reverse move. */
  function enterHero() {
    if (heroActive || editMode || disposed) return;
    heroActive = true;
    clearTimeout(heroEndTimer);
    clearSearch();
    if (searchBox.contains(document.activeElement)) document.activeElement.blur();
    // Laid out in the hero state, out of sight, then started from the header.
    libraryPageEl.classList.remove("is-hero-transition");
    libraryPageEl.classList.add("is-hero", "has-hero");
    placeHero();
    libraryPageEl.classList.remove("is-hero");
    void libraryPageEl.offsetWidth;
    searchHint.replaceChildren();
    showHint(HERO_HINT_DEFAULT, { slide: false });
    libraryPageEl.classList.add("is-hero-transition", "is-hero");
    sceneHandle?.setHero(true);
    startHintCycle();
    heroEndTimer = setTimeout(() => libraryPageEl.classList.remove("is-hero-transition"), HERO_DURATION_MS + 50);
  }

  // The row of results holds more or fewer cards as the window changes.
  function onHeroResize() {
    if (!heroActive) return;
    placeHero();
    if (heroCards.size || heroResultsEmpty.classList.contains("is-shown")) renderSearchResults();
  }

  const searchOpen = () =>
    searchBox.contains(document.activeElement) || !searchResults.hidden || heroCards.size > 0;
  // Nothing moves while the opening loader is up.
  let pageReady = false;

  // The page never scrolls. On the hero, scrolling down leaves it (closing
  // the search), unless a long filter menu takes the wheel. On the shelves,
  // scrolling closes an open search.
  function onPageWheel(event) {
    if (!pageReady) {
      event.preventDefault();
      return;
    }
    if (heroActive) {
      const menu = event.target.closest?.(".library-search-menu");
      if (menu && menu.scrollHeight > menu.clientHeight) return;
      event.preventDefault();
      if (event.deltaY <= 0) return;
      if (searchOpen()) {
        clearSearch();
        searchInput.blur();
      }
      exitHero();
      return;
    }
    if (searchOpen() && !searchResults.contains(event.target)) {
      searchWrap.classList.add("is-snapping");
      clearSearch();
      searchInput.blur();
      requestAnimationFrame(() => searchWrap.classList.remove("is-snapping"));
    }
  }

  // On the hero, page-scrolling keys leave it; "/" focuses the search.
  function onPageKeydown(event) {
    if (!pageReady || event.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      searchInput.focus();
      return;
    }
    if (heroActive && HERO_EXIT_KEYS.has(event.key)) {
      event.preventDefault();
      exitHero();
    }
  }

  heroQuestionEl.textContent = heroQuestion();
  window.addEventListener("resize", onHeroResize);
  libraryPageEl.addEventListener("wheel", onPageWheel, { passive: false });
  window.addEventListener("keydown", onPageKeydown);
  container.querySelector("[data-hero-scroll]").addEventListener("click", exitHero);
  if (heroActive) {
    libraryPageEl.classList.add("is-hero", "has-hero");
    showHint(HERO_HINT_DEFAULT, { slide: false });
    placeHero();
    // The title's width depends on its web font: placed again once it's in.
    document.fonts?.ready.then(() => {
      if (!disposed && heroActive) placeHero();
    });
  }

  // --- Opening loader ---------------------------------------------------------

  const loaderEl = container.querySelector("[data-loader]");
  const loaderTextEl = container.querySelector("[data-loader-text]");
  // Opening straight on the shelves (back from a book), it's paper-coloured.
  loaderEl.classList.toggle("is-light", !heroActive);

  /** Scene ready: the loader fades and the hero enters (title from a blur,
   * then the rest). */
  function revealPage() {
    pageReady = true;
    loaderEl.classList.add("is-done");
    if (!heroActive) return;
    // Ready to type straight away.
    searchInput.focus({ preventScroll: true });
    libraryPageEl.classList.add("is-hero-intro");
    setTimeout(() => libraryPageEl.classList.remove("is-hero-intro"), HERO_INTRO_MS);
  }

  // --- Hover popup ----------------------------------------------------------

  let pointerPos = { x: 0, y: 0 }; // raw pointer position
  let displayedPos = { left: 0, top: 0 }; // smoothed box position actually on screen
  let bookCenter = { x: 0, y: 0 }; // hovered book's on-screen spine centre (raw target)
  let displayedBookCenter = { x: 0, y: 0 }; // smoothed, leader line's actual first point
  let popupVisible = false;
  let lineVisible = false; // separate from popupVisible: the line has no grace period
  let hidePopupTimer = null;
  let popupFrameId = null;
  let lastPopupFrameTime = null;

  // The popup's target position from the pointer: on the side (left/right,
  // top/bottom) away from the screen centre, clamped to the screen and
  // header. It jumps on flips and clamps; displayedPos eases towards it.
  function desiredPopupPlacement() {
    const { x, y } = pointerPos;
    const inLeftHalf = x < window.innerWidth / 2;
    const inTopHalf = y < window.innerHeight / 2;

    let left = inLeftHalf ? x - POPUP_OFFSET_PX - POPUP_WIDTH_PX : x + POPUP_OFFSET_PX;
    let top = inTopHalf ? y - POPUP_OFFSET_PX - POPUP_HEIGHT_PX : y + POPUP_OFFSET_PX;

    const minTop = topbarEl.getBoundingClientRect().bottom + POPUP_MARGIN_PX;
    left = clamp(left, POPUP_MARGIN_PX, window.innerWidth - POPUP_WIDTH_PX - POPUP_MARGIN_PX);
    top = clamp(top, minTop, window.innerHeight - POPUP_HEIGHT_PX - POPUP_MARGIN_PX);

    return { left, top };
  }

  function applyPopupStyle() {
    popupEl.style.transform = `translate(${displayedPos.left}px, ${displayedPos.top}px)`;
  }

  // Leader line: book point, elbow, popup point (middle of the popup edge
  // facing the book). The elbow is the midpoint nudged towards the book's
  // screen side, plus its wobble.
  function updateHoverLine(bookCenterPos, nowSeconds) {
    const popupCenterY = displayedPos.top + POPUP_HEIGHT_PX / 2;
    const popupIsAbove = popupCenterY < bookCenterPos.y;
    const popupPoint = {
      x: displayedPos.left + POPUP_WIDTH_PX / 2,
      y: popupIsAbove ? displayedPos.top + POPUP_HEIGHT_PX : displayedPos.top,
    };

    const lean = bookCenterPos.x < window.innerWidth / 2 ? -POPUP_LINE_LEAN_PX : POPUP_LINE_LEAN_PX;
    const elbowIdle = idleOffset(nowSeconds, ELBOW_IDLE_AMPLITUDE_PX, ELBOW_IDLE_SPEED);
    const elbow = {
      x: (bookCenterPos.x + popupPoint.x) / 2 + lean + elbowIdle.x,
      y: (bookCenterPos.y + popupPoint.y) / 2 + elbowIdle.y,
    };

    lineAEl.setAttribute("x1", bookCenterPos.x);
    lineAEl.setAttribute("y1", bookCenterPos.y);
    lineAEl.setAttribute("x2", elbow.x);
    lineAEl.setAttribute("y2", elbow.y);

    lineBEl.setAttribute("x1", elbow.x);
    lineBEl.setAttribute("y1", elbow.y);
    lineBEl.setAttribute("x2", popupPoint.x);
    lineBEl.setAttribute("y2", popupPoint.y);

    dotBookEl.setAttribute("cx", bookCenterPos.x);
    dotBookEl.setAttribute("cy", bookCenterPos.y);
    dotElbowEl.setAttribute("cx", elbow.x);
    dotElbowEl.setAttribute("cy", elbow.y);
  }

  function showPopup({ title, recipeCount, x, y }) {
    if (hidePopupTimer) {
      clearTimeout(hidePopupTimer);
      hidePopupTimer = null;
    }
    popupTitleEl.textContent = title;
    popupMetaEl.textContent = tn("count.recipe", recipeCount ?? 0);
    // Updated now: the per-frame update would come a frame late for the snap
    // below.
    bookCenter = { x, y };

    // A fresh appearance starts in place, so the open animation (vertical
    // scale) doesn't travel; switching books or reappearing before the hide
    // delay keeps easing. The line's visibility is checked on its own.
    if (!popupVisible) displayedPos = desiredPopupPlacement();
    if (!lineVisible) displayedBookCenter = { x, y };

    applyPopupStyle();
    updateHoverLine(displayedBookCenter, performance.now() / 1000);
    popupVisible = true;
    lineVisible = true;
    popupBoxEl.classList.add("is-visible");
    lineEl.classList.add("is-visible");
  }

  function scheduleHidePopup() {
    // The line fades out as soon as hover ends (no grace period, unlike the
    // popup).
    lineVisible = false;
    lineEl.classList.remove("is-visible");

    if (hidePopupTimer) return;
    hidePopupTimer = setTimeout(() => {
      hidePopupTimer = null;
      popupVisible = false;
      popupBoxEl.classList.remove("is-visible");
    }, POPUP_HIDE_DELAY_MS);
  }

  function updateBookCenter(x, y) {
    bookCenter = { x, y };
  }

  // Each frame, eases (frame-rate independent) towards the target, so flips
  // and clamps never snap.
  function popupFrame(now) {
    popupFrameId = requestAnimationFrame(popupFrame);
    const dt = lastPopupFrameTime == null ? 0 : (now - lastPopupFrameTime) / 1000;
    lastPopupFrameTime = now;
    if (!popupVisible) return;
    const desired = desiredPopupPlacement();
    displayedPos.left = damp(displayedPos.left, desired.left, POPUP_FOLLOW_DAMPING, dt);
    displayedPos.top = damp(displayedPos.top, desired.top, POPUP_FOLLOW_DAMPING, dt);
    displayedBookCenter.x = damp(displayedBookCenter.x, bookCenter.x, POPUP_LINE_FOLLOW_DAMPING, dt);
    displayedBookCenter.y = damp(displayedBookCenter.y, bookCenter.y, POPUP_LINE_FOLLOW_DAMPING, dt);
    applyPopupStyle();
    updateHoverLine(displayedBookCenter, now / 1000);
  }
  popupFrameId = requestAnimationFrame(popupFrame);

  canvas.addEventListener("pointermove", (event) => {
    pointerPos = { x: event.clientX, y: event.clientY };
  });

  // --- Edit mode ------------------------------------------------------------

  let editMode = false;
  let selectedBook = null; // full { id, title, colorToken, coverColor, pageColorToken, recipes } while editing
  let previewHandle = null;

  for (const token of PAGE_COLOR_TOKENS) {
    const swatch = cloneTemplate(container, "page-color-swatch");
    swatch.style.setProperty("--swatch-color", PAGE_COLORS[token].hex);
    const input = swatch.querySelector("input");
    input.value = token;
    input.setAttribute("aria-label", t(`pageColor.${token}`));
    editPageColorGroup.appendChild(swatch);
  }

  function closePreview() {
    if (!previewHandle) return;
    previewHandle.dispose();
    previewHandle = null;
  }

  // The open book's cover style and pictures; the texture popup edits a
  // draft, so cancelling leaves them untouched.
  let editLook = { coverStyle: "color", coverTexture: null, spineTexture: null, backTexture: null };
  let editLookDirty = false;
  let editSizeDirty = false;
  // A colour picked on a textured book only previews until confirmed: the
  // replaced colour, to restore on cancel, or null.
  let colorBeforePending = null;

  // The form's current values, saved or not: for the preview and the save.
  function currentEditedColors() {
    const pageColorToken = editPageColorGroup.querySelector("input:checked")?.value ?? DEFAULT_PAGE_COLOR_TOKEN;
    const pageLightHex = PAGE_COLORS[pageColorToken].hex;
    return { coverColor: editCoverColorInput.value, pageColorToken, pageLightHex, pageDarkHex: darken(pageLightHex) };
  }

  function currentEditedSizes() {
    return { widthMultiplier: Number(editWidthSlider.value), heightMultiplier: Number(editHeightSlider.value) };
  }

  function previewAppearance() {
    const { coverColor, pageLightHex, pageDarkHex } = currentEditedColors();
    return {
      coverHex: coverColor,
      pageLightHex,
      pageDarkHex,
      style: colorBeforePending === null ? editLook.coverStyle : "color",
      gloss: Number(editGlossSlider.value),
      coverTexture: editLook.coverTexture,
      spineTexture: editLook.spineTexture,
      backTexture: editLook.backTexture,
    };
  }

  // The preview is a rounded hole in the card's tint: an SVG mask of the
  // card's box with the canvas's rectangle cut out (evenodd).
  function updatePreviewHole() {
    const width = bookCardEl.clientWidth;
    const height = bookCardEl.clientHeight;
    const x = editPreviewCanvas.offsetLeft;
    const y = editPreviewCanvas.offsetTop;
    const w = editPreviewCanvas.offsetWidth;
    const h = editPreviewCanvas.offsetHeight;
    const radius = parseFloat(getComputedStyle(editPreviewCanvas).borderTopLeftRadius) || 0;
    const r = Math.min(radius, w / 2, h / 2);
    const hole = w && h
      ? `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
      : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path fill="black" fill-rule="evenodd" d="M0 0 H${width} V${height} H0 Z ${hole}"/></svg>`;
    bookCardEl.style.setProperty("--hole-mask", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  }
  const previewHoleObserver = new ResizeObserver(updatePreviewHole);
  previewHoleObserver.observe(editPreviewCanvas);
  previewHoleObserver.observe(bookCardEl);

  function updatePreviewAppearance() {
    previewHandle?.setAppearance(previewAppearance());
  }

  function updatePreviewSizes() {
    previewHandle?.setSize(currentEditedSizes());
  }

  function renderCoverStyle() {
    const textured = editLook.coverStyle === "texture";
    editCoverColorInput.classList.toggle("is-selected", !textured);
    editCoverTexturesButton.classList.toggle("is-selected", textured);
  }

  async function saveBookEdits() {
    if (!selectedBook) return;
    const title = editTitleInput.value.trim();
    if (!title) {
      editTitleInput.value = selectedBook.title;
      return;
    }
    const { pageColorToken } = currentEditedColors();
    // A colour still waiting for confirmation isn't saved yet.
    const coverColor = colorBeforePending ?? editCoverColorInput.value;
    const coverGloss = Number(editGlossSlider.value);
    const sizes = currentEditedSizes();
    const sizesChanged = editSizeDirty;
    const fields = { coverColor, pageColorToken, coverStyle: editLook.coverStyle, coverGloss };
    if (title !== selectedBook.title) fields.title = title;
    if (editLookDirty) Object.assign(fields, picturesToSave());
    if (sizesChanged) Object.assign(fields, sizes);

    try {
      await booksApi.update(selectedBook.id, fields);
      Object.assign(selectedBook, { title, coverColor, pageColorToken, coverStyle: editLook.coverStyle, coverGloss, ...editLookPictures() });
      if (sizesChanged) {
        Object.assign(selectedBook, sizes);
        // The shelf already shows the new size (updateBookSize()); this saves where
        // books ended up after rows were pushed.
        sceneHandle?.persistShelfLayout();
      }
      sceneHandle?.updateBookAppearance(selectedBook.id, {
        coverColor,
        pageColorToken,
        coverStyle: editLook.coverStyle,
        coverGloss,
        ...editLookPictures(),
      });
    } catch (err) {
      console.error(err);
    }
  }

  function editLookPictures() {
    return { coverTexture: editLook.coverTexture, spineTexture: editLook.spineTexture, backTexture: editLook.backTexture };
  }

  // Pictures sent: new uploads (data URLs) and removals (null); unchanged
  // ones (image URLs) are left out.
  function picturesToSave() {
    return Object.fromEntries(
      Object.entries(editLookPictures()).filter(([, value]) => value === null || value.startsWith("data:"))
    );
  }

  const scheduleSaveBookEdits = debounce(saveBookEdits, SAVE_DELAY_MS);

  editTitleInput.addEventListener("input", scheduleSaveBookEdits);
  editTitleInput.addEventListener("blur", () => {
    scheduleSaveBookEdits.cancel();
    saveBookEdits();
  });
  function showCoverConfirm(visible) {
    editCoverConfirm.hidden = !visible;
    editCoverTexturesButton.hidden = visible;
  }

  // Settles a pending colour: kept (plain colour cover) or dropped (input
  // restored).
  function settlePendingColor(apply) {
    if (colorBeforePending === null) return;
    if (apply) {
      editLook = { ...editLook, coverStyle: "color" };
      renderCoverStyle();
    } else {
      editCoverColorInput.value = colorBeforePending;
    }
    colorBeforePending = null;
    showCoverConfirm(false);
    updatePreviewAppearance();
    if (apply) scheduleSaveBookEdits();
  }

  // On a textured book, picking a colour only previews it; the confirm
  // buttons decide.
  editCoverColorInput.addEventListener("click", () => {
    if (editLook.coverStyle !== "texture" || colorBeforePending !== null) return;
    colorBeforePending = editCoverColorInput.value;
    showCoverConfirm(true);
  });
  editCoverColorInput.addEventListener("input", () => {
    updatePreviewAppearance();
    if (colorBeforePending !== null) return;
    scheduleSaveBookEdits();
  });
  container.querySelector("[data-edit-cover-apply]").addEventListener("click", () => settlePendingColor(true));
  container.querySelector("[data-edit-cover-cancel]").addEventListener("click", () => settlePendingColor(false));

  editGlossSlider.addEventListener("input", () => {
    updatePreviewAppearance();
    if (selectedBook) sceneHandle?.updateBookAppearance(selectedBook.id, { coverGloss: Number(editGlossSlider.value) });
    scheduleSaveBookEdits();
  });
  editPageColorGroup.addEventListener("change", () => {
    updatePreviewAppearance();
    scheduleSaveBookEdits();
  });
  for (const slider of [editWidthSlider, editHeightSlider]) {
    slider.addEventListener("input", () => {
      editSizeDirty = true;
      updatePreviewSizes();
      if (selectedBook) sceneHandle?.updateBookSize(selectedBook.id, currentEditedSizes());
      applyPatternProportions();
      scheduleSaveBookEdits();
    });
  }

  async function readPictureFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, MAX_PICTURE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const ctx = canvas.getContext("2d");
      // JPEG has no transparency: a PNG's transparent areas would otherwise come out black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.9);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // A zone's width/height at the current size: the face's length along the
  // outline (book-outline.js) over its height.
  function faceAspectRatio(face, { widthMultiplier, heightMultiplier }) {
    const lengths = faceLengths(widthMultiplier);
    return (face === "spine" ? lengths.spine : lengths.board) / (lengths.height * heightMultiplier);
  }

  let texturePatternZones = [];
  let texturePattern = null;

  function applyPatternProportions() {
    const sizes = currentEditedSizes();
    let widthUnits = 0;
    for (const { elements, face } of texturePatternZones) {
      const ratio = faceAspectRatio(face, sizes);
      for (const element of elements) element.style.setProperty("--face-ratio", String(ratio));
      widthUnits += ratio;
    }
    texturePattern?.style.setProperty("--width-units", String(widthUnits));
  }

  // A face: its picture in the jacket ("+" if none) and its name below, both
  // as wide as the face.
  function createPatternZone({ key, label, face }, draft) {
    const zone = document.createElement("label");
    zone.className = "library-texture-zone";

    const add = document.createElement("span");
    add.className = "library-texture-zone-add";
    add.innerHTML = `<i data-icon="plus"></i>`;
    mountIcons(add);

    const name = document.createElement("span");
    name.className = "library-texture-zone-label";
    name.textContent = label;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = PICTURE_TYPES.join(",");
    input.className = "library-texture-zone-input";
    input.setAttribute("aria-label", t("library.textures.pick", { zone: label }));

    const showPicture = () => {
      zone.style.setProperty("--zone-picture", draft[key] ? `url("${draft[key]}")` : "none");
      zone.classList.toggle("has-picture", Boolean(draft[key]));
    };
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file || !PICTURE_TYPES.includes(file.type)) return;
      try {
        draft[key] = await readPictureFile(file);
        showPicture();
      } catch (err) {
        console.error(err);
      }
    });

    zone.append(input, add);
    showPicture();
    texturePatternZones.push({ elements: [zone, name], face });
    return { zone, name };
  }

  // One picker at a time; settling it resolves with null (dismissed) or the
  // draft.
  let settleTexturePicker = null;

  function closeTexturePicker() {
    settleTexturePicker?.(null);
  }

  function openTexturePicker() {
    closeTexturePicker();
    const draft = { ...editLookPictures() };
    return new Promise((resolve) => {
      function onKeydown(event) {
        if (event.key === "Escape") settle(null);
      }
      function settle(value) {
        if (settleTexturePicker !== settle) return;
        settleTexturePicker = null;
        document.removeEventListener("keydown", onKeydown);
        texturePopover.hidden = true;
        texturePopover.replaceChildren();
        texturePatternZones = [];
        texturePattern = null;
        resolve(value);
      }

      settleTexturePicker = settle;
      document.addEventListener("keydown", onKeydown);

      const heading = document.createElement("span");
      heading.className = "library-edit-label";
      heading.textContent = t("library.textures.title");

      // The jacket laid flat, faces side by side with their names below; a face
      // without a picture shows the cover colour.
      const pattern = document.createElement("div");
      pattern.className = "library-texture-pattern";
      pattern.style.setProperty("--jacket-color", previewAppearance().coverHex);
      texturePattern = pattern;
      const jacket = document.createElement("div");
      jacket.className = "library-texture-jacket";
      const names = document.createElement("div");
      names.className = "library-texture-names";
      names.setAttribute("aria-hidden", "true");
      for (const face of PATTERN_ZONES) {
        const { zone, name } = createPatternZone(face, draft);
        jacket.append(zone);
        names.append(name);
      }
      pattern.append(jacket, names);

      const actions = document.createElement("div");
      actions.className = "library-texture-actions";
      const iconButton = (label, name) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-icon btn-round library-texture-action";
        button.setAttribute("aria-label", label);
        button.title = label;
        button.innerHTML = `<i data-icon="${name}"></i>`;
        mountIcons(button);
        return button;
      };
      const cancel = iconButton(t("common.cancel"), "close");
      const confirm = iconButton(t("common.apply"), "check");
      cancel.addEventListener("click", () => settle(null));
      confirm.addEventListener("click", () => settle(draft));
      actions.append(cancel, confirm);

      applyPatternProportions();
      texturePopover.replaceChildren(heading, pattern, actions);
      texturePopover.hidden = false;
    });
  }

  editCoverTexturesButton.addEventListener("click", async () => {
    const pictures = await openTexturePicker();
    if (!pictures || !selectedBook) return;
    const hasPicture = Object.values(pictures).some(Boolean);
    editLook = { ...editLook, ...pictures, coverStyle: hasPicture ? "texture" : "color" };
    editLookDirty = true;
    renderCoverStyle();
    updatePreviewAppearance();
    scheduleSaveBookEdits();
  });

  function automaticSizes(book) {
    return {
      widthMultiplier: widthMultiplierForRecipeCount(book.recipes.length),
      heightMultiplier: heightMultiplierForId(book.id),
    };
  }

  async function showBookForEdit(book) {
    closeTexturePicker();
    settlePendingColor(false);
    selectedBook = book;
    editEmptyEl.hidden = true;
    editBookEl.hidden = false;
    editTitleInput.value = book.title;
    editCoverColorInput.value = book.coverColor || hexForColorToken(book.colorToken);
    const pageColorToken = book.pageColorToken || DEFAULT_PAGE_COLOR_TOKEN;
    for (const input of editPageColorGroup.querySelectorAll("input")) {
      input.checked = input.value === pageColorToken;
    }

    editLook = {
      coverStyle: book.coverStyle === "texture" ? "texture" : "color",
      coverTexture: book.coverTextureUrl,
      spineTexture: book.spineTextureUrl,
      backTexture: book.backTextureUrl,
    };
    editLookDirty = false;
    editSizeDirty = false;
    const automatic = automaticSizes(book);
    editWidthSlider.value = book.widthMultiplier ?? automatic.widthMultiplier;
    editHeightSlider.value = book.heightMultiplier ?? automatic.heightMultiplier;
    editGlossSlider.value = book.coverGloss ?? 0;
    renderCoverStyle();

    closePreview();
    const { createBookPreviewScene } = await import("./three/book-preview-scene.js");
    if (selectedBook !== book) return; // selection changed while the module loaded
    const handle = await createBookPreviewScene({
      canvas: editPreviewCanvas,
      appearance: previewAppearance(),
      ...currentEditedSizes(),
    });
    if (selectedBook !== book) {
      handle.dispose(); // selection changed while the scene's own assets loaded
      return;
    }
    previewHandle = handle;
  }

  async function selectBookForEdit(bookId) {
    // Singled out on the shelf at once, the panel following once loaded.
    sceneHandle?.setSelectedBook(bookId);
    const book = await booksApi.get(bookId);
    if (!editMode) return; // exited edit mode while this was loading
    await showBookForEdit(book);
  }

  function closeEditMode() {
    editMode = false;
    settlePendingColor(false);
    selectedBook = null;
    closeTexturePicker();
    closePreview();
    editBookEl.hidden = true;
    editEmptyEl.hidden = false;
    editButton.classList.remove("is-active");
    editButton.setAttribute("aria-pressed", "false");
    editPanel.classList.remove("is-open");
    libraryPageEl.classList.remove("is-editing");
    sceneHandle?.setEditMode(false);
  }

  function openEditMode() {
    editMode = true;
    editButton.classList.add("is-active");
    editButton.setAttribute("aria-pressed", "true");
    editPanel.classList.add("is-open");
    libraryPageEl.classList.add("is-editing");
    sceneHandle?.setEditMode(true);
  }

  // Not the touch screen's first tap on the hat, which only opens its menu.
  editButton.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    if (editMode) closeEditMode();
    else openEditMode();
  });
  // The "+" below the last shelf, placed by the scene (onShelfEndChange).
  const addShelfButton = container.querySelector("[data-add-shelf]");
  function placeAddShelfButton({ visible, x, y }) {
    addShelfButton.style.setProperty("--x", `${x}px`);
    addShelfButton.style.setProperty("--y", `${y}px`);
    addShelfButton.classList.toggle("is-visible", visible);
    addShelfButton.tabIndex = visible ? 0 : -1;
  }
  addShelfButton.addEventListener("click", () => sceneHandle?.addShelf());
  function onEditModeKeydown(event) {
    if (event.key === "Escape" && editMode) closeEditMode();
  }
  window.addEventListener("keydown", onEditModeKeydown);

  // --- Search -------------------------------------------------------------

  // Recipe count per book (results), and the books (hero card colours),
  // filled with the shelf list (mountScene()).
  const recipeCountByBook = new Map();
  const bookById = new Map();
  let activeResult = -1;

  // Recipe filters ("/i", "/t", "/c", "/p", see search-filters.js), set up
  // before the field's other listeners.
  const searchFilters = createSearchFilters({
    box: searchBox,
    input: searchInput,
    getRecipes: () => searchEntries?.recipes,
    getCustomTags: () => searchEntries?.customTags,
    onChange() {
      syncSearchValue();
      renderSearchResults();
    },
  });
  searchFilters.bindHelp(container.querySelector(".library-search-kbd"));

  function syncSearchValue() {
    searchBox.classList.toggle("has-value", searchInput.value.trim() !== "" || searchFilters.isActive());
    updateHeroLift();
  }

  /** Writes `title` into `el`, the part matching `needle` (folded) in a <mark>. */
  function writeHighlighted(el, title, needle) {
    if (!needle) {
      el.textContent = title;
      return;
    }
    // Folded char by char, keeping each one's origin, to map a match back.
    let folded = "";
    const origin = [];
    for (let i = 0; i < title.length; i += 1) {
      for (const char of foldForSearch(title[i])) {
        folded += char;
        origin.push(i);
      }
    }
    const at = folded.indexOf(needle);
    if (at < 0) {
      el.textContent = title;
      return;
    }
    const start = origin[at];
    const end = origin[at + needle.length - 1] + 1;
    const mark = document.createElement("mark");
    mark.textContent = title.slice(start, end);
    el.replaceChildren(title.slice(0, start), mark, title.slice(end));
  }

  function buildBookResult(book, needle) {
    const node = cloneTemplate(container, "book-result");
    node.style.setProperty("--result-color", hexForColorToken(book.colorToken));
    node.dataset.nav = `/${encodeURIComponent(book.id)}`;
    writeHighlighted(node.querySelector(".library-search-result-title"), book.title, needle);
    const count = recipeCountByBook.get(book.id);
    node.querySelector(".library-search-result-meta").textContent =
      count === undefined ? t("library.result.book") : tn("count.recipe", count);
    return node;
  }

  function buildRecipeResult(recipe, needle) {
    const node = cloneTemplate(container, "recipe-result");
    node.dataset.nav = `/${encodeURIComponent(recipe.bookId)}/${encodeURIComponent(recipe.id)}`;
    writeHighlighted(node.querySelector(".library-search-result-title"), recipe.title, needle);
    node.querySelector(".library-search-result-meta").textContent = recipe.bookTitle;
    return node;
  }

  function buildGroup(label, rows) {
    const group = document.createElement("div");
    group.className = "library-search-group";
    group.setAttribute("role", "group");
    const heading = document.createElement("p");
    heading.className = "library-search-group-label";
    heading.textContent = label;
    group.setAttribute("aria-label", label);
    group.append(heading, ...rows);
    return group;
  }

  // Match quality: whole title, its start, a word's start, anywhere (-1: none).
  function matchRank(folded, needle) {
    if (folded === needle) return 0;
    if (folded.startsWith(needle)) return 1;
    for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + 1)) {
      if (!/[\p{L}\p{N}]/u.test(folded[at - 1])) return 2;
    }
    return folded.includes(needle) ? 3 : -1;
  }

  const titleCollator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });

  /** Books and recipes (recipes only under filters), best matches first, then
   * alphabetical. */
  function rankedResults(needle, filters) {
    const entries = filters.length
      ? searchEntries.recipes.filter((recipe) => matchesFilters(recipe, filters))
      : [...searchEntries.books, ...searchEntries.recipes];
    return entries
      .map((entry) => ({ entry, rank: needle ? matchRank(entry.folded, needle) : 0 }))
      .filter(({ rank }) => rank >= 0)
      .sort((a, b) => a.rank - b.rank || titleCollator.compare(a.entry.title, b.entry.title))
      .map(({ entry }) => entry);
  }

  // --- Hero results: cards under the bar, keyed by target, so remaining cards
  // slide, others fade out and new ones rise in.

  const heroCards = new Map();

  const resultPath = (entry) =>
    entry.type === "book"
      ? `/${encodeURIComponent(entry.id)}`
      : `/${encodeURIComponent(entry.bookId)}/${encodeURIComponent(entry.id)}`;

  // Light lettering on a dark cover, dark on a light one.
  function inkOn(hex) {
    const value = parseInt(hex.slice(1), 16);
    const [r, g, b] = [16, 8, 0].map((shift) => ((value >> shift) & 0xff) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "var(--color-page-text)" : "#fbf5ec";
  }

  function buildHeroCard(entry) {
    if (entry.type === "book") {
      const book = bookById.get(entry.id) ?? entry;
      const color = book.coverColor || hexForColorToken(book.colorToken);
      const card = cloneTemplate(container, "hero-book-card");
      card.style.setProperty("--book-color", color);
      card.style.setProperty("--book-ink", inkOn(color));
      card.querySelector(".library-hero-card-title").textContent = entry.title;
      card.setAttribute("aria-label", `Livre ${entry.title}`);
      card.dataset.nav = resultPath(entry);
      return card;
    }
    const card = cloneTemplate(container, "hero-recipe-card");
    card.style.setProperty("--page-color", hexForPageColorToken(bookById.get(entry.bookId)?.pageColorToken));
    card.querySelector(".recipe-card-title").textContent = entry.title;
    card.querySelector(".recipe-card-meta").textContent = entry.servings ? `${entry.servings} pers.` : "—";
    card.setAttribute("aria-label", `${entry.title}, ${entry.bookTitle}`);
    card.dataset.nav = resultPath(entry);
    return card;
  }

  // As many cards as the row's width holds.
  function heroCardsThatFit() {
    const style = getComputedStyle(heroResultsEl);
    const card = parseFloat(style.getPropertyValue("--hero-card-width"));
    const gap = parseFloat(style.columnGap) || 0;
    return Math.max(1, Math.floor((heroResultsEl.clientWidth + gap) / (card + gap)));
  }

  // A leaving card is taken out of the flow where it stood (`rect`), then
  // fades.
  function dismissHeroCard(card, rect, origin) {
    card.classList.remove("is-active");
    Object.assign(card.style, {
      position: "absolute",
      left: `${rect.left - origin.left}px`,
      top: `${rect.top - origin.top}px`,
      pointerEvents: "none",
    });
    card
      .animate({ opacity: 0, translate: "0 8px" }, { duration: HERO_CARD_LEAVE_MS, easing: "ease", fill: "forwards" })
      .finished.then(
        () => card.remove(),
        () => card.remove()
      );
  }

  function hideHeroResults() {
    const origin = heroResultsEl.getBoundingClientRect();
    const leaving = [...heroCards.values()].map((card) => [card, card.getBoundingClientRect()]);
    for (const [card, rect] of leaving) dismissHeroCard(card, rect, origin);
    heroCards.clear();
    heroResultsEmpty.classList.remove("is-shown");
    updateHeroLift();
  }

  /** Raises title, subtitle and bar while the bar holds anything, enough to
   * centre the whole block with a row of results; lowers it when empty.
   * From layout offsets (which ignore the lift). */
  function updateHeroLift() {
    let lift = 0;
    if (heroActive && searchBox.classList.contains("has-value")) {
      const cardWidth = parseFloat(getComputedStyle(heroResultsEl).getPropertyValue("--hero-card-width"));
      const stack = heroResultsEl.offsetParent;
      const top = stack.offsetTop + heroTitleSlot.offsetTop;
      const bottom = stack.offsetTop + heroResultsEl.offsetTop + cardWidth * HERO_CARD_RATIO;
      lift = Math.max(0, Math.round((top + bottom) / 2 - heroEl.clientHeight / 2));
    }
    libraryPageEl.style.setProperty("--hero-lift", `${lift}px`);
  }

  function renderHeroResults(results, emptyText) {
    const shown = results.slice(0, heroCardsThatFit());
    const origin = heroResultsEl.getBoundingClientRect();
    const before = new Map([...heroCards].map(([path, card]) => [path, card.getBoundingClientRect()]));

    const next = new Map(shown.map((entry) => [resultPath(entry), null]));
    for (const path of next.keys()) {
      next.set(path, heroCards.get(path) ?? buildHeroCard(shown.find((entry) => resultPath(entry) === path)));
    }
    for (const [path, card] of heroCards) {
      if (!next.has(path)) dismissHeroCard(card, before.get(path), origin);
    }
    heroCards.clear();
    for (const [path, card] of next) heroCards.set(path, card);

    // Reorders, moving only what must (moving a node stops its transitions);
    // leaving cards are skipped.
    const kept = new Set(next.values());
    const skipLeaving = (node) => {
      while (node && !kept.has(node)) node = node.nextElementSibling;
      return node;
    };
    let cursor = skipLeaving(heroResultsEmpty.nextElementSibling);
    for (const card of next.values()) {
      if (cursor === card) cursor = skipLeaving(cursor.nextElementSibling);
      else heroResultsEl.insertBefore(card, cursor);
    }

    let entering = 0;
    for (const [path, card] of next) {
      const from = before.get(path);
      if (!from) {
        card.animate([{ opacity: 0, translate: "0 12px" }, { opacity: 1, translate: "0 0" }], {
          duration: HERO_CARD_ENTER_MS,
          delay: entering * HERO_CARD_STAGGER_MS,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "backwards",
        });
        entering += 1;
        continue;
      }
      const dx = from.left - card.getBoundingClientRect().left;
      if (Math.abs(dx) < 0.5) continue;
      card.animate([{ translate: `${dx}px 0` }, { translate: "0 0" }], {
        duration: HERO_CARD_MOVE_MS,
        easing: "cubic-bezier(0.2, 0.7, 0.3, 1)",
      });
    }

    heroResultsEmpty.textContent = emptyText;
    heroResultsEmpty.classList.toggle("is-shown", shown.length === 0);
    updateHeroLift();
    // Nothing highlighted until pointer or arrows pick a card; Enter opens the
    // first.
    setActiveResult(-1);
  }

  function resultRows() {
    return heroActive ? [...heroCards.values()] : [...searchResults.querySelectorAll(".library-search-result")];
  }

  // The highlighted result (pointer or arrows; the first by default in the
  // list). -1: none.
  function setActiveResult(index) {
    const rows = resultRows();
    activeResult = rows.length && index >= 0 ? index % rows.length : -1;
    rows.forEach((row, i) => row.classList.toggle("is-active", i === activeResult));
    if (!heroActive) rows[activeResult]?.scrollIntoView({ block: "nearest" });
  }

  function moveActiveResult(step) {
    const count = resultRows().length;
    if (!count) return;
    setActiveResult(activeResult < 0 ? (step > 0 ? 0 : count - 1) : (activeResult + step + count) % count);
  }

  function hideSearchResults() {
    searchResults.hidden = true;
    searchResults.replaceChildren();
    hideHeroResults();
    activeResult = -1;
  }

  function renderSearchResults() {
    const query = searchFilters.text().trim();
    const filters = searchFilters.filters();
    if ((!query && !filters.length) || !searchEntries) {
      hideSearchResults();
      return;
    }

    const needle = foldForSearch(query);
    const emptyText = query ? t("library.results.none", { query }) : t("library.results.noneFiltered");
    if (heroActive) {
      renderHeroResults(rankedResults(needle, filters), emptyText);
      return;
    }
    // Filters are about recipes: no books under them.
    const books = filters.length ? [] : searchEntries.books.filter((book) => book.folded.includes(needle));
    const recipes = searchEntries.recipes.filter(
      (recipe) => recipe.folded.includes(needle) && matchesFilters(recipe, filters)
    );
    const shownBooks = books.slice(0, MAX_SEARCH_RESULTS);
    const shownRecipes = recipes.slice(0, Math.max(0, MAX_SEARCH_RESULTS - shownBooks.length));

    if (shownBooks.length + shownRecipes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "library-search-empty";
      empty.textContent = emptyText;
      searchResults.replaceChildren(empty);
    } else {
      searchResults.replaceChildren(
        ...(shownBooks.length
          ? [buildGroup(t("library.results.books"), shownBooks.map((book) => buildBookResult(book, needle)))]
          : []),
        ...(shownRecipes.length
          ? [buildGroup(t("library.results.recipes"), shownRecipes.map((recipe) => buildRecipeResult(recipe, needle)))]
          : [])
      );
    }
    searchResults.hidden = false;
    setActiveResult(0);
  }

  function clearSearch() {
    searchInput.value = "";
    searchFilters.clear();
    searchBox.classList.remove("has-value");
    hideSearchResults();
  }

  function openResult(row) {
    if (!row) return;
    clearSearch();
    navigate(row.dataset.nav, { transition: "veil" });
  }

  // Enter, or the hero bar's arrow: the highlighted result.
  function openActiveResult() {
    openResult(resultRows()[Math.max(activeResult, 0)]);
  }

  searchInput.addEventListener("input", () => {
    syncSearchValue();
    renderSearchResults();
  });
  searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim() || searchFilters.isActive()) renderSearchResults();
  });
  searchInput.addEventListener("keydown", (event) => {
    // Already used by the filters (their menu, a chip).
    if (event.defaultPrevented) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!resultRows().length) return;
      event.preventDefault();
      moveActiveResult(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openActiveResult();
      return;
    }
    if (event.key !== "Escape") return;
    clearSearch();
    searchInput.blur();
  });
  searchResults.addEventListener("pointermove", (event) => {
    const row = event.target.closest(".library-search-result");
    if (row) setActiveResult(resultRows().indexOf(row));
  });
  searchGo.addEventListener("click", openActiveResult);
  // Keep focus in the field while clicking a result (blur would hide the
  // list first); the following "click" navigates.
  searchResults.addEventListener("mousedown", (event) => event.preventDefault());
  searchResults.addEventListener("click", (event) => openResult(event.target.closest("[data-nav]")));
  // The hero's cards, the same way.
  heroResultsEl.addEventListener("pointermove", (event) => {
    const card = event.target.closest(".library-hero-card");
    if (card) setActiveResult(resultRows().indexOf(card));
  });
  heroResultsEl.addEventListener("pointerleave", () => setActiveResult(-1));
  heroResultsEl.addEventListener("mousedown", (event) => event.preventDefault());
  heroResultsEl.addEventListener("click", (event) => openResult(event.target.closest("[data-nav]")));
  // The search closes when focus leaves it and the results, not when the
  // window loses focus.
  for (const el of [searchWrap, heroResultsEl]) {
    el.addEventListener("focusout", (event) => {
      if (searchWrap.contains(event.relatedTarget) || heroResultsEl.contains(event.relatedTarget)) return;
      if (!document.hasFocus()) return;
      clearSearch();
    });
  }

  // --- 3D scene -----------------------------------------------------------

  // `first`: the opening, under the loader, lifted once the shelves are
  // ready. A rebuild (book added) just replaces the scene.
  async function mountScene({ first = false } = {}) {
    const [books, index] = await Promise.all([booksApi.list(), booksApi.searchIndex()]);
    fillHero(books, index.recipes);
    for (const book of books) {
      recipeCountByBook.set(book.id, book.recipeCount);
      bookById.set(book.id, book);
    }
    if (disposed) return;

    // Pictures come as cached image URLs (listBooks()), not inline data.
    for (const book of books) {
      Object.assign(book, {
        coverTexture: book.coverTextureUrl,
        spineTexture: book.spineTextureUrl,
        backTexture: book.backTextureUrl,
      });
    }

    searchEntries = {
      books: index.books.map((book) => ({ type: "book", ...book, folded: foldForSearch(book.title) })),
      recipes: index.recipes.map((recipe) => ({
        type: "recipe",
        ...recipe,
        folded: foldForSearch(recipe.title),
      })),
      customTags: index.customTags ?? [],
    };

    if (sceneHandle) {
      sceneHandle.dispose();
      sceneHandle = null;
    }

    // Three.js loads on demand, for this page only.
    const { createLibraryScene } = await import("./three/scene.js");
    if (disposed) return;

    sceneHandle = await createLibraryScene({
      canvas,
      container: canvasWrap,
      books,
      // No veil: the opening book crossfades into the next page's backdrop (see
      // cover-backdrop.js).
      onBookOpening: (bookId) => prepareTransitionBackdrop(books.find((book) => book.id === bookId)),
      onBookFading: (durationMs) => showTransitionBackdrop(durationMs),
      onBookClick: (bookId) => navigate(`/${bookId}`),
      onHoverChange: (info) => (info ? showPopup(info) : scheduleHidePopup()),
      onHoverMove: (x, y) => updateBookCenter(x, y),
      onBookSelectForEdit: (bookId) => selectBookForEdit(bookId),
      onBooksReordered: (bookIds) => booksApi.reorder(bookIds).catch((err) => console.error(err)),
      hero: heroActive,
      heroTransitionMs: HERO_DURATION_MS,
      onHeroExitRequest: exitHero,
      onHeroReturnRequest: enterHero,
      onShelfEndChange: placeAddShelfButton,
      // The objects chosen on the settings page.
      shelfObjects: loadShelfObjects(),
    });
    if (editMode) sceneHandle.setEditMode(true);
    // The hero may have been left while the scene was still loading.
    sceneHandle.setHero(heroActive);

    if (first) {
      const giveUp = new Promise((resolve) => setTimeout(resolve, LOADER_MAX_WAIT_MS));
      Promise.race([sceneHandle.whenComplete(), giveUp]).then(() => {
        if (!disposed) revealPage();
      });
    }
  }

  addButton.addEventListener("click", async () => {
    const title = await promptDialog({
      title: t("library.newBook.title"),
      label: t("library.newBook.label"),
      confirmLabel: t("common.create"),
    });
    if (!title) return;
    await booksApi.create(title);
    if (!disposed) mountScene();
  });

  try {
    await mountScene({ first: true });
  } catch (err) {
    console.error(err);
    if (!disposed) loaderTextEl.textContent = t("library.loadFailed");
  }

  return () => {
    disposed = true;
    if (hidePopupTimer) clearTimeout(hidePopupTimer);
    if (popupFrameId != null) cancelAnimationFrame(popupFrameId);
    window.removeEventListener("keydown", onEditModeKeydown);
    window.removeEventListener("resize", onHeroResize);
    window.removeEventListener("keydown", onPageKeydown);
    clearInterval(heroHintTimer);
    clearTimeout(heroEndTimer);
    scheduleSaveBookEdits.cancel();
    previewHoleObserver.disconnect();
    closePreview();
    unbindHatMenu();
    if (sceneHandle) sceneHandle.dispose();
  };
}
