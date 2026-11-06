# syntax=docker/dockerfile:1
# NALARA API image (P0-012). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t nalara-api:local .
# No secret is ever passed as ARG/ENV. An optional BuildKit secret "npm_ca" adds a CA bundle
# for registries behind a TLS-inspecting proxy; it is mounted only for the install step.
ARG NODE_IMAGE=node:24.22.2-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d

FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi \
    && corepack enable \
    && pnpm install --frozen-lockfile --filter @nalara/api

FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @nalara/api run build

FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi \
    && corepack enable \
    && pnpm install --frozen-lockfile --prod --filter @nalara/api

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Everything is owned by root and only readable by the runtime user: the process cannot
# modify its own code even if the filesystem were writable.
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json
COPY db/migrations ./db/migrations
WORKDIR /app/apps/api
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
