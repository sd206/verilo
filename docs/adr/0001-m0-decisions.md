# ADR 0001 — M0 stack choices and approved additions

Status: accepted (2026-10-16, product owner)

## Choices among the section 3 options
- ORM: **Drizzle** (SQL migrations committed in `packages/db/migrations`).
- Auth: **Auth.js** for the magic-link flow, with our own session layer (ADR 0002).
- Jobs: **pg-boss**. Errors: **Cloud Error Reporting** (no Sentry, no `SENTRY_DSN`).
- Email: **Postmark** (Mailpit locally).
- Monorepo: **pnpm workspaces** (no Turborepo).

## Approved additions (R10)
- Libraries: `@node-rs/argon2` (passwords), `otplib` + `qrcode` (TOTP), `@aws-sdk/client-s3` +
  `@aws-sdk/s3-request-presigner` (MinIO), `@google-cloud/storage`, `@google-cloud/kms`,
  `google-auth-library` (ID tokens to call `clamav`), `pino`. Build tooling: `tsx`, `esbuild`.
- Tables/columns: `session`, `verification_token`, `invitation`, `mfa_recovery_code`,
  `rate_limit`, `firm.wrapped_data_key`, `app_user.mfa_enabled_at`.
- `MIGRATE_DATABASE_URL` secret (owner role) next to `DATABASE_URL` (runtime role) — RLS needs a
  non-owner runtime role.
- Our own ClamAV HTTP wrapper image (`infra/images/clamav`).

## Interpretations made while building (flagged for review)
- `user` is reserved in Postgres → table `app_user`.
- `membership.consultant_id` is a nullable column with no FK or CHECK until the `consultant`
  table exists (M1). Consultants can be invited in M0 without a consultant record.
- Section 12 has no row for generic uploads. M0 uses `UPLOAD_FILES` (all roles) and
  `VIEW_ALL_FILES` (Admin/Manager/Finance); consultants see only their own uploads.
- "Managers also act as Finance" is supported by `can(..., { managersActAsFinance })`, but there
  is no firm setting for it yet (open decision 2).
- Sign-up says when an email already has an account (409). Email verification is not in M0.
- Sessions last 12 hours (no sliding expiry). TOTP codes aren't yet replay-protected within
  their 30-second window — hardening item for M8.
- `sa-clamav` (no data access) is used for the `clamav` service instead of the default compute
  account; it isn't in the 24.4 table.
