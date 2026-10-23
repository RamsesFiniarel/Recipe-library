import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { OUTLINE, SPINE_START_INDEX, SPINE_END_INDEX } from "./book-outline.js";

const MODEL_URL = "/models/book-rigged.glb";
// The model's 1024px strip: cover over most of it, page edges from px 818.
const TEXTURE_SIZE = 1024;
const PAGES_START = 818;

// One material slot per face, each with its own picture; the page-edge
// slot keeps the shared texture.
const COVER_SLOT = 0;
const BACK_SLOT = 1;
const SPINE_SLOT = 2;
const PAGES_SLOT = 3;
const SLOT_COUNT = 4;
// Triangles whose original UVs reach past this belong to the page block.
const PAGES_MIN_U = 0.8;

// Pictures use a second UV set ("uv1") along the outer outline (the model's
// own UVs are shared front/back): 0 at the back's fore-edge, 1 at the
// cover's, V from the top. Back [0, spineStart], spine [spineStart,
// spineEnd], cover [spineEnd, 1]. Board and spine thickness (V 0 and 1)
// take the picture's top and bottom rows, like a cloth cover.
const slotBands = {};

let cachedAssetPromise = null;
// One texture per colour, shared and kept across scene rebuilds.
const textureCache = new Map();
const faceImageCache = new Map();

// Loading pictures show the cover colour through this white stand-in: same
// shader before and after, so no compile stall when a picture arrives.
const PENDING_FACE_TEXTURE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
PENDING_FACE_TEXTURE.colorSpace = THREE.SRGBColorSpace;
PENDING_FACE_TEXTURE.channel = 1;
PENDING_FACE_TEXTURE.needsUpdate = true;

// Decoded pictures upload a few per frame, not all at once (a visible hitch).
const FACE_UPLOADS_PER_FRAME = 3;
const pendingFaceUploads = [];
let faceUploadFrame = null;

function drainFaceUploads() {
  faceUploadFrame = null;
  for (const upload of pendingFaceUploads.splice(0, FACE_UPLOADS_PER_FRAME)) upload();
  if (pendingFaceUploads.length) faceUploadFrame = requestAnimationFrame(drainFaceUploads);
}

function queueFaceUpload(upload) {
  pendingFaceUploads.push(upload);
  faceUploadFrame ??= requestAnimationFrame(drainFaceUploads);
}

// Pictures requested but not yet on the GPU, and who's waiting for none to be.
let loadingFacePictures = 0;
const facePictureWaiters = [];

function settleFacePicture() {
  loadingFacePictures -= 1;
  if (loadingFacePictures === 0) for (const resolve of facePictureWaiters.splice(0)) resolve();
}

/** Resolves once every requested picture is loaded (or failed) and applied. */
export function facePicturesSettled() {
  return loadingFacePictures === 0 ? Promise.resolve() : new Promise((resolve) => facePictureWaiters.push(resolve));
}

/** Loads the rigged book model once (armature with Tilt/TiltBack/FullOpening
 * clips) and measures its bind-pose size. */
export function loadBookAsset() {
  if (!cachedAssetPromise) {
    cachedAssetPromise = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
      let mesh = null;
      gltf.scene.traverse((child) => {
        if (child.isSkinnedMesh && !mesh) mesh = child;
      });
      if (!mesh) throw new Error("book-rigged.glb ne contient aucun SkinnedMesh");

      mesh.geometry.computeBoundingBox();
      smoothNormals(mesh.geometry);
      assignFaceGroups(mesh.geometry);

      const box = mesh.geometry.boundingBox;
      const size = new THREE.Vector3();
      box.getSize(size);

      return { gltf, size, spineZ: box.max.z };
    });
  }
  return cachedAssetPromise;
}

// The model's normals are faceted (flat bands): each vertex normal is
// averaged with coincident ones within SMOOTH_ANGLE, smoothing curves and
// keeping right-angled edges crisp ("auto smooth").
const SMOOTH_ANGLE = THREE.MathUtils.degToRad(50);

function smoothNormals(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const original = normal.array.slice();
  const minDot = Math.cos(SMOOTH_ANGLE);

  const coincident = new Map();
  for (let i = 0; i < position.count; i += 1) {
    const key = `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`;
    if (!coincident.has(key)) coincident.set(key, []);
    coincident.get(key).push(i);
  }

  const sum = new THREE.Vector3();
  for (const vertices of coincident.values()) {
    for (const i of vertices) {
      sum.set(0, 0, 0);
      for (const j of vertices) {
        const dot = original[i * 3] * original[j * 3] + original[i * 3 + 1] * original[j * 3 + 1] + original[i * 3 + 2] * original[j * 3 + 2];
        if (dot >= minDot) sum.add({ x: original[j * 3], y: original[j * 3 + 1], z: original[j * 3 + 2] });
      }
      sum.normalize();
      normal.setXYZ(i, sum.x, sum.y, sum.z);
    }
  }
  normal.needsUpdate = true;
}

// Cumulative length at each OUTLINE point, and any (x, z) projected onto
// the outline as a length.
function measureOutline() {
  const cumulative = [0];
  for (let i = 1; i < OUTLINE.length; i += 1) {
    const [x0, z0] = OUTLINE[i - 1];
    const [x1, z1] = OUTLINE[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(x1 - x0, z1 - z0));
  }
  function project(x, z) {
    let best = Infinity;
    let along = 0;
    for (let i = 1; i < OUTLINE.length; i += 1) {
      const [x0, z0] = OUTLINE[i - 1];
      const [x1, z1] = OUTLINE[i];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const t = THREE.MathUtils.clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz), 0, 1);
      const distance = Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz));
      if (distance < best) {
        best = distance;
        along = cumulative[i - 1] + t * (cumulative[i] - cumulative[i - 1]);
      }
    }
    return along;
  }
  return { cumulative, total: cumulative[cumulative.length - 1], project };
}

// The page block: its top, bottom and fore-edge side.
function isPagesTriangle(normal, uv, corners) {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  const onPagesStrip = Math.max(uv.getX(corners[0]), uv.getX(corners[1]), uv.getX(corners[2])) >= PAGES_MIN_U;
  if (ay >= ax && ay >= az) return onPagesStrip;
  if (az > ax && normal.z < 0) return true;
  return onPagesStrip;
}

// Adds the outline UVs, regroups the index buffer by face, and registers one
// geometry group per face. Once, on the shared geometry.
function assignFaceGroups(geometry) {
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const index = geometry.index.array;
  const { min, max } = geometry.boundingBox;
  const outline = measureOutline();

  const outlineUv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    outlineUv[i * 2] = outline.project(position.getX(i), position.getZ(i)) / outline.total;
    outlineUv[i * 2 + 1] = (max.y - position.getY(i)) / (max.y - min.y);
  }
  geometry.setAttribute("uv1", new THREE.BufferAttribute(outlineUv, 2));

  const spineStart = outline.cumulative[SPINE_START_INDEX] / outline.total;
  const spineEnd = outline.cumulative[SPINE_END_INDEX] / outline.total;
  slotBands[BACK_SLOT] = [0, spineStart];
  slotBands[SPINE_SLOT] = [spineStart, spineEnd];
  slotBands[COVER_SLOT] = [spineEnd, 1];

  const buckets = Array.from({ length: SLOT_COUNT }, () => []);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const edge = new THREE.Vector3();

  for (let t = 0; t < index.length; t += 3) {
    const corners = [index[t], index[t + 1], index[t + 2]];
    a.fromBufferAttribute(position, corners[0]);
    b.fromBufferAttribute(position, corners[1]);
    c.fromBufferAttribute(position, corners[2]);
    normal.subVectors(b, a).cross(edge.subVectors(c, a));
    let slot = PAGES_SLOT;
    if (!isPagesTriangle(normal, uv, corners)) {
      const along = (outlineUv[corners[0] * 2] + outlineUv[corners[1] * 2] + outlineUv[corners[2] * 2]) / 3;
      slot = along < spineStart ? BACK_SLOT : along > spineEnd ? COVER_SLOT : SPINE_SLOT;
    }
    buckets[slot].push(...corners);
  }

  const reordered = [];
  geometry.clearGroups();
  buckets.forEach((corners, slot) => {
    geometry.addGroup(reordered.length, corners.length, slot);
    reordered.push(...corners);
  });
  geometry.setIndex(reordered);
}

function paintBookTexture({ coverHex, pageLightHex, pageDarkHex }) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = coverHex;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // Page edges: a soft gradient, no sheet lines (sub-pixel, they moiré).
  const pages = ctx.createLinearGradient(PAGES_START, 0, TEXTURE_SIZE, 0);
  pages.addColorStop(0, pageDarkHex);
  pages.addColorStop(0.35, pageLightHex);
  pages.addColorStop(1, pageDarkHex);
  ctx.fillStyle = pages;
  ctx.fillRect(PAGES_START, 0, TEXTURE_SIZE - PAGES_START, TEXTURE_SIZE);

  return canvas;
}

/** Cached per colour combination, shared by books. Live editing (a colour
 * being dragged) passes `cache: false`, or every interim colour would stay
 * cached forever. */
function createBookTexture({ coverHex, pageLightHex, pageDarkHex, cache = true }) {
  const key = `${coverHex}|${pageLightHex}|${pageDarkHex}`;
  if (cache) {
    const cached = textureCache.get(key);
    if (cached) return cached;
  }

  const texture = new THREE.CanvasTexture(paintBookTexture({ coverHex, pageLightHex, pageDarkHex }));
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  // Anisotropy keeps grazing-angle textures sharp (clamped to the GPU max).
  texture.anisotropy = 8;
  if (cache) textureCache.set(key, texture);
  return texture;
}

// Pictures (data or image URLs) decode off the main thread; `onReady` gets
// the texture once loaded and its upload turn has come.
function requestFaceImage(slot, dataUrl, onReady) {
  const key = `${slot}|${dataUrl}`;
  let entry = faceImageCache.get(key);
  if (!entry) {
    const texture = new THREE.Texture();
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // Stretches this picture over its own band of the outline UVs.
    const [u0, u1] = slotBands[slot];
    texture.channel = 1;
    texture.repeat.set(1 / (u1 - u0), 1);
    texture.offset.set(-u0 / (u1 - u0), 0);

    entry = { texture, loaded: false, waiting: [] };
    faceImageCache.set(key, entry);

    loadingFacePictures += 1;
    const image = new Image();
    image.decoding = "async";
    image.src = dataUrl;
    image
      .decode()
      .then(
        () => true,
        // decode() can refuse a picture the browser still shows fine.
        () => image.complete && image.naturalWidth > 0
      )
      .then((usable) => {
        if (!usable) {
          settleFacePicture();
          return;
        }
        queueFaceUpload(() => {
          texture.image = image;
          texture.needsUpdate = true;
          entry.loaded = true;
          for (const callback of entry.waiting.splice(0)) callback(texture);
          settleFacePicture();
        });
      });
  }

  if (entry.loaded) onReady(entry.texture);
  else entry.waiting.push(onReady);
}

// Counted, so the scene redraws when a face changes (see scene.js).
let faceMapChanges = 0;

/** How many times a face's picture or colour has been set so far. */
export function faceMapChangeCount() {
  return faceMapChanges;
}

// A picture shows as is (white tint); none, or still loading: the cover
// colour.
function setFaceMap(material, texture, coverHex) {
  const picture = texture && texture !== PENDING_FACE_TEXTURE;
  faceMapChanges += 1;
  material.color.set(picture ? 0xffffff : coverHex);
  if (material.map !== texture) {
    material.map = texture;
    material.needsUpdate = true;
  }
}

// Each face shows its picture in texture style, else the cover colour.
// Gloss (0 matte, 1 shiniest) lowers roughness and adds a faint metallic
// sheen, never altering the picture.
const MATTE_ROUGHNESS = 0.78;
const GLOSSY_ROUGHNESS = 0.12;
const MATTE_METALNESS = 0.03;
const GLOSSY_METALNESS = 0.136;

function applyFaceLook(mesh, { coverHex, style, gloss = 0, coverTexture, backTexture, spineTexture }) {
  const pictures = {
    [COVER_SLOT]: coverTexture,
    [BACK_SLOT]: backTexture,
    [SPINE_SLOT]: spineTexture,
  };
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    if (slot === PAGES_SLOT) continue;
    const material = mesh.material[slot];
    material.roughness = THREE.MathUtils.lerp(MATTE_ROUGHNESS, GLOSSY_ROUGHNESS, gloss);
    material.metalness = THREE.MathUtils.lerp(MATTE_METALNESS, GLOSSY_METALNESS, gloss);
    const dataUrl = style === "texture" ? pictures[slot] : null;
    const key = dataUrl ? `${slot}|${dataUrl}` : null;
    material.userData.faceKey = key;
    setFaceMap(material, dataUrl ? PENDING_FACE_TEXTURE : null, coverHex);
    if (!dataUrl) continue;
    requestFaceImage(slot, dataUrl, (texture) => {
      if (material.userData.faceKey === key) setFaceMap(material, texture, coverHex);
    });
  }
}

function setupAction(mixer, clips, name) {
  const action = mixer.clipAction(THREE.AnimationClip.findByName(clips, name));
  action.clampWhenFinished = true;
  action.loop = THREE.LoopOnce;
  return action;
}

/** A standalone book (cloned skeleton, own texture and mixer). `pivot`'s
 * origin is the spine's bottom centre, the point placed on a shelf.
 * `asset` from loadBookAsset(); `appearance`: { coverHex, pageLightHex,
 * pageDarkHex, cache?, style?, coverTexture?, backTexture?, spineTexture? }
 * (`cache: false` for live previews, see createBookTexture()). */
export function createBookInstance(asset, appearance) {
  const { gltf, spineZ } = asset;

  const root = cloneSkeleton(gltf.scene);
  let mesh = null;
  root.traverse((child) => {
    if (child.isSkinnedMesh && !mesh) mesh = child;
  });
  mesh.name = "book";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const faceMaterial = () =>
    new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.03 });
  mesh.material = [
    faceMaterial(),
    faceMaterial(),
    faceMaterial(),
    new THREE.MeshStandardMaterial({
      map: createBookTexture(appearance),
      roughness: 0.78,
      metalness: 0.03,
    }),
  ];
  applyFaceLook(mesh, appearance);

  // Moves the pivot origin to the spine's aisle-side edge, not mid-depth.
  root.position.set(0, 0, -spineZ);

  const pivot = new THREE.Group();
  pivot.add(root);

  const mixer = new THREE.AnimationMixer(root);
  const clips = gltf.animations;
  const tilt = setupAction(mixer, clips, "Tilt");
  const tiltBack = setupAction(mixer, clips, "TiltBack");
  const fullOpening = setupAction(mixer, clips, "FullOpening");

  // Initial resting pose (visually equivalent to a finished "TiltBack").
  tiltBack.play();
  tiltBack.paused = true;
  tiltBack.time = tiltBack.getClip().duration;
  mixer.update(0); // apply it now, so no bind-pose frame flashes

  return { pivot, mesh, mixer, actions: { tilt, tiltBack, fullOpening } };
}

/** Points an instance at a new (cached) texture after a saved colour change. */
export function updateBookInstanceColors(mesh, appearance) {
  mesh.material[PAGES_SLOT].map = createBookTexture(appearance);
  mesh.material[PAGES_SLOT].needsUpdate = true;
  applyFaceLook(mesh, appearance);
}

/** Repaints an instance's texture canvas in place (the edit preview, on every
 * colour input; uncached, see createBookTexture()). */
export function repaintBookInstancePreview(mesh, appearance) {
  const texture = mesh.material[PAGES_SLOT].map;
  texture.image = paintBookTexture(appearance);
  texture.needsUpdate = true;
  applyFaceLook(mesh, appearance);
}
