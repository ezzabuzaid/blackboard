FROM node:24-bookworm-slim AS build

WORKDIR /app

ENV NX_DAEMON=false

COPY package.json package-lock.json nx.json tsconfig*.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/annotation/package.json packages/annotation/package.json
COPY packages/input/package.json packages/input/package.json
COPY packages/voice/package.json packages/voice/package.json
RUN npm ci

COPY apps apps
COPY catalog catalog
COPY packages packages
COPY sdk-it.config.ts sdk-it.config.ts
RUN npx nx run api:build \
  && VITE_API_URL= npx nx run web:build \
  && npm prune --omit=dev

FROM docker:29.7.2-cli AS docker-cli

FROM node:24-bookworm-slim AS app

ENV NODE_ENV=production \
  PORT=3001 \
  WEB_ROOT=/app/apps/web/dist \
  ZUKHRUF_DATA_DIR=/data/zukhruf

WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY catalog catalog
COPY participants participants

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]

FROM docker:29.7.2-dind AS sandbox-runner

WORKDIR /app

COPY catalog catalog
COPY participants participants
