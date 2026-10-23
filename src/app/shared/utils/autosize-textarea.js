/** Keeps a textarea as tall as its content; returns the resize handler.
 * Re-measures after web fonts load and on width changes, which rewrap it. */
export function autosizeTextarea(el) {
  const resize = () => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  el.addEventListener("input", resize);
  requestAnimationFrame(resize);
  document.fonts?.ready.then(resize);

  // Only width changes matter: resize() itself changes the height.
  let lastWidth = 0;
  new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    if (width === lastWidth) return;
    lastWidth = width;
    resize();
  }).observe(el);

  return resize;
}
