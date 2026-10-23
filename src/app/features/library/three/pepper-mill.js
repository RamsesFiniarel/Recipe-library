import * as THREE from "three";
import { createGltfLoader } from "./gltf-loader.js";

const MODEL_URL = "/models/pepper.glb";
// Pepper mills read a bit shorter than the books next to them.
const TARGET_HEIGHT = 0.6;

let cachedPromise = null;
let cachedMetalMaterial = null;

/** Shared by every metal part on the shelves (see olive-oil.js). */
export function getMetalMaterial() {
  if (!cachedMetalMaterial) {
    cachedMetalMaterial = new THREE.MeshStandardMaterial({
      color: 0xEAEFF2,
      roughness: 0.3,
      metalness: 0.8,
    });
  }
  return cachedMetalMaterial;
}

/** Loads pepper.glb once, sets its two materials ("Metal", and the body by
 * elimination) and scales it to a fixed height. Cached, returned ready to
 * place: there is only one mill (add a clone step, like
 * createBookInstance, for more). */
export function loadPepperMill() {
  if (!cachedPromise) {
    cachedPromise = createGltfLoader().loadAsync(MODEL_URL).then((gltf) => {
      const root = gltf.scene;

      const bodyMaterial = new THREE.MeshStandardMaterial({
        // Lacquered wood: near black, slightly warm.
        color: 0x1a120e,
        roughness: 0.5,
        metalness: 0,
      });
      const metalMaterial = getMetalMaterial();

      root.traverse((child) => {
        if (!child.isMesh) return;
        child.material = child.material?.name === "Metal" ? metalMaterial : bodyMaterial;
        child.castShadow = true;
        child.receiveShadow = true;
      });

      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      root.scale.setScalar(TARGET_HEIGHT / size.y);

      return root;
    });
  }
  return cachedPromise;
}
