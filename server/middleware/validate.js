import { HttpError } from "../utils/http-error.js";
import { getUnit, isEmptyLine, MAX_LINES, MAX_NAME_LENGTH, MAX_QUANTITY_LENGTH, QUANTITY_CHARS } from "../../shared/ingredients.js";
import { TAG_KEYS } from "../../shared/recipe-tags.js";

// Ids go into URLs and SQL parameters: a strict, short charset.
const ID_PATTERN = /^[A-Za-z0-9-]{1,80}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const TITLE_MAX_LENGTH = 200;
const TEXT_MAX_LENGTH = 20000;
const SERVINGS_MAX = 999;
const PREP_MINUTES_MAX = 99 * 24 * 60; // 99 days
// A client-resized cover/spine/back image, jpg or png only.
const DATA_URL_IMAGE_PATTERN = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
const TEXTURE_MAX_LENGTH = 5_000_000; // ~3.7MB decoded - generous for a resized cover image
// What a picture's first bytes must be for the type its data: URL claims.
const IMAGE_SIGNATURES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};
// Settings' tags: "c-" and an id (see custom-tags.service.js).
const TAG_KEY_PATTERN = /^c-[0-9a-z]{12}$/;

export function assertValidId(id, label = "id") {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new HttpError(400, `${label} invalide`);
  }
  return id;
}

export function requireTitle(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "Le titre est requis");
  }
  const trimmed = value.trim();
  if (trimmed.length > TITLE_MAX_LENGTH) {
    throw new HttpError(400, `Le titre est trop long (${TITLE_MAX_LENGTH} caracteres max)`);
  }
  return trimmed;
}

/** Returns undefined when the field is absent, "" when explicitly cleared. */
export function optionalText(value, { max = TEXT_MAX_LENGTH, label = "champ" } = {}) {
  if (value === undefined) return undefined;
  if (value === null) return "";
  if (typeof value !== "string") {
    throw new HttpError(400, `${label} doit etre du texte`);
  }
  if (value.length > max) {
    throw new HttpError(400, `${label} est trop long (${max} caracteres max)`);
  }
  return value;
}

/** Undefined when absent, null when cleared (falls back to the colour
 * token, see books.service.js). */
export function optionalHexColor(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) {
    throw new HttpError(400, "La couleur doit être un hexadécimal du type #rrggbb");
  }
  return value.toLowerCase();
}

/** Undefined when absent; otherwise one of `allowed`. */
export function optionalEnum(value, allowed, label = "champ") {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${label} invalide`);
  }
  return value;
}

/** The full shelf layout: rows of { left, right } id lists, edge to gap
 * (see shelfSideLists in three/scene.js). */
export function requireShelfRows(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "rows doit être un tableau non vide");
  }
  return value.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new HttpError(400, `rows[${index}] invalide`);
    }
    const left = Array.isArray(row.left) ? row.left : [];
    const right = Array.isArray(row.right) ? row.right : [];
    return {
      left: left.map((id) => assertValidId(id, `rows[${index}].left`)),
      right: right.map((id) => assertValidId(id, `rows[${index}].right`)),
    };
  });
}

/** Undefined when absent, null when cleared (removes the texture). Otherwise
 * a jpg or png data: URL whose content really starts like one. */
export function optionalTextureDataUrl(value, label = "texture") {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const type = typeof value === "string" && value.length <= TEXTURE_MAX_LENGTH ? DATA_URL_IMAGE_PATTERN.exec(value)?.[1] : null;
  const data = type ? value.slice(value.indexOf(",") + 1) : "";
  const start = Buffer.from(data.slice(0, 12), "base64");
  if (!type || !IMAGE_SIGNATURES[type].every((byte, i) => start[i] === byte)) {
    throw new HttpError(400, `${label} doit être une image jpg ou png`);
  }
  return value;
}

/** Undefined when absent, null when cleared (automatic value, see
 * book-sizing.js); otherwise a number within the slider's [min, max]. */
export function optionalMultiplier(value, { min, max, label = "champ" } = {}) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new HttpError(400, `${label} doit être un nombre entre ${min} et ${max}`);
  }
  return num;
}

/** Returns undefined when absent, null when explicitly cleared. */
export function optionalServings(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > SERVINGS_MAX) {
    throw new HttpError(400, `Le nombre de personnes doit etre un entier entre 1 et ${SERVINGS_MAX}`);
  }
  return num;
}

/** Returns undefined when absent, null when explicitly cleared. */
export function optionalMinutes(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > PREP_MINUTES_MAX) {
    throw new HttpError(400, `Le temps de preparation doit etre un nombre de minutes entre 1 et ${PREP_MINUTES_MAX}`);
  }
  return num;
}

// Text read from photos (see recipe-photo-reader.js): pages of lines, each
// with its box as shares of the page (0-1).
const MAX_PAGES = 6;
const MAX_PAGE_LINES = 1000;
const MAX_LINE_LENGTH = 500;

/** The pages read from a recipe's photos, checked line by line. */
export function requireReadPages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PAGES) {
    throw new HttpError(400, `Entre 1 et ${MAX_PAGES} pages`);
  }
  const share = (number) => typeof number === "number" && Number.isFinite(number) && number >= -0.1 && number <= 1.1;
  return value.map((page, pageIndex) => {
    const lines = page?.lines;
    if (!Array.isArray(lines) || lines.length > MAX_PAGE_LINES) throw new HttpError(400, `pages[${pageIndex}] invalide`);
    return {
      lines: lines.map((line, lineIndex) => {
        const { text, confidence, x, y, w, h } = line ?? {};
        if (typeof text !== "string" || text.length > MAX_LINE_LENGTH || ![confidence, x, y, w, h].every(share)) {
          throw new HttpError(400, `pages[${pageIndex}].lines[${lineIndex}] invalide`);
        }
        return { text, confidence, x, y, w, h };
      }),
    };
  });
}

/** Tag corrections { add, remove }, keys among `allowed` (automatic and
 * settings tags). Undefined when absent, null to clear them all. */
export function optionalTagOverrides(value, allowed = TAG_KEYS) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "tagOverrides invalide");
  const list = (name) => {
    const keys = value[name] ?? [];
    if (!Array.isArray(keys) || keys.some((key) => !allowed.includes(key))) {
      throw new HttpError(400, `tagOverrides.${name} invalide`);
    }
    return [...new Set(keys)];
  };
  const add = list("add");
  const remove = list("remove").filter((key) => !add.includes(key));
  return add.length || remove.length ? { add, remove } : null;
}

const TAG_LABEL_MAX_LENGTH = 30;

/** A settings' tag key, from a URL. */
export function assertTagKey(value) {
  if (typeof value !== "string" || !TAG_KEY_PATTERN.test(value)) throw new HttpError(400, "Tag invalide");
  return value;
}

/** A tag added in the settings: a short name. */
export function requireTagLabel(value) {
  const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!label) throw new HttpError(400, "Le nom du tag est requis");
  if (label.length > TAG_LABEL_MAX_LENGTH) throw new HttpError(400, `Le nom du tag est trop long (${TAG_LABEL_MAX_LENGTH} caractères max)`);
  return label;
}

/** Ingredient lines (see shared/ingredients.js), blank ones dropped. */
export function requireIngredientLines(value) {
  if (!Array.isArray(value) || value.length > MAX_LINES) {
    throw new HttpError(400, `ingredients doit etre une liste de ${MAX_LINES} lignes au plus`);
  }
  return value
    .map((line, index) => {
      if (!line || typeof line !== "object") throw new HttpError(400, `ingredients[${index}] invalide`);
      const { quantity = "", unit = "", name = "" } = line;
      if (typeof quantity !== "string" || quantity.length > MAX_QUANTITY_LENGTH || !QUANTITY_CHARS.test(quantity)) {
        throw new HttpError(400, `ingredients[${index}].quantity invalide`);
      }
      if (typeof unit !== "string" || (unit !== "" && !getUnit(unit))) {
        throw new HttpError(400, `ingredients[${index}].unit invalide`);
      }
      if (typeof name !== "string" || name.length > MAX_NAME_LENGTH) {
        throw new HttpError(400, `ingredients[${index}].name invalide`);
      }
      return { quantity, unit, name: name.replace(/\s*\n\s*/g, " ") };
    })
    .filter((line) => !isEmptyLine(line));
}
