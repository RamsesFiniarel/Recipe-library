import express, { Router } from "express";
import { rmSync } from "node:fs";
import { backUpDatabase, exportDatabase, importDatabase, listBackups } from "../services/backup.service.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { asyncHandler } from "../utils/async-handler.js";
import { DATABASE_UPLOAD_LIMIT, FILE_TRANSFERS_PER_MINUTE } from "../config.js";

/** The settings page's "Sauvegarde" section (see backup.service.js). */
export const backupRouter = Router();

// Each of these copies the whole database: a few a minute at most.
const fileTransfers = rateLimit({ windowMs: 60_000, max: FILE_TRANSFERS_PER_MINUTE, label: "sauvegardes" });

backupRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(listBackups());
  })
);

// A copy now, in place of today's.
backupRouter.post(
  "/",
  fileTransfers,
  asyncHandler(async (_req, res) => {
    backUpDatabase({ replace: true });
    res.json(listBackups());
  })
);

backupRouter.get(
  "/export",
  fileTransfers,
  asyncHandler(async (_req, res, next) => {
    const file = exportDatabase();
    const name = `cuisine-${new Date().toISOString().slice(0, 10)}.db`;
    // The scratch file's name starts with a dot: it's ours to send.
    const options = { dotfiles: "allow", headers: { "Cache-Control": "no-store" } };
    res.download(file, name, options, (err) => {
      rmSync(file, { force: true });
      if (err && !res.headersSent) next(err);
    });
  })
);

// The file's bytes as they are (application/octet-stream), not JSON.
backupRouter.post(
  "/import",
  fileTransfers,
  express.raw({ type: "application/octet-stream", limit: DATABASE_UPLOAD_LIMIT }),
  asyncHandler(async (req, res) => {
    res.json(importDatabase(req.body));
  })
);
