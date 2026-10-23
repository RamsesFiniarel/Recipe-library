import { parseIngredientLine } from "../../shared/ingredients.js";
import { foldForSearch } from "../../shared/text.js";

/** A recipe from the text of its photos (read in the browser, see
 * recipe-photo-reader.js): positioned lines sorted into title, servings,
 * time, ingredients and steps. Layout does most of the work (columns, type
 * size, line edges), helped by what lines look like. Several photos read as
 * one recipe, in order; the text stays as printed. */

// Lines and blocks: { text, x, y, w, h }, from the top left, as shares of
// the page (0-1).

const BULLET = /^[\s,.;:•·\-–—*]+/;
const QUANTITY_FIRST = /^(\d|[½¼¾⅓⅔]|une?\s|quelques\s|a\s+pinch|pinch|une\s+pinc[ée]e)/i;
const startsWithQuantity = (text) => QUANTITY_FIRST.test(text.replace(BULLET, ""));
const MIXED_FRACTION = /(\d)\s*([½¼¾⅓⅔])/g;
const FRACTION_VALUES = { "½": 5, "¼": 25, "¾": 75, "⅓": 33, "⅔": 67 };

const INGREDIENT_HEADINGS = /^(ingr[ée]dients?|il (vous )?faut|what you('ll)? need)\s*:?$/i;
const STEP_HEADINGS = /^(étapes?|etapes?|pr[ée]paration|method|directions|instructions|steps?|d[ée]roul[ée])\s*:?$/i;
const NOTE_HEADINGS = /^(notes?|astuces?|conseils?|tips?|le conseil du chef)\s*:?$/i;
// A sub-list's name inside the ingredients ("Filling", "Pour la sauce :").
const SECTION_WORDS = /^(filling|topping|garnish|dough|glaze|crust|dressing|marinade|farce|garniture|p[âa]te|sauce|gla[çc]age|cr[èe]me|base)$/i;

const PEOPLE_WORDS = ["personnes", "personne", "pers", "portions", "parts", "convives", "couverts", "people", "persons", "servings"];
const TIME_WORDS = ["preparation", "prep", "cuisson", "cooking", "cook", "repos", "maceration", "marinade", "attente", "total", "temps", "time", "baking", "bake", "refrigeration", "rest"];
const DURATION = /(\d+(?:[.,]\d+)?)\s*(?:h|heures?|hrs?|hours?)(?![a-zà-ÿ])\s*(?:et\s+)?(\d{1,2})?\s*(?:mn|min(?:ute)?s?)?(?![a-zà-ÿ])|(\d+)\s*(?:mn|min(?:ute)?s?)(?![a-zà-ÿ])/gi;

// A title read less surely than this is likely a misread hand.
const TITLE_CONFIDENCE = 0.6;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** Edit distance, for words the OCR misread ("fertonnes", "Curion"). */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

const looksLike = (word, words) => {
  const folded = foldForSearch(word).replace(/[^a-z]/g, "");
  return folded.length >= 3 && words.some((target) => folded === target || (target.length >= 6 && distance(folded, target) <= 3));
};

// Mostly capitals (a printed list in capitals, a word added by hand).
const isAllCaps = (text) => {
  const letters = text.replace(/[^a-zà-ÿA-ZÀ-ß]/g, "");
  const capitals = letters.replace(/[^A-ZÀ-ß]/g, "");
  return letters.length >= 3 && capitals.length >= letters.length * 0.7;
};

const sentenceCase = (text) => {
  const lower = text.toLocaleLowerCase("fr");
  return lower.charAt(0).toLocaleUpperCase("fr") + lower.slice(1);
};

// --- Lines ---------------------------------------------------------------------

/** Lines worth reading: no cropped margin bits, page numbers or stray marks. */
function cleanLines(page) {
  return page.lines
    .map((line) => ({ ...line, text: line.text.replace(/\s+/g, " ").trim() }))
    .filter((line) => {
      if (!line.text || /^\d{1,3}$/.test(line.text)) return false;
      const atEdge = line.x < 0.012 || line.x + line.w > 0.988;
      if (atEdge && line.text.length <= 4) return false;
      return !(line.confidence < 0.4 && line.text.length < 4);
    })
    .map((line) => ({ ...line, cropped: line.x < 0.012 }));
}

/** "6/8 personnes", "Serves 2", "Pour 4 personnes" -> 6, 2, 4. */
function readServings(text) {
  const plain = text.replace(BULLET, "");
  const lead = plain.match(/^(?:serves|servings|portions|pour)\s*:?\s*(\d+)/i);
  if (lead) return Number(lead[1]);
  const counted = plain.match(/^(?:pour\s+)?(\d+)(?:\s*(?:\/|à|-|ou)\s*\d+)?\s+([a-zà-ÿ.]+)\s*:?$/i);
  return counted && looksLike(counted[2], PEOPLE_WORDS) ? Number(counted[1]) : null;
}

/** Minutes in a line giving only a time ("Cuisson 1 H 30 MN"), or null. */
function readTime(text) {
  const plain = text.replace(BULLET, "");
  if (plain.length > 45 || /[.!?]$/.test(plain)) return null;
  const words = plain.replace(DURATION, " ").split(/[\s:]+/).filter((word) => /[a-zà-ÿ]{2}/i.test(word));
  // Only a time, a word saying what it's for, or a short line ending on a
  // time (its first words misread).
  const endsOnTime = plain.length <= 30 && words.length <= 3 && new RegExp(`(?:${DURATION.source})\\s*$`, "i").test(plain);
  if (!endsOnTime && (words.length > 2 || (words.length && !looksLike(words[0], TIME_WORDS)))) return null;
  let minutes = 0;
  for (const [, hours, extra, alone] of plain.matchAll(DURATION)) {
    minutes += hours ? Math.round(Number(hours.replace(",", ".")) * 60) + Number(extra ?? 0) : Number(alone);
  }
  return minutes || null;
}

// --- Blocks ---------------------------------------------------------------------

/** Lines grouped into blocks: runs of close lines in a column, starting at
 * about the same x. */
function buildBlocks(lines, lineHeight) {
  const blocks = [];
  for (const line of [...lines].sort((a, b) => a.y - b.y)) {
    const candidates = blocks.filter((block) => {
      const below = line.y - block.bottom;
      if (below > lineHeight * 0.9 || line.y < block.top - lineHeight * 0.5) return false;
      const overlap = Math.min(line.x + line.w, block.right) - Math.max(line.x, block.left);
      return Math.abs(line.x - block.left) <= 0.035 || (line.x > block.left && line.x < block.left + 0.06 && overlap > line.w * 0.5);
    });
    const block = candidates.sort((a, b) => Math.abs(line.x - a.left) - Math.abs(line.x - b.left))[0];
    if (block) {
      block.lines.push(line);
      block.left = Math.min(block.left, line.x);
      block.right = Math.max(block.right, line.x + line.w);
      block.bottom = Math.max(block.bottom, line.y + line.h);
    } else {
      blocks.push({ lines: [line], left: line.x, right: line.x + line.w, top: line.y, bottom: line.y + line.h });
    }
  }
  return blocks;
}

/** A block's kind ("ingredients", "steps", "note", "title", "other"), from
 * its heading, else from its lines. */
function classify(block, lineHeight) {
  const first = block.lines[0].text.replace(BULLET, "");
  if (INGREDIENT_HEADINGS.test(first)) return { kind: "ingredients", headed: true };
  if (STEP_HEADINGS.test(first)) return { kind: "steps", headed: true };
  if (NOTE_HEADINGS.test(first)) return { kind: "note", headed: true };

  const texts = block.lines.map((line) => line.text);
  const average = texts.reduce((sum, text) => sum + text.length, 0) / texts.length;
  const quantities = texts.filter(startsWithQuantity).length / texts.length;
  const sentences = texts.filter((text) => /[.!]$/.test(text)).length / texts.length;
  const height = median(block.lines.map((line) => line.h));

  if (block.lines.length <= 3 && height >= lineHeight * 1.5 && quantities === 0) return { kind: "title" };
  if (average > 40 || (sentences >= 0.4 && average > 25)) return { kind: "steps" };
  if (quantities >= 0.3) return { kind: "ingredients" };
  return { kind: "other" };
}

/** List pieces set apart by a wider gap go back into the ingredient block
 * above in the same column; a lone sub-list name ("Bouquet garni :") into
 * the one below. */
function joinLists(blocks, lineHeight) {
  const sameColumn = (a, b) => Math.abs(a.left - b.left) <= 0.035;
  for (const heading of blocks) {
    const last = heading.lines[heading.lines.length - 1];
    if (heading.kind !== "other" || !/:$/.test(last.text)) continue;
    const below = blocks.find(
      (block) =>
        block.kind === "ingredients" &&
        sameColumn(block, heading) &&
        block.top - heading.bottom >= 0 &&
        block.top - heading.bottom <= lineHeight * 3
    );
    if (!below) continue;
    below.lines.unshift(...heading.lines);
    below.top = heading.top;
    heading.lines = [];
  }

  const joined = [];
  for (const block of [...blocks].filter((block) => block.lines.length).sort((a, b) => a.top - b.top)) {
    const shortLines = block.lines.every((line) => line.text.length <= 45 && !/[.!]$/.test(line.text));
    const above = joined.find(
      (other) =>
        other.kind === "ingredients" &&
        Math.abs(other.left - block.left) <= 0.035 &&
        block.top - other.bottom >= 0 &&
        block.top - other.bottom <= lineHeight * 3
    );
    if (above && !block.headed && (block.kind === "ingredients" || (block.kind === "other" && shortLines))) {
      above.lines.push(...block.lines);
      above.right = Math.max(above.right, block.right);
      above.bottom = Math.max(above.bottom, block.bottom);
    } else {
      joined.push(block);
    }
  }
  return joined;
}

// Reading order: side by side, left first; otherwise top first.
function readingOrder(a, b) {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (overlap > Math.min(a.bottom - a.top, b.bottom - b.top) * 0.3) return a.left - b.left;
  return a.top - b.top;
}

// --- Content ---------------------------------------------------------------------

/** A block's ingredient lines: no bullets, capitals lowered, wrapped lines
 * joined, sub-list names as headings. */
function ingredientRows(block) {
  const width = block.right - block.left;
  const rows = [];
  for (const line of block.lines) {
    const raw = line.text.replace(BULLET, "").trim();
    if (!raw) continue;
    const previous = rows[rows.length - 1];
    // A wrapped line: lower case or a bracket, after a line that ran on.
    if (
      previous &&
      !previous.heading &&
      /^[a-zà-ÿ(]/.test(raw) &&
      (/,$/.test(previous.text) || previous.width >= width * 0.75)
    ) {
      previous.text = `${previous.text} ${raw}`;
      previous.width = width;
      continue;
    }
    const text = (isAllCaps(raw) ? raw.toLocaleLowerCase("fr") : raw).replace(
      MIXED_FRACTION,
      (_, whole, fraction) => `${whole},${FRACTION_VALUES[fraction]}`
    );
    const heading =
      !startsWithQuantity(text) && (/:$/.test(text) || /^(pour|for)\s/i.test(text) || SECTION_WORDS.test(text));
    rows.push({ text, heading, width: line.w });
  }
  return rows.map(({ text, heading }) =>
    heading
      ? { quantity: "", unit: "", name: `${sentenceCase(text.replace(/\s*:$/, ""))} :` }
      : parseIngredientLine(text)
  );
}

/** A block's text as paragraphs: new at a bullet, a number, a gap or after
 * a short sentence-ending line; hyphenated words joined. */
function paragraphs(block, lineHeight, prefix = "") {
  const width = block.right - block.left;
  const result = [];
  let previous = null;
  for (const line of block.lines) {
    const marked = /^([-–•·*]|\d+[.)]|étape\s*\d+\s*:?)\s+/i.test(line.text);
    const text = line.text.replace(/^([-–•·*]|étape\s*\d+\s*:?)\s+/i, "");
    const startsNew =
      !previous ||
      marked ||
      line.y - (previous.y + previous.h) > lineHeight * 0.6 ||
      (/[.!:]$/.test(previous.text) && previous.w < width * 0.8);
    if (startsNew) {
      result.push(text);
    } else {
      const last = result.length - 1;
      result[last] = /[a-zà-ÿ]-$/.test(result[last]) && /^[a-zà-ÿ]/.test(text)
        ? result[last].slice(0, -1) + text
        : `${result[last]} ${text}`;
    }
    previous = line;
  }
  if (prefix && result.length) result[0] = `${prefix}${result[0]}`;
  return result;
}

const cleanTitle = (text) => {
  const plain = text
    .replace(/\((cont\.?|continued|suite)\)/gi, "")
    .replace(/[\s:;,.-]+$/, "")
    .trim();
  return isAllCaps(plain) ? sentenceCase(plain) : plain;
};

/** The recipe in the photos' text: { title (or null), servings, prepMinutes
 * (all times added up), ingredients, instructions (a paragraph per line) }. */
export function parseRecipePages(pages) {
  let title = null;
  let titleScore = 0;
  let servings = null;
  let prepMinutes = null;
  const ingredients = [];
  const steps = [];

  for (const page of pages) {
    const lines = cleanLines(page);
    if (!lines.length) continue;
    const lineHeight = median(lines.filter((line) => line.text.length >= 4).map((line) => line.h)) || 0.02;

    // Servings and times first: short lines of their own.
    const rest = [];
    for (const line of lines) {
      const people = readServings(line.text);
      const minutes = people === null ? readTime(line.text) : null;
      if (people !== null) servings ??= people;
      else if (minutes !== null) prepMinutes = (prepMinutes ?? 0) + minutes;
      else rest.push(line);
    }

    const blocks = joinLists(
      buildBlocks(rest, lineHeight)
        // Text cut off by the frame (the end of a facing page) says nothing.
        .filter((block) => !block.lines.every((line) => line.cropped))
        .map((block) => ({ ...block, ...classify(block, lineHeight) })),
      lineHeight
    );
    for (const block of blocks.filter((candidate) => candidate.kind === "title")) {
      // The biggest type near the top, uncropped and read with confidence (not a
      // misread handwritten word).
      const score = median(block.lines.map((line) => line.h)) / lineHeight - block.top;
      const sure = median(block.lines.map((line) => line.confidence)) >= TITLE_CONFIDENCE;
      if (!sure || block.lines.some((line) => line.cropped) || block.top > 0.5 || score <= titleScore) continue;
      title = cleanTitle(block.lines.map((line) => line.text).join(" "));
      titleScore = score;
    }

    for (const block of blocks.sort(readingOrder)) {
      const body = block.headed ? { ...block, lines: block.lines.slice(1) } : block;
      if (!body.lines.length) continue;
      if (block.kind === "ingredients") ingredients.push(...ingredientRows(body));
      else if (block.kind === "steps") steps.push(...paragraphs(body, lineHeight));
      else if (block.kind === "note") steps.push(...paragraphs(body, lineHeight, "Note : "));
    }
  }

  return { title, servings, prepMinutes, ingredients, instructions: steps.join("\n") };
}
