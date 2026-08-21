FROM node:20-alpine AS base

RUN npm install -g pnpm

WORKDIR /app

# Dependencies layer
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install

# Build layer
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm run build

# Production layer
FROM node:20-alpine AS production

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/dist ./dist
COPY --from=base /app/src/assets ./src/assets

EXPOSE 5001

CMD ["node", "dist/main"]
