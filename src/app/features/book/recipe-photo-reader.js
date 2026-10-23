import { createWorker, OEM, PSM } from "tesseract.js";
import { t } from "../../shared/i18n/i18n.js";

/** Reads recipe photos in the browser with Tesseract (WebAssembly), served
 * by the app itself (public/ocr, see scripts/ocr/vendor.mjs). Each photo
 * becomes positioned text lines; the server turns them into a recipe
 * (recipe-import.service.js). */

const OCR_FILES = "/ocr/";
const LANGUAGES = ["fra", "eng"];
// Read this big at most: plenty for print, much quicker than a full photo.
const MAX_SIDE = 2000;
// Below this mean confidence the page may be sideways or upside down: the
// other orientations are tried and the best kept.
const SURE_CONFIDENCE = 70;
const TURNS = [0, 90, 270, 180];
// Words Tesseract is this unsure of, with nothing to read in them, are specks.
const SPECK_CONFIDENCE = 30;
// A first pass finds the columns; each block is then read alone (tilted
// lines or close columns otherwise get read across).
const SECOND_PASS = true;

// --- Lines from words (no browser needed: also run by the tests) ----------------

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

const isSpeck = (word) => !/[\p{L}\p{N}]/u.test(word.text) || (word.confidence < SPECK_CONFIDENCE && word.text.length <= 2);

/** Column starts: a left edge shared by several lines, over their height. */
function columnStarts(runs, width) {
  const starts = [];
  for (const run of [...runs].sort((a, b) => a.x0 - b.x0)) {
    const column = starts.find((start) => Math.abs(start.x - run.x0) <= width * 0.015);
    if (column) {
      column.runs.push(run);
      column.top = Math.min(column.top, run.y0);
      column.bottom = Math.max(column.bottom, run.y1);
    } else {
      starts.push({ x: run.x0, top: run.y0, bottom: run.y1, runs: [run] });
    }
  }
  return starts
    .filter((start) => start.runs.length >= 3)
    .map((start) => ({ ...start, x: median(start.runs.map((run) => run.x0)) }));
}

function runOf(words) {
  return {
    words,
    x0: Math.min(...words.map((word) => word.bbox.x0)),
    x1: Math.max(...words.map((word) => word.bbox.x1)),
    y0: Math.min(...words.map((word) => word.bbox.y0)),
    y1: Math.max(...words.map((word) => word.bbox.y1)),
  };
}

/** The page's lines (text, confidence 0-1, box as shares of the page) from
 * Tesseract's blocks. Lines run across columns are cut at wide word gaps,
 * then where a word starts on another column's left edge. */
function linesFromBlocks(blocks, width, height) {
  const tesseractLines = blocks.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));

  // Runs of words, cut at wide gaps.
  let runs = [];
  for (const line of tesseractLines) {
    const words = line.words.filter((word) => word.text.trim() && !isSpeck(word)).sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const lineHeight = Math.min(line.bbox.y1 - line.bbox.y0, height * 0.04);
    let current = [];
    for (const word of words) {
      const previous = current[current.length - 1];
      if (previous && word.bbox.x0 - previous.bbox.x1 > Math.max(width * 0.03, lineHeight * 2.5)) {
        runs.push(runOf(current));
        current = [];
      }
      current.push(word);
    }
    if (current.length) runs.push(runOf(current));
  }

  // Runs cut again where a word starts at another column's edge.
  const columns = columnStarts(runs, width);
  runs = runs.flatMap((run) => {
    const lineHeight = run.y1 - run.y0;
    const pieces = [[]];
    run.words.forEach((word, index) => {
      const previous = run.words[index - 1];
      const atColumn =
        previous &&
        word.bbox.x0 - previous.bbox.x1 > lineHeight * 0.25 &&
        columns.some(
          (column) =>
            column.x > run.x0 + width * 0.03 &&
            Math.abs(word.bbox.x0 - column.x) <= width * 0.012 &&
            run.y0 >= column.top - lineHeight &&
            run.y1 <= column.bottom + lineHeight
        );
      if (atColumn) pieces.push([]);
      pieces[pieces.length - 1].push(word);
    });
    return pieces.map(runOf);
  });

  // One or two letters on their own (a bullet read as "e") say nothing.
  runs = runs.filter((run) => run.words.map((word) => word.text).join("").replace(/[^\p{L}\p{N}]/gu, "").length > 2);

  return runs.map((run) => ({
    text: run.words.map((word) => word.text).join(" "),
    confidence: run.words.reduce((sum, word) => sum + word.confidence, 0) / run.words.length / 100,
    x: run.x0 / width,
    y: run.y0 / height,
    w: (run.x1 - run.x0) / width,
    h: (run.y1 - run.y0) / height,
  }));
}

/** Blocks worth reading again alone, as pixel rectangles: each column's
 * runs of lines (split at gaps), cut where a neighbouring column begins.
 * `lines` from linesFromBlocks. */
function regionsToReread(lines, width, height) {
  const runs = lines.map((line) => ({
    x0: line.x * width,
    x1: (line.x + line.w) * width,
    y0: line.y * height,
    y1: (line.y + line.h) * height,
  }));
  const columns = columnStarts(runs, width);
  // The column beside a run, if any: its edge bounds the run's block.
  const besideOf = (run) => {
    const lineHeight = run.y1 - run.y0;
    return columns.find(
      (other) => other.x > run.x0 + width * 0.03 && other.top - lineHeight < run.y1 && other.bottom + lineHeight > run.y0
    );
  };
  const regions = [];
  for (const column of columns) {
    const lineHeight = median(column.runs.map((run) => run.y1 - run.y0));
    // Bigger type (a title) is left as first read: never cut short.
    const sorted = column.runs.filter((run) => run.y1 - run.y0 <= lineHeight * 1.4).sort((a, b) => a.y0 - b.y0);
    let block = null;
    for (const run of sorted) {
      const beside = besideOf(run);
      // A new block after a gap, or where a neighbouring column starts or stops.
      if (block && run.y0 - block.y1 <= lineHeight * 2 && block.beside === beside) {
        block.runs.push(run);
        block.y1 = Math.max(block.y1, run.y1);
      } else {
        block = { runs: [run], y0: run.y0, y1: run.y1, beside };
        regions.push(block);
      }
    }
  }
  return regions.map((region) => {
    const pad = median(region.runs.map((run) => run.y1 - run.y0)) * 0.4;
    const x0 = Math.min(...region.runs.map((run) => run.x0));
    // Some room on the right for letters the first pass lost, up to the next
    // column.
    let x1 = Math.max(...region.runs.map((run) => run.x1)) + width * 0.02;
    if (region.beside) x1 = Math.min(x1, region.beside.x - width * 0.004);
    const left = Math.max(0, Math.floor(x0 - pad));
    const top = Math.max(0, Math.floor(region.y0 - pad));
    return {
      left,
      top,
      width: Math.min(width, Math.ceil(x1 + pad)) - left,
      height: Math.min(height, Math.ceil(region.y1 + pad)) - top,
    };
  });
}

// Below this confidence or share of the line height (a cut line): noise.
const NOISE_CONFIDENCE = 0.45;
const NOISE_HEIGHT = 0.45;

/** Re-read lines without noise, each kept once (best reading where regions
 * overlap), plus first-pass lines where the second found nothing. */
function mergeRereadLines(firstLines, regionLines) {
  const usual = median([...firstLines, ...regionLines].filter((line) => line.text.length >= 4).map((line) => line.h));
  const clean = (lines) =>
    lines.filter((line) => line.confidence >= NOISE_CONFIDENCE && line.h >= usual * NOISE_HEIGHT).sort((a, b) => b.confidence - a.confidence);
  const overlap = (line, other) => {
    const w = Math.min(line.x + line.w, other.x + other.w) - Math.max(line.x, other.x);
    const h = Math.min(line.y + line.h, other.y + other.h) - Math.max(line.y, other.y);
    return w > 0 && h > 0 && w * h > Math.min(line.w * line.h, other.w * other.h) * 0.5;
  };
  const kept = [];
  for (const line of [...clean(regionLines), ...clean(firstLines)]) {
    if (!kept.some((other) => overlap(line, other))) kept.push(line);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}

// --- Reading in the browser ---------------------------------------------------------

/** The photo drawn upright on a canvas (MAX_SIDE at most), turned by
 * `degrees`. */
function drawTurned(bitmap, degrees) {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const sideways = degrees === 90 || degrees === 270;
  const canvas = document.createElement("canvas");
  canvas.width = sideways ? height : width;
  canvas.height = sideways ? width : height;
  const context = canvas.getContext("2d");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(bitmap, -width / 2, -height / 2, width, height);
  return canvas;
}

/** Thrown for a photo the browser can't open (HEIC outside Safari...). */
export class UnreadablePhotoError extends Error {}

async function openPhoto(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new UnreadablePhotoError(t("newRecipe.badPhoto", { name: file.name }));
  }
}

// Progress shares: engine start, then each photo alike (first pass, extra
// orientations, then its blocks).
const PREPARE_SHARE = 0.05;
const FIRST_READ_SHARE = 0.4;
const TURN_SHARE = 0.1;

/** The photos' text as pages of lines (see linesFromBlocks).
 * `onProgress({ stage, page, pages, total })`: "prepare" then "read";
 * `total` (0-1) only grows. */
export async function readRecipePhotos(files, onProgress = () => {}) {
  const pages = files.length;
  let stage = "prepare";
  let page = 0;
  // The part of the job the running step covers, and how far it's gone.
  let span = [0, PREPARE_SHARE];
  let total = 0;
  const report = (share) => {
    const next = Math.min(1, span[0] + (span[1] - span[0]) * share);
    if (next < total) return;
    total = next;
    onProgress({ stage, page, pages, total });
  };
  // A step within the current photo, from `from` to `to` of its share.
  const photoStep = (from, to) => {
    const photo = (1 - PREPARE_SHARE) / pages;
    const start = PREPARE_SHARE + photo * (page - 1);
    span = [start + photo * from, start + photo * to];
    report(0);
  };

  report(0);
  const worker = await createWorker(LANGUAGES, OEM.LSTM_ONLY, {
    workerPath: `${OCR_FILES}worker.min.js`,
    corePath: OCR_FILES,
    langPath: OCR_FILES,
    gzip: true,
    workerBlobURL: false,
    logger: (message) => {
      if (stage === "prepare" && message.status === "loading language traineddata") report(message.progress);
      if (stage === "read" && message.status === "recognizing text") report(message.progress);
    },
  });
  report(1);
  stage = "read";
  try {
    const result = [];
    for (const file of files) {
      page += 1;
      photoStep(0, FIRST_READ_SHARE);
      const bitmap = await openPhoto(file);
      let best = null;
      let read = 0;
      for (const degrees of TURNS) {
        if (read > 0) photoStep(FIRST_READ_SHARE + TURN_SHARE * (read - 1), FIRST_READ_SHARE + TURN_SHARE * read);
        const canvas = drawTurned(bitmap, degrees);
        const { data } = await worker.recognize(canvas, {}, { blocks: true });
        read += 1;
        const score = data.confidence * data.text.replace(/\s/g, "").length;
        if (!best || score > best.score) best = { score, data, canvas, width: canvas.width, height: canvas.height };
        if (data.confidence >= SURE_CONFIDENCE) break;
      }
      bitmap.close();
      let lines = linesFromBlocks(best.data.blocks ?? [], best.width, best.height);
      if (SECOND_PASS) {
        const regions = regionsToReread(lines, best.width, best.height);
        const reread = [];
        const from = FIRST_READ_SHARE + TURN_SHARE * (read - 1);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        for (const [index, rectangle] of regions.entries()) {
          photoStep(from + ((1 - from) * index) / regions.length, from + ((1 - from) * (index + 1)) / regions.length);
          const { data } = await worker.recognize(best.canvas, { rectangle }, { blocks: true });
          reread.push(...linesFromBlocks(data.blocks ?? [], best.width, best.height));
        }
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        lines = mergeRereadLines(lines, reread);
      }
      result.push({ lines: lines.map(({ words, ...line }) => line) });
      photoStep(1, 1);
    }
    return result;
  } finally {
    await worker.terminate();
  }
}
