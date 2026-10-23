import { bindEscapeBack } from "../../shared/utils/escape-back.js";
import { cloneTemplate, mountTemplate } from "../../shared/utils/dom.js";
import { mountWindowLight } from "../../shared/components/window-light.js";
import { switchLanguage } from "../../shared/components/language-switch.js";
import { confirmDialog } from "../../shared/components/confirm-dialog.js";
import { tagsApi } from "../../core/api/tags.api.js";
import { backupApi } from "../../core/api/backup.api.js";
import { ApiError } from "../../core/api/http.js";
import { locale, t, tn } from "../../shared/i18n/i18n.js";
import { foldForSearch } from "@shared/text.js";
import { RECIPE_TAGS } from "@shared/recipe-tags.js";
import {
  LANGUAGES,
  SHELF_OBJECTS,
  loadLanguage,
  loadShelfObjects,
  saveShelfObject,
} from "../../shared/utils/preferences.js";
import template from "./settings.page.html?raw";
import "./settings.page.css";

export function render(container, _params, navigate) {
  mountTemplate(container, template);
  mountWindowLight(container.querySelector("[data-window-light]"));

  // Language: the whole interface follows it, from a fresh load (see i18n.js).
  const languageGroup = container.querySelector("[data-language-group]");
  const language = loadLanguage();
  for (const { key, label } of LANGUAGES) {
    const option = cloneTemplate(container, "language-option");
    const radio = option.querySelector("input");
    radio.value = key;
    radio.checked = key === language;
    radio.addEventListener("change", () => switchLanguage(key));
    option.querySelector(".settings-segment-label").textContent = label;
    languageGroup.append(option);
  }

  // Backups: the last daily copy (or one now), export, and import.
  const backupStatus = container.querySelector("[data-backup-status]");
  const backupMessage = container.querySelector("[data-backup-message]");
  const backupNow = container.querySelector("[data-backup-now]");
  const importButton = container.querySelector("[data-backup-import]");
  const fileInput = container.querySelector("[data-backup-file]");
  container.querySelector("[data-backup-export]").href = backupApi.exportUrl;
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" });

  function showBackups({ copies }) {
    backupStatus.textContent = copies.length
      ? t("settings.backupLast", { date: dateFormat.format(new Date(copies[0].savedAt)) })
      : t("settings.backupNone");
  }

  function say(text, { error = false } = {}) {
    backupMessage.textContent = text;
    backupMessage.classList.toggle("is-error", error);
    backupMessage.hidden = false;
  }

  backupNow.addEventListener("click", async () => {
    backupNow.disabled = true;
    try {
      showBackups(await backupApi.backUpNow());
      say(t("settings.backupDone"));
    } catch (err) {
      console.error(err);
      say(t("settings.backupFailed"), { error: true });
    } finally {
      backupNow.disabled = false;
    }
  });

  importButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const confirmed = await confirmDialog({
      title: t("settings.importConfirm.title"),
      message: t("settings.importConfirm.message", { file: file.name }),
      confirmLabel: t("settings.importConfirm.action"),
    });
    if (!confirmed) return;
    importButton.disabled = true;
    say(t("settings.importing"));
    try {
      const { books, recipes } = await backupApi.importFile(file);
      say(t("settings.importDone", { books: tn("count.book", books), recipes: tn("count.recipe", recipes) }));
      // What this page shows of the library comes from the new one now.
      loadCustomTags();
      backupApi.list().then(showBackups, (err) => console.error(err));
    } catch (err) {
      console.error(err);
      const status = err instanceof ApiError ? err.status : 0;
      say(t(status === 400 ? "settings.importInvalid" : status === 413 ? "settings.importTooBig" : "settings.importFailed"), {
        error: true,
      });
    } finally {
      importButton.disabled = false;
    }
  });

  backupApi.list().then(showBackups, (err) => {
    console.error(err);
    backupStatus.textContent = t("settings.backupUnknown");
  });

  // Shelf objects: the library reads them when it next sets its shelves.
  const objectList = container.querySelector("[data-shelf-objects]");
  const shown = loadShelfObjects();
  for (const { key } of SHELF_OBJECTS) {
    const row = cloneTemplate(container, "shelf-object");
    const toggle = row.querySelector("input");
    toggle.checked = shown[key];
    toggle.addEventListener("change", () => saveShelfObject(key, toggle.checked));
    row.querySelector(".settings-toggle-label").textContent = t(`shelfObject.${key}`);
    objectList.append(row);
  }

  // Tags: the automatic ones, each with what puts it on (not to be deleted).
  const rules = container.querySelector("[data-auto-tags]");
  for (const { key } of RECIPE_TAGS) {
    const term = document.createElement("dt");
    term.textContent = t(`tag.${key}`);
    const rule = document.createElement("dd");
    rule.textContent = t(`tagRule.${key}`);
    rules.append(term, rule);
  }

  // ...and the ones added here, which can go again.
  const customList = container.querySelector("[data-custom-tags]");
  const form = container.querySelector("[data-tag-form]");
  const input = container.querySelector("[data-tag-input]");
  const error = container.querySelector("[data-tag-error]");
  let customTags = [];

  function showError(text) {
    error.textContent = text ?? "";
    error.hidden = !text;
  }

  function renderCustomTags() {
    if (!customTags.length) {
      const empty = document.createElement("li");
      empty.className = "settings-custom-tags-empty";
      empty.textContent = t("settings.customTagsEmpty");
      customList.replaceChildren(empty);
      return;
    }
    customList.replaceChildren(
      ...customTags.map((tag) => {
        const item = cloneTemplate(container, "custom-tag");
        item.querySelector(".settings-custom-tag-label").textContent = tag.label;
        const remove = item.querySelector(".settings-custom-tag-remove");
        const label = t("settings.deleteTag", { tag: tag.label });
        remove.setAttribute("aria-label", label);
        remove.title = label;
        remove.addEventListener("click", () => deleteTag(tag));
        return item;
      })
    );
  }

  async function deleteTag(tag) {
    const confirmed = await confirmDialog({
      title: t("settings.deleteTagConfirm.title"),
      message: t("settings.deleteTagConfirm.message", { tag: tag.label }),
      confirmLabel: t("common.delete"),
    });
    if (!confirmed) return;
    await tagsApi.remove(tag.key);
    customTags = customTags.filter((other) => other.key !== tag.key);
    renderCustomTags();
  }

  // A new tag can't reuse an automatic tag's name (in either language) or a
  // custom one's.
  const taken = (label) =>
    [...RECIPE_TAGS.map(({ key }) => t(`tag.${key}`)), ...customTags.map((tag) => tag.label)].some(
      (other) => foldForSearch(other) === foldForSearch(label)
    );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const label = input.value.trim().replace(/\s+/g, " ");
    if (!label) return;
    if (taken(label)) {
      showError(t("settings.tagExists"));
      return;
    }
    try {
      customTags.push(await tagsApi.create(label));
      input.value = "";
      showError(null);
      renderCustomTags();
    } catch (err) {
      console.error(err);
      showError(t(err instanceof ApiError && err.status === 409 ? "settings.tagExists" : "settings.tagFailed"));
    }
  });
  input.addEventListener("input", () => showError(null));

  function loadCustomTags() {
    tagsApi
      .list()
      .then((tags) => {
        customTags = tags;
        renderCustomTags();
      })
      .catch((err) => console.error(err));
  }
  loadCustomTags();

  return bindEscapeBack(() => navigate("/", { transition: "crossfade" }));
}
