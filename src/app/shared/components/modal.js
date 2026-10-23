import { t } from "../i18n/i18n.js";

let instanceCount = 0;
// Dialogs open right now: the page under them stays still while any is.
let openCount = 0;

/** Shared dialog shell: overlay, heading, Escape or backdrop to dismiss,
 * focus returned to the opener. `build(modal, close)` fills the body and
 * returns the element to focus; `close(value)` settles the promise. */
export function openModal({ role, title, cancelValue = null, build }) {
  return new Promise((resolve) => {
    const titleId = `modal-title-${(instanceCount += 1)}`;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.setAttribute("role", role);
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", titleId);
    overlay.append(modal);

    const heading = document.createElement("h2");
    heading.id = titleId;
    heading.textContent = title;
    modal.append(heading);

    const previouslyFocused = document.activeElement;
    let settled = false;

    function close(result) {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      openCount -= 1;
      if (openCount === 0) document.documentElement.classList.remove("has-modal");
      previouslyFocused?.focus?.();
      resolve(result);
    }

    // Marked as used: the page under the dialog mustn't act on it too.
    function onKeydown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(cancelValue);
    }

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(cancelValue);
    });
    document.addEventListener("keydown", onKeydown);

    const toFocus = build(modal, close);
    document.body.append(overlay);
    openCount += 1;
    document.documentElement.classList.add("has-modal");
    toFocus?.focus();
  });
}

/** Cancel + confirm row shared by both dialogs. */
export function createModalActions({ confirmLabel, confirmClass, confirmType = "button" }) {
  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-ghost";
  cancel.textContent = t("common.cancel");

  const confirm = document.createElement("button");
  confirm.type = confirmType;
  confirm.className = `btn ${confirmClass}`;
  confirm.textContent = confirmLabel;

  actions.append(cancel, confirm);
  return { actions, cancel, confirm };
}
