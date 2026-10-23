import { saveLanguage } from "../utils/preferences.js";

/** Language change: the page reloads (see i18n.js) under the library
 * loader's cover, shown before the reload and again right after, then
 * faded out. */

const SWITCHING_KEY = "language-switching";
// Kept in step with .language-switch in components.css.
const FADE_MS = 400;

function cover() {
  const node = document.createElement("div");
  node.className = "language-switch";
  node.setAttribute("aria-hidden", "true");
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  node.append(spinner);
  document.body.append(node);
  return node;
}

export function switchLanguage(key) {
  saveLanguage(key);
  try {
    sessionStorage.setItem(SWITCHING_KEY, "1");
  } catch {
    // Without it the reload just arrives uncovered.
  }
  const node = cover();
  requestAnimationFrame(() => node.classList.add("is-shown"));
  setTimeout(() => window.location.reload(), FADE_MS);
}

/** After the reload: the cover, fading once `ready` (first render) settles. */
export function resumeLanguageSwitch(ready) {
  let switching = false;
  try {
    switching = sessionStorage.getItem(SWITCHING_KEY) === "1";
    sessionStorage.removeItem(SWITCHING_KEY);
  } catch {
    return;
  }
  if (!switching) return;
  const node = cover();
  node.classList.add("is-shown");
  Promise.resolve(ready)
    .catch(() => {})
    .then(() => {
      node.classList.remove("is-shown");
      setTimeout(() => node.remove(), FADE_MS);
    });
}
