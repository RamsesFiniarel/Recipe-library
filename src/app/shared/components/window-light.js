import markup from "./window-light.svg?raw";
import "./window-light.css";

/** Window sunlight and a monstera's shadow on a wall: replaces the `slot`
 * placeholder with the drawing (window-light.svg, .window-light). */
export function mountWindowLight(slot) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  slot.replaceWith(template.content.querySelector("svg"));
}
