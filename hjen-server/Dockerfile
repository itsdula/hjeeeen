# HJEN Studio server — container image.
#
# WHY THIS EXISTS: today the server is deployed by rsync onto a hand-built Ubuntu
# box (deploy.sh). That box is a pet: its ImageMagick, ffmpeg, node version and
# /data live only in one person's shell history. A region move (Dammam, Riyadh,
# anywhere) is not portable until the box is reproducible. This file is that.
#
# The server declares "zero runtime dependencies" in package.json, but that is
# true only of npm packages. It shells out to TWO system binaries:
#   convert  — cloudstore.js:35, cloudstore.js:350   (ImageMagick, thumbnails)
#   ffmpeg   — cloudstore.js:403, breakdown/ingest.js:20, cuts/engine.js
#   yt-dlp   — cuts/engine.js (URL fetch)
# and it has two native npm deps (sharp, onnxruntime-node). All four are pinned
# here so the image is the contract, not the box.
#
# BUILD (from this directory). On Apple Silicon you MUST cross-build to amd64 or
# the image will not boot on a Linux VM/Cloud Run — see the "works off the build
# machine" law:
#
#   # 1. the web renderer dist the server serves (paths.webappDir)
#   ( cd ../app && npm run build:web ) && rm -rf webapp-dist \
#     && cp -R ../app/dist webapp-dist
#   # 2. the image
#   docker buildx build --platform linux/amd64 -t hjen-server:local .
#
# RUN (local smoke test — keys come from the environment, never baked in):
#   docker run --rm -p 8787:8787 --env-file .env -v "$PWD/data:/data" hjen-server:local
#
# NOTHING SECRET GOES IN THIS IMAGE. Provider keys arrive as env vars at run
# time (Secret Manager on GCP, SSM on AWS). config.js reads keys from env only.

FROM node:22-bookworm-slim

# System binaries the server shells out to. Debian 12 ships ImageMagick 6, which
# provides `convert` under that exact name — the name the code calls.
# tini reaps the zombie children left by execFile'd convert/ffmpeg spawns.
RUN apt-get update && apt-get install -y --no-install-recommends \
      imagemagick \
      ffmpeg \
      ca-certificates \
      tini \
      curl \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp — the Cuts URL fetch (src/cuts/engine.js). Debian's package lags badly
# enough to break on live sites, so take the upstream static build and pin it.
# The engine probes for this exact path and reports honestly when it is absent,
# so removing this layer degrades one door rather than breaking the image.
ARG YTDLP_VERSION=2026.07.21
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" \
      -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp

# ImageMagick's Debian policy.xml blocks some coders by default. The server only
# ever resizes its OWN generated rasters (never user-supplied SVG/PS), so we lift
# nothing: if a future frame type is refused, fix the policy explicitly and say
# why, rather than disabling the policy wholesale.

WORKDIR /app

# Install deps first so the layer caches across code edits. --omit=dev keeps the
# image to the two native runtime deps (sharp, onnxruntime-node).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# The Context Agents seed library (58 method cards, 15 DNA profiles, the lexicon
# and the Eye criteria). src/contextagents/engine.js reads it as READ-ONLY and
# overlays each account's own cards on top, so it belongs in the image rather
# than on the data volume. ~300 KB.
COPY context_agents ./context_agents

# The built desktop renderer, served read-only on the web with the cloud adapter
# injected (see paths.webappDir). Build it before docker build — the step is in
# the header comment. Kept as a separate layer: renderer changes far more often
# than the server's node_modules.
COPY webapp-dist ./webapp-dist

# State. Mounted at run time — a persistent disk on a VM, a GCS volume on Cloud
# Run. Never a container-local directory in production: the container filesystem
# is ephemeral and, on Cloud Run, is RAM.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    HJEN_WEBAPP_DIST=/app/webapp-dist

USER node
EXPOSE 8787

# /health is the liveness endpoint deploy.sh already probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
