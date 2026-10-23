import express from "express";
import helmet from "helmet";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { booksRouter } from "./routes/books.routes.js";
import { nutritionRouter } from "./routes/nutrition.routes.js";
import { tagsRouter } from "./routes/tags.routes.js";
import { backupRouter } from "./routes/backup.routes.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { hostGuard, isSafeMethod, sameOriginGuard } from "./middleware/request-guards.js";
import { rateLimit } from "./middleware/rate-limit.js";
import {
  ALLOWED_HOSTS,
  CHANGES_PER_MINUTE,
  IS_PRODUCTION,
  JSON_BODY_LIMIT,
  JSON_UPLOAD_LIMIT,
} from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Only this machine's names are answered, and only its own pages may
  // change data (see request-guards.js).
  app.use(hostGuard({ allowedHosts: ALLOWED_HOSTS }));
  app.use("/api", sameOriginGuard);
  // Reads are free (the library fetches every cover); changes are counted.
  const changesLimit = rateLimit({ windowMs: 60_000, max: CHANGES_PER_MINUTE, label: "modifications" });
  app.use("/api", (req, res, next) => (isSafeMethod(req) ? next() : changesLimit(req, res, next)));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // Everything is self-hosted, fonts included. No inline styles: per-element
          // values go through element.style, which CSP doesn't govern.
          "style-src": ["'self'"],
          "font-src": ["'self'"],
          // The photo reader runs Tesseract as WebAssembly (public/ocr).
          "script-src": ["'self'", "'wasm-unsafe-eval'"],
          // data: for canvas textures and picked pictures, blob: for photo thumbnails.
          "img-src": ["'self'", "data:", "blob:"],
          // Off on purpose: served over plain HTTP on the LAN, where upgrading
          // requests to https would break them.
          "upgrade-insecure-requests": null,
        },
      },
    })
  );
  app.use(compression());
  // The larger limit only where pictures or read pages are sent.
  const jsonBody = express.json({ limit: JSON_BODY_LIMIT });
  const jsonUpload = express.json({ limit: JSON_UPLOAD_LIMIT });
  const isUpload = (req) =>
    (req.method === "PATCH" && /^\/api\/books\/[^/]+\/?$/.test(req.path)) ||
    (req.method === "POST" && /^\/api\/books\/[^/]+\/recipes\/import\/?$/.test(req.path));
  app.use((req, res, next) => (isUpload(req) ? jsonUpload : jsonBody)(req, res, next));

  app.use("/api/books", booksRouter);
  app.use("/api/nutrition", nutritionRouter);
  app.use("/api/tags", tagsRouter);
  app.use("/api/backup", backupRouter);
  // Any other /api path is a real 404, never the SPA fallback below.
  app.use("/api", notFoundHandler);

  if (IS_PRODUCTION && existsSync(distDir)) {
    // Hashed build files are cached for good; the page, models and OCR files
    // are revalidated on each visit.
    app.use("/assets", express.static(path.join(distDir, "assets"), { maxAge: "1y", immutable: true }));
    app.use(express.static(distDir));
    // Any other route returns the client app (see core/router/router.js).
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.use(errorHandler);

  return app;
}
