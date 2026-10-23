import { mountIcons } from "../icons.js";
import { translate } from "../i18n/i18n.js";

/** Installs a page shell (.page.html imported ?raw): fills its strings and
 * icons. Trusted markup only; user data always goes through textContent or
 * value. */
export function mountTemplate(container, html) {
  container.innerHTML = html;
  translate(container);
  mountIcons(container);
  return container;
}

/** A new element, with its class(es) and its text when given. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Clones a <template data-template="name"> declared in a page shell. */
export function cloneTemplate(root, name) {
  const template = root.querySelector(`template[data-template="${name}"]`);
  if (!template) throw new Error(`Template introuvable : ${name}`);
  const node = template.content.firstElementChild.cloneNode(true);
  translate(node);
  mountIcons(node);
  return node;
}
