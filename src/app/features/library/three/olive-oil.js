import * as THREE from "three";
import { createGltfLoader } from "./gltf-loader.js";
import { getMetalMaterial } from "./pepper-mill.js";
import { getSandstoneSpeckleTexture } from "./sandstone-texture.js";

const MODEL_URL = "/models/olive-oil.glb";
// A little taller than the pepper mill, close to the books' own height.
const TARGET_HEIGHT = 0.9;

let cachedPromise = null;

// Matched by keyword, robust to the export's "sandtsone" typo and to the
// accent in "liège".
function classifyMaterial(name) {
  const n = (name ?? "").toLowerCase();
  if (n.includes("white") && n.includes("sand")) return "white";
  if (n.includes("yellow") && n.includes("sand")) return "yellow";
  if (n.includes("liege") || n.includes("liège")) return "cork";
  if (n.includes("metal")) return "metal";
  return null;
}

/** Loads olive-oil.glb once, sets its four materials and scales it to a
 * fixed height. Cached, a single instance (like loadPepperMill()). */
export function loadOliveOilBottle() {
  if (!cachedPromise) {
    cachedPromise = createGltfLoader().loadAsync(MODEL_URL).then((gltf) => {
      const root = gltf.scene;

      // Shared speckle map, mostly white: only the flecks darken each glaze.
      const speckle = getSandstoneSpeckleTexture();
      const materials = {
        // Stoneware, two glazes: off-white below, pastel yellow above.
        white: new THREE.MeshStandardMaterial({ map: speckle, color: 0xe7ded0, roughness: 0.3, metalness: 0 }),
        yellow: new THREE.MeshStandardMaterial({ map: speckle, color: 0xe9dda3, roughness: 0.3, metalness: 0 }),
        cork: new THREE.MeshStandardMaterial({ color: 0xc4a06a, roughness: 0.95, metalness: 0 }),
        metal: getMetalMaterial(),
      };

      root.traverse((child) => {
        if (!child.isMesh) return;
        const kind = classifyMaterial(child.material?.name);
        child.material = materials[kind] ?? materials.white;
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
