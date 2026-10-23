import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { loadBookAsset, createBookInstance, repaintBookInstancePreview } from "./book-asset.js";

// Radians per second: a slow showcase turn.
const ROTATE_SPEED = 0.5;
const FOV_DEGREES = 38;
// Camera distance from the book's centre (the book is 1 unit tall), always
// looking at it.
const CAMERA_DISTANCE = 1.94;
// Starting elevation: high enough to look down onto the top of the pages.
const CAMERA_ELEVATION = THREE.MathUtils.degToRad(25);
// Vertical drag range, short of straight above/below the book.
const MIN_ELEVATION = THREE.MathUtils.degToRad(-70);
const MAX_ELEVATION = THREE.MathUtils.degToRad(80);
// Radians per drag pixel: horizontal turns the book, vertical orbits the
// camera.
const DRAG_ROTATE_SPEED = 0.012;
// Reflection: a tall soft "window" on the right at book height. Turning,
// each face sweeps through it: a sharp band when glossy, a faint sheen when
// matte.
const WINDOW_POSITION = new THREE.Vector3(1.5, 0, 1.4);
const WINDOW_SIZE = { width: 0.7, height: 2.6 };
const WINDOW_INTENSITY = 3;

/** A small separate scene for the edit panel: one lit, slowly turning book
 * previewing colour changes live. Minimal (key light, window, no shadows);
 * live only while a book is selected. */
export async function createBookPreviewScene({ canvas, appearance, widthMultiplier, heightMultiplier }) {
  const asset = await loadBookAsset();
  const { size } = asset;
  const baseScale = 1 / size.y;

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(FOV_DEGREES, 1, 0.1, 20);
  let elevation = CAMERA_ELEVATION;
  function placeCamera() {
    camera.position.set(0, CAMERA_DISTANCE * Math.sin(elevation), CAMERA_DISTANCE * Math.cos(elevation));
    camera.lookAt(0, 0, 0);
  }
  placeCamera();

  // The window lights the faces too: the ambient makes up the difference.
  scene.add(new THREE.AmbientLight(0xfbe9d6, 0.6));
  const key = new THREE.DirectionalLight(0xffd8b4, 1.1);
  key.position.set(-2, 3, 3);
  scene.add(key);
  RectAreaLightUniformsLib.init();
  const reflectionWindow = new THREE.RectAreaLight(0xfff4e6, WINDOW_INTENSITY, WINDOW_SIZE.width, WINDOW_SIZE.height);
  reflectionWindow.position.copy(WINDOW_POSITION);
  reflectionWindow.lookAt(0, 0, 0);
  scene.add(reflectionWindow);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const { pivot, mesh } = createBookInstance(asset, { ...appearance, cache: false });

  // The pivot's origin is a spine corner (book-asset.js), so a turntable
  // spins instead, the pivot offset inside it to put the book's centre on
  // its axis. Measured unscaled, so setSize() can recompute the offset.
  const center = new THREE.Box3().setFromObject(pivot).getCenter(new THREE.Vector3());
  const turntable = new THREE.Group();
  turntable.add(pivot);
  scene.add(turntable);

  // Same proportions as on the shelf (placeBook): width scales X, height Y.
  function setSize({ widthMultiplier: width, heightMultiplier: height }) {
    const scale = new THREE.Vector3(baseScale * width, baseScale * height, baseScale);
    pivot.scale.copy(scale);
    pivot.position.copy(center).multiply(scale).negate();
  }
  setSize({ widthMultiplier, heightMultiplier });

  // Start part-turned, cover first.
  turntable.rotation.y = Math.PI * 0.35;

  function refit() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(() => refit());
  resizeObserver.observe(canvas);
  refit();

  // Horizontal drag turns the book (auto-rotation resumes from there);
  // vertical drag orbits the camera, which stays at that height.
  let dragging = false;
  let lastPointerX = 0;
  let lastPointerY = 0;

  function onPointerDown(event) {
    dragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = "grabbing";
  }
  function onPointerMove(event) {
    if (!dragging) return;
    turntable.rotation.y += (event.clientX - lastPointerX) * DRAG_ROTATE_SPEED;
    elevation = THREE.MathUtils.clamp(
      elevation + (event.clientY - lastPointerY) * DRAG_ROTATE_SPEED,
      MIN_ELEVATION,
      MAX_ELEVATION
    );
    placeCamera();
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  }
  function onPointerUp() {
    dragging = false;
    canvas.style.cursor = "grab";
  }

  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  let frameId = null;
  const clock = new THREE.Clock();
  function animate() {
    frameId = requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (!dragging) turntable.rotation.y += delta * ROTATE_SPEED;
    renderer.render(scene, camera);
  }
  animate();

  return {
    setAppearance(next) {
      repaintBookInstancePreview(mesh, next);
    },
    setSize,
    dispose() {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      // Only the page-edge texture is this instance's; pictures belong to the
      // shared cache.
      mesh.material[3].map.dispose();
      for (const material of mesh.material) material.dispose();
      renderer.dispose();
    },
  };
}
