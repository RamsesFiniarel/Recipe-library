#!/bin/sh
# Updates the app to the latest main branch (see documentation/technical.md).
# Run as an administrator: sudo /opt/cuisine/deploy/update.sh
set -eu

APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
APP_USER=$(stat -c %U "$APP_DIR")
as_app() { sudo -u "$APP_USER" -H sh -c "cd '$APP_DIR' && $1"; }

# Backup first, made by the running server.
PORT=$(sed -n 's/^PORT=//p' "$APP_DIR/.env")
curl -fsS -X POST "http://localhost:${PORT:-3000}/api/backup" > /dev/null \
  || echo "No backup: the server isn't answering."

systemctl stop cuisine
# Started again whatever happens below.
trap 'systemctl start cuisine' EXIT
as_app "git pull --ff-only"
as_app "npm ci"
as_app "npm run build"
as_app "npm run nutrition:build"
as_app "npm prune --omit=dev"
echo "Update done."
