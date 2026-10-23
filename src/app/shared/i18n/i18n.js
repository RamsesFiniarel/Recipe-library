import { loadLanguage } from "../utils/preferences.js";
import fr from "./fr.js";
import en from "./en.js";

/** Interface strings in the language chosen in the settings (French or
 * English); recipes stay as written. Read once per load: switching reloads.
 * - t("key", { name }) fills {placeholders};
 * - tn("key", count) picks "key.one" / "key.other" ({n} in it);
 * - page shells use data-i18n="key" and data-i18n-attr="placeholder:key",
 *   filled by translate() (see mountTemplate() in dom.js). */

const STRINGS = { fr, en };

export const language = loadLanguage();
/** For Intl formatting, sorting and speech recognition. */
export const locale = language === "en" ? "en-GB" : "fr-FR";

const strings = STRINGS[language] ?? fr;
const pluralRules = new Intl.PluralRules(locale);

export function t(key, params) {
  const text = strings[key] ?? fr[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? "")) : text;
}

export function tn(key, count, params) {
  return t(`${key}.${pluralRules.select(count) === "one" ? "one" : "other"}`, { n: count, ...params });
}

/** Fills the data-i18n / data-i18n-attr strings of `root` and below. */
export function translate(root) {
  const nodes = root.matches?.("[data-i18n], [data-i18n-attr]") ? [root] : [];
  nodes.push(...root.querySelectorAll("[data-i18n], [data-i18n-attr]"));
  for (const node of nodes) {
    if (node.dataset.i18n) node.textContent = t(node.dataset.i18n);
    for (const pair of node.dataset.i18nAttr?.split(/\s+/) ?? []) {
      const [attribute, key] = pair.split(":");
      node.setAttribute(attribute, t(key));
    }
  }
}
