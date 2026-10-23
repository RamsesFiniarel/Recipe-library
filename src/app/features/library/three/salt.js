import * as THREE from "three";
import { createGltfLoader } from "./gltf-loader.js";

const MODEL_URL = "/models/salt.glb";
// A small open dish, sized by footprint rather than height: about the oil
// bottle's diameter.
const TARGET_DIAMETER = 0.3;

let cachedPromise = null;

// Matched by keyword, like olive-oil.js's classifyMaterial().
function classifyMaterial(name) {
  const n = (name ?? "").toLowerCase();
  if (n.includes("blue") && n.includes("stone")) return "stone";
  if (n.includes("white") && n.includes("wood")) return "wood";
  if (n.includes("salt")) return "salt";
  return null;
}

/** Loads salt.glb once, sets its three materials and scales it to match the
 * pepper mill. Cached, a single instance. */
export function loadSaltMill() {
  if (!cachedPromise) {
    cachedPromise = createGltfLoader().loadAsync(MODEL_URL).then((gltf) => {
      const root = gltf.scene;

      const materials = {
        // Plain light wood body - no procedural texture, just a flat colour.
        wood: new THREE.MeshStandardMaterial({ color: 0xd8c39d, roughness: 0.75, metalness: 0 }),
        // Dark blue stone collar.
        stone: new THREE.MeshStandardMaterial({ color: 0x2e4053, roughness: 0.55, metalness: 0 }),
        // The salt: near white, a touch of grey so it doesn't look like plastic.
        salt: new THREE.MeshStandardMaterial({ color: 0xe8e6e1, roughness: 0.85, metalness: 0 }),
      };

      root.traverse((child) => {
        if (!child.isMesh) return;
        const kind = classifyMaterial(child.material?.name);
        child.material = materials[kind] ?? materials.wood;
        child.castShadow = true;
        child.receiveShadow = true;
      });

      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      root.scale.setScalar(TARGET_DIAMETER / Math.max(size.x, size.z));

      return root;
    });
  }
  return cachedPromise;
}
