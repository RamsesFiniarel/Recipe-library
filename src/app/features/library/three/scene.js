import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import {
  loadBookAsset,
  createBookInstance,
  updateBookInstanceColors,
  facePicturesSettled,
  faceMapChangeCount,
} from "./book-asset.js";
import { getWoodMaterial } from "./wood-texture.js";
import { getContactShadowMaterial } from "./contact-shadow.js";
import { loadPepperMill } from "./pepper-mill.js";
import { loadOliveOilBottle } from "./olive-oil.js";
import { loadSaltMill } from "./salt.js";
import { layoutBooksIntoShelves, splitShelfLeftRight } from "./layout.js";
import { widthMultiplierForRecipeCount, heightMultiplierForId } from "./book-sizing.js";
import { hexForColorToken, hexForPageColorToken, darken } from "@shared/palette.js";

const TARGET_BOOK_HEIGHT = 1;
const SHELF_INNER_WIDTH = 2.3;
const SHELF_MARGIN = 0.18;
const SHELF_THICKNESS = 0.06;
// How quickly the view glides down to a shelf just added.
const SCROLL_GLIDE_DAMPING = 5;
const FOV_DEGREES = 42;
const CAMERA_DOWN_RATIO = 0.26; // slightly high: the top of the pages stays visible
const CAMERA_RIGHT_RATIO = 0.16; // mild three-quarter angle from the right
const DRAG_THRESHOLD_PX = 6;
// How far a dragged book lifts towards the camera (world Z), clearing every
// neighbour it slides past.
const BOOK_DRAG_LIFT_RATIO = 1.3; // multiplied by the book's own depth
// Perspective makes a slot feel further than it is while dragging: the
// reflow triggers this early (times the book's width, towards the cursor's
// approach). See computeInsertionIndex().
const DRAG_SNAP_LOOKAHEAD_RATIO = 0.5;
// How fast the dragged book follows the cursor (feels attached); books
// moving out of its way are gentler.
const BOOK_DRAG_FOLLOW_DAMPING = 18;
const BOOK_REFLOW_DAMPING = 9;
// Holding a dragged book near the canvas's top or bottom edge scrolls the
// shelves (world units/s at the edge, down to 0 at the margin).
const AUTO_SCROLL_MARGIN_PX = 90;
const AUTO_SCROLL_SPEED = 2.2;
// Extra scroll room below the last centred shelf (see maxScrollY in refit()).
const BOTTOM_SCROLL_MARGIN = -0.3;
// ...and in edit mode, room for the "+" under the last shelf.
const EDIT_BOTTOM_ROOM = 0.9;
const CROSSFADE_DURATION = 0.2;
// Pointer parallax: the camera orbits its look-at point at a constant
// distance, horizontally and vertically at once. Each value is the swing at
// full pointer travel on that axis (NDC +/-1).
const MOUSE_ORBIT_ANGLE_X = -THREE.MathUtils.degToRad(1);
const MOUSE_ORBIT_ANGLE_Y = -THREE.MathUtils.degToRad(1);
// Smoothing speed (per second) towards the pointer's angle: a soft lag.
const MOUSE_ORBIT_DAMPING = 4;
// How fast the camera eases between three-quarter and edit mode's frontal
// view (editModeT).
const EDIT_MODE_DAMPING = 4;
// The canvas stays full-screen behind the edit panel; the projection shifts
// sideways (lens shift) to centre the shelves in the uncovered area. Half
// the panel's width ratio: keep in sync with .library-edit-panel (see
// applyEditModeViewOffset()).
const EDIT_MODE_PANEL_WIDTH_RATIO = 0.4;
const EDIT_MODE_VIEW_SHIFT = EDIT_MODE_PANEL_WIDTH_RATIO / 2;
// Camera distance while editing, as a multiplier of the normal one (> 1 is
// further), blended by editModeT. Drag and scroll sensitivity keep the
// plain distance.
const EDIT_MODE_DISTANCE_MULTIPLIER = 1.2;

// Opening a book, two separately timed animations:
//   1. "pull out": the book slides out of the shelf;
//   2. "turn": it faces the camera and grows past the screen while
//      "FullOpening" spreads the covers.
// The canvas then fades into the page background before navigating.
const PULL_OUT_DURATION = 0.45; // seconds, animation 1
const TURN_DURATION = 0.8; // seconds, animation 2
// Where in animation 1 (0-1) animation 2 starts: 1 is sequential, less
// overlaps (animation 2 starts from animation 1's live state). Below ~0.8
// the book may clip through its neighbours before clearing them.
const TURN_START_RATIO = 0.5;
// Seconds after the click when animation 2 starts: only for the canvas fade
// and navigation timing.
const TURN_START_TIME = TURN_START_RATIO * PULL_OUT_DURATION;
// Above 1 overflows the frame, on top of the exact fit on the tightest axis.
const OPEN_FILL_RATIO = 1.2;
// The fade starts at 55% of animation 2, whatever durations are configured.
const CANVAS_FADE_DELAY_MS = (TURN_START_TIME + TURN_DURATION * 0.55) * 1000;
const CANVAS_FADE_DURATION_MS = 520; // keep in sync with .library-canvas in the CSS
const NAVIGATE_DELAY_MS = CANVAS_FADE_DELAY_MS + CANVAS_FADE_DURATION_MS + 40;

// The reflection light's offset from the look-at point, and its intensity.
const REFLECTION_LIGHT_OFFSET = new THREE.Vector3(-1.1, 1.1, 3.4);
const REFLECTION_LIGHT_INTENSITY = 5;

const SPINE_AXIS = new THREE.Vector3(0, 0, 1); // the spine faces the aisle
// Fully opened, the covers' outside still faces the aisle: a 180deg turn
// shows the pages instead.
const OPEN_Y_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/** Smooth acceleration then deceleration. */
function easeInOut(t) {
  return (t * t) / (2 * (t * t - t) + 1);
}

// Hero <-> library camera move: the CSS curve of the title and search bar
// (--hero-ease), so scene and overlay move as one.
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export async function createLibraryScene({
  canvas,
  container,
  books,
  onBookClick,
  onBookOpening,
  onBookFading,
  onHoverChange,
  onHoverMove,
  onBookSelectForEdit,
  onBooksReordered,
  // Starts in the hero framing (second shelf as wide as the window), left by
  // setHero(false).
  hero = false,
  heroTransitionMs = 1000,
  // A touch drag in the hero framing: the page decides to leave it.
  onHeroExitRequest = () => {},
  // Shelves pushed past their top on purpose ("wheel" or "drag", see
  // HERO_RETURN_*): the page decides to bring the hero back.
  onHeroReturnRequest = () => {},
  // The add-shelf "+" position, { visible, x, y } in container pixels: shown
  // in edit mode at the end of the shelves (reportShelfEnd()).
  onShelfEndChange = () => {},
  // Shelf objects shown, by key (preferences.js); all unless turned off.
  shelfObjects = {},
}) {
  const [asset, pepperMill, oliveOilBottle, saltMill] = await Promise.all([
    loadBookAsset(),
    loadPepperMill(),
    loadOliveOilBottle(),
    loadSaltMill(),
  ]);

  const { size } = asset;
  const baseScale = TARGET_BOOK_HEIGHT / size.y;
  const baseBookWidth = size.x * baseScale;
  const baseBookDepth = size.z * baseScale;
  const shelfGap = TARGET_BOOK_HEIGHT + 0.42;
  // Open book width, normalised (computeOpenTarget): never widened by the
  // spine tier, so any opened book overflows the screen.
  const OPEN_WIDTH_ESTIMATE = baseBookDepth * 2.1;
  // How far the book slides out: just clear of its neighbours' depth before
  // turning.
  const PULL_OUT_DISTANCE = baseBookDepth * 1.1 + SHELF_MARGIN * 0.5;
  // Drag lift (see BOOK_DRAG_LIFT_RATIO): clears every neighbour passed.
  const BOOK_DRAG_LIFT_DISTANCE = baseBookDepth * BOOK_DRAG_LIFT_RATIO;
  const DRAG_SNAP_LOOKAHEAD = baseBookWidth * DRAG_SNAP_LOOKAHEAD_RATIO;

  const woodMaterial = getWoodMaterial();
  const shelfGeometry = new THREE.BoxGeometry(
    SHELF_INNER_WIDTH + SHELF_MARGIN * 2,
    SHELF_THICKNESS,
    baseBookDepth + 0.22
  );

  // Fake contact shadow (contact-shadow.js): a shared plane scaled to each
  // book's footprint, just above the shelf.
  const contactShadowGeometry = new THREE.PlaneGeometry(1, 1);
  const contactShadowMaterial = getContactShadowMaterial();
  const CONTACT_SHADOW_LIFT = 0.003; // clears the shelf's top face, no z-fighting
  const CONTACT_SHADOW_WIDTH_RATIO = 1.15; // a little wider than the book itself
  const CONTACT_SHADOW_DEPTH_RATIO = 1.3; // and a little deeper, towards the back
  // Room a shelf object needs: its footprint plus a margin each side (see
  // refitDecorations()).
  const SHELF_OBJECT_EDGE_MARGIN = 0.05;
  // Gap between two objects sharing a shelf.
  const SHELF_OBJECT_SPACING = 0.06;
  // Salt and pepper stand almost touching - they read as a matched pair.
  const SALT_PEPPER_GAP = 0.005;
  // The salt sits this much closer to the aisle than the pepper mill, so the
  // pair isn't a flat row.
  const SALT_PEPPER_DEPTH_OFFSET = 0.1;

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(FOV_DEGREES, 1, 0.1, 100);

  const ambient = new THREE.AmbientLight(0xfbe9d6, 0.5);
  scene.add(ambient);

  // Key light, from the front left (negative X, positive Z = viewer side).
  const keyLight = new THREE.DirectionalLight(0xffd8b4, 1.15);
  keyLight.position.set(-2.5, 6, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.radius = 2.5;
  keyLight.shadow.bias = -0.0015;
  scene.add(keyLight);
  scene.add(keyLight.target);

  // Soft light from the aisle on the faces we look at.
  const frontLight = new THREE.DirectionalLight(0xfff5ea, 0.4);
  frontLight.position.set(0, 1.5, 6);
  scene.add(frontLight);

  // Fill light, opposite the key, softening shadows.
  const fillLight = new THREE.DirectionalLight(0xd9c6ad, 0.2);
  fillLight.position.set(3, 2, 2);
  scene.add(fillLight);

  // Reflection: a soft rectangular "window" up and left of the camera, a
  // sheen sliding over glossy covers. Follows the camera's scroll.
  RectAreaLightUniformsLib.init();
  const reflectionLight = new THREE.RectAreaLight(0xfff4e6, REFLECTION_LIGHT_INTENSITY, 1.1, 2.6);
  scene.add(reflectionLight);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Per-book width (recipe-count tier or override) and height (stable +/-10%
  // by id or override), resolved once per mount.
  const sizedBooks = books.map((book) => ({
    ...book,
    width: baseBookWidth * (book.widthMultiplier ?? widthMultiplierForRecipeCount(book.recipeCount)),
    heightMultiplier: book.heightMultiplier ?? heightMultiplierForId(book.id),
  }));
  const sizedBookById = new Map(sizedBooks.map((book) => [book.id, book]));
  const pivotById = new Map();

  // A stable random left/right split per row (see layout.js), rolled lazily.
  const rowSeeds = [];
  function getRowSeed(rowIndex) {
    if (rowSeeds[rowIndex] === undefined) rowSeeds[rowIndex] = Math.random();
    return rowSeeds[rowIndex];
  }

  /** Places one (row, side) group of ids from the shelf edge towards the gap,
   * writing each slot into `slots`. Returns the gap boundary on that side. */
  function placeSide(ids, side, rowY, rowIndex, slots) {
    let cursor = side === "left" ? -SHELF_INNER_WIDTH / 2 : SHELF_INNER_WIDTH / 2;
    for (const id of ids) {
      const book = sizedBookById.get(id);
      const x = side === "left" ? cursor + book.width / 2 : cursor - book.width / 2;
      slots.set(id, { x, rowY, rowIndex, side });
      cursor += side === "left" ? book.width : -book.width;
    }
    return cursor;
  }

  const bookInstances = [];

  function resolveBookColors(book) {
    const coverHex = book.coverColor || hexForColorToken(book.colorToken);
    const pageLightHex = hexForPageColorToken(book.pageColorToken);
    return {
      coverHex,
      pageLightHex,
      pageDarkHex: darken(pageLightHex),
      style: book.coverStyle,
      gloss: book.coverGloss,
      coverTexture: book.coverTexture,
      spineTexture: book.spineTexture,
      backTexture: book.backTexture,
    };
  }

  function placeBook(book, x, rowY) {
    const { pivot, mesh, mixer, actions } = createBookInstance(asset, resolveBookColors(book));

    pivot.scale.set(baseScale * (book.width / baseBookWidth), baseScale * book.heightMultiplier, baseScale);
    pivot.position.set(x, rowY, 0);

    const contactShadow = new THREE.Mesh(contactShadowGeometry, contactShadowMaterial);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.scale.set(book.width * CONTACT_SHADOW_WIDTH_RATIO, baseBookDepth * CONTACT_SHADOW_DEPTH_RATIO, 1);
    contactShadow.position.set(x, rowY + CONTACT_SHADOW_LIFT, -baseBookDepth / 2);
    scene.add(contactShadow);

    pivot.userData = {
      id: book.id,
      title: book.title,
      recipeCount: book.recipeCount,
      // Kept so updateBookColors() can fall back to the colour token when a
      // custom cover colour is cleared.
      colorToken: book.colorToken,
      coverColor: book.coverColor,
      pageColorToken: book.pageColorToken,
      coverStyle: book.coverStyle,
      coverGloss: book.coverGloss,
      coverTexture: book.coverTexture,
      spineTexture: book.spineTexture,
      backTexture: book.backTexture,
      mesh,
      mixer,
      actions,
      opening: false,
      contactShadow,
      // The slot this pivot (and its shadow) eases towards each frame; changed by
      // drags (startBookDrag()/finishBookDrag()).
      targetX: x,
      targetRowY: rowY,
      targetZ: 0,
    };
    scene.add(pivot);
    bookInstances.push(pivot);
    pivotById.set(book.id, pivot);
  }

  // The shelf structure for this mount, the single source of truth: the
  // books on each row's left and right, edge to gap. Seeded from saved
  // placements (shelfRow/shelfSide/sortOrder); unplaced books get new rows
  // (layoutUnplacedBooksIntoNewRows()). Drags edit it in place, never
  // re-running the layout (whose cuts depend on counts and would reshuffle
  // untouched rows).
  const shelfSideLists = new Map();
  let placedRowCount = 0;
  const unplacedIds = [];
  // Empty shelves are dropped; rows with books close up, in order.
  let rowsClosedUp = false;
  {
    const usedRows = [...new Set(sizedBooks.filter((book) => book.shelfRow != null).map((book) => book.shelfRow))].sort(
      (a, b) => a - b
    );
    const compactRow = new Map(usedRows.map((row, index) => [row, index]));
    rowsClosedUp = usedRows.some((row, index) => row !== index);
    const byGroup = new Map();
    for (const book of sizedBooks) {
      if (book.shelfRow == null || book.shelfSide == null) {
        unplacedIds.push(book.id);
        continue;
      }
      const row = compactRow.get(book.shelfRow);
      placedRowCount = Math.max(placedRowCount, row + 1);
      const key = `${row}:${book.shelfSide}`;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(book);
    }
    for (const [key, groupBooks] of byGroup) {
      groupBooks.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      shelfSideLists.set(key, groupBooks.map((book) => book.id));
    }
  }

  /** Lays unplaced books into new rows after the placed ones (layout.js's
   * width-based algorithm, from startRowIndex). Writes into shelfSideLists;
   * returns the number of rows used. */
  function layoutUnplacedBooksIntoNewRows(ids, startRowIndex) {
    if (ids.length === 0) return 0;
    const shelves = layoutBooksIntoShelves(
      ids.map((id) => sizedBookById.get(id)),
      { shelfInnerWidth: SHELF_INNER_WIDTH, minShelfCount: 1 }
    );
    shelves.forEach((rowBooks, localIndex) => {
      const rowIndex = startRowIndex + localIndex;
      const { left, right } = splitShelfLeftRight(rowBooks, getRowSeed(rowIndex));
      shelfSideLists.set(`${rowIndex}:left`, left.map((book) => book.id));
      shelfSideLists.set(`${rowIndex}:right`, right.map((book) => book.id));
    });
    return shelves.length;
  }

  const newRowCount = layoutUnplacedBooksIntoNewRows(unplacedIds, placedRowCount);
  // Only shelves holding books: grows when a resize pushes books down
  // (applyBookSize()) or a shelf is added (addShelf()), shrinks when a drag
  // empties one (closeUpEmptyRows()).
  let shelfRowCount = Math.max(1, placedRowCount + newRowCount);

  const shelfMeshes = [];
  // Shelves shrinking away (animate()); later ones grow in from their middle.
  const leavingShelves = [];
  let shelvesGrowIn = false;
  function syncShelfMeshes() {
    while (shelfMeshes.length < shelfRowCount) {
      const shelfMesh = new THREE.Mesh(shelfGeometry, woodMaterial);
      shelfMesh.receiveShadow = true;
      shelfMesh.castShadow = true;
      if (shelvesGrowIn) shelfMesh.scale.x = 0.01;
      scene.add(shelfMesh);
      shelfMeshes.push(shelfMesh);
    }
    while (shelfMeshes.length > shelfRowCount) leavingShelves.push(shelfMeshes.pop());
    shelfMeshes.forEach((shelfMesh, rowIndex) => {
      shelfMesh.position.set(0, -rowIndex * shelfGap - SHELF_THICKNESS / 2, -baseBookDepth / 2 + 0.1);
    });
  }
  syncShelfMeshes();
  shelvesGrowIn = true;

  const { slots: initialSlots } = computeRestingLayout();
  for (const book of sizedBooks) {
    const slot = initialSlots.get(book.id);
    placeBook(book, slot.x, slot.rowY);
  }

  // Books placed for the first time get saved, to stay put next time.
  if (unplacedIds.length > 0 || rowsClosedUp) {
    onBooksReordered(buildShelfRowsPayload());
  }

  // Shelf decorations in the gap between a shelf's left and right books,
  // each with a contact shadow. Salt and pepper are one unit (salt slightly
  // forward), the olive oil another. Each starts on its home shelf and moves
  // down when books leave no room; two share a shelf only as a last resort
  // (refitDecorations()).
  function footprintDiameter(object) {
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
    return Math.max(size.x, size.z);
  }

  function createShelfObjectShadow(diameter) {
    const shadow = new THREE.Mesh(contactShadowGeometry, contactShadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.setScalar(diameter * 1.3);
    scene.add(shadow);
    return shadow;
  }

  // Eased each frame like books, so a moved unit slides. An object may cast
  // its shadow under part of itself only: userData.shadowDiameter/Offset.
  const decorationEntries = [];
  function shelfPart(object, depthOffset = 0) {
    const diameter = footprintDiameter(object);
    const shadowOffset = object.userData.shadowOffset ?? new THREE.Vector2();
    const entry = {
      object,
      diameter,
      depthOffset,
      shadow: createShelfObjectShadow(object.userData.shadowDiameter ?? diameter),
      shadowOffset,
      targetX: 0,
      targetRowY: 0,
      targetZ: 0,
    };
    scene.add(object);
    decorationEntries.push(entry);
    return entry;
  }

  function shelfUnit(key, homeRow, parts, partGap = 0) {
    const width = parts.reduce((sum, part) => sum + part.diameter, 0) + partGap * (parts.length - 1);
    // row: its shelf (null: nowhere, no room or turned off); shown: wanted out
    // in the settings.
    return { key, homeRow, parts, partGap, width, row: null, shown: shelfObjects[key] ?? true };
  }

  const shelfUnits = [
    shelfUnit("saltPepper", 0, [shelfPart(saltMill), shelfPart(pepperMill, -SALT_PEPPER_DEPTH_OFFSET)], SALT_PEPPER_GAP),
    shelfUnit("oliveOil", 1, [shelfPart(oliveOilBottle)]),
  ];

  function setDecorationTarget(entry, x, rowY, z, instant) {
    entry.targetX = x;
    entry.targetRowY = rowY;
    entry.targetZ = z;
    if (instant) {
      entry.object.position.set(x, rowY, z);
      entry.shadow.position.set(x + entry.shadowOffset.x, rowY + CONTACT_SHADOW_LIFT, z + entry.shadowOffset.y);
    }
  }

  function applyDecorationVisibility() {
    for (const unit of shelfUnits) {
      for (const part of unit.parts) {
        part.object.visible = unit.row !== null;
        part.shadow.visible = unit.row !== null;
      }
    }
  }

  /** Every book's {x, rowY} slot and every row's gap bounds, computed from
   * shelfSideLists as they are now (first placement, refitDecorations()). */
  function computeRestingLayout() {
    const slots = new Map();
    const shelfGapByRow = [];
    for (let rowIndex = 0; rowIndex < shelfRowCount; rowIndex += 1) {
      const rowY = -rowIndex * shelfGap;
      const leftIds = shelfSideLists.get(`${rowIndex}:left`) ?? [];
      const rightIds = shelfSideLists.get(`${rowIndex}:right`) ?? [];
      const gapLeft = placeSide(leftIds, "left", rowY, rowIndex, slots);
      const gapRight = placeSide(rightIds, "right", rowY, rowIndex, slots);
      shelfGapByRow.push({ rowIndex, rowY, gapLeft, gapRight });
    }
    return { slots, shelfGapByRow };
  }

  /** shelfSideLists as rows for PATCH /books/reorder: sent at mount if books
   * were placed, and after each drag. */
  function buildShelfRowsPayload() {
    const rows = [];
    for (let rowIndex = 0; rowIndex < shelfRowCount; rowIndex += 1) {
      rows.push({
        left: shelfSideLists.get(`${rowIndex}:left`) ?? [],
        right: shelfSideLists.get(`${rowIndex}:right`) ?? [],
      });
    }
    return rows;
  }

  /** Places each shelf object unit for the current layout: at mount
   * (instant) and after each drag. A placed unit only looks at its shelf or
   * lower ones (getting out from under the book that displaced it); an
   * unplaced one searches from its home shelf down, then everywhere. A shelf
   * of its own first, sharing last. */
  function totalWidth(ids) {
    return ids.reduce((sum, id) => sum + sizedBookById.get(id).width, 0);
  }

  function sideIds(rowIndex, side) {
    return shelfSideLists.get(`${rowIndex}:${side}`) ?? [];
  }

  function rowIndexOf(id) {
    for (let rowIndex = 0; rowIndex < shelfRowCount; rowIndex += 1) {
      if (sideIds(rowIndex, "left").includes(id) || sideIds(rowIndex, "right").includes(id)) return rowIndex;
    }
    return -1;
  }

  // A grown book can overflow its row: books move one at a time from the
  // fuller side, nearest the gap, to the next row's start, which may
  // overflow in turn. Rows above, and rows that still fit, stay as they are.
  function pushOverflowingBooks(fromRowIndex) {
    for (let rowIndex = fromRowIndex; rowIndex < shelfRowCount; rowIndex += 1) {
      while (totalWidth(sideIds(rowIndex, "left")) + totalWidth(sideIds(rowIndex, "right")) > SHELF_INNER_WIDTH) {
        const side = totalWidth(sideIds(rowIndex, "left")) >= totalWidth(sideIds(rowIndex, "right")) ? "left" : "right";
        const pushed = sideIds(rowIndex, side).pop();
        if (rowIndex + 1 === shelfRowCount) shelfRowCount += 1;
        const nextKey = `${rowIndex + 1}:${side}`;
        shelfSideLists.set(nextKey, [pushed, ...(shelfSideLists.get(nextKey) ?? [])]);
      }
    }
  }

  /** Sends every book towards its slot in shelfSideLists (eased in animate()). */
  function retargetBooks() {
    const { slots } = computeRestingLayout();
    for (const [id, slot] of slots) {
      const pivot = pivotById.get(id);
      pivot.userData.targetX = slot.x;
      pivot.userData.targetRowY = slot.rowY;
    }
  }

  /** Removes shelves left without books: rows below move up, a shelf object
   * there takes the next shelf. Returns whether any went. */
  function closeUpEmptyRows() {
    const kept = [];
    for (let rowIndex = 0; rowIndex < shelfRowCount; rowIndex += 1) {
      if (sideIds(rowIndex, "left").length + sideIds(rowIndex, "right").length > 0) kept.push(rowIndex);
    }
    if (kept.length === shelfRowCount || kept.length === 0) return false;
    const rows = kept.map((rowIndex) => [sideIds(rowIndex, "left"), sideIds(rowIndex, "right")]);
    shelfSideLists.clear();
    rows.forEach(([left, right], rowIndex) => {
      shelfSideLists.set(`${rowIndex}:left`, left);
      shelfSideLists.set(`${rowIndex}:right`, right);
    });
    for (const unit of shelfUnits) {
      if (unit.row === null) continue;
      unit.row = Math.min(kept.filter((rowIndex) => rowIndex < unit.row).length, kept.length - 1);
    }
    shelfRowCount = kept.length;
    syncShelfMeshes();
    updateShelfBounds();
    // Past the new end: glide back up to it.
    if (scrollY > maxScrollY) scrollGlide = maxScrollY;
    return true;
  }

  // Scale as in placeBook(); the layout then reflows through the usual
  // per-frame easing.
  function applyBookSize(bookId, { widthMultiplier, heightMultiplier }) {
    const book = sizedBookById.get(bookId);
    const pivot = pivotById.get(bookId);
    if (!book || !pivot) return;
    book.width = baseBookWidth * widthMultiplier;
    book.heightMultiplier = heightMultiplier;
    pivot.scale.set(baseScale * widthMultiplier, baseScale * heightMultiplier, baseScale);
    pivot.userData.contactShadow.scale.x = book.width * CONTACT_SHADOW_WIDTH_RATIO;

    const rowIndex = rowIndexOf(bookId);
    if (rowIndex !== -1) pushOverflowingBooks(rowIndex);
    syncShelfMeshes();
    updateShelfBounds();
    retargetBooks();
    refitDecorations();
  }

  function refitDecorations(instant = false) {
    const { shelfGapByRow: gaps } = computeRestingLayout();
    const unitsByRow = new Map();
    const rowWidth = (units) =>
      units.reduce((sum, unit) => sum + unit.width, 0) + SHELF_OBJECT_SPACING * (units.length - 1);
    const fits = (rowIndex, unit) => {
      const { gapLeft, gapRight } = gaps[rowIndex];
      return rowWidth([...(unitsByRow.get(rowIndex) ?? []), unit]) + SHELF_OBJECT_EDGE_MARGIN * 2 <= gapRight - gapLeft;
    };
    const firstRow = (test) => gaps.find(({ rowIndex }) => test(rowIndex))?.rowIndex ?? null;
    // Just come out: straight to their place, no slide from where they were.
    const appearing = new Set();

    for (const unit of shelfUnits) {
      const previousRow = unit.row;
      unit.row = null;
      if (!unit.shown) continue;
      const from = previousRow ?? unit.homeRow;
      const alone = (rowIndex) => !unitsByRow.has(rowIndex) && fits(rowIndex, unit);
      const shared = (rowIndex) => fits(rowIndex, unit);
      unit.row =
        firstRow((rowIndex) => rowIndex >= from && alone(rowIndex)) ??
        (previousRow === null ? firstRow(alone) : null) ??
        firstRow((rowIndex) => rowIndex >= from && shared(rowIndex)) ??
        (previousRow === null ? firstRow(shared) : null);
      if (unit.row === null) continue;
      if (!unitsByRow.has(unit.row)) unitsByRow.set(unit.row, []);
      unitsByRow.get(unit.row).push(unit);
      if (previousRow === null) appearing.add(unit);
    }

    // Each shelf's units side by side, centred in its gap.
    const z = -baseBookDepth / 2;
    for (const [rowIndex, units] of unitsByRow) {
      const { gapLeft, gapRight, rowY } = gaps[rowIndex];
      let x = (gapLeft + gapRight) / 2 - rowWidth(units) / 2;
      for (const unit of units) {
        for (const part of unit.parts) {
          setDecorationTarget(part, x + part.diameter / 2, rowY, z + part.depthOffset, instant || appearing.has(unit));
          x += part.diameter + unit.partGap;
        }
        x += SHELF_OBJECT_SPACING - unit.partGap;
      }
    }

    applyDecorationVisibility();
  }

  refitDecorations(true);

  let maxScrollY = 0;
  let bottomRoom = BOTTOM_SCROLL_MARGIN;
  function updateShelfBounds() {
    const contentHeight = (shelfRowCount - 1) * shelfGap;

    keyLight.target.position.set(0, -contentHeight / 2, 0);
    keyLight.shadow.camera.left = -SHELF_INNER_WIDTH / 2 - 1.5;
    keyLight.shadow.camera.right = SHELF_INNER_WIDTH / 2 + 1.5;
    keyLight.shadow.camera.top = 2;
    keyLight.shadow.camera.bottom = -(contentHeight + 2);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 20;
    keyLight.shadow.camera.updateProjectionMatrix();

    maxScrollY = Math.max(0, contentHeight + bottomRoom);
  }
  updateShelfBounds();

  // Aim height: the first shelf's middle sits near the window centre on
  // load, and the last one's at the end of the scroll.
  const SHELF_CENTER_Y = TARGET_BOOK_HEIGHT * 0.5;
  const initialCameraY = SHELF_CENTER_Y;
  let scrollY = 0;
  // Where scrollY is gliding to, if anywhere (see addShelf()).
  let scrollGlide = null;
  let cameraDistance = 6;
  // Pointer parallax: targetOrbitX/Y is wanted, orbitX/Y the eased angles
  // applied (radians).
  let targetOrbitX = 0;
  let targetOrbitY = 0;
  let orbitX = 0;
  let orbitY = 0;
  // Edit mode: 0 three-quarter, 1 frontal, eased like the orbit.
  let targetEditModeT = 0;
  let editModeT = 0;
  let editMode = false;
  // Hero framing: 1 hero (one shelf filling the width), 0 library. Eased
  // over a fixed duration (heroAnim) to match the CSS transition.
  let heroT = hero ? 1 : 0;
  let heroAnim = null;
  // Hero camera distance relative to the normal one (refit(), aspect-based).
  let heroDistanceRatio = 1;
  // No hovering, opening or scrolling while the hero is up or leaving.
  const heroBlocking = () => heroT > 0.001 || heroAnim !== null;
  // Drawn only when something changed since the last frame (sceneChanged()):
  // at rest it costs nothing. Changes from outside the loop (colours,
  // selection, resize, pictures) call invalidate().
  let invalid = true;
  const invalidate = () => {
    invalid = true;
  };

  // The hero looks slightly above the second shelf (1 = right on it).
  const HERO_SHELF_OFFSET = 1.3;

  // Back to the hero by scrolling up past the top: a gesture starting there
  // needs a short push, one arriving by momentum a much longer one, so
  // browsing never triggers it. The camera gives like a rubber band.
  const HERO_RETURN_WHEEL_PX = 240;
  const HERO_RETURN_WHEEL_ARRIVING_PX = 700;
  const HERO_RETURN_DRAG_PX = 160;
  // Wheel events closer than this are one gesture (as in library.page.js).
  const WHEEL_GESTURE_GAP_MS = 350;
  const HERO_PULL_DISTANCE_RATIO = 0.08; // of the visible height, at full pull
  const HERO_PULL_DAMPING = 10;
  let wheelGestureAtTop = false;
  let lastWheelTime = -Infinity;
  let wheelPull = 0; // accumulated push past the top, px
  let wheelPullTarget = HERO_RETURN_WHEEL_PX; // the push this gesture needs
  let dragPull = 0; // 0..1 while a touch drag pulls past the top
  let pull = 0; // displayed, 0..1

  // A sideways projection shift (same size, no crop); positive x moves the
  // content left. Re-applied while editModeT eases, so the shift animates.
  // The library centres in the uncovered (1 - panel) part of the screen:
  // from w/2 to (1 - panel) * w / 2, a shift of panel * w / 2, i.e.
  // EDIT_MODE_VIEW_SHIFT.
  function applyEditModeViewOffset(w, h) {
    if (editModeT < 0.001) {
      camera.clearViewOffset();
    } else {
      camera.setViewOffset(w, h, EDIT_MODE_VIEW_SHIFT * w * editModeT, 0, w, h);
    }
  }

  function refit() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    const vFovRad = THREE.MathUtils.degToRad(camera.fov);
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * camera.aspect);
    const padding = 1.12;
    const distanceForWidth = ((SHELF_INNER_WIDTH / 2) * padding) / Math.tan(hFovRad / 2);
    cameraDistance = Math.max(distanceForWidth, 3.2);
    // Hero: the whole shelf, its side margins included, spans the window.
    const heroDistance = (SHELF_INNER_WIDTH / 2 + SHELF_MARGIN) / Math.tan(hFovRad / 2);
    heroDistanceRatio = Math.min(heroDistance / cameraDistance, 1);

    scrollY = THREE.MathUtils.clamp(scrollY, 0, maxScrollY);

    applyEditModeViewOffset(w, h);
    camera.updateProjectionMatrix();
    updateCameraPosition();
    invalidate(); // a resized canvas is blank until drawn again
  }

  function updateCameraPosition() {
    // The hero frames the second shelf; the library the first, plus scroll and
    // the pull past the top.
    const libraryY = initialCameraY - scrollY + pull * HERO_PULL_DISTANCE_RATIO * visibleWorldHeight();
    const y = THREE.MathUtils.lerp(libraryY, initialCameraY - shelfGap * HERO_SHELF_OFFSET, heroT);
    // The camera's rest spot: fixed radius, azimuth and elevation around
    // (0, y, 0); the pointer orbit adds to azimuth and elevation.
    const distance =
      cameraDistance *
      THREE.MathUtils.lerp(1, EDIT_MODE_DISTANCE_MULTIPLIER, editModeT) *
      THREE.MathUtils.lerp(1, heroDistanceRatio, heroT);
    const baseX = distance * THREE.MathUtils.lerp(CAMERA_RIGHT_RATIO, 0, editModeT);
    const baseY = distance * THREE.MathUtils.lerp(CAMERA_DOWN_RATIO, 0, editModeT);
    const baseZ = distance;
    const radius = Math.sqrt(baseX * baseX + baseY * baseY + baseZ * baseZ);
    const azimuth = Math.atan2(baseX, baseZ) + orbitX;
    const elevation = Math.asin(baseY / radius) + orbitY;
    const horizontalRadius = radius * Math.cos(elevation);
    camera.position.set(
      horizontalRadius * Math.sin(azimuth),
      y + radius * Math.sin(elevation),
      horizontalRadius * Math.cos(azimuth)
    );
    camera.lookAt(0, y, 0);
    reflectionLight.position.set(REFLECTION_LIGHT_OFFSET.x, y + REFLECTION_LIGHT_OFFSET.y, REFLECTION_LIGHT_OFFSET.z);
    reflectionLight.lookAt(0, y, 0);
  }

  const resizeObserver = new ResizeObserver(() => refit());
  resizeObserver.observe(container);

  // --- Interaction: hover (tilt + title) and click/tap ---------------------
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2(-10, -10);
  // Reused during the opening: the pull-out-only position.
  const scratchPulledPosition = new THREE.Vector3();
  // Reused to report the hovered book's spine centre, without allocating.
  const scratchSpineCenter = new THREE.Vector3();
  // Reused while dragging: the drag-plane point under the cursor.
  const scratchDragHit = new THREE.Vector3();
  const openTimers = [];
  let hoveredBook = null;
  let opening = null;
  let pointerDown = false;
  // The pointer, or the scene under it, moved since the last hover test.
  let pickStale = true;
  let dragging = false;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let dragStartScrollY = 0;
  // The book pressed in edit mode, picked up if the gesture becomes a drag;
  // null otherwise (a scroll-drag instead).
  let pointerDownBook = null;
  // Last pointer screen Y, for auto-scroll near the canvas edges.
  let lastPointerClientY = 0;
  // Set only while a book is being dragged (edit mode) - see startBookDrag().
  let bookDrag = null;

  function visibleWorldHeight() {
    return 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * cameraDistance;
  }

  function setPointerFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickBook() {
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(bookInstances, true);
    if (hits.length === 0) return null;
    let obj = hits[0].object;
    while (obj && obj.parent !== scene) obj = obj.parent;
    return obj;
  }

  /** A book's spine centre on screen (CSS px), anchoring the popup's leader
   * line: half the unscaled height above the pivot, through its transform. */
  function projectToScreen(book) {
    scratchSpineCenter.set(0, size.y / 2, 0);
    book.localToWorld(scratchSpineCenter);
    scratchSpineCenter.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (scratchSpineCenter.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (1 - (scratchSpineCenter.y * 0.5 + 0.5)) * rect.height,
    };
  }

  // Until when (performance.now()) a tilt plays: mixers run, and the scene
  // draws, only meanwhile.
  let tiltingUntil = 0;
  const TILT_MARGIN_MS = 100;

  function applyTilt(pivot, tilted) {
    // Already that way: replaying the action would jump back to its start.
    if (Boolean(pivot.userData.tilted) === tilted) return;
    pivot.userData.tilted = tilted;
    const { tilt, tiltBack } = pivot.userData.actions;
    const playing = (tilted ? tilt : tiltBack).getClip().duration + CROSSFADE_DURATION;
    tiltingUntil = Math.max(tiltingUntil, performance.now() + playing * 1000 + TILT_MARGIN_MS);
    if (tilted) {
      tilt.reset();
      tilt.crossFadeFrom(tiltBack, CROSSFADE_DURATION, false);
      tilt.play();
    } else {
      tiltBack.reset();
      tilt.crossFadeTo(tiltBack, CROSSFADE_DURATION, false);
      tiltBack.play();
    }
  }

  // The book open in the edit panel glows orange while selected.
  let selectedBook = null;
  const SELECTED_GLOW = new THREE.Color(0xff8c00);
  const NO_GLOW = new THREE.Color(0x000000);
  const SELECTED_GLOW_INTENSITY = 0.25;

  function setSelectedGlow(pivot, on) {
    for (const material of [pivot.userData.mesh.material].flat()) {
      material.emissive.copy(on ? SELECTED_GLOW : NO_GLOW);
      material.emissiveIntensity = on ? SELECTED_GLOW_INTENSITY : 1;
    }
  }

  function selectBook(id) {
    const next = id ? (bookInstances.find((instance) => instance.userData.id === id) ?? null) : null;
    if (next === selectedBook) return;
    if (selectedBook) setSelectedGlow(selectedBook, false);
    selectedBook = next;
    if (next) setSelectedGlow(next, true);
    invalidate();
  }

  function setHover(book) {
    if (book === hoveredBook) return;

    const previous = hoveredBook;
    hoveredBook = book;
    if (previous) applyTilt(previous, false);

    // Computed now rather than next frame, so the leader line snaps to the new
    // book at once.
    onHoverChange(
      book
        ? { title: book.userData.title, recipeCount: book.userData.recipeCount, ...projectToScreen(book) }
        : null
    );
    canvas.style.cursor = book ? "pointer" : "default";

    if (book) applyTilt(book, true);
  }

  /** An opening book's final pose: centred and close enough to overflow the
   * frame on both axes. Recentred along the camera's up vector (the pivot is
   * at the spine's foot), reliable whatever the orientation. */
  function computeOpenTarget(book) {
    // The width tier only thickens the spine on the shelf: the open book uses a
    // normal width; its height variation stays.
    const scale = new THREE.Vector3(baseScale, book.scale.y, baseScale);
    const bookHeight = size.y * scale.y;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const screenUp = new THREE.Vector3(0, 1, 0).projectOnPlane(forward).normalize();

    const faceCamera = new THREE.Quaternion().setFromUnitVectors(SPINE_AXIS, forward.clone().negate());
    // Flip first, align to the camera after (see OPEN_Y_FLIP).
    const quaternion = faceCamera.clone().multiply(OPEN_Y_FLIP);

    // The distance where each axis fills the frame; the smaller leaves neither
    // short. OPEN_FILL_RATIO goes closer still.
    const vFovRad = THREE.MathUtils.degToRad(camera.fov);
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * camera.aspect);
    const distanceForHeight = bookHeight / (2 * Math.tan(vFovRad / 2));
    const distanceForWidth = OPEN_WIDTH_ESTIMATE / (2 * Math.tan(hFovRad / 2));
    const distance = Math.min(distanceForHeight, distanceForWidth) / OPEN_FILL_RATIO;

    const position = camera.position
      .clone()
      .addScaledVector(forward, distance)
      .addScaledVector(screenUp, -bookHeight / 2);

    return { position, quaternion, scale };
  }

  function openBookAndNavigate(book) {
    if (opening) return;

    // No straightening up: the opening takes over the pose.
    hoveredBook = null;
    book.userData.opening = true;
    book.userData.contactShadow.visible = false;
    onHoverChange(null);
    canvas.style.cursor = "default";

    const { tilt, tiltBack } = book.userData.actions;
    tilt.fadeOut(CROSSFADE_DURATION);
    tiltBack.fadeOut(CROSSFADE_DURATION);
    // "FullOpening" starts with animation 2: no covers spreading while sliding
    // out.

    // The canvas goes above the header for the flight.
    canvas.classList.add("is-opening");
    onBookOpening(book.userData.id);

    const target = computeOpenTarget(book);
    const fromPosition = book.position.clone();
    book.renderOrder = 10;
    opening = {
      book,
      elapsed: 0,
      turnStarted: false,
      fromPosition,
      pulledPosition: fromPosition.clone().addScaledVector(SPINE_AXIS, PULL_OUT_DISTANCE),
      fromQuaternion: book.quaternion.clone(),
      fromScale: book.scale.clone(),
      toPosition: target.position,
      toQuaternion: target.quaternion,
      toScale: target.scale,
    };

    // The canvas fades into the page background as the book grows: no hard cut.
    openTimers.push(
      setTimeout(() => {
        canvas.classList.add("is-closing");
        onBookFading(CANVAS_FADE_DURATION_MS);
      }, CANVAS_FADE_DELAY_MS),
      setTimeout(() => onBookClick(book.userData.id), NAVIGATE_DELAY_MS)
    );
  }

  /** Picks up a book to reorder it (edit mode), selecting it like a click
   * (see onPointerMove's threshold). Driven by updateBookDrag() until
   * finishBookDrag(). */
  function startBookDrag(book) {
    onBookSelectForEdit(book.userData.id);

    // Kept tilted for the drag (unless already, when hovered).
    if (hoveredBook !== book) applyTilt(book, true);
    hoveredBook = null;
    onHoverChange(null);
    canvas.style.cursor = "grabbing";
    book.userData.contactShadow.visible = false;

    const id = book.userData.id;

    // Other books' (row, side) are frozen for the drag, copied from
    // shelfSideLists. Only the dragged book is spliced in (computeSideLayout()),
    // so displaced books only shift within their own side.
    const sideLists = new Map();
    let candidate = null;
    for (let rowIndex = 0; rowIndex < shelfRowCount; rowIndex += 1) {
      for (const side of ["left", "right"]) {
        const key = `${rowIndex}:${side}`;
        const ids = shelfSideLists.get(key) ?? [];
        const index = ids.indexOf(id);
        if (index !== -1) candidate = { rowIndex, side, index };
        sideLists.set(key, ids.filter((bookId) => bookId !== id));
      }
    }

    bookDrag = {
      pivot: book,
      id,
      rowCount: shelfRowCount,
      sideLists,
      candidate,
      lastKey: `${candidate.rowIndex}:${candidate.side}:${candidate.index}`,
      // Half the book's height: the cursor holds the spine's middle, not its foot.
      followOffsetY: (size.y * book.scale.y) / 2,
      liftedZ: BOOK_DRAG_LIFT_DISTANCE,
      dragPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -BOOK_DRAG_LIFT_DISTANCE),
      restLayout: null,
      layout: null,
    };
    // Everyone's slots without the dragged book: the fixed reference for
    // computeInsertionIndex().
    bookDrag.restLayout = computeSideLayout(null);
    applyDragLayoutTargets(computeSideLayout(candidate));
  }

  /** Places every group as frozen in bookDrag.sideLists, the candidate group
   * with the dragged book spliced in: books only shift within their side. */
  function computeSideLayout(candidate) {
    const slots = new Map();
    const shelfGapByRow = [];
    for (let rowIndex = 0; rowIndex < bookDrag.rowCount; rowIndex += 1) {
      const rowY = -rowIndex * shelfGap;
      let leftIds = bookDrag.sideLists.get(`${rowIndex}:left`) ?? [];
      let rightIds = bookDrag.sideLists.get(`${rowIndex}:right`) ?? [];
      if (candidate && candidate.rowIndex === rowIndex) {
        const ids = (candidate.side === "left" ? leftIds : rightIds).slice();
        ids.splice(candidate.index, 0, bookDrag.id);
        if (candidate.side === "left") leftIds = ids;
        else rightIds = ids;
      }
      const gapLeft = placeSide(leftIds, "left", rowY, rowIndex, slots);
      const gapRight = placeSide(rightIds, "right", rowY, rowIndex, slots);
      shelfGapByRow.push({ rowY, rowIndex, gapLeft, gapRight });
    }
    return { slots, shelfGapByRow };
  }

  /** Sends every book but the dragged one towards its candidate slot. */
  function applyDragLayoutTargets(layout) {
    bookDrag.layout = layout;
    for (const [id, slot] of layout.slots) {
      if (id === bookDrag.id) continue;
      const pivot = pivotById.get(id);
      if (!pivot) continue;
      pivot.userData.targetX = slot.x;
      pivot.userData.targetRowY = slot.rowY;
    }
  }

  /** The { rowIndex, side, index } nearest the cursor, measured against
   * bookDrag.restLayout (fixed for the drag). The side is chosen against the
   * row's real gap centre; within it, the book goes before the first one it
   * hasn't passed coming from the edge, DRAG_SNAP_LOOKAHEAD early. */
  function computeInsertionIndex(hit) {
    let bestRow = 0;
    let bestRowDist = Infinity;
    for (const row of bookDrag.restLayout.shelfGapByRow) {
      const dist = Math.abs(row.rowY - hit.y);
      if (dist < bestRowDist) {
        bestRowDist = dist;
        bestRow = row.rowIndex;
      }
    }

    const rowGap = bookDrag.restLayout.shelfGapByRow[bestRow];
    const side = hit.x < (rowGap.gapLeft + rowGap.gapRight) / 2 ? "left" : "right";

    const ids = bookDrag.sideLists.get(`${bestRow}:${side}`) ?? [];
    for (let index = 0; index < ids.length; index += 1) {
      const slot = bookDrag.restLayout.slots.get(ids[index]);
      const threshold = side === "left" ? slot.x + DRAG_SNAP_LOOKAHEAD : slot.x - DRAG_SNAP_LOOKAHEAD;
      const hasPassed = side === "left" ? hit.x < threshold : hit.x > threshold;
      if (hasPassed) return { rowIndex: bestRow, side, index };
    }
    return { rowIndex: bestRow, side, index: ids.length };
  }

  /** Each frame while dragging: follow the cursor, auto-scroll near the
   * edges, reflow when the insertion point changes. */
  function updateBookDrag(delta) {
    raycaster.setFromCamera(pointerNDC, camera);
    const didHit = raycaster.ray.intersectPlane(bookDrag.dragPlane, scratchDragHit);

    if (didHit) {
      bookDrag.pivot.position.x = THREE.MathUtils.damp(
        bookDrag.pivot.position.x,
        scratchDragHit.x,
        BOOK_DRAG_FOLLOW_DAMPING,
        delta
      );
      bookDrag.pivot.position.y = THREE.MathUtils.damp(
        bookDrag.pivot.position.y,
        scratchDragHit.y - bookDrag.followOffsetY,
        BOOK_DRAG_FOLLOW_DAMPING,
        delta
      );
    }
    bookDrag.pivot.position.z = THREE.MathUtils.damp(
      bookDrag.pivot.position.z,
      bookDrag.liftedZ,
      BOOK_DRAG_FOLLOW_DAMPING,
      delta
    );

    // Auto-scroll near the edges, through the wheel's clamp.
    const rect = canvas.getBoundingClientRect();
    const fromTop = lastPointerClientY - rect.top;
    const fromBottom = rect.bottom - lastPointerClientY;
    let scrollDelta = 0;
    if (fromTop < AUTO_SCROLL_MARGIN_PX) {
      scrollDelta = -AUTO_SCROLL_SPEED * (1 - Math.max(fromTop, 0) / AUTO_SCROLL_MARGIN_PX);
    } else if (fromBottom < AUTO_SCROLL_MARGIN_PX) {
      scrollDelta = AUTO_SCROLL_SPEED * (1 - Math.max(fromBottom, 0) / AUTO_SCROLL_MARGIN_PX);
    }
    if (scrollDelta !== 0) {
      scrollY = THREE.MathUtils.clamp(scrollY + scrollDelta * delta, 0, maxScrollY);
      updateCameraPosition();
    }

    if (!didHit) return;
    const candidate = computeInsertionIndex(scratchDragHit);
    const key = `${candidate.rowIndex}:${candidate.side}:${candidate.index}`;
    if (key === bookDrag.lastKey) return;
    bookDrag.lastKey = key;
    bookDrag.candidate = candidate;
    applyDragLayoutTargets(computeSideLayout(candidate));
  }

  /** Drop: the book eases into its slot, the frozen lists are committed and
   * the order saved. */
  function finishBookDrag() {
    const { pivot, id, layout, candidate, sideLists } = bookDrag;
    const finalSlot = layout.slots.get(id);
    pivot.userData.targetX = finalSlot.x;
    pivot.userData.targetRowY = finalSlot.rowY;
    pivot.userData.targetZ = 0;
    pivot.userData.contactShadow.visible = true;
    canvas.style.cursor = editMode ? "pointer" : "default";
    // The drag's tilt relaxes; the next hover test re-tilts if still hovered.
    applyTilt(pivot, false);

    const key = `${candidate.rowIndex}:${candidate.side}`;
    const finalIds = sideLists.get(key).slice();
    finalIds.splice(candidate.index, 0, id);
    sideLists.set(key, finalIds);

    // Commits the drag into shelfSideLists (untouched groups as they were), so
    // the next drag starts from here.
    for (const [sideKey, ids] of sideLists) {
      shelfSideLists.set(sideKey, ids);
    }

    bookDrag = null;
    // A shelf this drag emptied goes, the ones below moving up.
    if (closeUpEmptyRows()) retargetBooks();
    // Settled books may crowd or free a decoration's spot (refitDecorations()).
    refitDecorations();
    onBooksReordered(buildShelfRowsPayload());
  }

  function onPointerMove(event) {
    if (opening) return;
    setPointerFromEvent(event);
    pickStale = true;
    lastPointerClientY = event.clientY;
    if (bookDrag) return; // followed every frame in animate() instead

    // Pointer position orbits the camera on both axes; not under the hero.
    targetOrbitX = heroBlocking() ? 0 : pointerNDC.x * MOUSE_ORBIT_ANGLE_X;
    targetOrbitY = heroBlocking() ? 0 : pointerNDC.y * MOUSE_ORBIT_ANGLE_Y;
    if (!pointerDown) return;

    const deltaX = event.clientX - pointerDownX;
    const deltaY = event.clientY - pointerDownY;
    if (!dragging && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > DRAG_THRESHOLD_PX) {
      // A touch swipe up leaves the hero instead of moving the shelves.
      if (heroBlocking()) {
        if (deltaY < 0) onHeroExitRequest();
        return;
      }
      if (editMode && pointerDownBook) {
        startBookDrag(pointerDownBook);
        return;
      }
      dragging = true;
    }
    if (!dragging) return;

    const pxToWorld = visibleWorldHeight() / (container.clientHeight || 1);
    scrollY = THREE.MathUtils.clamp(dragStartScrollY - deltaY * pxToWorld, 0, maxScrollY);
    // A drag that started at the top and keeps pulling down: towards the hero.
    dragPull = dragStartScrollY <= 0 && !editMode ? THREE.MathUtils.clamp(deltaY / HERO_RETURN_DRAG_PX, 0, 1) : 0;
    updateCameraPosition();
  }

  // Pointer gone (to a panel or away): parallax back to centre, hover dropped.
  function onPointerLeave() {
    targetOrbitX = 0;
    targetOrbitY = 0;
    if (!pointerDown) pointerNDC.set(-10, -10);
    pickStale = true;
  }

  function onPointerDown(event) {
    scrollGlide = null;
    if (opening) return;
    pointerDown = true;
    dragging = false;
    pointerDownX = event.clientX;
    pointerDownY = event.clientY;
    dragStartScrollY = scrollY;
    canvas.setPointerCapture?.(event.pointerId);
    setPointerFromEvent(event);
    pickStale = true;
    pointerDownBook = editMode ? pickBook() : null;
  }

  // On the window, to end a drag released off the scene; only for presses
  // that started on the scene.
  function onPointerUp(event) {
    if (!pointerDown) return;
    pointerDown = false;
    pickStale = true;
    if (dragPull >= 1) onHeroReturnRequest("drag");
    dragPull = 0;
    if (bookDrag) {
      finishBookDrag();
    } else if (!dragging && !opening && !heroBlocking()) {
      setPointerFromEvent(event);
      const book = pickBook();
      if (book && editMode) onBookSelectForEdit(book.userData.id);
      else if (book) openBookAndNavigate(book);
    }
    dragging = false;
    pointerDownBook = null;
  }

  function onWheel(event) {
    scrollGlide = null;
    event.preventDefault();
    if (opening) return;
    // Under the hero, the page decides (see onPageWheel in library.page.js).
    if (heroBlocking()) return;
    let delta = event.deltaY;
    if (Math.abs(delta) > 400) delta /= 5; // tame free-spinning mouse wheels

    // Pushing up at the top: towards the hero (see HERO_RETURN_*).
    const now = performance.now();
    if (now - lastWheelTime > WHEEL_GESTURE_GAP_MS) wheelGestureAtTop = scrollY <= 0;
    lastWheelTime = now;
    if (delta > 0) wheelGestureAtTop = false;
    if (scrollY <= 0 && delta < 0 && !editMode && !bookDrag) {
      if (wheelPull === 0) wheelPullTarget = wheelGestureAtTop ? HERO_RETURN_WHEEL_PX : HERO_RETURN_WHEEL_ARRIVING_PX;
      // In pixels whatever the wheel reports (Firefox counts lines).
      wheelPull += -delta * (event.deltaMode === 1 ? 16 : 1);
      if (wheelPull >= wheelPullTarget) {
        wheelPull = 0;
        onHeroReturnRequest("wheel");
      }
      return;
    }
    wheelPull = 0;
    scrollY = THREE.MathUtils.clamp(scrollY + (delta / 500) * visibleWorldHeight(), 0, maxScrollY);
    updateCameraPosition();
  }

  canvas.style.touchAction = "none";
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // The add-shelf "+": under the last shelf's front edge, in edit mode at the
  // end of the scroll, if that shelf has a book to spare. Reported on change.
  const ADD_SHELF_DROP = 0.32;
  const scratchShelfEnd = new THREE.Vector3();
  let shelfEnd = { visible: false, x: 0, y: 0 };
  function reportShelfEnd() {
    const lastRow = shelfRowCount - 1;
    const visible =
      editMode &&
      editModeT > 0.95 &&
      !bookDrag &&
      scrollGlide === null &&
      scrollY >= maxScrollY - 0.05 &&
      sideIds(lastRow, "left").length + sideIds(lastRow, "right").length > 1;
    scratchShelfEnd.set(0, -lastRow * shelfGap - SHELF_THICKNESS - ADD_SHELF_DROP, 0.21).project(camera);
    const x = (scratchShelfEnd.x * 0.5 + 0.5) * container.clientWidth;
    const y = (0.5 - scratchShelfEnd.y * 0.5) * container.clientHeight;
    if (visible === shelfEnd.visible && Math.abs(x - shelfEnd.x) < 0.5 && Math.abs(y - shelfEnd.y) < 0.5) return;
    shelfEnd = { visible, x, y };
    onShelfEndChange(shelfEnd);
  }

  refit();

  // What the last drawn frame showed (camera, books, decorations, shelves),
  // compared value by value: a change past MOVED draws again.
  const MOVED = 1e-5;
  let drawnValues = new Float64Array(512);
  let valueIndex = 0;
  let valuesChanged = false;

  function record(value) {
    if (valueIndex === drawnValues.length) {
      const grown = new Float64Array(drawnValues.length * 2);
      grown.set(drawnValues);
      drawnValues = grown;
    }
    if (Math.abs(drawnValues[valueIndex] - value) > MOVED) {
      drawnValues[valueIndex] = value;
      valuesChanged = true;
    }
    valueIndex += 1;
  }

  function recordObject(object) {
    const { position, quaternion, scale } = object;
    record(position.x);
    record(position.y);
    record(position.z);
    record(quaternion.x);
    record(quaternion.y);
    record(quaternion.z);
    record(quaternion.w);
    record(scale.x);
    record(scale.y);
    record(scale.z);
    record(object.visible ? 1 : 0);
  }

  /** Whether anything shown moved, came or went since the last frame drawn. */
  function sceneChanged() {
    valueIndex = 0;
    valuesChanged = false;
    record(bookInstances.length);
    record(decorationEntries.length);
    record(shelfMeshes.length);
    record(leavingShelves.length);
    record(faceMapChangeCount());
    record(editModeT); // the view's sideways shift
    recordObject(camera);
    for (const pivot of bookInstances) recordObject(pivot);
    for (const entry of decorationEntries) recordObject(entry.object);
    for (const shelfMesh of shelfMeshes) recordObject(shelfMesh);
    for (const shelfMesh of leavingShelves) recordObject(shelfMesh);
    return valuesChanged;
  }

  let frameId = null;
  const clock = new THREE.Clock();

  function animate() {
    frameId = requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (opening) {
      opening.elapsed += delta;

      // Animation 1 runs on its own clock, capped at PULL_OUT_DURATION.
      const pullT = easeInOut(Math.min(opening.elapsed / PULL_OUT_DURATION, 1));
      scratchPulledPosition.lerpVectors(opening.fromPosition, opening.pulledPosition, pullT);

      // Animation 2 waits for TURN_START_TIME, then starts from animation 1's
      // live state.
      const turnRawT = Math.max(0, Math.min((opening.elapsed - TURN_START_TIME) / TURN_DURATION, 1));
      const turnT = easeInOut(turnRawT);
      opening.book.position.lerpVectors(scratchPulledPosition, opening.toPosition, turnT);
      opening.book.quaternion.slerpQuaternions(opening.fromQuaternion, opening.toQuaternion, turnT);
      opening.book.scale.lerpVectors(opening.fromScale, opening.toScale, turnT);

      if (!opening.turnStarted && opening.elapsed >= TURN_START_TIME) {
        opening.turnStarted = true;
        const { fullOpening } = opening.book.userData.actions;
        fullOpening.reset();
        fullOpening.fadeIn(CROSSFADE_DURATION);
        fullOpening.play();
      }
    } else {
      // Ease towards the pointer's orbit angles; frozen during an opening.
      orbitX = THREE.MathUtils.damp(orbitX, targetOrbitX, MOUSE_ORBIT_DAMPING, delta);
      orbitY = THREE.MathUtils.damp(orbitY, targetOrbitY, MOUSE_ORBIT_DAMPING, delta);
      editModeT = THREE.MathUtils.damp(editModeT, targetEditModeT, EDIT_MODE_DAMPING, delta);
      // Gliding down to a shelf just added (see addShelf()).
      if (scrollGlide !== null) {
        scrollY = THREE.MathUtils.damp(scrollY, scrollGlide, SCROLL_GLIDE_DAMPING, delta);
        if (Math.abs(scrollY - scrollGlide) < 0.001) scrollGlide = null;
      }
      // The pull past the top springs back once the gesture stops.
      if (performance.now() - lastWheelTime > WHEEL_GESTURE_GAP_MS) wheelPull = 0;
      const targetPull = Math.max(Math.min(wheelPull / wheelPullTarget, 1), dragPull);
      pull = THREE.MathUtils.damp(pull, targetPull, HERO_PULL_DAMPING, delta);
      if (heroAnim) {
        heroAnim.elapsed += delta;
        const t = Math.min(heroAnim.elapsed / heroAnim.duration, 1);
        heroT = THREE.MathUtils.lerp(heroAnim.from, heroAnim.to, easeInOutCubic(t));
        if (t >= 1) heroAnim = null;
      }
      updateCameraPosition();
      applyEditModeViewOffset(container.clientWidth || 1, container.clientHeight || 1);
      camera.updateProjectionMatrix();

      if (bookDrag) updateBookDrag(delta);
    }

    // Every book not dragged or opening eases towards its slot (a no-op once
    // there): reflow and drop alike.
    for (const pivot of bookInstances) {
      if (pivot.userData.opening) continue;
      if (bookDrag && pivot === bookDrag.pivot) continue;
      const data = pivot.userData;
      pivot.position.x = THREE.MathUtils.damp(pivot.position.x, data.targetX, BOOK_REFLOW_DAMPING, delta);
      pivot.position.y = THREE.MathUtils.damp(pivot.position.y, data.targetRowY, BOOK_REFLOW_DAMPING, delta);
      pivot.position.z = THREE.MathUtils.damp(pivot.position.z, data.targetZ, BOOK_REFLOW_DAMPING, delta);
      data.contactShadow.position.x = pivot.position.x;
      data.contactShadow.position.y = pivot.position.y + CONTACT_SHADOW_LIFT;
    }

    // Decorations ease the same way.
    for (const entry of decorationEntries) {
      entry.object.position.x = THREE.MathUtils.damp(entry.object.position.x, entry.targetX, BOOK_REFLOW_DAMPING, delta);
      entry.object.position.y = THREE.MathUtils.damp(entry.object.position.y, entry.targetRowY, BOOK_REFLOW_DAMPING, delta);
      entry.object.position.z = THREE.MathUtils.damp(entry.object.position.z, entry.targetZ, BOOK_REFLOW_DAMPING, delta);
      entry.shadow.position.x = entry.object.position.x + entry.shadowOffset.x;
      entry.shadow.position.y = entry.object.position.y + CONTACT_SHADOW_LIFT;
      entry.shadow.position.z = entry.object.position.z + entry.shadowOffset.y;
    }

    // Shelves come and go from their middle.
    for (const shelfMesh of shelfMeshes) {
      if (shelfMesh.scale.x < 1) shelfMesh.scale.x = Math.min(THREE.MathUtils.damp(shelfMesh.scale.x, 1.01, BOOK_REFLOW_DAMPING, delta), 1);
    }
    for (let i = leavingShelves.length - 1; i >= 0; i -= 1) {
      const shelfMesh = leavingShelves[i];
      shelfMesh.scale.x = THREE.MathUtils.damp(shelfMesh.scale.x, 0, BOOK_REFLOW_DAMPING, delta);
      if (shelfMesh.scale.x < 0.01) {
        scene.remove(shelfMesh);
        leavingShelves.splice(i, 1);
      }
    }

    const moved = sceneChanged();

    // The hovered book, looked up again only after movement, its screen centre
    // reported for the leader line.
    if (!opening && !bookDrag && (pickStale || moved)) {
      pickStale = false;
      const target = (pointerDown && dragging) || heroBlocking() ? null : pickBook();
      setHover(target && !target.userData.opening ? target : null);
      if (hoveredBook) {
        const { x, y } = projectToScreen(hoveredBook);
        onHoverMove(x, y);
      }
    }

    const tilting = performance.now() < tiltingUntil;
    if (tilting || opening) {
      for (const book of bookInstances) book.userData.mixer.update(delta);
    }

    reportShelfEnd();

    if (!moved && !tilting && !opening && !invalid) return;
    invalid = false;
    renderer.render(scene, camera);
  }

  // Compiles every shader up front (in parallel where possible), not on the
  // first frame.
  await renderer.compileAsync(scene, camera).catch(() => {});
  animate();

  return {
    /** Resolves once every cover picture is in and a frame drawn with them. */
    async whenComplete() {
      await facePicturesSettled();
      invalidate();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    /** Eases into (true) or out of (false) the landing framing. */
    setHero(active) {
      if (active) {
        targetOrbitX = 0;
        targetOrbitY = 0;
        wheelPull = 0;
        dragPull = 0;
      }
      const to = active ? 1 : 0;
      if (heroT === to && !heroAnim) return;
      heroAnim = { from: heroT, to, elapsed: 0, duration: heroTransitionMs / 1000 };
    },
    /** A new shelf under the last one (edit mode), scrolled into view; the last
     * shelf's rightmost book moves onto it, so no shelf stands empty. Needs two
     * books on the last shelf. */
    addShelf() {
      const lastRow = shelfRowCount - 1;
      const left = sideIds(lastRow, "left");
      const right = sideIds(lastRow, "right");
      if (left.length + right.length < 2) return;
      const id = right.length ? right[0] : left[left.length - 1];
      shelfSideLists.set(`${lastRow}:left`, left.filter((other) => other !== id));
      shelfSideLists.set(`${lastRow}:right`, right.filter((other) => other !== id));
      shelfRowCount += 1;
      shelfSideLists.set(`${lastRow + 1}:left`, []);
      shelfSideLists.set(`${lastRow + 1}:right`, [id]);
      syncShelfMeshes();
      updateShelfBounds();
      retargetBooks();
      refitDecorations();
      onBooksReordered(buildShelfRowsPayload());
      scrollGlide = maxScrollY;
    },
    /** Marks the book open in the edit panel (null: none). */
    setSelectedBook(bookId) {
      selectBook(bookId);
    },
    setEditMode(isEditing) {
      editMode = isEditing;
      if (!isEditing) selectBook(null);
      targetEditModeT = isEditing ? 1 : 0;
      // Edit mode scrolls a little further, to show the "+".
      bottomRoom = BOTTOM_SCROLL_MARGIN + (isEditing ? EDIT_BOTTOM_ROOM : 0);
      updateShelfBounds();
      if (scrollY > maxScrollY) scrollGlide = maxScrollY;
      if (!isEditing) {
        // Leaving edit mode mid-drag (Escape): drop the book normally.
        if (bookDrag) finishBookDrag();
      }
    },
    updateBookSize(bookId, sizes) {
      applyBookSize(bookId, sizes);
    },
    persistShelfLayout() {
      onBooksReordered(buildShelfRowsPayload());
    },
    updateBookAppearance(bookId, fields) {
      const pivot = bookInstances.find((instance) => instance.userData.id === bookId);
      if (!pivot) return;
      Object.assign(pivot.userData, fields);
      updateBookInstanceColors(pivot.userData.mesh, resolveBookColors(pivot.userData));
      invalidate();
    },
    dispose() {
      cancelAnimationFrame(frameId);
      // Pending timers would otherwise navigate after the page is gone.
      for (const timer of openTimers) clearTimeout(timer);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);

      // Only per-instance materials are this scene's to dispose; geometry,
      // textures and shared materials stay cached for the next mount. The
      // contact shadow's geometry is per scene.
      for (const pivot of bookInstances) {
        pivot.traverse((child) => {
          for (const material of [child.material].flat()) material?.dispose();
        });
      }
      shelfGeometry.dispose();
      contactShadowGeometry.dispose();
      renderer.dispose();
    },
  };
}
