# Build stage: everything installed, the site built into dist/ (photo reader
# included) and the nutrition database made. node:sqlite is part of Node: no
# native module, so no compiler needed. Only the server's own dependencies
# are kept for the final image.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build \
  && NUTRITION_DB_PATH=/app/reference/nutrition.db npm run nutrition:build \
  && npm prune --omit=dev

# Final stage: the Node runtime, the server and the built site.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
  PORT=3000 \
  DB_PATH=/app/data/cuisine.db \
  BACKUP_DIR=/app/data/backups \
  NUTRITION_DB_PATH=/app/reference/nutrition.db

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/reference ./reference
COPY package.json ./
COPY server ./server
COPY shared ./shared

# The library and its backups: the only writable place, mounted as a volume.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/books', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
