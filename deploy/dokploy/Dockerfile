FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json nx.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci

COPY apps apps
COPY catalog catalog
COPY packages packages
COPY sdk-it.config.ts sdk-it.config.ts
RUN npx nx run api:build \
  && VITE_API_URL= npx nx run web:build \
  && npm prune --omit=dev

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
  PORT=3001 \
  WEB_ROOT=/app/apps/web/dist \
  ZUKHRUF_DATA_DIR=/data/zukhruf

WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY catalog catalog
COPY participants participants

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
