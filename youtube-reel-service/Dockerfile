# Reel generation service — one image, two processes (reel-api / reel-worker).
# Debian (not alpine) because it needs ffmpeg with libass/libx264, Python yt-dlp and the deno JS runtime.

FROM node:20-bookworm-slim AS build
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:20-bookworm-slim AS runtime
# Pinned versions: yt-dlp must be refreshed when YouTube changes (rebuild the image with a newer version).
ARG YTDLP_VERSION=2026.08.19
ARG DENO_VERSION=v2.9.7
ENV NODE_ENV=production \
    REEL_WORK_DIR=/work \
    REEL_ASSETS_DIR=/app/assets \
    XDG_CACHE_HOME=/work/.cache \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates curl unzip tini \
 && pip install --no-cache-dir --break-system-packages "yt-dlp[default]==${YTDLP_VERSION}" \
 && curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
 && unzip -q /tmp/deno.zip -d /usr/local/bin && rm /tmp/deno.zip && chmod +x /usr/local/bin/deno \
 && apt-get purge -y unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && yt-dlp --version && deno --version | head -1 && ffmpeg -hide_banner -version | head -1

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY assets ./assets
RUN mkdir -p /work/.cache && chown -R node:node /work
USER node

# tini reaps ffmpeg/yt-dlp children and forwards signals for graceful shutdown.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.worker.js"]
