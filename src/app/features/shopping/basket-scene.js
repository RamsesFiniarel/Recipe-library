import * as THREE from "three";
import { getWoodMaterial } from "../../shared/three/wood-texture.js";
import { getContactShadowMaterial } from "../../shared/three/contact-shadow.js";

/** The groceries basket as a shelf (computers): one sheet of paper per
 * recipe, standing on it square to the camera. A recipe picked below flies
 * from its card up in front of the shelf, then down to its place, the
 * paper rippling; a hovered sheet shows a cross, and a click takes it out
 * (it just goes).
 * Drawn on a canvas over the area's column (no pointer events), in CSS
 * pixels (x right, y up, z towards the viewer), seen in perspective from in
 * front of the shelf and a little above; the shelf runs along the bottom of
 * `area`, which takes the pointer. Draws only while something moves; the
 * shadows are drawn once all is still; when the area moves up or down, the
 * canvas glides with it (slide()) and the scene is placed again after. */

// A sheet's size (a recipe card's proportions, 1 by 1.3), and the room
// between two on the shelf.
const SHEET_W = 148;
const SHEET_H = 192;
const SHEET_GAP = 18;
// Its texture: as many texels as the screen has pixels where the sheet
// stands (square to the camera, about one pixel per unit), so the title
// reads sharp; twice at least.
const TEXTURE_SCALE = Math.max(2, Math.ceil(Math.min(window.devicePixelRatio, 2)));
const SHELF_THICKNESS = 14;
const SHELF_DEPTH = 96;
// The shelf's front edge, this far above the area's bottom; the shelf as
// wide as the area.
const SHELF_BOTTOM = 26;
// The eye: in front of the shelf, looking down at it as at the library's
// shelves, close enough for the back to look shorter. Always as far: the
// shelf moving up or down is then the same picture, moved.
const CAMERA_TILT = 0.4;
const REST_LEAN = -CAMERA_TILT;
const CAMERA_DISTANCE = 950;
// The canvas covers the area's column and this much on either side (a
// flight's paper ripples over its edge). The screen's own resolution at rest
// (sharp text), less while sheets fly, appear or go (smoother).
const CANVAS_MARGIN = 32;
const REST_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);
const MOTION_PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.5);
// A flight rises this far above the sheet's place, in front of the shelf,
// before coming down onto it.
const FLIGHT_RISE = 170;
// The soft shadow at a sheet's foot (see contact-shadow.js).
const FOOT_SHADOW_DEPTH = 24;
// Standing sheets lean back by the camera's own tilt: square to it, they
// look upright on screen; a hovered one rises.
const HOVER_RISE = 8;
const FLIGHT_MS = 1200;
const APPEAR_MS = 260;
const VANISH_MS = 180;
// How fast resting sheets ease to their place (higher = snappier).
const SETTLE_DAMPING = 10;
const PAGE_TEXT = "#241f1b";
const PAGE_TEXT_MUTED = "#7d7265";

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// From a start time, 0 to 1 over `ms` (frames can be timed just before it).
const progress = (now, started, ms) => Math.min(1, Math.max(0, (now - started) / ms));
const damp = (current, target, dt) => target + (current - target) * Math.exp(-SETTLE_DAMPING * dt);

/** `container`: where the canvas and the cross go; `area`: the basket's
 * element (the shelf along its bottom, the pointer read on it);
 * `onRemove(id)`: a sheet clicked. */
export async function createBasketScene({ container, area, onRemove, removeLabel }) {
  await Promise.all([document.fonts.load("600 33px Fraunces"), document.fonts.load("600 20px Inter")]).catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.className = "shopping-shelf-canvas";
  canvas.setAttribute("aria-hidden", "true");
  container.append(canvas);

  const cross = document.createElement("button");
  cross.type = "button";
  cross.className = "shopping-shelf-remove";
  cross.tabIndex = -1;
  cross.setAttribute("aria-hidden", "true");
  cross.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  container.append(cross);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Drawn when all is still (see tick()), not every frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.setPixelRatio(REST_PIXEL_RATIO);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 10, 10000);

  // The library's lights (see library/three/scene.js), the front one
  // stronger: paper faces the viewer.
  scene.add(new THREE.AmbientLight(0xfbe9d6, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffd8b4, 1.15);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.0008;
  scene.add(keyLight, keyLight.target);
  const frontLight = new THREE.DirectionalLight(0xfff5ea, 0.85);
  scene.add(frontLight, frontLight.target);

  const footShadowGeometry = new THREE.PlaneGeometry(SHEET_W * 1.12, FOOT_SHADOW_DEPTH);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1, SHELF_THICKNESS, SHELF_DEPTH), getWoodMaterial());
  shelf.receiveShadow = true;
  shelf.castShadow = true;
  scene.add(shelf);

  // --- Screen and world ----------------------------------------------------

  // The canvas: from `left` (page pixels), `width` wide, the window's
  // height.
  let left = 0;
  let width = 1;
  let height = 1;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const scratch = new THREE.Vector3();

  // Page coordinates to the canvas's, minus its glide if any (slide()).
  function setNdc(x, y) {
    const shift = sliding ? canvasShift() : 0;
    ndc.set(((x - left) / width) * 2 - 1, -(((y - shift) / height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
  }

  // The point at depth `z` seen at screen (x, y).
  function screenToWorld(x, y, z) {
    setNdc(x, y);
    plane.constant = -z;
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  function worldToScreen(point) {
    scratch.copy(point).project(camera);
    const shift = sliding ? canvasShift() : 0;
    return { x: left + ((scratch.x + 1) / 2) * width, y: ((1 - scratch.y) / 2) * height + shift };
  }

  // The shelf: top face's front edge at y = shelfTop, z = 0.
  let shelfTop = 0;
  let shelfLeft = 0;
  let shelfWidth = 1;

  function fit() {
    const rect = area.getBoundingClientRect();
    left = Math.max(0, Math.floor(rect.left - CANVAS_MARGIN));
    width = Math.min(window.innerWidth, Math.ceil(rect.right + CANVAS_MARGIN)) - left;
    height = window.innerHeight;
    Object.assign(canvas.style, { left: `${left}px`, width: `${width}px`, height: `${height}px` });
    renderer.setSize(width, height, false);
    place();
    wake();
  }

  // The eye and the shelf, where the area is now.
  function place() {
    const rect = area.getBoundingClientRect();
    placedShift = areaShift();

    // The eye in front of the sheets' middle, CAMERA_DISTANCE away: the
    // projection centred there (a view offset in a frame twice the
    // window's), one pixel per unit on the plane z = 0, the canvas its part
    // of the window.
    const eyeX = rect.left + rect.width / 2;
    const eyeY = rect.bottom - SHELF_BOTTOM - SHEET_H / 2;
    const frameW = 2 * window.innerWidth;
    const frameH = 2 * window.innerHeight;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(frameH / 2 / CAMERA_DISTANCE));
    camera.aspect = frameW / frameH;
    camera.setViewOffset(frameW, frameH, frameW / 2 - eyeX + left, frameH / 2 - eyeY, width, height);
    const look = new THREE.Vector3(eyeX, -eyeY, 0);
    camera.position.set(
      look.x,
      look.y + Math.sin(CAMERA_TILT) * CAMERA_DISTANCE,
      Math.cos(CAMERA_TILT) * CAMERA_DISTANCE
    );
    camera.lookAt(look);
    camera.updateMatrixWorld();

    // The front edge from the area's left to its right, as seen.
    const front = rect.bottom - SHELF_BOTTOM;
    const leftEnd = screenToWorld(rect.left, front, 0);
    const rightEnd = screenToWorld(rect.right, front, 0);
    shelfLeft = leftEnd.x;
    shelfWidth = Math.max(SHEET_W * 2, rightEnd.x - leftEnd.x);
    shelfTop = leftEnd.y;
    shelf.scale.x = shelfWidth;
    shelf.position.set(shelfLeft + shelfWidth / 2, shelfTop - SHELF_THICKNESS / 2, -SHELF_DEPTH / 2);

    // The key light from the front left, its shadows covering the shelf.
    const target = new THREE.Vector3(shelf.position.x, shelfTop, -SHELF_DEPTH / 2);
    keyLight.target.position.copy(target);
    keyLight.position.copy(target).add(new THREE.Vector3(-500, 900, 700));
    Object.assign(keyLight.shadow.camera, {
      left: -shelfWidth / 2 - 200,
      right: shelfWidth / 2 + 200,
      top: 400,
      bottom: -400,
      near: 1,
      far: 3000,
    });
    keyLight.shadow.camera.updateProjectionMatrix();
    frontLight.target.position.copy(target);
    frontLight.position.copy(target).add(new THREE.Vector3(0, 200, 1500));

    layout(true);
    shadowsStale = true;
  }

  // --- The area moving: the canvas glides with it --------------------------

  // The area's vertical move (its CSS translate) when last placed, and
  // whether the canvas is gliding.
  let placedShift = 0;
  let sliding = false;
  let slideTimer = null;
  let slideFrame = null;

  const translateY = (element) => parseFloat(getComputedStyle(element).translate.split(" ")[1] ?? "0") || 0;
  const areaShift = () => translateY(area);
  const canvasShift = () => translateY(canvas);

  // The area moves to the translate `target` over `ms`, eased as `easing`:
  // the canvas, a picture of the scene, moves with it on the compositor,
  // nothing drawn or measured meanwhile; then the scene is placed where the
  // area ends and drawn once.
  function slide(target, ms, easing) {
    clearTimeout(slideTimer);
    cancelAnimationFrame(slideFrame);
    sliding = true;
    canvas.style.transition = `translate ${ms}ms ${easing}`;
    canvas.style.translate = `0 ${target - placedShift}px`;
    // Ended once the area is really there: its move may start a frame or two
    // late (the first time, say), and placing it early would make it jump.
    const settle = () => {
      if (Math.abs(areaShift() - target) > 0.5) {
        slideFrame = requestAnimationFrame(settle);
        return;
      }
      sliding = false;
      canvas.style.transition = "none";
      canvas.style.translate = "";
      // Drawn in the same step, shadows included: no frame in between.
      place();
      renderer.shadowMap.needsUpdate = true;
      shadowsStale = false;
      draw();
    };
    slideTimer = setTimeout(settle, ms);
  }

  // --- Sheets --------------------------------------------------------------

  // { id, mesh, base (the flat geometry's positions), rest: {position,
  //   rotation}, state: "resting" | "flying" | "appearing" | "vanishing",
  //   started, flight }
  const sheets = [];
  // Cards a recipe was picked from, flown from on the next sync.
  const origins = new Map();
  let hovered = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function wrapLines(ctx, text, maxWidth) {
    const lines = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // The sheet's face: the book's paper, the title, the servings at the foot.
  function paintSheet({ title, meta, color }) {
    const s = TEXTURE_SCALE;
    const paper = document.createElement("canvas");
    paper.width = SHEET_W * s;
    paper.height = SHEET_H * s;
    const ctx = paper.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, paper.width, paper.height);
    const sheen = ctx.createLinearGradient(0, 0, 0, paper.height);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.18)");
    sheen.addColorStop(1, "rgba(0, 0, 0, 0.04)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, paper.width, paper.height);

    const pad = 13.5 * s;
    ctx.fillStyle = PAGE_TEXT;
    ctx.font = `600 ${14.5 * s}px Fraunces, Georgia, serif`;
    ctx.textBaseline = "top";
    const lines = wrapLines(ctx, title, paper.width - 2 * pad).slice(0, 5);
    lines.forEach((line, i) => ctx.fillText(line, pad, pad + 3 * s + i * 18.5 * s));

    ctx.fillStyle = PAGE_TEXT_MUTED;
    ctx.font = `600 ${8.7 * s}px Inter, sans-serif`;
    ctx.textBaseline = "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${0.6 * s}px`;
    ctx.fillText(meta.toUpperCase(), pad, paper.height - pad);

    const texture = new THREE.CanvasTexture(paper);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Seen at about its own size: no mipmaps, which would soften it.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    // Sent to the graphics card now, not on the flight's first frame.
    renderer.initTexture(texture);
    return texture;
  }

  function createSheet(recipe) {
    const geometry = new THREE.PlaneGeometry(SHEET_W, SHEET_H, 8, 10).translate(0, SHEET_H / 2, 0);
    const map = paintSheet(recipe);
    // Lit, and a little self-lit: paper reads as light as the cards below.
    const material = new THREE.MeshStandardMaterial({
      map,
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: 0.28,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = recipe.id;
    scene.add(mesh);
    const footShadow = new THREE.Mesh(footShadowGeometry, getContactShadowMaterial().clone());
    footShadow.rotation.x = -Math.PI / 2;
    footShadow.material.opacity = 0;
    scene.add(footShadow);
    return {
      id: recipe.id,
      mesh,
      footShadow,
      base: Float32Array.from(geometry.attributes.position.array),
      rest: { position: new THREE.Vector3(), rotation: new THREE.Euler(REST_LEAN, 0, 0) },
      state: "resting",
      started: 0,
      flight: null,
    };
  }

  // Places on the shelf, in basket order: spaced, or overlapping once they
  // no longer fit, later ones in front.
  function layout(instant = false) {
    const standing = sheets.filter((sheet) => sheet.state !== "vanishing");
    const count = standing.length;
    const usable = shelfWidth - 2 * SHEET_GAP;
    const step = count > 1 ? Math.min(SHEET_W + SHEET_GAP, (usable - SHEET_W) / (count - 1)) : 0;
    const start = shelfLeft + shelfWidth / 2 - (SHEET_W + step * (count - 1)) / 2 + SHEET_W / 2;
    standing.forEach((sheet, index) => {
      sheet.rest.position.set(start + index * step, shelfTop, -SHELF_DEPTH * 0.3 + index * 0.5);
      if (instant && sheet.state === "resting") {
        sheet.mesh.position.copy(sheet.rest.position);
        sheet.mesh.rotation.copy(sheet.rest.rotation);
        placeFootShadow(sheet, sheet.footShadow.material.opacity);
      }
    });
  }

  function dispose(sheet) {
    scene.remove(sheet.mesh, sheet.footShadow);
    sheet.mesh.geometry.dispose();
    sheet.mesh.material.map.dispose();
    sheet.mesh.material.dispose();
    sheet.footShadow.material.dispose();
  }

  // On the shelf under the sheet's foot, as dark as the sheet is there.
  function placeFootShadow(sheet, opacity) {
    const { mesh, footShadow } = sheet;
    footShadow.position.set(mesh.position.x, shelfTop + 0.4, mesh.position.z - 4);
    footShadow.rotation.z = -mesh.rotation.y;
    footShadow.material.opacity = opacity;
  }

  // A flight from the card's rectangle: lifts off it at its size and goes
  // to its place on a gentle arc, the paper rippling on the way.
  function launch(sheet, rect, now) {
    const from = screenToWorld(rect.left + rect.width / 2, rect.bottom, 60);
    const right = screenToWorld(rect.right, rect.bottom, 60);
    const side = Math.random() < 0.5 ? -1 : 1;
    sheet.state = "flying";
    sheet.started = now;
    sheet.flight = { from, side, scale: (2 * from.distanceTo(right)) / SHEET_W };
    sheet.mesh.position.copy(from);
    sheet.mesh.rotation.set(-CAMERA_TILT, 0, 0);
  }

  const bezier = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return p0
      .clone()
      .multiplyScalar(u * u * u)
      .addScaledVector(p1, 3 * u * u * t)
      .addScaledVector(p2, 3 * u * t * t)
      .addScaledVector(p3, t * t * t);
  };

  // The paper's ripple: waves along it, strongest mid-flight.
  function ripple(sheet, strength, time) {
    const positions = sheet.mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i += 1) {
      const x = sheet.base[i * 3];
      const y = sheet.base[i * 3 + 1];
      const u = x / SHEET_W + 0.5;
      const v = y / SHEET_H;
      const wave =
        Math.sin(u * 3 + time * 9) * 12 * (0.35 + 0.65 * v) + Math.sin(v * 3.5 - time * 7) * 7 + (u - 0.5) ** 2 * 18;
      positions.setZ(i, wave * strength);
    }
    positions.needsUpdate = true;
    sheet.mesh.geometry.computeVertexNormals();
  }

  function flatten(sheet) {
    sheet.mesh.geometry.attributes.position.array.set(sheet.base);
    sheet.mesh.geometry.attributes.position.needsUpdate = true;
    sheet.mesh.geometry.computeVertexNormals();
  }

  function stepFlight(sheet, now) {
    const t = progress(now, sheet.started, FLIGHT_MS);
    const e = easeInOutCubic(t);
    const { from, side, scale } = sheet.flight;
    const to = sheet.rest.position;
    const rest = sheet.rest.rotation;
    // Up in front of the shelf (never through it), over, and down onto it;
    // the top kept on screen, still clear of the shelf.
    const ceiling = screenToWorld(left + width / 2, 12, 140).y - SHEET_H;
    const top = Math.max(to.y + 40, Math.min(Math.max(from.y, to.y) + FLIGHT_RISE, ceiling));
    const up = new THREE.Vector3(from.x, top, 140);
    const over = new THREE.Vector3(to.x, top, 70);
    sheet.mesh.position.copy(bezier(from, up, over, to, e));
    const bend = Math.sin(Math.PI * t);
    sheet.mesh.rotation.set(
      THREE.MathUtils.lerp(-CAMERA_TILT, rest.x, e) + bend * 0.16,
      THREE.MathUtils.lerp(0, rest.y, e) + bend * 0.2 * side,
      THREE.MathUtils.lerp(0, rest.z, e)
    );
    sheet.mesh.scale.setScalar(THREE.MathUtils.lerp(scale, 1, e));
    // The paper ripples mid-flight, flat on landing; its shadow comes as it
    // nears the shelf.
    ripple(sheet, bend * 0.7, now / 1000);
    placeFootShadow(sheet, Math.max(0, (t - 0.8) / 0.2));
    if (t < 1) return true;
    flatten(sheet);
    sheet.mesh.scale.setScalar(1);
    sheet.state = "resting";
    sheet.flight = null;
    return false;
  }

  // --- Frames: only while something moves ------------------------------------

  let frame = null;
  let lastTime = null;

  function wake() {
    if (frame === null) frame = requestAnimationFrame(tick);
  }

  // Shadows to draw again once all is still.
  let shadowsStale = true;

  // The resolution for what's happening (see REST_PIXEL_RATIO), changed
  // just before drawing: no frame in between.
  function setResolution(ratio) {
    if (renderer.getPixelRatio() === ratio) return;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
  }

  function draw() {
    const moving = sheets.some((sheet) => sheet.state !== "resting");
    setResolution(moving ? MOTION_PIXEL_RATIO : REST_PIXEL_RATIO);
    renderer.render(scene, camera);
    placeCross();
  }

  function tick(now) {
    frame = null;
    const dt = lastTime === null ? 0 : Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    let busy = false;
    for (const sheet of [...sheets]) {
      const { mesh, rest } = sheet;
      if (sheet.state === "flying") {
        busy = stepFlight(sheet, now) || busy;
        if (sheet.state === "flying") continue;
      }
      if (sheet.state === "vanishing") {
        const t = progress(now, sheet.started, VANISH_MS);
        mesh.material.opacity = 1 - t;
        sheet.footShadow.material.opacity = 1 - t;
        mesh.scale.setScalar(1 - 0.06 * t);
        if (t >= 1) {
          dispose(sheet);
          sheets.splice(sheets.indexOf(sheet), 1);
        } else {
          busy = true;
        }
        continue;
      }
      if (sheet.state === "appearing") {
        const t = progress(now, sheet.started, APPEAR_MS);
        mesh.material.opacity = easeOutCubic(t);
        if (t >= 1) sheet.state = "resting";
        else busy = true;
      }
      // Resting: eased to its place, risen while hovered.
      const lift = sheet === hovered ? HOVER_RISE : 0;
      const targetY = rest.position.y + lift;
      const targetLean = rest.rotation.x;
      mesh.position.x = damp(mesh.position.x, rest.position.x, dt);
      mesh.position.y = damp(mesh.position.y, targetY, dt);
      mesh.position.z = damp(mesh.position.z, rest.position.z + lift, dt);
      mesh.rotation.x = damp(mesh.rotation.x, targetLean, dt);
      mesh.rotation.y = damp(mesh.rotation.y, rest.rotation.y, dt);
      mesh.rotation.z = damp(mesh.rotation.z, rest.rotation.z, dt);
      const off =
        Math.abs(mesh.position.x - rest.position.x) +
        Math.abs(mesh.position.y - targetY) +
        Math.abs(mesh.rotation.x - targetLean) * 100;
      if (off > 0.05) busy = true;
      placeFootShadow(sheet, mesh.material.opacity * (sheet === hovered ? 0.6 : 1));
    }
    // Shadows: kept as they were while things move, drawn again on the frame
    // all comes to rest.
    if (busy) shadowsStale = true;
    else if (shadowsStale) {
      renderer.shadowMap.needsUpdate = true;
      shadowsStale = false;
    }
    draw();
    if (busy) wake();
    else lastTime = null;
  }

  // --- Pointer: hover, cross, click ------------------------------------------

  function placeCross() {
    if (!hovered || hovered.state === "vanishing") {
      cross.classList.remove("is-shown");
      return;
    }
    const centre = worldToScreen(hovered.mesh.localToWorld(new THREE.Vector3(0, SHEET_H / 2, 0)));
    cross.style.translate = `${centre.x}px ${centre.y}px`;
    cross.classList.add("is-shown");
  }

  function sheetAt(x, y) {
    setNdc(x, y);
    const resting = sheets.filter((sheet) => sheet.state === "resting" || sheet.state === "appearing");
    const hit = raycaster.intersectObjects(resting.map((sheet) => sheet.mesh), false)[0];
    return hit ? resting.find((sheet) => sheet.mesh === hit.object) : null;
  }

  function setHovered(sheet) {
    if (sheet === hovered) return;
    hovered = sheet;
    area.classList.toggle("is-pointing", Boolean(sheet));
    cross.setAttribute("aria-label", sheet ? removeLabel(sheet.id) : "");
    wake();
  }

  const onPointerMove = (event) => setHovered(sheetAt(event.clientX, event.clientY));
  const onPointerLeave = (event) => {
    if (event.relatedTarget !== cross) setHovered(null);
  };
  const onClick = (event) => {
    const sheet = sheetAt(event.clientX, event.clientY) ?? (event.currentTarget === cross ? hovered : null);
    if (sheet) onRemove(sheet.id);
  };
  area.addEventListener("pointermove", onPointerMove);
  area.addEventListener("pointerleave", onPointerLeave);
  area.addEventListener("click", onClick);
  cross.addEventListener("click", onClick);
  cross.addEventListener("pointerleave", (event) => {
    if (!area.contains(event.relatedTarget)) setHovered(null);
  });

  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(area);
  window.addEventListener("resize", fit);
  // A narrow window scrolls the page: the shelf follows its area.
  window.addEventListener("scroll", fit, { passive: true });
  fit();

  // The sheets' shaders made now, not on a first flight: a sheet drawn once
  // and dropped.
  const warmUp = createSheet({ id: "", title: "", meta: "", color: "#ffffff" });
  warmUp.mesh.position.copy(shelf.position);
  renderer.compile(scene, camera);
  dispose(warmUp);

  return {
    /** The area moves to its translate `target` (px) over `ms`, eased as
     * `easing` (a layout transition): the shelf goes with it. */
    slide,
    /** The area's place changed at once: the shelf placed again. */
    refit() {
      place();
      wake();
    },
    /** The next sync flies this recipe up from the card's rectangle. */
    flyFrom(id, rect) {
      origins.set(id, rect);
    },
    /** The basket now: [{ id, title, meta, color }], in order. New ones
     * fly in (or fade in), gone ones vanish, the rest make room. */
    sync(recipes) {
      const now = performance.now();
      const wanted = new Set(recipes.map((recipe) => recipe.id));
      for (const sheet of sheets) {
        if (wanted.has(sheet.id) || sheet.state === "vanishing") continue;
        sheet.state = "vanishing";
        sheet.started = now;
        flatten(sheet);
        if (sheet === hovered) setHovered(null);
      }
      const byId = new Map(sheets.filter((sheet) => sheet.state !== "vanishing").map((sheet) => [sheet.id, sheet]));
      const ordered = recipes.map((recipe) => {
        if (byId.has(recipe.id)) return byId.get(recipe.id);
        const sheet = createSheet(recipe);
        const rect = origins.get(recipe.id);
        if (rect && !reducedMotion.matches) {
          launch(sheet, rect, now);
        } else {
          sheet.state = "appearing";
          sheet.started = now;
          sheet.mesh.material.opacity = 0;
        }
        return sheet;
      });
      origins.clear();
      const leaving = sheets.filter((sheet) => sheet.state === "vanishing");
      sheets.length = 0;
      sheets.push(...ordered, ...leaving);
      layout();
      // Placed at once where they rest when they appear without flying.
      for (const sheet of ordered) {
        if (sheet.state !== "appearing" || sheet.mesh.position.lengthSq() > 0) continue;
        sheet.mesh.position.copy(sheet.rest.position);
        sheet.mesh.rotation.copy(sheet.rest.rotation);
      }
      wake();
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      clearTimeout(slideTimer);
      cancelAnimationFrame(slideFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit);
      area.removeEventListener("pointermove", onPointerMove);
      area.removeEventListener("pointerleave", onPointerLeave);
      area.removeEventListener("click", onClick);
      for (const sheet of sheets) dispose(sheet);
      footShadowGeometry.dispose();
      shelf.geometry.dispose();
      renderer.dispose();
      canvas.remove();
      cross.remove();
    },
  };
}
