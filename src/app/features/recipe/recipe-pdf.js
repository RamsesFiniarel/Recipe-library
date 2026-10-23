import { jsPDF } from "jspdf";
import { formatIngredientLine, isHeading } from "@shared/ingredients.js";
import { formatDuration } from "../../shared/utils/duration.js";
import { language, t, tn } from "../../shared/i18n/i18n.js";

/** The recipe as an A4 PDF laid out like its page, on its book's paper
 * colour: title, tags and servings, then ingredients left and steps right,
 * each column flowing onto the next page. Made in the browser with jsPDF's
 * standard fonts (module loaded on first download). */

const PAGE = { width: 210, height: 297 };
const MARGIN = { top: 22, side: 20, bottom: 22 };
const INGREDIENTS_WIDTH = 60;
const COLUMN_GAP = 12;
const STEPS_X = MARGIN.side + INGREDIENTS_WIDTH + COLUMN_GAP;
const STEPS_WIDTH = PAGE.width - MARGIN.side - STEPS_X;
const BOTTOM = PAGE.height - MARGIN.bottom;

const INK = [36, 31, 27];
const SOFT = [85, 76, 67];
const MUTED = [125, 114, 101];
const RULE = [216, 210, 200];

const PT_TO_MM = 25.4 / 72;
const BODY_SIZE = 10.5;
const BODY_LEADING = BODY_SIZE * PT_TO_MM * 1.5;

// The standard fonts cover Latin-1 plus Windows-1252's extras (œ, ’, –,
// €...); anything else is spelled out or dropped.
const WIN_ANSI_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const SPELLED_OUT = { "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "→": "->", "\t": " ", "\u202f": " ", "\u2009": " " };

function printable(text) {
  return [...String(text ?? "")]
    .map((char) => SPELLED_OUT[char] ?? char)
    .join("")
    .replace(/[^\n -ÿ]/gu, (char) => (WIN_ANSI_EXTRAS.includes(char) ? char : ""));
}

/** "Tarte aux pommes.pdf": the title, minus what a file name can't hold. */
function fileName(title) {
  const base = String(title).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${base || t("recipe.pdf.fileName")}.pdf`;
}

export function downloadRecipePdf({ title, bookTitle, pageColor, tags, servings, prepMinutes, ingredients, instructions }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setProperties({ title: printable(title), subject: printable(bookTitle), creator: "Cuisine" });

  // The book's paper, drawn first on every page.
  const paintPaper = () => {
    doc.setFillColor(pageColor);
    doc.rect(0, 0, PAGE.width, PAGE.height, "F");
  };
  paintPaper();

  const style = (font, fontStyle, size, color) => {
    doc.setFont(font, fontStyle);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };

  // --- Head: title, tags, servings and time, a rule -----------------------
  let y = MARGIN.top;
  style("times", "normal", 26, INK);
  const titleLines = doc.splitTextToSize(printable(title), PAGE.width - 2 * MARGIN.side);
  y += 26 * PT_TO_MM * 0.8;
  doc.text(titleLines, MARGIN.side, y, { lineHeightFactor: 1.15 });
  y += (titleLines.length - 1) * 26 * PT_TO_MM * 1.15;

  if (tags.length) {
    y += 7;
    style("times", "italic", 12.5, SOFT);
    doc.text(printable(tags.join(", ")), MARGIN.side, y);
  }

  const facts = [
    servings ? tn("count.person", servings) : null,
    prepMinutes ? t("recipe.pdf.prepTime", { time: formatDuration(prepMinutes) }) : null,
  ].filter(Boolean);
  if (facts.length) {
    y += tags.length ? 10 : 7;
    style("helvetica", "normal", 10, MUTED);
    // Side by side, a wide space between them.
    let x = MARGIN.side;
    for (const fact of facts) {
      doc.text(printable(fact), x, y);
      x += doc.getTextWidth(printable(fact)) + 10;
    }
  }

  y += 6;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN.side, y, PAGE.width - MARGIN.side, y);
  const columnsTop = y + 10;

  // --- Columns: each keeps its own place, page after page -----------------
  function column(x, width) {
    let page = 1;
    let cursor = columnsTop;
    return {
      x,
      width,
      /** Room for `height` more millimetres, on this page or the next. */
      reserve(height) {
        if (cursor + height > BOTTOM && cursor > MARGIN.top) {
          page += 1;
          cursor = MARGIN.top;
        }
        while (doc.getNumberOfPages() < page) {
          doc.addPage();
          paintPaper();
        }
        doc.setPage(page);
        const top = cursor;
        cursor += height;
        return top;
      },
      skip(height) {
        cursor += height;
      },
    };
  }

  function heading(col, label) {
    style("helvetica", "normal", 8.5, MUTED);
    const top = col.reserve(8);
    doc.text(label.toUpperCase(), col.x, top + 3, { charSpace: 0.6 });
  }

  /** Words laid out from `firstWidth` on the first line, full width after. */
  function wrap(text, firstWidth, width) {
    const lines = [];
    let line = "";
    let limit = firstWidth;
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && doc.getTextWidth(candidate) > limit) {
        lines.push(line);
        line = word;
        limit = width;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
    return lines;
  }

  // Ingredients: a dash, then the line; headings ("Pâte :") in italics, alone.
  const left = column(MARGIN.side, INGREDIENTS_WIDTH);
  if (ingredients.length) heading(left, t("recipe.ingredients"));
  ingredients.forEach((line, index) => {
    if (isHeading(line)) {
      if (index > 0) left.skip(2.5);
      style("times", "italic", 12, INK);
      const top = left.reserve(BODY_LEADING);
      doc.text(printable(line.name.replace(/\s*:\s*$/, "")), left.x, top + 3.6);
      return;
    }
    const dash = "–  ";
    style("helvetica", "normal", BODY_SIZE, MUTED);
    const dashWidth = doc.getTextWidth(dash);
    style("helvetica", "normal", BODY_SIZE, INK);
    const text = printable(formatIngredientLine(line, language));
    wrap(text, left.width - dashWidth, left.width).forEach((lineText, lineIndex) => {
      const top = left.reserve(BODY_LEADING);
      const baseline = top + 3.6;
      if (lineIndex === 0) {
        style("helvetica", "normal", BODY_SIZE, MUTED);
        doc.text(dash, left.x, baseline);
        style("helvetica", "normal", BODY_SIZE, INK);
        doc.text(lineText, left.x + dashWidth, baseline);
      } else {
        doc.text(lineText, left.x, baseline);
      }
    });
  });

  // Steps: one paragraph per line, full width without ingredients.
  const right = ingredients.length ? column(STEPS_X, STEPS_WIDTH) : column(MARGIN.side, PAGE.width - 2 * MARGIN.side);
  const paragraphs = printable(instructions).split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (paragraphs.length) heading(right, t("recipe.steps"));
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) right.skip(2.2);
    style("helvetica", "normal", BODY_SIZE, INK);
    for (const text of doc.splitTextToSize(paragraph, right.width)) {
      const top = right.reserve(BODY_LEADING);
      doc.text(text, right.x, top + 3.6);
    }
  });

  // --- Footer: the book, the page --------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    style("helvetica", "normal", 8, MUTED);
    const where = pages > 1 ? `${printable(bookTitle)}   ·   ${page} / ${pages}` : printable(bookTitle);
    doc.text(where, PAGE.width / 2, PAGE.height - 11, { align: "center" });
  }

  doc.save(fileName(title));
}
