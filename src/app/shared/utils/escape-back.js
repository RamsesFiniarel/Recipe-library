/** Escape goes one level up (recipe, book, library) unless something used
 * the key first (preventDefault). The focused field blurs first, so it
 * saves. Returns the unbinding function. */
export function bindEscapeBack(goBack) {
  let gone = false;
  function onKeydown(event) {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || gone) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    gone = true;
    document.activeElement?.blur?.();
    goBack();
  }
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
