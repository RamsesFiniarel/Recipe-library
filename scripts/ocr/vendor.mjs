// Copies the photo reader's files from node_modules to public/ocr, so the
// app serves them itself: Tesseract's worker, its LSTM-only SIMD engines
// (plain and relaxed; every browser since 2023) and the French and English
// data. Anything else there is removed. Runs before `dev` and `build`.

import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = path.join(root, "public", "ocr");

const packageDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const files = [
  [packageDir("tesseract.js"), "dist/worker.min.js"],
  ...["-simd", "-relaxedsimd"].map((variant) => [packageDir("tesseract.js-core"), `tesseract-core${variant}-lstm.wasm.js`]),
  [packageDir("@tesseract.js-data/fra"), "4.0.0_best_int/fra.traineddata.gz"],
  [packageDir("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"],
];

await mkdir(target, { recursive: true });
for (const [dir, file] of files) {
  const from = path.join(dir, file);
  const to = path.join(target, path.basename(file));
  const [source, copy] = await Promise.all([stat(from), stat(to).catch(() => null)]);
  if (copy && copy.size === source.size && copy.mtimeMs >= source.mtimeMs) continue;
  await copyFile(from, to);
}
const kept = new Set(files.map(([, file]) => path.basename(file)));
for (const name of await readdir(target)) {
  if (!kept.has(name)) await rm(path.join(target, name));
}
console.log(`OCR : ${files.length} fichiers dans public/ocr`);
