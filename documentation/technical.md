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
| Three.js | 0.171 | the 3D library and the groceries basket's shelf, glTF models compressed with meshopt |
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
  app/features/  one folder per page: library, book, recipe, groceries (shopping), settings, foods
  app/shared/    styles, components, translations, fonts
shared/        code shared by the site and the server (ingredients, tags, shopping list, text)
public/        3D models, photo reader (copied at install time)
scripts/       building the nutrition database, copying the photo reader
Dockerfile     container image
docker-compose.yml  container stack, behind a reverse proxy
tests/         automated tests
data/          databases and backups (not in git)
```

Each page has three files: `*.page.html` (a static template), `*.page.css` and `*.page.js`. The template is inserted once, then filled through the DOM (`textContent`, `value`): no data ever goes through hand-built HTML. Pages load on demand; only the library and, on a computer, the groceries page (its basket's shelf) load Three.js. The wood and the contact shadows both shelves share are in `src/app/shared/three`.

Conventions: short code comments in English, one folder per page, no visual change during a refactor.

Phones: the phone layout is in each stylesheet's `@media (max-width: 640px)` rules; scripts read the same width from `shared/utils/media.js`. The library also counts a phone turned sideways (small height, touch screen) as a phone: it then shows the welcome screen alone and never loads Three.js.

## Data

`data/cuisine.db` holds five tables.

| Table | Content |
|---|---|
| books | title, colours, cover pictures, size, gloss, place on the shelves |
| recipes | book, title, people, time, ingredients (JSON list of quantity, unit, name), method, tag corrections |
| custom_tags | personal tags |
| shopping_recipes | the recipes in the groceries basket, in the order picked |
| shopping_hidden | the things taken off the groceries list |

The schema updates itself when the server starts. `data/nutrition.db` is built from the files in `scripts/nutrition/sources` (the Ciqual table, food names in French and English, unit weights) and is never changed by the application. `data/backups` receives the daily copies.

## Configuration

With `npm start` or `npm run dev`, the server reads a `.env` file, which is then required (template: `.env.example`). In Docker, the variables come from the image and `docker-compose.yml`.

| Variable | Default | Role |
|---|---|---|
| PORT | 3000 | server port |
| DB_PATH | ./data/cuisine.db | the library |
| NUTRITION_DB_PATH | ./data/nutrition.db | the nutrition table |
| BACKUP_DIR | ./data/backups | the daily copies, 7 kept |
| ALLOWED_HOSTS | empty | host names accepted besides the IP address, `localhost` and the machine's name, comma separated |
| TRUST_PROXY | 0 | reverse proxies in front of the app (1 behind Caddy), so the per-device limits see the client's address |

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
| `GET /api/shopping` | the groceries basket, with each recipe's lines to buy |
| `POST /api/shopping/recipes`, `DELETE /api/shopping/recipes/:id` | add a recipe to the basket or take it out |
| `POST /api/shopping/hidden` | take a thing off the groceries list |
| `GET`, `POST /api/backup` | state of the copies, copy now |
| `GET /api/backup/export`, `POST /api/backup/import` | export or replace the library |

## Development

```bash
npm install
cp .env.example .env
npm run nutrition:build   # nutrition database
npm run dev               # API on :3000, site on http://localhost:5173
```

The library starts empty: create a first book from the library's menu, import a backup from Settings, or import the demo library (see below).

| Script | Role |
|---|---|
| `npm run build` | builds the site into `dist/` |
| `npm start` | serves `dist/` and the API on one port, in production |
| `npm run check` | ESLint, Knip (unused code, exports and dependencies) and the tests |
| `npm run ocr:vendor` | copies the photo reader into `public/ocr`; runs by itself at install time |

### Demo library

A sample library in English, to try the app: 21 books on three shelves and 115 recipes, at least three per book. The top shelf is for everyday cooking (Desserts, French, Grandma's recipes, Meal prep, Quick), the middle one for preserves, sauces and drinks (Fermentation, Jams, Sauces, Italian, Drinks, Smoothies, Garnishes), the bottom one for cuisines of the world (Chinese, Japanese, Southeast Asian, Indian, Latin American, Middle Eastern, Persian, North African, Greek). The recipes cover every automatic tag; the library also has three personal tags and a few tag corrections. Every book has an illustrated cover.

It is not part of the repository, so a new install starts empty: download `recipe-library-demo.db` from the [demo release](https://github.com/RamsesFiniarel/Recipe-library/releases/tag/demo) and import it from Settings, Backup.

## Performance

The 3D scene is only drawn when something moves (no rendering at rest). Book covers are separate cached images rather than part of the API responses. Built scripts, styles and fonts carry a content hash and are cached for good. Responses are compressed, 3D models are compressed with meshopt, and only the modern variants of the photo reader ship.

## Deployment with Docker

The application runs as a container on a home server, behind a reverse proxy container that provides HTTPS (Caddy, for instance), both on a shared Docker network. Portainer, or `docker compose`, builds and runs it from this repository.

### Requirements

- A 64-bit Linux server with Docker and Compose, kept up to date.
- A reverse proxy on an external Docker network named `shared_net`, serving the app's name over HTTPS.
- A local DNS entry for that name (for instance `cuisine.home`), pointing to the server.
- A synchronised clock: with a wrong time, websites' certificates are rejected during a web import, and backups get the wrong date.
- Outgoing internet access for the web import. No port has to be opened on the router.

### Image and stack

The `Dockerfile` has two stages. The first installs everything, builds the site and the nutrition database; the second keeps only the Node runtime, the server, its own dependencies (about 5 MB) and the built site. The app runs as the unprivileged `node` user, and a health check calls `/api/books` every 30 seconds.

`docker-compose.yml` runs it as the `cuisine` container: port 3000 is exposed on `shared_net` only, never published on the host; privilege escalation is off and every capability dropped; memory is capped at 768 MB (reading an imported page can briefly take a few hundred MB), CPU at one core, logs at 30 MB. Two variables:

| Variable | Value | Role |
|---|---|---|
| ALLOWED_HOSTS | `cuisine.home` by default | the name(s) the proxy serves the app under |
| TRUST_PROXY | 1 | the proxy in front, so the per-device limits see the client's address |

The library and its backups live in the `cuisine_data` volume, which survives rebuilds. The proxy forwards the app's name to `cuisine:3000`; with Caddy:

```
cuisine.home:8449 {
    tls ...              # the proxy's own certificate settings
    reverse_proxy cuisine:3000
}
```

### First start

The library starts empty. To bring an existing one over, use Settings, Backup, Export on the machine that hosts it, then Import in the deployed app; the old machine must not be used afterwards, to avoid two libraries drifting apart. To try the app first, import the demo library (`recipe-library-demo.db`, see Demo library) the same way.

### Updates

Click "Back up now" in the settings, then redeploy: in Portainer, "Pull and redeploy" on the stack, which rebuilds the image from the repository; with Compose, `git pull && docker compose up -d --build`. The volume keeps the data, and the database schema updates itself at start-up. `npm audit --omit=dev` must stay at zero.

### Backups

The server copies the library at start-up then every 24 hours into `/app/data/backups` and keeps the last 7; an import also keeps the library it replaces (`cuisine-avant-import.db`). These copies sit in the same volume as the database: a regular export from the settings, or `docker cp cuisine:/app/data/backups .` to another machine, protects against losing the server.

To restore, import the file from the settings. By hand: stop the container, replace `cuisine.db` in the volume with the chosen copy, delete `cuisine.db-wal` and `cuisine.db-shm`, start it again.

### Monitoring

Portainer shows the container's state, health and logs (or `docker ps` and `docker logs cuisine`). It restarts by itself after an unexpected stop, and `docker stop` shuts it down cleanly: requests finished, database closed.

### Without Docker

On any machine with Node.js 22.13 or later: `npm ci && npm run build && npm run nutrition:build && npm prune --omit=dev`, a `.env` from `.env.example`, then `npm start`.

## Security

### Starting choices

- A family application on the local network, with no login by choice: anyone can read and change everything. Backups and limits make up for it.
- HTTPS through the reverse proxy; plain HTTP only inside the Docker network. The app's port is never published on the host nor opened to the internet.
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
- the page is parsed on a separate thread, given up after 10 seconds and limited to 256 MB: a booby-trapped page cannot freeze the server;
- only the extracted recipe reaches the browser, never the page;
- the application introduces itself by its name, `Cuisine/1.0`, and does not work around a site that refuses automated reading.

Behind the reverse proxy, the per-device limits read the client's address from `X-Forwarded-For` (`TRUST_PROXY=1`). The app is only reachable through the proxy, which sets that header itself, so a device cannot forge it.

### Accepted risks

- Any device on the network can change or delete anything.
- A device on the network can slow the server down within the allowed limits.
- Four `braces` alerts in the development tools (through Knip), never run in production.

### Checks

`npm run check` runs the tests of the protections: host names, request origin, rate limits, input validation, backups, addresses refused by the web import. The container runs as an unprivileged user, with every capability dropped, no privilege escalation and only its data volume writable.

## License

The code is under the MIT license (see `LICENSE`). The fonts are under the SIL Open Font License (`src/app/shared/fonts`), and the Ciqual table under the Licence Ouverte, credited to "Anses. 2025. Table de composition nutritionnelle des aliments Ciqual".
