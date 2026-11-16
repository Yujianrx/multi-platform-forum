FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --cache /tmp/npm-cache
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY public ./public
COPY scripts/optimize-brand-assets.mjs ./scripts/optimize-brand-assets.mjs
RUN node scripts/optimize-brand-assets.mjs && npx tsc -p tsconfig.server.json && npx vite build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --cache /tmp/npm-cache && npm cache clean --force --cache /tmp/npm-cache
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/server/main.js"]
