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

## M1 additions (approved 2026-10-17)
- `firm_holiday` table for the holiday calendar (13.3 item 1).
- The seed creates Summit Factoring as a FACTOR party only; its factoring profile arrives with M5.
- Seed users share a dev password (`SEED_PASSWORD`, default `lonestar-dev-password`); the seed prints
  authenticator keys for admin@ and finance@ and refuses to run in staging or production.

## M1 interpretations (flagged for review)
- `membership.disabled_at` and `membership.mfa_required` were added for "disable" and "require MFA"
  on Users and roles (13.3 item 2). Disable is per firm: `app_user.status` is global, and one
  firm's Admin must not lock a user out of another firm.
- Consultant invitations now require a consultant record (`invitation.consultant_id`), and the
  section 5.1 rule "consultant_id required when role = CONSULTANT" is a CHECK (NOT VALID, so older
  rows are left alone).
- Activating an engagement requires a REGULAR bill rate covering its start date (otherwise
  `resolveRate` returns NO_RATE and invoicing would be blocked from day one).
- Rates are changed by ending the current rate and adding a new one (section 16 `addRate`/`endRate`);
  an end date can only move earlier, so a later rate can never be overlapped by an edit.
- Party `kind` can't change after creation. Employment type can't change once a consultant has
  engagements.
- `party.code` is 2–10 capital letters or digits; required for prime vendors and implementation
  partners (they can be bill-to and feed `{CLIENT}`).
- Unknown `{TOKENS}` in a numbering pattern are literal text, as section 7.4 says.
- Document status flags "expiring" within 30 days of expiry.
- Invoice cycle ≥ timesheet cycle uses the order WEEKLY < BIWEEKLY < SEMIMONTHLY < MONTHLY.
- Same-firm composite foreign keys back up tenant isolation for every cross-table reference.
