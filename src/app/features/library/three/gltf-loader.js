import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/** A GLTFLoader reading meshopt-compressed models (the shelf objects, a
 * quarter of their raw size). The decoder ships with three.js. */
export function createGltfLoader() {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}
