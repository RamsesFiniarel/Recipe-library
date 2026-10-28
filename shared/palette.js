/** Flat book colours, shared by the server (assigned at creation) and the
 * client (rendering, UI). */
const BOOK_COLOR_TOKENS = [
  "noyer",
  "terracotta",
  "sauge",
  "ocre",
  "taupe",
  "bordeaux",
  "olive",
  "miel",
  "brique",
  "ardoise",
  "camel",
];

const BOOK_COLORS = {
  noyer: { hex: "#4f3c2f", label: "Noyer" },
  terracotta: { hex: "#ad5a3b", label: "Terracotta" },
  sauge: { hex: "#727d63", label: "Sauge" },
  ocre: { hex: "#be8b44", label: "Ocre" },
  taupe: { hex: "#8c7a6b", label: "Taupe" },
  bordeaux: { hex: "#763a3a", label: "Bordeaux" },
  olive: { hex: "#5c5c3a", label: "Olive" },
  miel: { hex: "#c99a3e", label: "Miel" },
  brique: { hex: "#9c4a34", label: "Brique" },
  ardoise: { hex: "#4d5b60", label: "Ardoise" },
  camel: { hex: "#a67b4f", label: "Camel" },
};

const DEFAULT_BOOK_COLOR_TOKEN = BOOK_COLOR_TOKENS[0];

/** A stable colour token for an id (deterministic hash). */
export function colorTokenForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return BOOK_COLOR_TOKENS[hash % BOOK_COLOR_TOKENS.length];
}

export function hexForColorToken(token) {
  return BOOK_COLORS[token]?.hex ?? BOOK_COLORS[DEFAULT_BOOK_COLOR_TOKEN].hex;
}

/** Page colours, a fixed list to pick from: the light tone of the page
 * block (darken() gives its shaded edges). */
export const PAGE_COLOR_TOKENS = ["creme", "ivoire", "sable", "gris"];

export const PAGE_COLORS = {
  creme: { hex: "#f3ecdb", label: "Crème" },
  ivoire: { hex: "#f7f2e7", label: "Ivoire" },
  sable: { hex: "#e8dcc0", label: "Sable" },
  gris: { hex: "#e4e1da", label: "Gris" },
};

export const DEFAULT_PAGE_COLOR_TOKEN = PAGE_COLOR_TOKENS[0];

export function hexForPageColorToken(token) {
  return PAGE_COLORS[token]?.hex ?? PAGE_COLORS[DEFAULT_PAGE_COLOR_TOKEN].hex;
}

/** Multiplies each channel by `factor` (page block edge tone). */
export function darken(hex, factor = 0.87) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.round(((value >> shift) & 0xff) * factor);
  const r = channel(16);
  const g = channel(8);
  const b = channel(0);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Whether a colour is light (dark lettering on it reads better). */
export function isLightColor(hex) {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [16, 8, 0].map((shift) => ((value >> shift) & 0xff) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

/** A second, independent hash: a stable pseudo-random value per book (e.g.
 * height variation). */
export function stableUnitFromId(id, salt = "") {
  let hash = 0;
  const seed = `${salt}:${id}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return (hash % 10000) / 10000; // [0, 1)
}
