/** The http(s) URL in typed or pasted text (a bare "marmiton.org/...", a
 * link amid words, or one pasted twice), or null. Used by the new-recipe
 * dialog and the server. */

// Up to the next "http" when two links run together.
const LINK = /https?:\/\/(?:(?!https?:\/\/)[^\s<>"'])+/i;
const BARE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;

export function findWebAddress(text) {
  const typed = String(text ?? "").trim();
  let found = LINK.exec(typed)?.[0] ?? (BARE.test(typed) ? `https://${typed}` : null);
  if (!found) return null;
  // The end of the sentence around it, not the address's.
  found = found.replace(/[.,;:!?]+$/, "");
  if (found.endsWith(")") && !found.includes("(")) found = found.slice(0, -1);
  try {
    return new URL(found).href;
  } catch {
    return null;
  }
}
