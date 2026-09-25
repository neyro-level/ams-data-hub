FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build-base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate
WORKDIR /app

FROM build-base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=ams-start-pnpm,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm config set fetch-timeout 300000 \
  && pnpm config set fetch-retries 5 \
  && pnpm install --frozen-lockfile

FROM build-base AS runtime-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=ams-start-pnpm,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm config set fetch-timeout 300000 \
  && pnpm config set fetch-retries 5 \
  && pnpm install --prod --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build && pnpm worker:build

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime-base
ENV NODE_ENV=production
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx
WORKDIR /app
USER node

FROM runtime-base AS runtime-web
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --chown=node:node --from=build /app/.next/standalone ./
ENTRYPOINT ["node", "server.js"]

FROM runtime-base AS runtime-worker
COPY --chown=node:node --from=runtime-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.runtime/worker ./.runtime/worker
COPY --chown=node:node package.json ./package.json
ENTRYPOINT ["node", ".runtime/worker/worker/main.js"]
CMD ["outbox-worker"]

# The migrator is deliberately separate from both runtime images. It carries
# build-time Prisma tooling but exposes only the controlled migration entrypoint.
FROM runtime-base AS migrator
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node --from=build /app/scripts/pgboss-migrate.mjs ./scripts/pgboss-migrate.mjs
COPY --chown=node:node scripts/migrator-entrypoint.mjs ./scripts/migrator-entrypoint.mjs
COPY --chown=node:node package.json ./package.json
ENTRYPOINT ["node", "scripts/migrator-entrypoint.mjs"]

FROM runtime-web AS runtime
