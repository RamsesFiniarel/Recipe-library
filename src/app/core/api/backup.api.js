import { http } from "./http.js";

/** The library's copies and files (see server/routes/backup.routes.js). */
export const backupApi = {
  list: () => http.get("/backup"),
  backUpNow: () => http.post("/backup"),
  /** Downloaded by following it: the whole library as a file. */
  exportUrl: "/api/backup/export",
  /** Replaces the library with an exported file: { books, recipes }. */
  importFile: (file) => http.upload("/backup/import", file),
};
