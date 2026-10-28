import * as THREE from "three";
import { paintWoodPlank } from "./wood-plank.js";

// Built once for every shelf (library and groceries), kept across scenes.
let cached = null;

export function getWoodMaterial() {
  if (!cached) {
    const texture = new THREE.CanvasTexture(paintWoodPlank());
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(2.2, 1);

    // No colour tint: it would darken the painted wood.
    cached = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.75,
      metalness: 0.04,
    });
  }
  return cached;
}
