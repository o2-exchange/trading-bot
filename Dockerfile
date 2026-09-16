# Builds the trading bot (Vite SPA) and serves it with nginx.
# docker build -t o2-trading-bot .

FROM node:22-bookworm-slim AS build
# keccak, bufferutil, utf-8-validate and bigint-buffer compile native addons with node-gyp.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# pnpm 9 matches lockfileVersion 9.0; pnpm 12 refuses to install because of
# dependency build scripts (ERR_PNPM_IGNORED_BUILDS).
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# PostHog project key and ingest host, baked into the bundle (Vercel supplied them as env vars).
ARG VITE_PUBLIC_POSTHOG_KEY
ARG VITE_PUBLIC_POSTHOG_HOST
ENV VITE_PUBLIC_POSTHOG_KEY=$VITE_PUBLIC_POSTHOG_KEY \
    VITE_PUBLIC_POSTHOG_HOST=$VITE_PUBLIC_POSTHOG_HOST \
    NODE_ENV=production
# Same command Vercel ran (vercel.json buildCommand).
RUN pnpm build

FROM nginx:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
