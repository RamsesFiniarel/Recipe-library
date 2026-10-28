import { openModal, createModalActions } from "../../shared/components/modal.js";
import { recipesApi } from "../../core/api/recipes.api.js";
import { ApiError } from "../../core/api/http.js";
import { t } from "../../shared/i18n/i18n.js";
import { el } from "../../shared/utils/dom.js";
import { mountIcons } from "../../shared/icons.js";
import { PHONE_LAYOUT } from "../../shared/utils/media.js";
import { findWebAddress } from "@shared/web-address.js";
import "./new-recipe-dialog.css";

/** "New recipe" dialog, in the book page's dark glass: from scratch (a
 * title), from photos (read in the browser by recipe-photo-reader.js,
 * loaded on demand) or from a web page (read by the server). Resolves to
 * the new recipe, or null if dismissed. */

const TITLE_MAX_LENGTH = 200;
const MAX_PHOTOS = 6;
// After this long, the site is said to be slow (the server waits 15 s).
const SLOW_SITE_MS = 6000;

// The ways in, side by side in a segmented control.
const WAYS = [
  { value: "blank", label: t("newRecipe.blank") },
  { value: "photos", label: t("newRecipe.photos") },
  { value: "web", label: t("newRecipe.web") },
];

const isImage = (file) => file.type.startsWith("image/") || /\.(hei[cf]|jpe?g|png|webp)$/i.test(file.name);

export function newRecipeDialog(bookId) {
  return openModal({
    role: "dialog",
    title: t("newRecipe.title"),
    cancelValue: null,
    build(modal, close) {
      modal.classList.add("modal--glass", "modal--glass-dark", "new-recipe");
      const body = el("div", "new-recipe-body");
      const fileInput = el("input");
      fileInput.type = "file";
      fileInput.accept = "image/*,.heic,.heif";
      fileInput.multiple = true;
      fileInput.hidden = true;
      // A phone's camera, straight to a photo (see showPhotoWays()).
      const cameraInput = el("input");
      cameraInput.type = "file";
      cameraInput.accept = "image/*";
      cameraInput.setAttribute("capture", "environment");
      cameraInput.hidden = true;
      modal.append(body, fileInput, cameraInput);

      // Dismissed while reading: the recipe is still made, but nothing opens.
      let closed = false;
      const finish = (recipe) => {
        closed = true;
        close(recipe);
      };
      // Photos or a page being read: nothing else dropped meanwhile.
      let busy = false;

      function show(...nodes) {
        body.replaceChildren(...nodes);
      }

      // --- The ways in: a segmented control, then "Continuer" ---

      function showChoices(initial = "blank") {
        const group = el("div", "new-recipe-ways");
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", t("newRecipe.how"));
        // The thumb slides under the chosen segment (see placeThumb()).
        const thumb = el("span", "new-recipe-ways-thumb");
        thumb.setAttribute("aria-hidden", "true");
        group.append(thumb);
        for (const way of WAYS) {
          const option = el("label", "new-recipe-way");
          const radio = el("input");
          radio.type = "radio";
          radio.name = "new-recipe-way";
          radio.value = way.value;
          radio.checked = way.value === initial;
          option.append(radio, el("span", "new-recipe-way-label", way.label));
          group.append(option);
        }

        const { actions, cancel, confirm } = createModalActions({
          confirmLabel: t("common.continue"),
          confirmClass: "btn-primary",
        });

        function placeThumb() {
          const label = group.querySelector("input:checked").parentElement;
          group.style.setProperty("--thumb-x", `${label.offsetLeft}px`);
          group.style.setProperty("--thumb-w", `${label.offsetWidth}px`);
        }
        // Placed once laid out, then free to slide.
        requestAnimationFrame(() => {
          placeThumb();
          requestAnimationFrame(() => group.classList.add("is-ready"));
        });

        const proceed = () => {
          const way = group.querySelector("input:checked").value;
          if (way === "photos" && window.matchMedia(PHONE_LAYOUT).matches) showPhotoWays().focus();
          else if (way === "photos") fileInput.click();
          else if (way === "web") showWebForm();
          else showTitleForm();
        };
        group.addEventListener("change", placeThumb);
        cancel.addEventListener("click", () => finish(null));
        confirm.addEventListener("click", proceed);
        group.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          proceed();
        });
        show(group, actions);
        placeThumb();
        return group.querySelector("input:checked");
      }

      // On a phone: take a photo with the camera, or choose some.
      function showPhotoWays() {
        const ways = el("div", "new-recipe-photo-ways");
        const button = (icon, label, input) => {
          const node = el("button", "new-recipe-photo-way");
          node.type = "button";
          const slot = el("i");
          slot.dataset.icon = icon;
          node.append(slot, el("span", null, label));
          node.addEventListener("click", () => input.click());
          return node;
        };
        const take = button("camera", t("newRecipe.takePhoto"), cameraInput);
        ways.append(take, button("image", t("newRecipe.choosePhotos"), fileInput));
        mountIcons(ways);
        const actions = el("div", "modal-actions");
        const back = el("button", "btn btn-ghost", t("common.back"));
        back.type = "button";
        back.addEventListener("click", () => showChoices("photos").focus());
        actions.append(back);
        show(ways, actions);
        return take;
      }

      // A field replacing the ways, its label as placeholder; the dialog keeps
      // its size (see .new-recipe-field).
      function fieldForm({ label, confirmLabel, way, value = "", onSubmit }) {
        const form = el("form");
        const input = el("input", "input new-recipe-field");
        input.type = "text";
        input.value = value;
        input.placeholder = label;
        input.setAttribute("aria-label", label);
        input.autocomplete = "off";
        input.required = true;

        const { actions, cancel, confirm } = createModalActions({
          confirmLabel,
          confirmClass: "btn-primary",
          confirmType: "submit",
        });
        cancel.textContent = t("common.back");
        cancel.addEventListener("click", () => showChoices(way).focus());
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          onSubmit(input, confirm);
        });

        form.append(input, actions);
        show(form);
        input.focus();
        return input;
      }

      // --- From scratch ---

      function showTitleForm() {
        const input = fieldForm({
          label: t("newRecipe.titleLabel"),
          confirmLabel: t("common.create"),
          way: "blank",
          async onSubmit(field, confirm) {
            const title = field.value.trim();
            if (!title) return;
            confirm.disabled = true;
            try {
              finish(await recipesApi.create(bookId, title));
            } catch (err) {
              console.error(err);
              confirm.disabled = false;
            }
          },
        });
        input.maxLength = TITLE_MAX_LENGTH;
      }

      // --- From photos ---

      async function readPhotos(files) {
        const photos = files.filter(isImage).slice(0, MAX_PHOTOS);
        if (!photos.length) return;
        busy = true;

        const thumbs = el("div", "new-recipe-thumbs");
        const urls = photos.map((file) => URL.createObjectURL(file));
        for (const url of urls) {
          const image = el("img");
          image.alt = "";
          image.src = url;
          // A format the browser can't show (HEIC): no thumbnail.
          image.addEventListener("error", () => image.remove());
          thumbs.append(image);
        }
        // One bar for the whole job, its percentage, and the current step below.
        const fill = el("span", "new-recipe-progress-fill");
        const track = el("span", "new-recipe-progress-track");
        track.append(fill);
        const percent = el("span", "new-recipe-progress-value", "0 %");
        const progress = el("div", "new-recipe-progress");
        progress.setAttribute("role", "progressbar");
        progress.setAttribute("aria-valuemin", "0");
        progress.setAttribute("aria-valuemax", "100");
        progress.append(track, percent);
        const status = el("p", "new-recipe-status", t("newRecipe.preparing"));
        const readingView = el("div", "new-recipe-reading");
        readingView.append(thumbs, el("span", "spinner new-recipe-spinner"), progress, status);
        show(readingView);

        const setProgress = (total) => {
          const value = Math.round(total * 100);
          fill.style.width = `${value}%`;
          percent.textContent = `${value} %`;
          progress.setAttribute("aria-valuenow", String(value));
        };
        const onProgress = ({ stage, page, pages, total }) => {
          setProgress(total);
          if (stage === "read") {
            status.textContent = pages > 1 ? t("newRecipe.readingOf", { page, pages }) : t("newRecipe.reading");
          }
        };

        try {
          const { readRecipePhotos, UnreadablePhotoError } = await import("./recipe-photo-reader.js");
          try {
            const pages = await readRecipePhotos(photos, onProgress);
            if (closed) return;
            setProgress(1);
            status.textContent = t("newRecipe.creating");
            const recipe = await recipesApi.importPages(bookId, pages);
            if (!closed) finish(recipe);
          } catch (err) {
            if (closed) return;
            console.error(err);
            const message =
              err instanceof UnreadablePhotoError
                ? err.message
                : err instanceof ApiError && err.status === 422
                  ? t("newRecipe.unreadable")
                  : t("newRecipe.failed");
            showError(message, { way: "photos", retryLabel: t("newRecipe.otherPhotos"), retry: () => fileInput.click() });
          }
        } finally {
          busy = false;
          for (const url of urls) URL.revokeObjectURL(url);
        }
      }

      // --- From a web page ---

      function showWebForm(value = "") {
        const input = fieldForm({
          label: t("newRecipe.webLabel"),
          confirmLabel: t("newRecipe.webImport"),
          way: "web",
          value,
          onSubmit(field) {
            // A link with words around it, or pasted twice, will do.
            const address = findWebAddress(field.value);
            if (!address) {
              field.setCustomValidity(t("newRecipe.webInvalid"));
              field.reportValidity();
              return;
            }
            readWebPage(address);
          },
        });
        input.inputMode = "url";
        input.spellcheck = false;
        input.setAttribute("autocapitalize", "off");
        input.addEventListener("input", () => input.setCustomValidity(""));
        input.select();
      }

      // The site, the ring, an endless bar (one server request, nothing to
      // count) and a status line.
      async function readWebPage(address) {
        busy = true;
        const track = el("span", "new-recipe-progress-track is-endless");
        track.append(el("span", "new-recipe-progress-fill"));
        const progress = el("div", "new-recipe-progress");
        progress.setAttribute("role", "progressbar");
        progress.setAttribute("aria-label", t("newRecipe.webReading"));
        progress.append(track);
        const status = el("p", "new-recipe-status", t("newRecipe.webReading"));
        status.setAttribute("aria-live", "polite");
        const readingView = el("div", "new-recipe-reading");
        const site = el("span", "new-recipe-site", new URL(address).hostname.replace(/^www\./, ""));
        readingView.append(site, el("span", "spinner new-recipe-spinner"), progress, status);
        show(readingView);
        const slow = setTimeout(() => (status.textContent = t("newRecipe.webSlow")), SLOW_SITE_MS);

        try {
          const recipe = await recipesApi.importWeb(bookId, address);
          if (!closed) finish(recipe);
        } catch (err) {
          if (closed) return;
          console.error(err);
          // What went wrong, said plainly (see page-fetch.service.js).
          const key = `newRecipe.web.${err instanceof ApiError ? err.code : ""}`;
          const message =
            err instanceof ApiError && err.status === 429
              ? t("newRecipe.webBusy")
              : t(key) === key
                ? t("newRecipe.webFailed")
                : t(key);
          showError(message, { way: "web", retryLabel: t("newRecipe.webOther"), retry: () => showWebForm(address) });
        } finally {
          clearTimeout(slow);
          busy = false;
        }
      }

      function showError(message, { way, retryLabel, retry }) {
        const text = el("p", "new-recipe-error", message);
        const { actions, cancel, confirm } = createModalActions({
          confirmLabel: retryLabel,
          confirmClass: "btn-primary",
        });
        cancel.textContent = t("common.back");
        cancel.addEventListener("click", () => showChoices(way).focus());
        confirm.addEventListener("click", retry);
        show(text, actions);
        confirm.focus();
      }

      // Photos, or a link from another tab, dropped on the dialog (not while
      // reading).
      modal.addEventListener("dragover", (event) => {
        if (busy) return;
        event.preventDefault();
        modal.classList.add("is-dragging");
      });
      modal.addEventListener("dragleave", (event) => {
        if (!modal.contains(event.relatedTarget)) modal.classList.remove("is-dragging");
      });
      modal.addEventListener("drop", (event) => {
        event.preventDefault();
        modal.classList.remove("is-dragging");
        if (busy) return;
        const files = [...event.dataTransfer.files];
        const link = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
        const address = files.length ? null : findWebAddress(link);
        if (address) readWebPage(address);
        else readPhotos(files);
      });

      for (const input of [fileInput, cameraInput]) {
        input.addEventListener("change", () => {
          const files = [...input.files];
          input.value = "";
          readPhotos(files);
        });
      }

      return showChoices();
    },
  });
}
