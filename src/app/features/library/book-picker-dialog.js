import { openModal } from "../../shared/components/modal.js";
import { t, tn } from "../../shared/i18n/i18n.js";
import { el } from "../../shared/utils/dom.js";
import { hexForColorToken } from "@shared/palette.js";

/** "Which book?", before a new recipe started from the library: the books
 * in shelf order, each with its cover, in the new recipe dialog's dark
 * glass. Resolves to the chosen book's id, or null if dismissed. */
export function bookPickerDialog(books) {
  return openModal({
    role: "dialog",
    title: t("bookPicker.title"),
    cancelValue: null,
    build(modal, close) {
      modal.classList.add("modal--glass", "modal--glass-dark", "book-picker");
      const list = el("div", "book-picker-list");
      for (const book of books) {
        const item = el("button", "book-picker-item");
        item.type = "button";
        const cover = el("span", "book-picker-cover");
        cover.style.setProperty("--book-color", book.coverColor || hexForColorToken(book.colorToken));
        if (book.coverStyle === "texture" && book.coverTextureUrl) {
          cover.style.backgroundImage = `url("${book.coverTextureUrl}")`;
        }
        item.append(cover, el("span", "book-picker-title", book.title), el("span", "book-picker-count", tn("count.recipe", book.recipeCount)));
        item.addEventListener("click", () => close(book.id));
        list.append(item);
      }
      const actions = el("div", "modal-actions");
      const cancel = el("button", "btn btn-ghost", t("common.cancel"));
      cancel.type = "button";
      cancel.addEventListener("click", () => close(null));
      actions.append(cancel);
      modal.append(list, actions);
      return list.firstElementChild;
    },
  });
}
