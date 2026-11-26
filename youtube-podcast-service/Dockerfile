# Podcast service: one image, one process (API + scheduler).
# Debian (not alpine): ffmpeg with libmp3lame, Python yt-dlp (audio fallback download) and the deno JS runtime for YouTube's challenges.
# yt-dlp / deno / PO-token plugin versions match the reel service image (see youtube-reel-service/Dockerfile for why they are pinned).

FROM node:20-bookworm-slim AS build
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:20-bookworm-slim AS runtime
ARG YTDLP_VERSION=2026.11.23
ARG POT_PLUGIN_VERSION=2.0.2
ARG DENO_VERSION=v2.9.7
ENV NODE_ENV=production \
    PODCAST_WORK_DIR=/work \
    XDG_CACHE_HOME=/work/.cache \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates curl unzip tini \
 && pip install --no-cache-dir --break-system-packages "yt-dlp[default]==${YTDLP_VERSION}" "bgutil-ytdlp-pot-provider==${POT_PLUGIN_VERSION}" \
 && printf '%s\n' '# PO tokens from the reel-pot sidecar (docker-compose.reels.yml, reachable on the shared network)' '--extractor-args "youtubepot-bgutilhttp:base_url=http://reel-pot:4416"' > /etc/yt-dlp.conf \
 && curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
 && unzip -q /tmp/deno.zip -d /usr/local/bin && rm /tmp/deno.zip && chmod +x /usr/local/bin/deno \
 && apt-get purge -y unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && yt-dlp --version && deno --version | head -1 && ffmpeg -hide_banner -version | head -1 && ffmpeg -hide_banner -encoders 2>/dev/null | grep -c libmp3lame

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /work/.cache && chown -R node:node /work
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
