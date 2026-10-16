# Verilo

C2C timesheet-to-cash platform for sub-vendor IT consulting firms. The build spec is
[`docs/build-spec.md`](docs/build-spec.md); project rules for coding agents are in `CLAUDE.md`.

**Status: M0 — Foundation** (spec section 19). Auth with MFA, firm sign-up, memberships and
roles, server-side permissions, audit log, scanned file uploads, row-level security, CI, and
Terraform for the shared and staging Google Cloud projects. No business features yet.

## Layout (section 4)

```
apps/web                  Next.js (App Router): screens, server actions, route handlers
packages/domain           Pure logic (R2): roles, state machines (domain/state)
packages/db               Drizzle schema, SQL migrations (incl. RLS), firm-scoped repositories
packages/auth             Sessions, passwords, TOTP, permission matrix (section 12), requireFeature, encryption
packages/jobs             pg-boss worker (heartbeat), migrate entry point, structured logger
packages/integrations/    storage (GCS + MinIO, signed URLs, ClamAV client), email (Postmark/Mailpit);
                          qbo, ai, pdf are placeholders for later milestones
tests/e2e                 Playwright: M0 flow (local) and the staging smoke test
infra/                    Terraform (shared, envs/staging, modules/environment), ClamAV image, bootstrap
docs/                     Spec, ADRs, runbooks (M8)
```

## Local development

Requirements: Node 22, pnpm 10 (`corepack enable`), Docker.

```bash
docker compose up -d --build --wait      # Postgres, MinIO, Mailpit, ClamAV (ClamAV takes ~2 min the first time)
docker compose up minio-init             # creates the buckets (exits when done)
pnpm install
cp .env.example apps/web/.env.local
set -a; . apps/web/.env.local; set +a    # or export the variables another way
pnpm db:migrate                          # owner role runs migrations; creates the runtime role
pnpm dev                                 # http://localhost:3000
```

Mailpit (invite and sign-in emails): http://localhost:8025 · MinIO console: http://localhost:9001

## Tests (R9)

```bash
pnpm typecheck && pnpm lint
pnpm test:unit                           # domain, permissions, crypto, TOTP, policies
pnpm test:integration                    # needs docker compose; resets the verilo_test database
pnpm build && pnpm test:e2e              # Playwright M0 flow against the built app
```

Integration tests include **T12 tenant isolation** (`apps/web/src/server/t12-tenant-isolation.int.test.ts`):
every server action and route is called with Firm B's session and Firm A's ids. A coverage
guard fails the suite when a handler, action or route is added without a T12 case.

## How tenant isolation works (R3)

1. Every handler gets `firmId` only from the session (`requireFirmContext`); Zod schemas are
   strict, so a client-sent `firmId` is rejected.
2. Every repository query filters by `firm_id`.
3. Postgres RLS (`packages/db/migrations/0001_rls.sql`): the app connects as a non-owner role;
   each request runs in a transaction that sets `app.firm_id` / `app.user_id`. The few steps
   before a session exists (sign-in lookup, session cookie lookup, invitation token lookup)
   go through narrow `SECURITY DEFINER` functions.

## Deployment

See [`infra/README.md`](infra/README.md). Every merge to `main` that passes CI builds one image,
scans it, runs the `migrate` job and deploys `web`, `worker` and `clamav` to staging, then runs
the Playwright smoke test.
