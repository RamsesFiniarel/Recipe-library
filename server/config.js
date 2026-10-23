export const PORT = Number(process.env.PORT) || 3000;
export const DB_PATH = process.env.DB_PATH || "./data/cuisine.db";
// The server's daily copies of that database (see services/backup.service.js).
export const BACKUP_DIR = process.env.BACKUP_DIR || "./data/backups";
export const BACKUPS_KEPT = 7;
// Reference food data, built by `npm run nutrition:build`, apart from user data.
export const NUTRITION_DB_PATH = process.env.NUTRITION_DB_PATH || "./data/nutrition.db";
// Host names accepted besides IPs, localhost and the machine name (see
// request-guards.js), comma separated: "cuisine.maison,cuisine.local".
export const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
// Set by `npm start`; when true the Express server also serves the built client.
export const IS_PRODUCTION = process.env.NODE_ENV === "production";
// Body limits: the larger one only for cover pictures (data: URLs) and text
// read from photos.
export const JSON_BODY_LIMIT = "1mb";
export const JSON_UPLOAD_LIMIT = "6mb";
// Per address and minute: changes and calculations stay well above typing
// speed; imports (costly) are counted apart and kept lower.
export const CHANGES_PER_MINUTE = 300;
export const IMPORTS_PER_MINUTE = 10;
// Library file upload (pictures make most of it, ~10 MB for 21 books), and
// backup/export/import operations per minute.
export const DATABASE_UPLOAD_LIMIT = "64mb";
export const FILE_TRANSFERS_PER_MINUTE = 10;
// Web page import (see page-fetch.service.js): total time, redirects
// included, and bytes read (recipe data sits near the top).
export const WEB_PAGE_TIMEOUT_MS = 15_000;
export const WEB_PAGE_MAX_BYTES = 6 * 1024 * 1024;
