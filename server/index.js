import { closeDatabase } from "./db.js";
import { createApp } from "./app.js";
import { scheduleBackups } from "./services/backup.service.js";
import { PORT } from "./config.js";

scheduleBackups();
const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`API disponible sur http://localhost:${PORT}`);
});

// On SIGTERM (systemd) or Ctrl+C: finish pending requests, close the
// database, exit within 5 s.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
