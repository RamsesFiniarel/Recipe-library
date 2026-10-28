import { Worker, parentPort, workerData } from "node:worker_threads";
import { readRecipePage } from "./recipe-web.service.js";
import { HttpError } from "../utils/http-error.js";

/** readRecipePage() on its own thread: deeply nested markup can take the
 * HTML parser minutes. The server keeps answering, and a slow page is
 * given up. */

const READ_TIMEOUT_MS = 10_000;

// Run as the thread: read, answer, done.
if (workerData?.recipePage) {
  const { html, url } = workerData.recipePage;
  parentPort.postMessage(readRecipePage(html, url));
}

/** The page's recipe, read on another thread; a 422 if not done in time. */
export function readRecipePageApart(html, url) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { recipePage: { html, url } },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const unreadable = () => new HttpError(422, "Page illisible", "unreadable");
    const timer = setTimeout(() => {
      worker.terminate();
      reject(unreadable());
    }, READ_TIMEOUT_MS);
    worker.once("message", (recipe) => {
      clearTimeout(timer);
      resolve(recipe);
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      console.error("Lecture de la page impossible :", err);
      reject(unreadable());
    });
  });
}
