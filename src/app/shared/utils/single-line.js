/** A title's textarea kept to one paragraph, like a field: Enter leaves it
 * (saving it), pasted line breaks become spaces. A textarea, so a long
 * title can wrap on a phone (see .title-field). Set up before the page's
 * own "input" listener. */
export function keepSingleLine(textarea) {
  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    textarea.blur();
  });
  textarea.addEventListener("input", () => {
    if (!/[\r\n]/.test(textarea.value)) return;
    const caret = textarea.selectionStart;
    textarea.value = textarea.value.replace(/\s*[\r\n]+\s*/g, " ");
    textarea.setSelectionRange(caret, caret);
  });
}
