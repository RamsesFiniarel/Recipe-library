import { mountIcons } from "../../shared/icons.js";
import { locale, t } from "../../shared/i18n/i18n.js";
import { el } from "../../shared/utils/dom.js";

/** The nutrition table: a row per ingredient (calories, carbs, protein,
 * fat, then the detail columns behind the chevron), then total and per
 * person. Scrolls in its own box within the window, header and totals
 * sticky. textContent only: names are user data. */

// Why a line counts for nothing: "food", "quantity" or "unit".
const issueText = (issue) => t(`nutrition.issue.${issue}`);

// The box never gets shorter than this, however little room is left.
const MIN_HEIGHT_PX = 240;

const formatters = new Map();
function format(value, digits) {
  if (!formatters.has(digits)) {
    formatters.set(digits, new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
  }
  return formatters.get(digits).format(value);
}

/** `reserveBelow()`: height kept under the box, so it ends with the sheet's
 * content. */
export function createNutritionTable(container, { reserveBelow }) {
  let expanded = false;
  let analysis = null;

  function valueCells(tr, columns, values, partial = []) {
    for (const column of columns) {
      const value = values?.[column.key];
      const td = el("td", "nutrition-value", value === null || value === undefined ? "—" : format(value, column.digits));
      if (column.firstExtra) td.classList.add("nutrition-extra-start");
      if (values && partial.includes(column.key)) {
        td.append(el("span", "nutrition-partial", "*"));
        td.title = t("nutrition.partial");
      }
      tr.append(td);
    }
  }

  function expandButton() {
    const button = el("button", "nutrition-expand");
    const label = t(expanded ? "nutrition.collapse" : "nutrition.expand");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-expanded", String(expanded));
    const slot = button.appendChild(el("i"));
    slot.dataset.icon = "chevronRight";
    mountIcons(button);
    button.addEventListener("click", toggle);
    return button;
  }

  function build() {
    const main = analysis.columns.filter((column) => column.main);
    const extra = analysis.columns.filter((column) => !column.main);
    const columns = expanded ? [...main, ...extra.map((column, i) => ({ ...column, firstExtra: i === 0 }))] : main;
    const table = el("table", `nutrition-table${expanded ? " is-expanded" : ""}`);

    const head = el("tr");
    head.append(el("th", null, t("nutrition.ingredients")));
    for (const column of columns) {
      const th = el("th", "nutrition-value", t(`nutrient.${column.key}`));
      th.append(el("span", "nutrition-unit", ` (${column.unit})`));
      if (column.firstExtra) th.classList.add("nutrition-extra-start");
      head.append(th);
    }
    table.appendChild(el("thead")).append(head);

    const body = table.appendChild(el("tbody"));
    for (const row of analysis.rows) {
      const tr = el("tr", row.values ? null : "is-missing");
      const name = el("td", "nutrition-ingredient");
      name.append(el("span", "nutrition-name", row.name));
      // What the line was read as, to trace a surprising number.
      const detail =
        row.food && row.issue !== "quantity"
          ? [
              row.food.name.replace(/\s*\([^)]*\)/g, ""),
              row.grams !== null ? `${format(row.grams, row.grams < 10 ? 1 : 0)} g` : issueText(row.issue),
            ]
          : [issueText(row.issue)];
      name.append(el("span", "nutrition-food", detail.join(" · ")));
      tr.append(name);
      valueCells(tr, columns, row.values);
      body.append(tr);
    }

    const foot = table.appendChild(el("tfoot"));
    const total = el("tr", "nutrition-total");
    total.append(el("th", null, t("nutrition.total")));
    valueCells(total, columns, analysis.total, analysis.partial);
    foot.append(total);
    if (analysis.perServing) {
      const serving = el("tr", "nutrition-serving");
      serving.append(el("th", null, t("nutrition.perPerson", { n: analysis.servings })));
      valueCells(serving, columns, analysis.perServing, analysis.partial);
      foot.append(serving);
    }
    return table;
  }

  /** Caps the box to the window's remaining height. */
  function fitHeight() {
    const scroll = container.querySelector(".nutrition-scroll");
    if (!scroll || !scroll.offsetParent) return;
    const top = scroll.getBoundingClientRect().top + window.scrollY;
    const available = window.innerHeight - top - reserveBelow();
    scroll.style.maxHeight = `${Math.max(MIN_HEIGHT_PX, Math.floor(available))}px`;
  }

  /** Layout-dependent settings: sticky totals stacked ("Total" above "Par
   * personne"), the chevron aligned with the header row. */
  function place() {
    const scroll = container.querySelector(".nutrition-scroll");
    if (!scroll?.offsetParent) return;
    const serving = scroll.querySelector(".nutrition-serving");
    scroll.style.setProperty("--nutrition-serving-height", `${serving?.offsetHeight ?? 0}px`);
    const header = scroll.querySelector("thead tr");
    const chevron = container.querySelector(".nutrition-expand");
    chevron.style.top = `${scroll.offsetTop + (header.offsetHeight - chevron.offsetHeight) / 2}px`;
  }

  function render(next) {
    analysis = next;
    // A refresh (the ingredients changed) keeps the reader where they were.
    const previous = container.querySelector(".nutrition-scroll");
    const scroll = el("div", "nutrition-scroll");
    scroll.append(build());

    const frame = el("div", "nutrition-frame");
    frame.append(scroll, expandButton());
    container.replaceChildren(frame);

    fitHeight();
    place();
    if (previous) {
      scroll.scrollTop = previous.scrollTop;
      scroll.scrollLeft = previous.scrollLeft;
    }
  }

  function toggle() {
    expanded = !expanded;
    render(analysis);
    const scroll = container.querySelector(".nutrition-scroll");
    container.querySelector(".nutrition-expand").focus({ preventScroll: true });
    if (!expanded) {
      scroll.scrollLeft = 0;
      return;
    }
    // New columns slide in against the sticky column.
    const firstExtra = scroll.querySelector("thead .nutrition-extra-start");
    const held = scroll.querySelector("thead th").getBoundingClientRect().right;
    const left = scroll.scrollLeft + firstExtra.getBoundingClientRect().left - held;
    scroll.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }

  return {
    render,
    fit() {
      fitHeight();
      place();
    },
    message(text) {
      container.replaceChildren(el("p", "nutrition-message", text));
    },
  };
}
