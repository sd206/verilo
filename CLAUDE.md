1. Product context (give this to the agent verbatim)
We are building a multi-tenant web application for small US IT consulting firms that work as sub-vendors in corp-to-corp (C2C) staffing chains:
```
End client (owns VMS such as SAP Fieldglass or Beeline)
  → Prime vendor (has VMS access, bills the end client)
    → [Implementation partner] (optional)
      → FIRM (our customer, the tenant)
        → Sub-vendor (supplies a contractor)  — or the consultant is the Firm's own W-2 employee
          → Consultant
```
The Firm usually does not have access to the end client's VMS. Consultants enter hours in the VMS, then send the Firm a screenshot of the approved VMS timesheet. Today the Firm's accounting staff key these hours in by hand, build invoices by hand, and match payments to invoices and vendor bills in spreadsheets.
The product does the following:
Captures hours once (in-app entry, email, or bulk upload of screenshots and PDFs), uses AI to extract hours and approval details from screenshots, and checks entered hours against the evidence.
Generates invoices to the bill-to party (usually the prime vendor) from verified hours, with configurable invoice numbering, templates, and an attached evidence PDF.
Generates expected sub-vendor bills from the same verified hours, then matches the sub-vendor's actual invoice against them (three-way match).
Records receipts (payments from prime vendors, including standard deductions, partial payments, and factoring) and applies them to invoices.
Releases sub-vendor payments on net terms or pay-when-paid, and records the vendor payments.
Reports margin, AR/AP aging, unbilled hours, PO burn, and the cash gap (vendor bills due before the matching prime payment is expected).
Pushes invoices, payments, bills, bill payments, and journal entries to QuickBooks Online (one-way). The app does not do the general ledger, payroll, taxes, or bank reconciliation.
The app records money; it does not move money in v1.
---
2. Non-negotiable engineering rules (give this to the agent verbatim)
R1 Money. Store all money as integer cents (`BIGINT`). Never use floating point for money. Hours are stored as `NUMERIC(7,2)`. Rates are integer cents per hour. Line amount = `round_half_up(hours × rate_cents)` to whole cents. Percentages are stored as basis points (`INT`, 2% = 200).
R2 Pure domain layer. All billing math, rate resolution, line splitting, matching, release rules and status transitions live in a framework-free `domain/` module with no database or HTTP imports. Every function is unit-tested.
R3 Tenant isolation. Every tenant-owned table has `firm_id`. Every query MUST be scoped by `firm_id` from the authenticated session, never from client input. Add a Postgres row-level-security policy as a second safeguard. Write an automated test proving that a user from Firm A can't read or change Firm B's data through any API route.
R4 Immutability. Once a timesheet is `INVOICED`, an invoice is `APPROVED` or later, or a vendor bill is `APPROVED` or later, its financial fields can't be updated. Corrections happen only through credit memos, adjustment lines, supplemental invoices, or reversals.
R5 Audit log. Every create, update, status change, override and QuickBooks sync writes an `audit_event` row (who, when, what entity, before/after JSON, reason). Overrides MUST require a reason.
R6 Status machines. Status changes go only through the transition functions in `domain/state/`. Direct `UPDATE … SET status` outside those functions is forbidden. Invalid transitions throw.
R7 Idempotency. QuickBooks pushes, email intake, AI extraction jobs, and invoice numbering MUST be idempotent. Store external IDs and use idempotency keys.
R8 Server-side authorization. Enforce permissions (Section 12) on the server for every action. Hiding a button in the UI is not authorization.
R9 Tests. Every milestone ships with passing unit tests (domain), integration tests (API + DB), and at least one end-to-end test (Playwright) for its main flow. CI runs typecheck, lint and all tests.
R10 Don't invent scope. If something isn't covered by this spec, stop and ask. Don't add features, libraries or tables that aren't listed without approval.
R11 Secrets. No secrets in code. Use environment variables. QuickBooks tokens and bank details are encrypted at rest (application-level encryption with a key from the environment).
R12 Time. Store timestamps in UTC (`timestamptz`). Work dates (timesheet days, period boundaries, invoice dates) are stored as `DATE` and interpreted in the Firm's time zone (default `America/Chicago`).
---
3. Technology stack
Defaults (the agent MAY propose equivalents, but must ask first):
Concern	Choice
Language	TypeScript (strict mode) everywhere
Web app	Next.js (App Router), React, server actions and route handlers
UI	Tailwind CSS + shadcn/ui; TanStack Table for data grids
Database	PostgreSQL 16
ORM / migrations	Drizzle ORM (or Prisma) with SQL migrations committed to the repo
Auth	Auth.js (or Clerk) — email + password, magic link, TOTP MFA (required for Admin and Finance)
Background jobs	pg-boss (Postgres-backed queue) or Inngest
File storage	Google Cloud Storage in staging and production (native client, signed upload URLs); MinIO (S3 API) locally, behind one storage interface. Virus scan on upload (ClamAV container)
Inbound email	Postmark or SendGrid inbound parse → webhook
Outbound email	Postmark / SendGrid / Resend
PDF generation	React-PDF or HTML → PDF via headless Chromium (Playwright). PDF merge for the evidence pack (pdf-lib)
AI extraction	Gemini on Vertex AI (Section 24.9), with structured JSON output (schema in Section 8). Wrap the provider behind an interface so it can be swapped
QuickBooks	QuickBooks Online Accounting API v3 via direct REST calls, OAuth 2.0
Subscription payments	Stripe (hosted checkout and invoices) — collects what our domain computes; no card data stored (Section 22, milestone M9)
Validation	Zod schemas shared between client and server
Exports	ExcelJS for the XLSX workbook; a streaming ZIP library (archiver or yazl) for the CPA package (Section 23)
Testing	Vitest (unit/integration), Playwright (E2E), Testcontainers or a docker-compose Postgres for integration tests
Observability	Structured logging (pino) to Cloud Logging, Cloud Error Reporting (or Sentry), Cloud Monitoring alerts and dashboards (Section 24.8), job dashboard
Hosting	Google Cloud (Section 24): Cloud Run service for the web app, Cloud Run worker pool for jobs, Cloud SQL for PostgreSQL, Cloud Storage, Secret Manager, Cloud KMS, Terraform for infrastructure. Docker Compose for local development
Mobile: v1 is a responsive web app installable as a PWA. Consultants must be able to submit a timesheet and upload a screenshot from a phone browser. Native apps are out of scope.
---
4. Repository layout
```
/apps/web                 Next.js app (UI, route handlers, server actions)
/packages/domain          Pure business logic (R2): money, rates, periods, lines, matching, release, state machines
/packages/db              Schema, migrations, seed, repository functions (all firm-scoped)
/packages/jobs            Background job definitions (extraction, email intake, QBO sync, reminders, aging)
/packages/integrations
    /qbo                  QuickBooks Online client, mapping, push functions
    /ai                   Extraction provider interface + implementation + prompts
    /email                Inbound parsing, outbound templates
    /storage              S3 wrapper, presigned URLs, virus scan hook
    /pdf                  Invoice renderer, evidence pack builder, remittance renderer
/packages/auth            Session, roles, permission checks
/tests/e2e                Playwright tests
/docs                     This spec, the workflow doc, ADRs (architecture decision records)
/infra                    Terraform for the shared, staging and production Google Cloud projects (Section 24)
/docs/runbooks            Restore, outage, secret rotation and QBO runbooks (Section 24.6)
docker-compose.yml        Postgres, MinIO (local S3), Mailpit (local email), ClamAV
```
---
