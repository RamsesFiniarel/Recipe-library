import * as THREE from "three";

// A soft dark oval under each book's (or groceries sheet's) foot: shadow
// maps leave a gap at a vertical book on a horizontal shelf
// ("peter-panning"), so this decal grounds them. Built once, shared.
const TEXTURE_SIZE = 128;

let cachedMaterial = null;

function paintContactShadow() {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  const center = TEXTURE_SIZE / 2;

  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.5)");
  gradient.addColorStop(0.6, "rgba(0, 0, 0, 0.25)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  return canvas;
}

/** A shared unlit, alpha-blended material, its plane fitted to each book's
 * footprint (see placeBook() in library/three/scene.js); clone it to fade
 * one alone. */
export function getContactShadowMaterial() {
  if (!cachedMaterial) {
    const texture = new THREE.CanvasTexture(paintContactShadow());
    texture.colorSpace = THREE.SRGBColorSpace;
    cachedMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
  }
  return cachedMaterial;
}
