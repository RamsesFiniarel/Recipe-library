import {
  QUANTITY_CHARS,
  findUnit,
  isEmptyLine,
  isHeading,
  isUnitPrefix,
  parseIngredientLine,
  parseIngredientText,
  scaleQuantity,
  unitLabel,
} from "@shared/ingredients.js";
import { autosizeTextarea } from "../../shared/utils/autosize-textarea.js";
import { language, t } from "../../shared/i18n/i18n.js";

/** Ingredient lines that read like a plain list: three borderless fields
 * (quantity, unit, name) sized to their text. Typing moves between them by
 * itself: a space after the number goes to the unit, a word that can't be
 * a unit goes to the name ("2 oignons"), Enter starts a new line.
 * Quantities may be shown scaled for a while (see setScale); the saved
 * ones don't change. */

const LINE_MARKUP = `
  <span class="ingredient-cell"><input class="ingredient-input" data-part="quantity" type="text" inputmode="decimal"
    size="1" autocomplete="off" spellcheck="false" aria-label="${t("ingredient.quantity")}" /></span>
  <span class="ingredient-cell"><input class="ingredient-input" data-part="unit" type="text"
    size="1" autocomplete="off" spellcheck="false" aria-label="${t("ingredient.unit")}" /></span>
  <textarea class="ingredient-input ingredient-name" data-part="name" rows="1" aria-label="${t("ingredient.name")}"></textarea>`;

const PARTS = ["quantity", "unit", "name"];
const EMPTY_LINE = { quantity: "", unit: "", name: "" };

function focusAt(field, position) {
  field.focus();
  field.setSelectionRange(position, position);
}

/** Types `text` at the caret, as if from the keyboard. */
function insertText(field, text) {
  field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

export function createIngredientList(listEl, { lines, onChange }) {
  const rows = [];

  // A wrapped name returns to the line's start: its first line is indented
  // by the dash, quantity and unit (--lead), re-measured when they resize.
  const rowOfCell = new WeakMap();
  function updateLead(row) {
    const style = getComputedStyle(row.el);
    const start = row.el.getBoundingClientRect().left + parseFloat(style.paddingLeft);
    const lead = row.unit.parentElement.getBoundingClientRect().right - start;
    if (row.el.style.getPropertyValue("--lead") === `${lead}px`) return;
    row.el.style.setProperty("--lead", `${lead}px`);
    row.resize();
  }
  const leadObserver = new ResizeObserver((entries) => {
    for (const row of new Set(entries.map((entry) => rowOfCell.get(entry.target)))) {
      if (row && rows.includes(row)) updateLead(row);
    }
  });

  const rowOf = (node) => rows.find((row) => row.el.contains(node));
  // A scaled quantity keeps the recipe's own in `row.saved`.
  const toLine = (row) => ({
    quantity: (row.saved ?? row.quantity.value).trim(),
    unit: row.unitKey,
    name: row.name.value.trim(),
  });
  const getLines = () => rows.map(toLine).filter((line) => !isEmptyLine(line));
  const emit = () => onChange(getLines());

  function showUnit(row) {
    row.unit.value = row.unitKey ? unitLabel(row.unitKey, row.quantity.value, language) : "";
  }

  // Cells size to a hidden copy of their text (.ingredient-cell); headings
  // lose their dash, an empty line shows a hint.
  function sync(row) {
    row.quantity.parentElement.dataset.value = row.quantity.value;
    row.unit.parentElement.dataset.value = row.unit.value;
    const line = toLine(row);
    const empty = isEmptyLine(line) && !row.unit.value;
    row.el.classList.toggle("is-heading", isHeading(line));
    row.el.classList.toggle("is-empty", empty);
    row.name.placeholder = empty ? t(rows.length === 1 ? "ingredient.firstPlaceholder" : "ingredient.placeholder") : "";
  }

  function makeRow(line) {
    const el = document.createElement("li");
    el.className = "ingredient-line";
    el.innerHTML = LINE_MARKUP;
    const row = {
      el,
      unitKey: line.unit || "",
      quantity: el.querySelector('[data-part="quantity"]'),
      unit: el.querySelector('[data-part="unit"]'),
      name: el.querySelector('[data-part="name"]'),
    };
    row.quantity.value = line.quantity;
    row.name.value = line.name;
    showUnit(row);
    row.resize = autosizeTextarea(row.name);
    for (const cell of [row.quantity.parentElement, row.unit.parentElement]) {
      rowOfCell.set(cell, row);
      leadObserver.observe(cell);
    }
    return row;
  }

  function insertRow(line, index) {
    const row = makeRow(line);
    listEl.insertBefore(row.el, rows[index]?.el ?? null);
    rows.splice(index, 0, row);
    rows.forEach(sync);
    return row;
  }

  function removeRow(row) {
    rows.splice(rows.indexOf(row), 1);
    leadObserver.unobserve(row.quantity.parentElement);
    leadObserver.unobserve(row.unit.parentElement);
    row.el.remove();
    rows.forEach(sync);
  }

  /** Settles the unit field: a full unit is kept (written as it reads after
   * the quantity), anything else is returned to go to the name. */
  function commitUnit(row) {
    const text = row.unit.value.trim();
    const unit = text ? findUnit(text) : null;
    row.unitKey = unit?.key ?? "";
    showUnit(row);
    sync(row);
    return unit ? "" : text;
  }

  // ---------------------------------------------------------------------
  // Typing rules
  // ---------------------------------------------------------------------
  function typeInQuantity(row, text, event) {
    if (text === " ") {
      event.preventDefault();
      if (row.quantity.value.trim()) focusAt(row.unit, row.unit.value.length);
      return;
    }
    if (QUANTITY_CHARS.test(text)) return;
    // Not a number: the unit, or straight the name when there's no number.
    event.preventDefault();
    if (row.quantity.value.trim()) {
      focusAt(row.unit, row.unit.value.length);
      typeInUnit(row, text, null);
    } else {
      focusAt(row.name, 0);
      insertText(row.name, text);
    }
  }

  function typeInUnit(row, text, event) {
    const field = row.unit;
    if (text === " ") {
      // Partway through a multi-word unit ("cuillère à soupe"): the space is
      // part of it.
      const typed = field.value;
      if (typed && !typed.endsWith(" ") && !findUnit(typed) && isUnitPrefix(typed)) return;
      event?.preventDefault();
      const leftover = commitUnit(row);
      focusAt(row.name, 0);
      if (leftover) insertText(row.name, `${leftover} `);
      emit();
      return;
    }
    const next = field.value.slice(0, field.selectionStart) + text + field.value.slice(field.selectionEnd);
    if (isUnitPrefix(next)) {
      if (!event) insertText(field, text);
      return;
    }
    // No unit starts this way: what's been typed is the name's beginning.
    event?.preventDefault();
    field.value = "";
    commitUnit(row);
    focusAt(row.name, 0);
    insertText(row.name, next);
  }

  function typeInName(row, text, event) {
    // A number typed at the very start of a line without one is its quantity.
    const atStart = row.name.selectionStart === 0 && row.name.selectionEnd === 0;
    if (atStart && /^\d/.test(text) && !row.quantity.value && !row.unit.value) {
      event.preventDefault();
      focusAt(row.quantity, 0);
      insertText(row.quantity, text);
    }
  }

  listEl.addEventListener("beforeinput", (event) => {
    if (event.inputType !== "insertText" || !event.data) return;
    const row = rowOf(event.target);
    if (!row) return;
    const part = event.target.dataset.part;
    if (part === "quantity") typeInQuantity(row, event.data, event);
    else if (part === "unit") typeInUnit(row, event.data, event);
    else typeInName(row, event.data, event);
  });

  listEl.addEventListener("input", (event) => {
    const row = rowOf(event.target);
    if (!row) return;
    const part = event.target.dataset.part;
    if (part === "unit") row.unitKey = findUnit(row.unit.value)?.key ?? "";
    // "1 gousse" becomes "2 gousses" as the quantity changes.
    if (part === "quantity" && row.unitKey && document.activeElement !== row.unit) showUnit(row);
    // A name never spans lines: a pasted line break would hide the next line.
    if (part === "name" && row.name.value.includes("\n")) row.name.value = row.name.value.replace(/\s*\n\s*/g, " ");
    sync(row);
    emit();
  });

  // ---------------------------------------------------------------------
  // Moving around: a line's fields act as one for arrows and Backspace.
  // ---------------------------------------------------------------------
  /** The line's fields that hold text, in reading order, plus `keep`. */
  function filledFields(row, keep) {
    return PARTS.map((part) => row[part]).filter((field) => field === keep || field.value);
  }

  function focusPrevious(row, field) {
    const fields = filledFields(row, field);
    const index = fields.indexOf(field);
    if (index > 0) return focusAt(fields[index - 1], fields[index - 1].value.length);
    const previous = rows[rows.indexOf(row) - 1];
    if (previous) focusAt(previous.name, previous.name.value.length);
  }

  function focusNext(row, field) {
    const fields = filledFields(row, field);
    const index = fields.indexOf(field);
    if (index < fields.length - 1) return focusAt(fields[index + 1], 0);
    const next = rows[rows.indexOf(row) + 1];
    if (next) focusAt(filledFields(next, next.name)[0], 0);
  }

  /** Same kind of field on the line above or below. */
  function focusVertical(row, field, step) {
    const target = rows[rows.indexOf(row) + step];
    if (!target) return;
    const part = field.dataset.part === "name" || target[field.dataset.part].value ? field.dataset.part : "name";
    const position = Math.min(field.selectionStart, target[part].value.length);
    focusAt(target[part], position);
  }

  listEl.addEventListener("keydown", (event) => {
    const field = event.target;
    const row = rowOf(field);
    if (!row || event.isComposing) return;
    const atStart = field.selectionStart === 0 && field.selectionEnd === 0;
    const atEnd = field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
    // Up/Down move within a name that wraps, and between lines at its ends.
    const multiRow = field === row.name && row.name.clientHeight > parseFloat(getComputedStyle(row.name).lineHeight) * 1.5;

    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        const leftover = field === row.unit ? commitUnit(row) : "";
        if (leftover) row.name.value = [leftover, row.name.value].filter(Boolean).join(" ");
        const next = insertRow(EMPTY_LINE, rows.indexOf(row) + 1);
        focusAt(next.quantity, 0);
        emit();
        break;
      }
      case "Backspace": {
        if (!atStart) return;
        event.preventDefault();
        if (isEmptyLine(toLine(row)) && !row.unit.value && rows.length > 1) {
          const previous = rows[rows.indexOf(row) - 1] ?? rows[rows.indexOf(row) + 1];
          removeRow(row);
          focusAt(previous.name, previous.name.value.length);
          emit();
        } else {
          focusPrevious(row, field);
        }
        break;
      }
      case "ArrowLeft":
        if (!atStart) return;
        event.preventDefault();
        focusPrevious(row, field);
        break;
      case "ArrowRight":
        if (!atEnd) return;
        event.preventDefault();
        focusNext(row, field);
        break;
      case "ArrowUp":
        if (multiRow && !atStart) return;
        event.preventDefault();
        focusVertical(row, field, -1);
        break;
      case "ArrowDown":
        if (multiRow && !atEnd) return;
        event.preventDefault();
        focusVertical(row, field, 1);
        break;
      default:
    }
  });

  // Leaving a line settles it: a half-typed unit joins the name, an empty
  // line goes (one always stays).
  listEl.addEventListener("focusout", (event) => {
    const row = rowOf(event.target);
    if (!row || row.el.contains(event.relatedTarget)) return;
    const leftover = commitUnit(row);
    if (leftover) {
      row.name.value = [leftover, row.name.value].filter(Boolean).join(" ");
      sync(row);
      emit();
    }
    if (isEmptyLine(toLine(row)) && rows.length > 1) removeRow(row);
  });

  // A pasted list becomes lines; a single pasted line fills an empty one.
  listEl.addEventListener("paste", (event) => {
    const row = rowOf(event.target);
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!row || !text.trim()) return;
    const empty = isEmptyLine(toLine(row)) && !row.unit.value;

    if (/\n/.test(text.trim()) || empty) {
      event.preventDefault();
      const pasted = /\n/.test(text.trim()) ? parseIngredientText(text) : [parseIngredientLine(text)];
      let index = rows.indexOf(row);
      if (empty) removeRow(row);
      else index += 1;
      let last = null;
      for (const line of pasted) {
        last = insertRow(line, index);
        index += 1;
      }
      focusAt(last.name, last.name.value.length);
      emit();
    } else if (event.target === row.quantity && !QUANTITY_CHARS.test(text.trim())) {
      event.preventDefault();
    }
  });

  for (const line of lines.length ? lines : [EMPTY_LINE]) insertRow(line, rows.length);

  return {
    getLines,
    /** The lines as they read on screen, scaled or not. */
    getShownLines() {
      return rows
        .map((row) => ({ ...toLine(row), quantity: row.quantity.value.trim() }))
        .filter((line) => !isEmptyLine(line));
    },
    /** Shows quantities for `factor` times the people (.is-scaled), never
     * saved; null restores the recipe's own. */
    setScale(factor) {
      for (const row of rows) {
        if (row.saved !== undefined) {
          row.quantity.value = row.saved;
          delete row.saved;
        }
        const scaled = factor ? scaleQuantity(row.quantity.value, factor, row.unitKey, language) : null;
        if (scaled !== null) {
          row.saved = row.quantity.value;
          row.quantity.value = scaled;
        }
        row.quantity.parentElement.classList.toggle("is-scaled", scaled !== null);
        row.quantity.title = scaled !== null ? t("ingredient.savedQuantity", { quantity: row.saved }) : "";
        if (row.unitKey) showUnit(row);
        sync(row);
      }
    },
    /** Adds an empty line at the end and puts the caret in it. */
    addLine() {
      const last = rows[rows.length - 1];
      const row = isEmptyLine(toLine(last)) && !last.unit.value ? last : insertRow(EMPTY_LINE, rows.length);
      focusAt(row.quantity, 0);
    },
    /** Caret at the end of the last line. */
    focusEnd() {
      const last = rows[rows.length - 1];
      focusAt(last.name, last.name.value.length);
    },
  };
}
