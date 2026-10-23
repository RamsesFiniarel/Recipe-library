import { nutritionApi } from "../../core/api/nutrition.api.js";
import { ApiError } from "../../core/api/http.js";
import { mountWindowLight } from "../../shared/components/window-light.js";
import { bindEscapeBack } from "../../shared/utils/escape-back.js";
import { debounce } from "../../shared/utils/debounce.js";
import { el, mountTemplate } from "../../shared/utils/dom.js";
import { locale, t, tn } from "../../shared/i18n/i18n.js";
import { foldForSearch } from "@shared/text.js";
import template from "./foods.page.html?raw";
import "./foods.page.css";

// Rows added per slice while scrolling: all ~2,600 foods by 23 values at
// once would be too many cells.
const SLICE = 120;
const SEARCH_DELAY_MS = 150;

export async function render(container, _params, navigate) {
  mountTemplate(container, template);
  mountWindowLight(container.querySelector("[data-window-light]"));
  const unbindEscape = bindEscapeBack(() => navigate("/parametres", { transition: "crossfade" }));

  const grid = container.querySelector("[data-foods-grid]");
  const message = container.querySelector("[data-foods-message]");
  const searchInput = container.querySelector("[data-foods-search]");
  const groupSelect = container.querySelector("[data-foods-group]");
  const countEl = container.querySelector("[data-foods-count]");

  let table;
  try {
    table = await nutritionApi.foods();
  } catch (err) {
    console.error(err);
    message.textContent = t(err instanceof ApiError && err.status === 503 ? "recipe.nutritionMissing" : "foods.failed");
    return unbindEscape;
  }

  container.querySelector("[data-foods-source]").textContent = t("foods.source", { source: table.source });
  for (const { code, name } of table.groups) {
    const option = el("option", null, name.charAt(0).toLocaleUpperCase(locale) + name.slice(1));
    option.value = code;
    groupSelect.append(option);
  }

  const countFormat = new Intl.NumberFormat(locale);
  const formatters = new Map();
  const format = (value, digits) => {
    if (!formatters.has(digits)) {
      formatters.set(digits, new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
    }
    return formatters.get(digits).format(value);
  };

  function valueCell(value, { digits }) {
    if (value === null) return el("span", "foods-cell is-unknown", "—");
    if (Array.isArray(value)) {
      const [qualifier, amount] = value;
      return el("span", "foods-cell is-qualified", qualifier === "traces" ? t("foods.traces") : `< ${format(amount, digits)}`);
    }
    return el("span", "foods-cell", format(value, digits));
  }

  // Four frozen panes: header row and food column follow the figures, which
  // alone scroll.
  const corner = el("div", "foods-corner", t("foods.food"));
  const head = el("div", "foods-head");
  const headRow = head.appendChild(el("div", "foods-row"));
  for (const column of table.columns) {
    const cell = el("span", "foods-cell");
    cell.append(el("span", "foods-label", t(`nutrient.${column.key}`)), el("span", "foods-unit", `(${column.unit})`));
    headRow.append(cell);
  }
  const side = el("div", "foods-side");
  const sideRows = side.appendChild(el("div", "foods-rows"));
  const body = el("div", "foods-body");
  const bodyRows = body.appendChild(el("div", "foods-rows"));
  grid.replaceChildren(corner, head, side, body);

  body.addEventListener("scroll", () => {
    head.scrollLeft = body.scrollLeft;
    side.scrollTop = body.scrollTop;
  });
  // The wheel over the header row or the names scrolls the figures.
  for (const pane of [head, side]) {
    pane.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        body.scrollBy(event.deltaX, event.deltaY);
      },
      { passive: false }
    );
  }

  function foodRow({ food }) {
    const row = el("div", "foods-row foods-food");
    const name = el("span", "foods-name", food.name);
    name.title = food.name;
    row.append(name, el("span", "foods-family", food.family ?? ""));
    return row;
  }

  function valuesRow({ food }) {
    const row = el("div", "foods-row");
    table.columns.forEach((column, i) => row.append(valueCell(food.values[i], column)));
    return row;
  }

  const entries = table.foods.map((food) => ({ food, folded: foldForSearch(food.name) }));
  let shown = entries;
  let rendered = 0;

  // The last row in sight (or nearly): the next slice.
  const endObserver = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue;
        endObserver.unobserve(record.target);
        appendSlice();
      }
    },
    { root: body, rootMargin: "600px 0px" }
  );

  function appendSlice() {
    const next = shown.slice(rendered, rendered + SLICE);
    sideRows.append(...next.map(foodRow));
    bodyRows.append(...next.map(valuesRow));
    rendered += next.length;
    if (rendered < shown.length) endObserver.observe(bodyRows.lastElementChild);
  }

  function applyFilter() {
    const needle = foldForSearch(searchInput.value.trim());
    const group = groupSelect.value;
    shown = entries.filter((entry) => (!group || entry.food.group === group) && entry.folded.includes(needle));
    countEl.textContent = tn("foods.count", shown.length, { n: countFormat.format(shown.length) });
    endObserver.disconnect();
    sideRows.replaceChildren();
    bodyRows.replaceChildren();
    rendered = 0;
    body.scrollTop = 0;
    if (shown.length) appendSlice();
    else sideRows.append(el("p", "foods-message", t("foods.none")));
  }

  const scheduleFilter = debounce(applyFilter, SEARCH_DELAY_MS);
  searchInput.addEventListener("input", scheduleFilter);
  groupSelect.addEventListener("change", applyFilter);
  applyFilter();
  searchInput.focus({ preventScroll: true });

  return () => {
    scheduleFilter.cancel();
    endObserver.disconnect();
    unbindEscape();
  };
}
