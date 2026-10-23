import * as THREE from "three";

// Stoneware glaze flecks: a mostly white canvas (multiplying the material's
// colour almost untouched) with dark dots, tiled by UV. Shared by every
// stoneware material (see olive-oil.js).
const TEXTURE_SIZE = 256;
const SPECKLE_COUNT = 250;
const SPECKLE_COLORS = ["#241611", "#3a271a", "#75543f"];

let cached = null;

function paintSandstoneSpeckle() {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  for (let i = 0; i < SPECKLE_COUNT; i += 1) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    const radius = 1 + Math.random() * 1.5;
    ctx.fillStyle = SPECKLE_COLORS[Math.floor(Math.random() * SPECKLE_COLORS.length)];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

export function getSandstoneSpeckleTexture() {
  if (!cached) {
    cached = new THREE.CanvasTexture(paintSandstoneSpeckle());
    cached.wrapS = THREE.RepeatWrapping;
    cached.wrapT = THREE.RepeatWrapping;
    cached.colorSpace = THREE.SRGBColorSpace;
    cached.repeat.set(6, 6);
    // Mipmaps would average the specks away where UVs compress (the neck):
    // sampling the base level keeps them, with some aliasing on a static
    // object.
    cached.generateMipmaps = false;
    cached.minFilter = THREE.LinearFilter;
  }
  return cached;
}
