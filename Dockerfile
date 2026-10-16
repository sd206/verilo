# One image for web, worker and migrate (section 24.7: build once, promote the same digest).
#   web:     node apps/web/server.js          (default CMD)
#   worker:  node dist/worker.mjs
#   migrate: node dist/migrate.mjs
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/jobs/package.json packages/jobs/
COPY packages/integrations/storage/package.json packages/integrations/storage/
COPY packages/integrations/email/package.json packages/integrations/email/
COPY packages/integrations/qbo/package.json packages/integrations/qbo/
COPY packages/integrations/ai/package.json packages/integrations/ai/
COPY packages/integrations/pdf/package.json packages/integrations/pdf/
COPY tests/e2e/package.json tests/e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @verilo/web build && node scripts/bundle.mjs

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 MIGRATIONS_DIR=/app/migrations
WORKDIR /app
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=app:app /repo/dist ./dist
COPY --from=build --chown=app:app /repo/packages/db/migrations ./migrations
USER app
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
