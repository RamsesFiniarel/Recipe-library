import { parse, parseFragment } from "parse5";
import { findUnit, parseIngredientLine } from "../../shared/ingredients.js";
import { foldForSearch } from "../../shared/text.js";

/** A recipe out of a web page: title, servings, time, ingredient lines and
 * steps. Read first from the schema.org data most sites publish (JSON-LD or
 * microdata), then from lists named after ingredients or instructions,
 * then from the lines under "Ingrédients" / "Préparation" headings. The
 * text is kept as written. */

// --- The page ----------------------------------------------------------------

// Never text of the page.
const SKIPPED = new Set(["script", "style", "noscript", "template", "svg", "iframe", "button", "select", "textarea"]);
const BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl", "dt", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
  "section", "summary", "table", "td", "th", "tr", "ul",
]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
// Around the content, never in it.
const SURROUNDINGS = new Set(["nav", "footer", "aside"]);
// Deeper than this, nothing is read (browsers stop nesting at 512).
const MAX_DEPTH = 400;

const attribute = (node, name) => node.attrs?.find((attr) => attr.name === name)?.value;
const children = (node) => node.content?.childNodes ?? node.childNodes ?? [];
const space = (text) => text.replace(/[\s\u200b]+/g, " ").trim();

function* descendants(node, depth = 0) {
  if (depth > MAX_DEPTH) return;
  for (const child of children(node)) {
    if (!child.tagName) continue;
    yield child;
    if (!SKIPPED.has(child.tagName)) yield* descendants(child, depth + 1);
  }
}

/** The node's text as lines: a new one at each block, list item or <br>. */
function textLines(node) {
  const lines = [];
  let line = "";
  const cut = () => {
    if (space(line)) lines.push(space(line));
    line = "";
  };
  (function walk(current, depth) {
    if (depth > MAX_DEPTH) return;
    for (const child of children(current)) {
      if (child.nodeName === "#text") line += child.value;
      else if (child.tagName && !SKIPPED.has(child.tagName)) {
        const block = BLOCKS.has(child.tagName);
        if (block) cut();
        walk(child, depth + 1);
        if (block) cut();
      }
    }
  })(node, 0);
  cut();
  return lines;
}

/** The node's text on one line (an ingredient spread over elements). */
const inlineText = (node) => textLines(node).join(" ");

const classes = (node) => `${attribute(node, "class") ?? ""} ${attribute(node, "id") ?? ""}`;

// --- Text ----------------------------------------------------------------------

/** Structured-data text, possibly HTML or (doubly) escaped, as lines. */
function htmlLines(value) {
  let text = String(value ?? "");
  for (let pass = 0; pass < 2 && /<[a-z/!]|&(#\d+|#x[\da-f]+|[a-z]+);/i.test(text); pass += 1) {
    const lines = textLines(parseFragment(text));
    text = lines.join("\n");
  }
  return text.split(/\n+/).map(space).filter(Boolean);
}

const htmlText = (value) => htmlLines(value).join(" ");

const INGREDIENT_HEADING =
  /^(les\s+)?(ingr[ée]dients?|zutaten|ingredienti|ingredientes|il (vous )?faut|what you('ll)? need)\b[^.]{0,60}$/i;
const STEP_HEADING =
  /^(la\s+)?(pr[ée]paration|recette|r[ée]alisation|[ée]tapes?|instructions?|directions?|method|steps|how to make( it)?|zubereitung|preparazione|procedimento|preparaci[óo]n|elaboraci[óo]n)(\s+(pour|for)\b[^.]{0,60})?\s*:?$/i;
// Where a recipe's lists end.
const END_HEADING =
  /^(notes?|astuces?|conseils?|tips?|nutrition|informations nutritionnelles|commentaires?|comments?|reviews?|avis|partager|share|vid[ée]o|related|[àa] lire aussi|vous aimerez aussi)\b/i;

// A step's number, said again before its text ("Étape 2", "3.").
const STEP_NUMBER = /^((é|e)tape|step|schritt|passo|paso)\s*\d+\s*[:.\-–]?\s*|^\d{1,2}\s*[.)]\s+/i;

/** Step lines without their numbers, sentences run together by a site
 * ("le lait.Dans une") split apart. */
function stepLines(lines) {
  return lines.flatMap((line) => {
    const runTogether = (line.match(/[a-zà-ÿ0-9)][.!?][A-ZÀ-Ý]/g) ?? []).length >= 2;
    const parts = runTogether
      ? line.split(/(?<=[.!?])(?=[A-ZÀ-Ý])|(?<=[a-zà-ÿ])(?=[A-ZÀ-Ý][a-zà-ÿ])/)
      : [line];
    return parts.map((part) => space(part.replace(STEP_NUMBER, ""))).filter((part) => part && !/^\d+$/.test(part));
  });
}

const UNICODE_FRACTIONS = { "½": 1 / 2, "¼": 1 / 4, "¾": 3 / 4, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8 };
const decimal = (value) => String(Math.round(value * 100) / 100).replace(".", ",");

// Quantity after the name: "Oignons - 50 grammes", "Farine : 250 g",
// "Farina 00 300 g".
const QUANTITY_AFTER = /^(\D.*?)\s+[-–:]\s+(\d.{0,30})$/;
const NUMBER_LAST = /^(\D.*?)\s+(\d+(?:[.,]\d+)?(?:\/\d+)?)\s*([^\d\s]{1,12})?$/;

/** An ingredient text as an editor line: no bullet, mixed numbers ("1 1/2",
 * "1½") as one quantity, quantity first. Ending with ":" = sub-heading. */
function ingredientLine(text) {
  // A line, not a page (the name keeps 500 characters anyway).
  let tidy = space(text.slice(0, 1000))
    .replace(/^[\s▢☐□✓✔•·*–—-]+/, "")
    .replace(/\u2044/g, "/")
    .replace(/\(\(([^()]*)\)\)/g, "($1)")
    .replace(/\(\s*[,;]?\s*/g, "(")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/(\d)\s*([½¼¾⅓⅔⅛⅜⅝⅞])/g, (_, whole, fraction) => decimal(Number(whole) + UNICODE_FRACTIONS[fraction]))
    .replace(/^(\d+)\s+(\d+)\s*\/\s*(\d+)(?!\d)/, (_, whole, top, bottom) => decimal(Number(whole) + top / bottom))
    .replace(/^[⅛⅜⅝⅞]/, (fraction) => decimal(UNICODE_FRACTIONS[fraction]));
  // The end of a sentence ("...," "...(pour la liaison).") - not of "q.b.".
  tidy = tidy.replace(/[,;]+$|(?<![\s.]\p{L})(?<!\.)\.$/u, "");
  const after = QUANTITY_AFTER.exec(tidy);
  const last = NUMBER_LAST.exec(tidy);
  if (after) tidy = `${after[2]} ${after[1]}`;
  else if (last && (!last[3] || findUnit(last[3]))) tidy = [last[2], last[3], last[1]].filter(Boolean).join(" ");
  const line = parseIngredientLine(tidy);
  if (!line.quantity && /:$/.test(line.name)) line.name = line.name.replace(/\s*:$/, " :");
  return line;
}

// --- Servings and times --------------------------------------------------------

const SERVING_WORDS =
  "personnes?|pers\\.?|portions?|parts?|couverts?|convives|servings?|serving\\(s\\)|people|persons?|personen|portionen|persone|porzioni|raciones|porciones";
const COUNTED_SERVINGS = new RegExp(`(\\d{1,3})(?:\\s*(?:-|–|à|to|ou|or)\\s*\\d+)?\\s*(?:${SERVING_WORDS})\\b`, "i");
const LEAD_SERVINGS = /\b(?:serves|pour|für|per)\s*:?\s*(\d{1,3})\b/i;
// A line that only gives them.
const SERVINGS_LINE = new RegExp(
  `^(?:(?:pour|for|serves|für|per)\\s+(\\d{1,3})(?:\\s*(?:${SERVING_WORDS}))?|(\\d{1,3})\\s*(?:${SERVING_WORDS}))$`,
  "i"
);

/** Servings in a "yield": a plain number, or one next to a word for people
 * (never "12 muffins"). */
function readServings(value) {
  for (const item of [value].flat()) {
    const text = typeof item === "number" ? String(item) : typeof item === "string" ? htmlText(item) : "";
    const count = /^\s*(\d{1,3})\s*$/.exec(text)?.[1] ?? COUNTED_SERVINGS.exec(text)?.[1] ?? LEAD_SERVINGS.exec(text)?.[1];
    if (count && Number(count) >= 1) return Number(count);
  }
  return null;
}

const ISO_DURATION =
  /^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:(\d+)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i;
const number = (text) => Number(String(text ?? 0).replace(",", "."));

/** Minutes in an ISO 8601 ("PT1H30M") or written ("1 h 15") duration. */
function readMinutes(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const iso = ISO_DURATION.exec(text);
  if (iso) {
    const [, days, hours, minutes, seconds] = iso;
    return Math.round(number(days) * 1440 + number(hours) * 60 + number(minutes) + number(seconds) / 60);
  }
  const hours = /(\d+(?:[.,]\d+)?)\s*(?:h|heures?|hours?|hrs?|std\.?|stunden?|ore?)\b\s*(\d{1,2})?/i.exec(text);
  const minutes = /(\d+)\s*(?:min|mn|minutes?|minuten|minuti)\b/i.exec(text);
  if (hours) return Math.round(number(hours[1]) * 60) + Number(hours[2] ?? minutes?.[1] ?? 0);
  return minutes ? Number(minutes[1]) : 0;
}

// --- Structured data -----------------------------------------------------------

const isRecipeType = (type) => typeof type === "string" && /(^|[/:])Recipe$/i.test(type);
const typesOf = (node) => [node?.["@type"] ?? []].flat();

/** A JSON-LD block as data, tolerating surrounding comments and raw line
 * breaks or tabs in strings. */
function parseJson(text) {
  const body = text.trim().replace(/^<!--|-->$/g, "").replace(/^\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>$/g, "");
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(body.replace(/[\n\r\t]+/g, " "));
    } catch {
      return null;
    }
  }
}

/** Every recipe in the JSON-LD blocks, however nested. */
function jsonLdRecipes(blocks) {
  const recipes = [];
  const visit = (value, depth) => {
    if (!value || typeof value !== "object" || depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typesOf(value).some(isRecipeType)) recipes.push(value);
    else for (const item of Object.values(value)) visit(item, depth + 1);
  };
  for (const block of blocks) visit(parseJson(block), 0);
  return recipes;
}

/** Steps from recipeInstructions (text, HTML, HowToStep, HowToSection as a
 * heading after a blank line, or lists of these); multi-paragraph steps are
 * separated by blank lines. */
function instructionLines(value, depth = 0) {
  if (value == null || depth > 6) return [];
  if (typeof value === "string") return stepLines(htmlLines(value));
  if (Array.isArray(value)) {
    const steps = value.map((item) => instructionLines(item, depth + 1));
    const spaced = steps.some((lines) => lines.length > 1 && lines[0] !== "");
    return steps.flatMap((lines) => (spaced && lines[0] !== "" ? ["", ...lines] : lines));
  }
  if (typeof value !== "object") return [];
  if (typesOf(value).includes("HowToSection") || (value.itemListElement && !value.text)) {
    const steps = instructionLines(value.itemListElement, depth + 1).filter(Boolean);
    const name = htmlText(value.name).replace(/\s*:$/, "");
    // A part named like the whole ("Zubereitung") says nothing.
    return name && steps.length && !STEP_HEADING.test(name) ? ["", `${name} :`, ...steps] : steps;
  }
  return instructionLines(value.text ?? value.description ?? value.name, depth + 1);
}

// The list's own title, sometimes among its items.
const LIST_TITLE = /^(les\s+)?(ingr[ée]dients?|zutaten|ingredienti|ingredientes)\s*:?$/i;

const ingredientItems = (value) =>
  [value ?? []]
    .flat()
    .flatMap((item) => (typeof item === "string" ? htmlLines(item) : []))
    .filter((text) => !LIST_TITLE.test(text))
    .map((text) => ({ text }));

function fromJsonLd(recipe) {
  const prep = readMinutes(recipe.prepTime) + readMinutes(recipe.cookTime);
  return {
    name: htmlText(recipe.name ?? recipe.headline),
    servings: readServings(recipe.recipeYield ?? recipe.yield),
    // The sum when the total is smaller (it left out the cooking).
    minutes: Math.max(readMinutes(recipe.totalTime), prep),
    ingredients: ingredientItems(recipe.recipeIngredient ?? recipe.ingredients),
    steps: instructionLines(recipe.recipeInstructions),
  };
}

// A microdata property's value.
function propertyValue(node, name) {
  const value =
    attribute(node, "content") ??
    (node.tagName === "time" ? attribute(node, "datetime") : undefined) ??
    (node.tagName === "data" || node.tagName === "meter" ? attribute(node, "value") : undefined);
  if (value !== undefined) return [value];
  return name === "recipeInstructions" ? textLines(node) : [inlineText(node)];
}

const MICRODATA_PROPERTIES = new Set([
  "name", "recipeIngredient", "ingredients", "recipeInstructions", "recipeYield", "totalTime", "prepTime", "cookTime",
]);

/** The same as fromJsonLd(), from a Recipe item marked up in the page. */
function fromMicrodata(root) {
  const values = Object.fromEntries([...MICRODATA_PROPERTIES].map((name) => [name, []]));
  (function walk(node, depth) {
    if (depth > MAX_DEPTH) return;
    for (const child of children(node)) {
      if (!child.tagName || SKIPPED.has(child.tagName)) continue;
      const names = (attribute(child, "itemprop") ?? "").split(/\s+/).filter((name) => MICRODATA_PROPERTIES.has(name));
      for (const name of names) values[name].push(...propertyValue(child, name));
      // A nested item's properties are its own (a step's, a rating's).
      if (!names.length && attribute(child, "itemscope") === undefined) walk(child, depth + 1);
    }
  })(root, 0);
  return fromJsonLd({
    name: values.name[0],
    recipeYield: values.recipeYield,
    totalTime: values.totalTime[0],
    prepTime: values.prepTime[0],
    cookTime: values.cookTime[0],
    recipeIngredient: [...values.recipeIngredient, ...values.ingredients],
    recipeInstructions: values.recipeInstructions,
  });
}

// --- The page's own lists ------------------------------------------------------

const count = (items) => items.filter((item) => !item.heading).length;

const INGREDIENT_CLASS = /ingr[ée]dient|zutat/i;
const STEP_CLASS = /instruction|direction|preparation|method|steps?\b|[ée]tapes?|zubereitung|preparazione|procedimento/i;
// A list's sub-heading ("Pour la sauce", "Filling").
const GROUP_CLASS = /group-?name|group-?title|heading|header|subtitle|title/i;

const leafItems = (container) =>
  [...descendants(container)].filter((node) => node.tagName === "li" && ![...descendants(node)].some((inner) => inner.tagName === "li"));

const isInside = (node, ancestor) => {
  for (let current = node.parentNode; current; current = current.parentNode) if (current === ancestor) return true;
  return false;
};

/** The innermost element named after ingredients holding the most list
 * items (2 or more). */
function ingredientList(page) {
  let best = null;
  let bestCount = 1;
  for (const node of page.named) {
    const named = classes(node);
    if (!INGREDIENT_CLASS.test(named) || STEP_CLASS.test(named)) continue;
    const count = leafItems(node).length;
    if (count > bestCount || (best && count === bestCount && isInside(node, best))) {
      best = node;
      bestCount = count;
    }
  }
  return best;
}

/** The page's ingredient list with its sub-headings: [{ text, heading }]. */
function pageIngredients(page) {
  const container = ingredientList(page);
  if (!container) return [];
  const items = [];
  (function walk(node, depth) {
    if (depth > MAX_DEPTH) return;
    for (const child of children(node)) {
      if (!child.tagName || SKIPPED.has(child.tagName)) continue;
      const isItem = child.tagName === "li" && ![...descendants(child)].some((inner) => inner.tagName === "li");
      if (isItem) {
        const text = inlineText(child);
        if (text) items.push({ text });
        continue;
      }
      const isGroup =
        (HEADINGS.has(child.tagName) || GROUP_CLASS.test(classes(child))) &&
        ![...descendants(child)].some((inner) => inner.tagName === "li");
      if (isGroup) {
        const text = inlineText(child).replace(/\s*:$/, "");
        // The list's own title, or a choice of measures, isn't a group.
        if (text && text.length <= 80 && !INGREDIENT_HEADING.test(text) && !/\b(us|metric|imperial|cups?)\b.*\b(us|metric|imperial)\b/i.test(text)) {
          items.push({ text, heading: true });
        }
        continue;
      }
      walk(child, depth + 1);
    }
  })(container, 0);
  return items;
}

/** The steps in an element named after them (Jetpack, h-recipe...). */
function pageSteps(page) {
  let best = null;
  let bestLength = 0;
  for (const node of page.named) {
    const named = classes(node);
    // Not the times ("recipe-preparation-time").
    if (!STEP_CLASS.test(named) || INGREDIENT_CLASS.test(named) || /time|temps|dur[ée]e|duration/i.test(named)) continue;
    const length = inlineText(node).length;
    if (length > bestLength && length < 20000) {
      best = node;
      bestLength = length;
    }
  }
  const lines = best ? textLines(best).filter((line) => !STEP_HEADING.test(line)) : [];
  // Sentences, not labels.
  return lines.some((line) => line.length >= 40) ? stepLines(lines) : [];
}

/** The page's lines as { text, level (1-6 for h1-h6, else 0), item, bold },
 * skipping navigation and footers. A blank line in text also breaks a line
 * (pages typed without tags). */
function pageLines(body) {
  const lines = [];
  let text = "";
  let bold = false;
  const cut = (kind) => {
    // Not a wiki's "[modifier]" links.
    if (space(text) && !/^\[[^\]]*\]$/.test(space(text))) {
      lines.push({ text: space(text), level: 0, item: false, bold, ...kind });
    }
    text = "";
    bold = false;
  };
  (function walk(node, inItem, depth) {
    if (depth > MAX_DEPTH) return;
    for (const child of children(node)) {
      if (child.nodeName === "#text") {
        for (const [index, part] of child.value.split(/\n[^\S\n]*\n\s*/).entries()) {
          if (index) cut({ item: inItem });
          if (space(part)) bold = false;
          text += part;
        }
      }
      if (!child.tagName || SKIPPED.has(child.tagName) || SURROUNDINGS.has(child.tagName)) continue;
      if (child.tagName === "strong" || child.tagName === "b") {
        const atStart = !space(text);
        walk(child, inItem, depth + 1);
        if (atStart && space(text)) bold = true;
        continue;
      }
      if (HEADINGS.has(child.tagName)) {
        cut({ item: inItem });
        text = inlineText(child);
        cut({ level: Number(child.tagName[1]) });
        continue;
      }
      const block = BLOCKS.has(child.tagName);
      const item = inItem || child.tagName === "li";
      if (block) cut({ item: inItem });
      walk(child, item, depth + 1);
      if (block) cut({ item });
    }
  })(body, false, 0);
  cut({});
  return lines;
}

const isHeadingLine = (line, pattern) => line.text.length <= 80 && pattern.test(line.text.replace(/\s*:$/, ""));

/** The lines after `start`, up to the next heading of the same or higher
 * level (kept if it names the same part, `same`) or a heading of another
 * part. */
function section(lines, start, same) {
  const level = lines[start].level || 7;
  const others = [INGREDIENT_HEADING, STEP_HEADING, END_HEADING].filter((pattern) => pattern !== same);
  const taken = [];
  for (const line of lines.slice(start + 1, start + 200)) {
    if (others.some((pattern) => isHeadingLine(line, pattern))) break;
    if (line.level && line.level <= level && !isHeadingLine(line, same)) break;
    taken.push(line);
  }
  return taken;
}

/** Ingredients and steps under "Ingrédients" / "Préparation" headings,
 * for pages without structured data. */
function headedSections(page) {
  const lines = page.lines;
  let ingredients = [];
  let ingredientsEnd = 0;
  let servings = null;
  for (const [index, line] of lines.entries()) {
    if (!isHeadingLine(line, INGREDIENT_HEADING)) continue;
    const taken = section(lines, index, INGREDIENT_HEADING);
    // Sub-heading: a heading, or a short bold line or one ending with ":".
    const isGroup = (entry) =>
      entry.level || (!entry.item && entry.text.length <= 60 && !/^\d/.test(entry.text) && (entry.bold || /:$/.test(entry.text)));
    const items = taken.some((entry) => entry.item) ? taken.filter((entry) => entry.item || isGroup(entry)) : taken;
    const rows = items.filter((entry) => !isGroup(entry));
    // Ingredients, not paragraphs ("Ingrédients et préparation").
    const short = rows.filter((entry) => entry.text.length <= 80 || (entry.text.length <= 150 && /^\d/.test(entry.text)));
    if (short.length >= rows.length * 0.6 && rows.length > count(ingredients)) {
      ingredients = items.map((entry) =>
        isGroup(entry) ? { text: entry.text.replace(/\s*:$/, ""), heading: true } : { text: entry.text }
      );
      ingredientsEnd = index + taken.length;
      servings = readServings(line.text);
    }
  }
  const stepsAt = lines.findIndex((line, index) => index >= ingredientsEnd && isHeadingLine(line, STEP_HEADING));
  // Its sub-headings ("Cuisson") as a part's, a blank line before.
  const steps =
    stepsAt >= 0
      ? section(lines, stepsAt, STEP_HEADING).flatMap((line) => {
          if (!line.level) return stepLines([line.text]);
          // "Étape 2": a blank line is enough.
          return STEP_NUMBER.test(`${line.text} `) && !space(line.text.replace(STEP_NUMBER, "")) ? [""] : ["", `${line.text.replace(/\s*:$/, "")} :`];
        })
      : [];
  return { ingredients: ingredients.length >= 2 ? ingredients : [], steps, servings };
}

// "Temps de cuisson : 120 min", "Nombre de personnes : 6" on pages without
// data.
const FACT_TIME =
  /^(?:temps\s+(?:de\s+)?)?(pr[ée]paration|cuisson|repos|total|prep(?:aration)?|cook(?:ing)?)(?:\s+time)?\s*:\s*(.{1,30})$/i;
const FACT_SERVINGS = /^(?:nombre de personnes|combien de personnes|personnes|portions|servings|serves|yield)\s*:\s*(\d{1,3})\b/i;

/** Servings and minutes from such lines (each time counted once). */
function pageFacts(lines) {
  let servings = null;
  const times = new Map();
  for (const [index, line] of lines.entries()) {
    // The value may be on the next line ("Combien de personnes :", "2").
    const text = /:$/.test(line.text) && lines[index + 1] ? `${line.text} ${lines[index + 1].text}` : line.text;
    // "Ingrédients (pour 6 personnes)".
    if (isHeadingLine(line, INGREDIENT_HEADING)) servings ??= readServings(line.text);
    if (text.length > 60) continue;
    const people = FACT_SERVINGS.exec(text);
    if (people) servings ??= Number(people[1]);
    const time = FACT_TIME.exec(text);
    if (!time) continue;
    const kind = /total/i.test(time[1]) ? "total" : /cuisson|cook/i.test(time[1]) ? "cook" : /repos/i.test(time[1]) ? "rest" : "prep";
    if (!times.has(kind)) times.set(kind, readMinutes(time[2]));
  }
  const total = times.get("total") ?? 0;
  times.delete("total");
  return { servings, minutes: Math.max(total, [...times.values()].reduce((sum, minutes) => sum + minutes, 0)) };
}

function readPage(html) {
  const document = parse(html);
  const page = { jsonLd: [], microdata: [], named: [], titles: {}, body: null };
  for (const node of descendants(document)) {
    if (node.tagName === "script" && /ld\+json/i.test(attribute(node, "type") ?? "")) {
      page.jsonLd.push(children(node).map((child) => child.value ?? "").join(""));
    } else if (/schema\.org\/Recipe$/i.test(attribute(node, "itemtype") ?? "")) {
      page.microdata.push(node);
    }
    if (INGREDIENT_CLASS.test(classes(node)) || STEP_CLASS.test(classes(node))) page.named.push(node);
    if (node.tagName === "body") page.body = node;
    if (node.tagName === "h1") page.titles.h1 ??= inlineText(node);
    if (node.tagName === "meta" && attribute(node, "property") === "og:title") page.titles.og ??= attribute(node, "content");
    if (node.tagName === "title") page.titles.title ??= inlineText(node);
  }
  page.lines = page.body ? pageLines(page.body) : [];
  return page;
}

// --- The recipe ----------------------------------------------------------------

/** The recipe's title: the page heading when the data's name only extends it
 * ("…: la meilleure recette", "… von Safino13"), without "Recette de" or
 * a trailing "recipe". */
function recipeTitle(name, titles) {
  const heading = space(titles.h1 ?? "");
  let title = space(name ?? "");
  if (heading && (!title || (heading.length < title.length && foldForSearch(title).startsWith(foldForSearch(heading))))) {
    title = heading;
  }
  // From the page's <title>: its first part, before the site's name.
  if (!title) title = space(titles.og ?? titles.title ?? "").split(/\s+[|–—-]\s+/)[0];
  // Written in capitals: as a sentence.
  const letters = title.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 4 && letters === letters.toLocaleUpperCase("fr") && letters !== letters.toLocaleLowerCase("fr")) {
    title = title.toLocaleLowerCase("fr");
  }
  title = title
    .replace(/^(livre de cuisine|cookbook)\s*[/:]\s*/i, "")
    .replace(/^recette\s*[:–—-]?\s+(?:(?:de|du|des)\s+|d['’]\s*)?/i, "")
    .replace(/^[\s–—:|•·-]+/, "")
    .replace(/\s+recipe$/i, "")
    .replace(/\s*\((video|vidéo)\)$/i, "");
  return title ? title.charAt(0).toLocaleUpperCase("fr") + title.slice(1) : null;
}

/** The recipe on the page: { title, servings, prepMinutes, ingredients,
 * instructions (a step per line, blank line before a part's heading, the
 * page URL last) }, or null. */
export function readRecipePage(html, pageUrl) {
  const page = readPage(html);
  const [found] = [
    ...jsonLdRecipes(page.jsonLd).map(fromJsonLd),
    ...page.microdata.map(fromMicrodata),
  ].sort((a, b) => count(b.ingredients) + b.steps.length - (count(a.ingredients) + a.steps.length));
  const recipe = found ?? { name: "", servings: null, minutes: 0, ingredients: [], steps: [] };

  // Prefer the page's own list when it adds sub-headings to the same
  // ingredients (sites' data often drops them).
  const listed = pageIngredients(page);
  let ingredients = recipe.ingredients;
  if (!ingredients.length || (listed.some((item) => item.heading) && count(listed) === count(ingredients))) {
    ingredients = listed;
  }
  let steps = recipe.steps.length ? recipe.steps : pageSteps(page);
  let servings = recipe.servings;
  if (!ingredients.length || !steps.length) {
    const headed = headedSections(page);
    if (!ingredients.length) ingredients = headed.ingredients;
    if (!steps.length) steps = headed.steps;
    servings ??= headed.servings;
  }
  if (!servings || !recipe.minutes) {
    const facts = pageFacts(page.lines);
    servings ??= facts.servings;
    recipe.minutes ||= facts.minutes;
  }
  // "Pour 4 personnes" among the ingredients: the servings, not a line.
  ingredients = ingredients.filter((item) => {
    const people = SERVINGS_LINE.exec(item.text.replace(/\s*:$/, ""));
    if (people) servings ??= Number(people[1] ?? people[2]);
    return !people;
  });
  if (!ingredients.length && !steps.length) return null;

  // Blank lines only between parts.
  steps = steps.filter((line, index) => line || (index > 0 && steps[index - 1]));
  while (steps[0] === "") steps.shift();
  const source = new URL(pageUrl);
  source.hash = "";
  for (const key of [...source.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) source.searchParams.delete(key);
  }

  return {
    title: recipeTitle(recipe.name, page.titles),
    servings,
    prepMinutes: recipe.minutes || null,
    ingredients: ingredients.map((item) =>
      item.heading ? { quantity: "", unit: "", name: `${item.text} :` } : ingredientLine(item.text)
    ),
    instructions: [...steps, "", `Source : ${source.href}`].join("\n"),
  };
}
