# Technical documentation

## Overview

A Node.js server (Express) serves both the site, built by Vite, and a JSON API. The data lives in a single SQLite file. The site is written in plain JavaScript, without a framework, with an Angular-like layout: a router, one folder per page, API services and shared components. The heavy client work (3D, reading photos, PDF) runs in the browser; the server keeps the data, computes nutrition and tags, makes the backups and reads imported web pages.

## Stack

| Component | Version | Role |
|---|---|---|
| Node.js | 24 (22.13 minimum) | runs the server; provides SQLite through `node:sqlite`, with no native module to compile |
| Express | 4.22 | web server and API |
| helmet | 8.3 | security headers and content security policy |
| compression | 1.8 | response compression |
| parse5 | 8.0 | parsing the HTML of imported web pages |
| nanoid | 5.1 | book and recipe ids |
| Vite | 6.4 | site build |
| Three.js | 0.171 | the 3D library, glTF models compressed with meshopt |
| Tesseract.js | 7.0 | reading photos in the browser, French and English data |
| jsPDF | 4.2 | recipe PDF export |
| Fraunces, Inter | | fonts, served by the application |
| Ciqual 2025 table | | food composition (Anses, Licence Ouverte), the basis for nutrition |

Development tools: ESLint 9.39, Knip 5.88, concurrently 9.2 and Node's built-in test runner (`node:test`).

## Code layout

```
server/        Express server
  routes/        API, one file per resource
  services/      data, imports, backups, reading web pages
  middleware/    protections, input validation, errors
src/           site
  app/core/      router and API client
  app/features/  one folder per page: library, book, recipe, settings, foods
  app/shared/    styles, components, translations, fonts
shared/        code shared by the site and the server (ingredients, tags, text)
public/        3D models, photo reader (copied at install time)
scripts/       building the nutrition database, copying the photo reader
deploy/        systemd service and update script
tests/         automated tests
data/          databases and backups (not in git)
```

Each page has three files: `*.page.html` (a static template), `*.page.css` and `*.page.js`. The template is inserted once, then filled through the DOM (`textContent`, `value`): no data ever goes through hand-built HTML. Pages load on demand; only the library loads Three.js.

Conventions: short code comments in English, one folder per page, no visual change during a refactor.

## Data

`data/cuisine.db` holds three tables.

| Table | Content |
|---|---|
| books | title, colours, cover pictures, size, gloss, place on the shelves |
| recipes | book, title, people, time, ingredients (JSON list of quantity, unit, name), method, tag corrections |
| custom_tags | personal tags |

The schema updates itself when the server starts. `data/nutrition.db` is built from the files in `scripts/nutrition/sources` (the Ciqual table, food names in French and English, unit weights) and is never changed by the application. `data/backups` receives the daily copies.

## Configuration

The server reads a `.env` file, which is required (template: `.env.example`).

| Variable | Default | Role |
|---|---|---|
| PORT | 3000 | server port |
| DB_PATH | ./data/cuisine.db | the library |
| NUTRITION_DB_PATH | ./data/nutrition.db | the nutrition table |
| BACKUP_DIR | ./data/backups | the daily copies, 7 kept |
| ALLOWED_HOSTS | empty | host names accepted besides the IP address, `localhost` and the machine's name, comma separated |

## API

| Request | Role |
|---|---|
| `GET /api/books` | the books |
| `POST /api/books` | create a book |
| `GET /api/books/search-index` | books and recipes for the search |
| `PATCH /api/books/reorder` | new layout of the shelves |
| `GET /api/books/:id/textures/:face` | a cover picture |
| `GET`, `PATCH`, `DELETE /api/books/:id` | a book and its recipes |
| `POST /api/books/:id/recipes` | create a recipe |
| `POST /api/books/:id/recipes/import` | create a recipe from the text read on photos |
| `POST /api/books/:id/recipes/import-web` | create a recipe from a web page |
| `GET`, `PATCH`, `DELETE /api/books/:id/recipes/:id` | a recipe |
| `POST /api/nutrition` | nutrition facts for a list of ingredients |
| `POST /api/nutrition/tags` | automatic tags for a recipe being edited |
| `GET /api/nutrition/foods` | the whole nutrition table |
| `GET`, `POST`, `DELETE /api/tags` | personal tags |
| `GET`, `POST /api/backup` | state of the copies, copy now |
| `GET /api/backup/export`, `POST /api/backup/import` | export or replace the library |

## Development

```bash
npm install
cp .env.example .env
npm run nutrition:build   # nutrition database
npm run dev               # API on :3000, site on http://localhost:5173
```

The library starts empty: create a first book from the library's menu, or import a backup from Settings.

| Script | Role |
|---|---|
| `npm run build` | builds the site into `dist/` |
| `npm start` | serves `dist/` and the API on one port, in production |
| `npm run check` | ESLint, Knip (unused code, exports and dependencies) and the tests |
| `npm run ocr:vendor` | copies the photo reader into `public/ocr`; runs by itself at install time |

## Performance

The 3D scene is only drawn when something moves (no rendering at rest). Book covers are separate cached images rather than part of the API responses. Built scripts, styles and fonts carry a content hash and are cached for good. Responses are compressed, 3D models are compressed with meshopt, and only the modern variants of the photo reader ship.

## Deployment on a local server

### Requirements

- A Linux machine with systemd, kept up to date, with automatic security updates.
- Node.js 24 installed system-wide (`/usr/bin/node`, for instance from NodeSource) and git.
- A synchronised clock and the right time zone: with a wrong time, websites' certificates are rejected during a web import, and backups get the wrong date.
- A fixed IP address, reserved in the router, and a meaningful machine name (for instance `cuisine`, reachable as `cuisine.local`).
- Outgoing internet access for the web import. No port has to be opened on the router.

### Installation

The application lives in `/opt/cuisine` and runs as a dedicated user, without admin rights.

```bash
sudo useradd --create-home --shell /usr/sbin/nologin cuisine
sudo mkdir /opt/cuisine && sudo chown cuisine: /opt/cuisine
# Then, as cuisine:
sudo -u cuisine -H bash
git clone https://github.com/RamsesFiniarel/Recipe-library.git /opt/cuisine
cd /opt/cuisine
cp .env.example .env        # then set PORT and ALLOWED_HOSTS
npm ci && npm run build && npm run nutrition:build && npm prune --omit=dev
chmod 700 data
exit
# Back as an administrator:
sudo cp /opt/cuisine/deploy/cuisine.service /etc/systemd/system/
sudo systemctl enable --now cuisine
```

The site then answers on `http://cuisine.local:3000`. For an address without `:3000`, set `PORT=80` in `.env` and uncomment the `AmbientCapabilities` line of the service. Finally, set the firewall (`ufw`) to accept only the local network, on the application's port and on SSH.

The library starts empty. To bring an existing one over, use Settings, Backup, Export on the machine that hosts it, then Import on the new server; the old machine must not be used afterwards, to avoid two libraries drifting apart.

### Updates

```bash
sudo /opt/cuisine/deploy/update.sh
```

The script backs up the library, stops the service, pulls the latest `main`, reinstalls, rebuilds the site and the nutrition database, then starts the service again, even if a step failed. The database schema updates itself at start-up. After each update, `npm audit --omit=dev` must stay at zero.

### Backups

The server copies the library at start-up then every 24 hours into `data/backups` and keeps the last 7; an import also keeps the library it replaces (`cuisine-avant-import.db`). These copies sit on the same disk as the database: a regular export from the settings, or an automatic copy to another machine, protects against losing the server.

To restore, import the file from the settings. By hand: stop the service, replace `data/cuisine.db` with the chosen copy, delete `cuisine.db-wal` and `cuisine.db-shm`, start again.

### Monitoring

`systemctl status cuisine` shows the service's state, `journalctl -u cuisine` its messages. The service restarts by itself after an unexpected stop, and shuts down cleanly (requests finished, database closed) during an update or a reboot.

## Security

### Starting choices

- A family application on the local network, with no login by choice: anyone can read and change everything. Backups and limits make up for it.
- Plain HTTP on the local network: no password or secret travels. The port is never opened to the internet.
- The browser loads nothing from the internet: fonts, 3D models and the photo reader are served by the application, voice dictation was removed, and the content security policy only allows the site itself.

### Audit

An audit took place on 19 October 2026, before going live, following the OWASP Top 10:2025 and ASVS 5.0. Each lead was followed from its entry point to its effect, then confirmed or ruled out before any fix.

| Finding | Severity | Fix |
|---|---|---|
| DNS rebinding: a web page opened on the network could read or empty the library | medium | the server only answers to its IP address, `localhost`, the machine's name and `ALLOWED_HOSTS` |
| vulnerable `proxy-addr` (an Express dependency) | not reachable here | updated to 2.0.8 |
| no rate limit | low | 300 changes and 10 imports per minute and per device |
| 6 MB accepted everywhere, error 500 beyond | low | 1 MB by default, 6 MB for pictures and photos, 413 response |
| cover pictures checked on their label only | low | the content must start like a real JPEG or PNG |
| inline styles allowed though unused | low | content security policy limited to the site |
| no backup | low | automatic daily copy |
| tag key not validated on deletion | info | format checked |
| changes requested from another site | false positive | already blocked; now refused explicitly |

Checked and fine: SQL injection (parameterised queries), XSS (data set with `textContent`, no `eval`), file paths (never taken from input), secrets (none in the repository or its history), error messages (generic), regular expressions (no catastrophic backtracking), production dependencies (`npm audit` at zero).

### Since the audit

Importing a library only accepts a sound copy: SQLite header, integrity check, only the application's tables and their indexes, no trigger or view. The file is opened read-only while it is checked, the replaced library is copied first, and the interface asks for confirmation. Size limited to 64 MB, 10 backup operations per minute.

Importing from a web page is the only request the server sends to the internet. So that it cannot be used to reach the router or a device at home (SSRF):

- only `http` and `https`, on ports 80 and 443, with no credentials in the address;
- only public addresses, checked on the address actually connected to, at each redirect (5 at most);
- 15 seconds and 6 MB at most, HTML pages only;
- the page is parsed on a separate thread and given up after 10 seconds: a booby-trapped page cannot freeze the server;
- only the extracted recipe reaches the browser, never the page;
- the application introduces itself by its name, `Cuisine/1.0`, and does not work around a site that refuses automated reading.

### Accepted risks

- Any device on the network can change or delete anything.
- A device on the network can slow the server down within the allowed limits.
- Four `braces` alerts in the development tools (through Knip), never run in production.

### Checks

`npm run check` runs the tests of the protections: host names, request origin, rate limits, input validation, backups, addresses refused by the web import. The service runs as a dedicated user, with no extra rights and only `data/` writable.

## License

The code is under the MIT license (see `LICENSE`). The fonts are under the SIL Open Font License (`src/app/shared/fonts`), and the Ciqual table under the Licence Ouverte, credited to "Anses. 2025. Table de composition nutritionnelle des aliments Ciqual".
