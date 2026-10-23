import { t } from "../i18n/i18n.js";

/** Full-page placeholders (loading, not found) shared by router and pages. */
function emptyState(container) {
  container.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  container.append(wrap);
  return wrap;
}

export function renderLoading(container, label = t("common.loading")) {
  emptyState(container).textContent = label;
}

export function renderNotFound(container, { title, linkHref = "/", linkLabel }) {
  const wrap = emptyState(container);

  const heading = document.createElement("h1");
  heading.textContent = title;

  const paragraph = document.createElement("p");
  const link = document.createElement("a");
  link.setAttribute("href", linkHref);
  link.textContent = linkLabel;
  paragraph.append(link);

  wrap.append(heading, paragraph);
}
