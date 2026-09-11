# syntax=docker/dockerfile:1
# Image multi-arch (amd64 + arm64 — Oracle Ampere A1 inclus).

# ---------- Étape 1 : build (dashboard web + dépendances) --------------------
FROM node:22-bookworm-slim AS build
# Outils de compilation des modules natifs (better-sqlite3 sans prebuild ARM)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared ./shared
COPY server ./server
COPY web ./web
COPY templates ./templates
RUN npm run build --workspace @odile/web

# ---------- Étape 2 : dépendances de production uniquement -------------------
FROM node:22-bookworm-slim AS proddeps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev
# Détourage local (onnxruntime) : on ne garde que les binaires Linux utiles
RUN rm -rf node_modules/onnxruntime-node/bin/napi-v3/win32 \
           node_modules/onnxruntime-node/bin/napi-v3/darwin \
           node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_cuda.so \
           node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime_providers_tensorrt.so

# ---------- Étape 3 : image finale -------------------------------------------
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation fonts-noto-color-emoji fonts-noto-core \
      ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*

ARG GIT_SHA=unknown
ENV NODE_ENV=production \
    TZ=Europe/Paris \
    CHROMIUM_PATH=/usr/bin/chromium \
    DATA_DIR=/data \
    PORT=3080 \
    GIT_SHA=$GIT_SHA

WORKDIR /app
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/tsconfig.base.json ./
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/templates ./templates
COPY --from=build /app/web/dist ./web/dist

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "tsx", "server/src/index.ts"]
