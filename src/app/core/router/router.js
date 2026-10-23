import { renderNotFound } from "../../shared/components/page-message.js";
import { t } from "../../shared/i18n/i18n.js";

/** Small client-side router: maps a path to a lazily imported page, tearing
 * the previous one down (the 3D scene has GPU resources to release). A page
 * exports `render(container, params, navigate)` returning its cleanup. */

const VEIL_FADE_MS = 180;

const routes = [];
let container = null;
let veil = null;
let currentCleanup = null;
// Guards against overlapping navigations: only the latest one may mount.
let renderToken = 0;

/** Patterns are developer-authored: "/", "/:bookId", "/:bookId/:recipeId". */
export function registerRoute(pattern, loader) {
  const paramNames = [];
  const regexSource = pattern.replace(/\/:([^/]+)/g, (_, name) => {
    paramNames.push(name);
    return "/([^/]+)";
  });
  routes.push({ regex: new RegExp(`^${regexSource}/?$`), paramNames, loader });
}

function matchRoute(pathname) {
  for (const route of routes) {
    const match = route.regex.exec(pathname);
    if (!match) continue;
    const params = {};
    route.paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return { route, params };
  }
  return null;
}

function teardown() {
  if (typeof currentCleanup === "function") currentCleanup();
  currentCleanup = null;
}

async function mountPage(match, token) {
  teardown();
  container.replaceChildren();

  if (!match) {
    renderNotFound(container, { title: t("common.pageNotFound"), linkLabel: t("common.backToLibrary") });
    return;
  }
  try {
    const pageModule = await match.route.loader();
    if (token !== renderToken) return;
    const cleanup = await pageModule.render(container, match.params, navigate);
    // A newer navigation started meanwhile: drop this page.
    if (token !== renderToken) {
      if (typeof cleanup === "function") cleanup();
      return;
    }
    currentCleanup = cleanup;
  } catch (err) {
    console.error(err);
    if (token !== renderToken) return;
    container.replaceChildren();
    renderNotFound(container, {
      title: t("common.error"),
      linkLabel: t("common.backToLibrary"),
    });
  }
}

/** `transition`: "veil" fades through the page colour; "crossfade" uses View
 * Transitions (the old page stays frozen while the new one mounts), or a
 * plain swap without the API. */
async function renderCurrentPath({ transition = null } = {}) {
  const token = (renderToken += 1);
  const match = matchRoute(window.location.pathname);

  if (transition === "crossfade" && document.startViewTransition) {
    document.startViewTransition(() => mountPage(match, token));
    return;
  }

  const withVeil = transition === "veil" && veil;
  if (withVeil) {
    veil.classList.add("is-active");
    await new Promise((resolve) => setTimeout(resolve, VEIL_FADE_MS));
    if (token !== renderToken) return;
  }

  await mountPage(match, token);

  if (withVeil) {
    requestAnimationFrame(() => veil.classList.remove("is-active"));
  }
}

function navigate(path, { transition = null } = {}) {
  if (path !== window.location.pathname) {
    window.history.pushState({}, "", path);
  }
  renderCurrentPath({ transition });
}

// Same-origin links are handled in place; others keep the default behaviour.
function onDocumentClick(event) {
  // A page may keep a link for itself (e.g. a first tap that opens a menu).
  if (event.defaultPrevented) return;
  const link = event.target.closest("a[href]");
  if (!link) return;
  if (link.target === "_blank" || link.hasAttribute("download")) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href, window.location.origin);
  if (url.origin !== window.location.origin) return;

  event.preventDefault();
  navigate(url.pathname, { transition: link.dataset.transition ?? null });
}

export function startRouter(rootElement) {
  container = rootElement;
  veil = document.querySelector(".page-transition-veil");

  document.addEventListener("click", onDocumentClick);
  window.addEventListener("popstate", () => renderCurrentPath());

  // Settles once the first page is mounted.
  return renderCurrentPath();
}
