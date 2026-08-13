FROM node:20-alpine AS base

RUN npm install -g pnpm

WORKDIR /app

# Dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# App sources & Build
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1

# Development runner
FROM base AS dev
EXPOSE 3000
CMD ["pnpm", "dev"]

# Production build
FROM base AS builder
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm run build

# Production runner
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN npm install -g pnpm

COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["pnpm", "start"]
