import { t } from "../i18n/i18n.js";

const AUTO_HIDE_MS = 2000;

/** Autosave status (idle / saving / saved / failed) in the page's
 * .save-indicator element. */
export function createSaveIndicator(root) {
  const text = root.querySelector("[data-save-text]");
  const icon = root.querySelector("[data-save-icon]");
  let hideTimer = null;

  function show(label, { error = false, autoHide = false, done = false } = {}) {
    clearTimeout(hideTimer);
    text.textContent = label;
    icon.hidden = !done;
    root.classList.add("is-visible");
    root.classList.toggle("is-error", error);
    if (autoHide) {
      hideTimer = setTimeout(() => root.classList.remove("is-visible"), AUTO_HIDE_MS);
    }
  }

  return {
    saving: () => show(t("save.saving")),
    saved: () => show(t("save.saved"), { autoHide: true, done: true }),
    error: () => show(t("save.failed"), { error: true }),
    dispose: () => clearTimeout(hideTimer),
  };
}
