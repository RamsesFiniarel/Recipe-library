/** The chef's-hat menus: a round button that stretches open on hover, the
 * hat becoming its own action. On touch screens, a first tap opens it (the
 * click is preventDefault-ed), a tap elsewhere closes it. Returns the
 * unbinding function. */
export function bindHatMenu(menu, hat) {
  const canHover = window.matchMedia("(hover: hover)");
  function onHatClick(event) {
    if (canHover.matches || menu.classList.contains("is-open")) return;
    event.preventDefault();
    menu.classList.add("is-open");
  }
  function onDocumentPointerDown(event) {
    if (!menu.contains(event.target)) menu.classList.remove("is-open");
  }
  hat.addEventListener("click", onHatClick);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
}
