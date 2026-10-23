import { openModal, createModalActions } from "./modal.js";
import { t } from "../i18n/i18n.js";

/** Confirmation box (instead of window.confirm), resolving to a boolean.
 * `glass`: "light" or "dark", like the page's dialogs (.modal--glass). */
export function confirmDialog({ title, message, confirmLabel = t("common.confirm"), danger = true, glass = null }) {
  return openModal({
    role: "alertdialog",
    title,
    cancelValue: false,
    build: (modal, close) => {
      if (glass) modal.classList.add("modal--glass");
      if (glass === "dark") modal.classList.add("modal--glass-dark");
      const text = document.createElement("p");
      text.textContent = message;

      const { actions, cancel, confirm } = createModalActions({
        confirmLabel,
        confirmClass: danger ? "btn-danger" : "btn-primary",
      });
      cancel.addEventListener("click", () => close(false));
      confirm.addEventListener("click", () => close(true));

      modal.append(text, actions);
      return confirm;
    },
  });
}
