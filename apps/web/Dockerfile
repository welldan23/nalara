# syntax=docker/dockerfile:1
# NALARA web image (P0-012), Next.js standalone output. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t nalara-web:local .
# No secret is ever passed as ARG/ENV (see apps/api/Dockerfile for the optional npm_ca secret).
ARG NODE_IMAGE=node:24.22.2-alpine3.24@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi \
    && corepack enable \
    && pnpm install --frozen-lockfile --filter @nalara/web
COPY apps/web apps/web
RUN pnpm --filter @nalara/web run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
