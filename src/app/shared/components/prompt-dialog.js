import { openModal, createModalActions } from "./modal.js";
import { t } from "../i18n/i18n.js";

const TITLE_MAX_LENGTH = 200;

/** Text prompt (a new book's title) in the library's light glass, or dark
 * with `glass: "dark"`, the field's label as its placeholder. Resolves to
 * the text or null. */
export function promptDialog({ title, label, confirmLabel = t("common.create"), glass = "light" }) {
  return openModal({
    role: "dialog",
    title,
    cancelValue: null,
    build: (modal, close) => {
      modal.classList.add("modal--glass");
      if (glass === "dark") modal.classList.add("modal--glass-dark");
      const form = document.createElement("form");
      const input = document.createElement("input");
      input.className = "input";
      input.type = "text";
      input.maxLength = TITLE_MAX_LENGTH;
      input.placeholder = label;
      input.setAttribute("aria-label", label);
      input.autocomplete = "off";
      input.required = true;

      const { actions, cancel } = createModalActions({
        confirmLabel,
        confirmClass: "btn-primary",
        confirmType: "submit",
      });
      cancel.addEventListener("click", () => close(null));

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (value) close(value);
      });

      form.append(input, actions);
      modal.append(form);
      return input;
    },
  });
}
