# syntax=docker/dockerfile:1.7
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS deps
WORKDIR /app
ARG JARVIS_BUILD_PROFILE=vps-safe
ENV JARVIS_BUILD_PROFILE=$JARVIS_BUILD_PROFILE \
    JARVIS_SKIP_ELECTRON=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build:vps

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG JARVIS_BUILD_PROFILE=vps-safe
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    JARVIS_BUILD_PROFILE=$JARVIS_BUILD_PROFILE
RUN groupadd --system --gid 1001 jarvis && useradd --system --uid 1001 --gid jarvis jarvis
COPY --from=build --chown=jarvis:jarvis /app/.next/standalone ./
COPY --from=build --chown=jarvis:jarvis /app/.next/static ./.next/static
COPY --from=build --chown=jarvis:jarvis /app/public ./public
COPY --from=deps --chown=jarvis:jarvis /app/node_modules/yaml ./node_modules/yaml
COPY --from=build --chown=jarvis:jarvis /app/config/hermes/config.yaml ./config/hermes/config.yaml
COPY --from=build --chown=jarvis:jarvis /app/scripts/configure-hermes-broker.mjs ./scripts/configure-hermes-broker.mjs
USER jarvis
EXPOSE 3000
CMD ["node", "server.js"]
