# Build Specification for an AI Coding Agent

## Product: Verilo — C2C Timesheet-to-Cash Platform for Sub-Vendor IT Consulting Firms

**Tagline:** Accurate hours. Less busywork. More time for your business.

Version 1.0 — companion to "End-to-End Workflow: Consultants, Clients, Vendors and Payments" (v2)

\---

## 0\. How to use this document with an AI coding tool

This spec is written for an autonomous or semi-autonomous coding agent (e.g. Claude Code, Cursor, Codex, Replit Agent, Lovable, Bolt). It's tool-agnostic.

**Recommended process**

1. Give the agent **Sections 1–4 (context, rules, stack, repo layout)** at the start of every session. Put them in the tool's persistent instruction file (`CLAUDE.md`, `.cursorrules`, `AGENTS.md`, or project knowledge).
2. Build **one milestone at a time** (Section 19). Paste the milestone prompt plus the sections it references.
3. Require the agent to **write the domain tests in Section 18 before the code that satisfies them.**
4. Don't move to the next milestone until every acceptance criterion passes and you've clicked through the screens yourself.
5. When the agent proposes something not in this spec, it must stop and ask (Rule R10).

**Notation**

* `MUST` = required. `SHOULD` = strongly recommended. `MAY` = optional.
* Money is shown as `$1,234.56` in examples but is stored as integer cents (Rule R1).

\---

## 1\. Product context (give this to the agent verbatim)

We are building a multi-tenant web application for **small US IT consulting firms that work as sub-vendors** in corp-to-corp (C2C) staffing chains:

```
End client (owns VMS such as SAP Fieldglass or Beeline)
  → Prime vendor (has VMS access, bills the end client)
    → \[Implementation partner] (optional)
      → FIRM (our customer, the tenant)
        → Sub-vendor (supplies a contractor)  — or the consultant is the Firm's own W-2 employee
          → Consultant
```

The Firm usually **does not have access to the end client's VMS**. Consultants enter hours in the VMS, then send the Firm a **screenshot of the approved VMS timesheet**. Today the Firm's accounting staff key these hours in by hand, build invoices by hand, and match payments to invoices and vendor bills in spreadsheets.

The product does the following:

1. Captures hours once (in-app entry, email, or bulk upload of screenshots and PDFs), uses AI to **extract hours and approval details from screenshots**, and checks entered hours against the evidence.
2. Generates **invoices to the bill-to party (usually the prime vendor)** from verified hours, with configurable invoice numbering, templates, and an attached evidence PDF.
3. Generates **expected sub-vendor bills** from the same verified hours, then **matches the sub-vendor's actual invoice** against them (three-way match).
4. Records **receipts** (payments from prime vendors, including standard deductions, partial payments, and factoring) and **applies them to invoices**.
5. Releases **sub-vendor payments** on net terms or **pay-when-paid**, and records the vendor payments.
6. Reports margin, AR/AP aging, unbilled hours, PO burn, and the **cash gap** (vendor bills due before the matching prime payment is expected).
7. **Pushes** invoices, payments, bills, bill payments, and journal entries to **QuickBooks Online** (one-way). The app does **not** do the general ledger, payroll, taxes, or bank reconciliation.

The app **records money; it does not move money** in v1.

\---

## 2\. Non-negotiable engineering rules (give this to the agent verbatim)

* **R1 Money.** Store all money as **integer cents** (`BIGINT`). Never use floating point for money. Hours are stored as `NUMERIC(7,2)`. Rates are integer cents per hour. Line amount = `round\_half\_up(hours × rate\_cents)` to whole cents. Percentages are stored as basis points (`INT`, 2% = 200).
* **R2 Pure domain layer.** All billing math, rate resolution, line splitting, matching, release rules and status transitions live in a framework-free `domain/` module with no database or HTTP imports. Every function is unit-tested.
* **R3 Tenant isolation.** Every tenant-owned table has `firm\_id`. Every query MUST be scoped by `firm\_id` from the authenticated session, never from client input. Add a Postgres row-level-security policy as a second safeguard. Write an automated test proving that a user from Firm A can't read or change Firm B's data through any API route.
* **R4 Immutability.** Once a timesheet is `INVOICED`, an invoice is `APPROVED` or later, or a vendor bill is `APPROVED` or later, its financial fields can't be updated. Corrections happen only through credit memos, adjustment lines, supplemental invoices, or reversals.
* **R5 Audit log.** Every create, update, status change, override and QuickBooks sync writes an `audit\_event` row (who, when, what entity, before/after JSON, reason). Overrides MUST require a reason.
* **R6 Status machines.** Status changes go only through the transition functions in `domain/state/`. Direct `UPDATE … SET status` outside those functions is forbidden. Invalid transitions throw.
* **R7 Idempotency.** QuickBooks pushes, email intake, AI extraction jobs, and invoice numbering MUST be idempotent. Store external IDs and use idempotency keys.
* **R8 Server-side authorization.** Enforce permissions (Section 12) on the server for every action. Hiding a button in the UI is not authorization.
* **R9 Tests.** Every milestone ships with passing unit tests (domain), integration tests (API + DB), and at least one end-to-end test (Playwright) for its main flow. CI runs typecheck, lint and all tests.
* **R10 Don't invent scope.** If something isn't covered by this spec, stop and ask. Don't add features, libraries or tables that aren't listed without approval.
* **R11 Secrets.** No secrets in code. Use environment variables. QuickBooks tokens and bank details are encrypted at rest (application-level encryption with a key from the environment).
* **R12 Time.** Store timestamps in UTC (`timestamptz`). Work dates (timesheet days, period boundaries, invoice dates) are stored as `DATE` and interpreted in the Firm's time zone (default `America/Chicago`).

\---

## 3\. Technology stack

Defaults (the agent MAY propose equivalents, but must ask first):

|Concern|Choice|
|-|-|
|Language|TypeScript (strict mode) everywhere|
|Web app|Next.js (App Router), React, server actions and route handlers|
|UI|Tailwind CSS + shadcn/ui; TanStack Table for data grids|
|Database|PostgreSQL 16|
|ORM / migrations|Drizzle ORM (or Prisma) with SQL migrations committed to the repo|
|Auth|Auth.js (or Clerk) — email + password, magic link, TOTP MFA (required for Admin and Finance)|
|Background jobs|pg-boss (Postgres-backed queue) or Inngest|
|File storage|Google Cloud Storage in staging and production (native client, signed upload URLs); MinIO (S3 API) locally, behind one storage interface. Virus scan on upload (ClamAV container)|
|Inbound email|Postmark or SendGrid inbound parse → webhook|
|Outbound email|Postmark / SendGrid / Resend|
|PDF generation|React-PDF or HTML → PDF via headless Chromium (Playwright). PDF merge for the evidence pack (pdf-lib)|
|AI extraction|Gemini on Vertex AI (Section 24.9), with structured JSON output (schema in Section 8). Wrap the provider behind an interface so it can be swapped|
|QuickBooks|QuickBooks Online Accounting API v3 via direct REST calls, OAuth 2.0|
|Subscription payments|Stripe (hosted checkout and invoices) — collects what our domain computes; no card data stored (Section 22, milestone M9)|
|Validation|Zod schemas shared between client and server|
|Exports|ExcelJS for the XLSX workbook; a streaming ZIP library (archiver or yazl) for the CPA package (Section 23)|
|Testing|Vitest (unit/integration), Playwright (E2E), Testcontainers or a docker-compose Postgres for integration tests|
|Observability|Structured logging (pino) to Cloud Logging, Cloud Error Reporting (or Sentry), Cloud Monitoring alerts and dashboards (Section 24.8), job dashboard|
|Hosting|**Google Cloud** (Section 24): Cloud Run service for the web app, Cloud Run worker pool for jobs, Cloud SQL for PostgreSQL, Cloud Storage, Secret Manager, Cloud KMS, Terraform for infrastructure. Docker Compose for local development|

Mobile: v1 is a **responsive web app installable as a PWA**. Consultants must be able to submit a timesheet and upload a screenshot from a phone browser. Native apps are out of scope.

\---

## 4\. Repository layout

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

\---

## 5\. Data model

All tables have `id UUID PK`, `created\_at`, `updated\_at`, `created\_by` (user id). Tenant tables also have `firm\_id UUID NOT NULL` with an index. Soft delete (`archived\_at`) is used for master data; financial records are never deleted.

### 5.1 Tenancy and users

**firm**

|Column|Type|Notes|
|-|-|-|
|legal\_name, display\_name|text||
|ein|text, encrypted||
|address\_line1, address\_line2, city, state, postal\_code, country|text||
|phone, email, website|text||
|logo\_file\_id|UUID → file||
|timezone|text|default `America/Chicago`|
|week\_start|enum `MON`,`SUN`|default `MON`|
|default\_payment\_terms\_days|int|default 30|
|remit\_to\_text|text|Printed on invoices (bank or remit instructions)|
|invoice\_number\_pattern|text|default `{CLIENT}-{YYYY}{MM}-{SEQ:4}`|
|invoice\_seq\_reset|enum `NEVER`,`YEARLY`,`MONTHLY`|default `YEARLY`|
|timesheet\_inbox\_address|text, unique|e.g. `ts-<slug>@inbound.app.com`|
|ap\_inbox\_address|text, unique|e.g. `ap-<slug>@inbound.app.com`|
|match\_tolerance\_cents|int|default 100 ($1.00)|
|deduction\_tolerance\_cents|int|default 100|

**user** — `email` (unique), `name`, `password\_hash` (nullable), `mfa\_secret` (encrypted, nullable), `status` (`INVITED`,`ACTIVE`,`DISABLED`).

**membership** — `firm\_id`, `user\_id`, `role` enum `ADMIN`,`MANAGER`,`FINANCE`,`CONSULTANT`, `consultant\_id` (nullable, required when role = CONSULTANT). A user can belong to several firms.

**audit\_event** — `firm\_id`, `actor\_user\_id`, `entity\_type`, `entity\_id`, `action`, `before` jsonb, `after` jsonb, `reason` text, `ip`, `user\_agent`.

**file** — `firm\_id`, `storage\_key`, `filename`, `mime\_type`, `size\_bytes`, `sha256`, `perceptual\_hash` (images, nullable), `scan\_status` enum `PENDING`,`CLEAN`,`INFECTED`, `uploaded\_by`, `source` enum `UPLOAD`,`EMAIL`,`SYSTEM`.

### 5.2 Parties

**party** — one table for every external organization.

|Column|Type|Notes|
|-|-|-|
|kind|enum `PRIME\_VENDOR`,`IMPLEMENTATION\_PARTNER`,`END\_CLIENT`,`SUB\_VENDOR`,`FACTOR`||
|legal\_name, display\_name|text||
|code|text|Short code for invoice numbers, e.g. `GLBX`. Unique per firm|
|address fields, phone|text||
|ap\_emails|text\[]|Where invoices and reminders go (bill-to parties)|
|ar\_emails|text\[]|Where remittances go (sub-vendors)|
|payment\_terms\_days|int||
|pays\_when\_paid\_upstream|bool|Bill-to only: they pay us after the end client pays them|
|upstream\_buffer\_days|int|Forecast buffer, default 15|
|standard\_deduction\_bps|int|Bill-to only, e.g. 200 = 2%|
|deduction\_label|text|e.g. "MSP fee"|
|invoice\_layout|enum `PER\_CONSULTANT`,`COMBINED`|default `PER\_CONSULTANT` for primes|
|delivery\_method|enum `EMAIL`,`PORTAL`||
|backup\_required|bool|Attach the evidence pack|
|po\_required|bool||
|timesheet\_confirm\_email|text|Prime contact who can confirm VMS hours|
|vendor\_pay\_terms|enum `NET`,`PAY\_WHEN\_PAID`|Sub-vendors only|
|vendor\_net\_days|int|Sub-vendors only|
|remit\_details|text, encrypted|Sub-vendors only|
|qbo\_customer\_id / qbo\_vendor\_id|text|Set after mapping|

Sub-vendors also carry `w9\_tax\_classification`, `tin` (encrypted) and `tin\_type` (section 23.8).

**party\_document** — `party\_id`, `doc\_type` enum `W9`,`COI`,`MSA`,`WORK\_ORDER`,`OTHER`, `file\_id`, `effective\_date`, `expiry\_date`, `required\_for\_payment` bool.

**party\_contact** — `party\_id`, `name`, `email`, `phone`, `role\_label`.

### 5.3 Consultants and engagements

**consultant**

|Column|Type|Notes|
|-|-|-|
|first\_name, last\_name|text||
|emails|text\[]|All addresses they may send timesheets from. Unique per firm|
|phone|text||
|employment\_type|enum `W2`,`CONTRACTOR`||
|sub\_vendor\_party\_id|UUID → party|Required when CONTRACTOR|
|work\_auth\_type|text, nullable|Alerts only|
|work\_auth\_expiry|date, nullable||
|status|enum `ACTIVE`,`INACTIVE`||

**engagement**

|Column|Type|Notes|
|-|-|-|
|consultant\_id|UUID||
|bill\_to\_party\_id|UUID → party|Usually PRIME\_VENDOR|
|end\_client\_party\_id|UUID → party||
|prime\_party\_id|UUID → party, nullable|Same as bill-to in the common case|
|implementation\_partner\_party\_id|UUID, nullable||
|project\_name, role\_title|text||
|start\_date, end\_date|date|end\_date nullable|
|timesheet\_cycle|enum `WEEKLY`,`BIWEEKLY`,`SEMIMONTHLY`,`MONTHLY`||
|biweekly\_anchor\_date|date, nullable|Required for BIWEEKLY|
|invoice\_cycle|enum, same values|Must be ≥ timesheet cycle|
|evidence\_required|bool|default true|
|expected\_weekly\_hours|numeric(5,2)|default 40|
|max\_weekly\_hours\_warning|numeric(5,2)|default 50|
|deduction\_bps\_override|int, nullable|Overrides party.standard\_deduction\_bps|
|factored|bool|default false|
|prime\_work\_order\_no|text||
|prime\_consultant\_ref|text|Consultant ID in the prime's system|
|end\_client\_worker\_ref|text|VMS worker ID if known|
|status|enum `DRAFT`,`ACTIVE`,`ENDED`||

**rate** — effective-dated, never overlapping per (engagement, rate\_kind, side).

|Column|Type|Notes|
|-|-|-|
|engagement\_id|UUID||
|side|enum `BILL`,`PAY`|PAY only for CONTRACTOR engagements|
|rate\_kind|enum `REGULAR`,`OVERTIME`,`HOLIDAY`|v1 MUST support REGULAR; OT and HOLIDAY MAY be stored and used if present|
|rate\_cents|int|Per hour|
|effective\_from|date||
|effective\_to|date, nullable|Inclusive|

Constraint: an exclusion constraint (or a check in the domain layer plus a DB trigger) prevents overlapping ranges for the same (engagement\_id, side, rate\_kind).

**purchase\_order**

|Column|Type|Notes|
|-|-|-|
|engagement\_id|UUID||
|po\_number|text|Usually the prime's work order|
|amount\_cents|bigint, nullable||
|start\_date, end\_date|date||
|alert\_thresholds\_bps|int\[]|default {7500, 9000, 10000}|

### 5.4 Timesheets and evidence

**timesheet**

|Column|Type|Notes|
|-|-|-|
|engagement\_id|UUID||
|period\_start, period\_end|date|Unique (engagement\_id, period\_start)|
|status|enum (Section 6.1)||
|total\_hours|numeric(7,2)|Derived from entries|
|submitted\_at, verified\_at|timestamptz||
|verified\_by|UUID||
|returned\_reason|text||
|invoice\_id|UUID, nullable|Set when invoiced|

**timesheet\_entry** — `timesheet\_id`, `work\_date` (date), `hours` numeric(5,2), `rate\_kind` (default REGULAR), `note` text. Unique (timesheet\_id, work\_date, rate\_kind). Hours must be 0–24.

**evidence** — `timesheet\_id` (nullable until matched), `file\_id`, `source` enum `CONSULTANT\_UPLOAD`,`EMAIL`,`BULK\_UPLOAD`,`PRIME\_CONFIRMATION`,`APPROVER\_LINK`, `extraction\_id` (nullable).

**extraction** — `file\_id`, `status` enum `QUEUED`,`RUNNING`,`DONE`,`FAILED`, `model`, `prompt\_version`, `raw\_json` jsonb, `result\_json` jsonb (validated against the Section 8 schema), `overall\_confidence` numeric(3,2), `error` text, `cost\_cents` int.

**timesheet\_check** — `timesheet\_id`, `check\_code` (Section 7.6), `severity` enum `BLOCK`,`WARN`,`INFO`, `message`, `resolved\_by`, `resolved\_at`, `resolution\_reason`.

**inbound\_email** — `firm\_id`, `inbox` enum `TIMESHEET`,`AP`, `message\_id` (unique), `from\_address`, `subject`, `received\_at`, `raw\_storage\_key`, `status` enum `RECEIVED`,`PROCESSED`,`UNMATCHED`,`REJECTED`, `matched\_consultant\_id`, `matched\_party\_id`.

### 5.5 Invoicing (receivables)

**invoice\_run** — `bill\_to\_party\_id`, `period\_start`, `period\_end`, `selected\_engagement\_ids` UUID\[], `status` enum `DRAFT`,`FINALIZED`, `created\_by`.

**invoice**

|Column|Type|Notes|
|-|-|-|
|invoice\_run\_id|UUID, nullable||
|bill\_to\_party\_id|UUID||
|invoice\_type|enum `STANDARD`,`SUPPLEMENTAL`,`RATE\_ADJUSTMENT`||
|invoice\_number|text, nullable|Assigned at APPROVED. Unique per firm|
|invoice\_date|date|Set at APPROVED|
|due\_date|date|invoice\_date + terms|
|expected\_payment\_date|date|Section 7.11|
|period\_start, period\_end|date||
|subject|text||
|po\_number|text||
|notes|text||
|template\_id|UUID||
|subtotal\_cents, total\_cents|bigint|total = subtotal (no tax in v1)|
|expected\_deduction\_cents|bigint|total × deduction\_bps, rounded half up|
|amount\_paid\_cents, amount\_credited\_cents, balance\_cents|bigint|Maintained by the domain|
|status|enum (Section 6.2)||
|sent\_at|timestamptz||
|factored|bool||
|pdf\_file\_id, evidence\_pack\_file\_id|UUID|Frozen at SENT|
|qbo\_invoice\_id, qbo\_sync\_status|text, enum||

**invoice\_line**

|Column|Type|Notes|
|-|-|-|
|invoice\_id|UUID||
|engagement\_id, consultant\_id|UUID||
|timesheet\_id|UUID, nullable||
|service\_start, service\_end|date|The rate segment covered|
|description|text|e.g. "Ravi Kumar — SAP Analyst — Oct 1–15, 2026"|
|rate\_kind|enum||
|hours|numeric(7,2)||
|rate\_cents|int||
|amount\_cents|bigint|round\_half\_up(hours × rate)|
|is\_prior\_period|bool||
|adjusts\_invoice\_line\_id|UUID, nullable|For rate adjustments and corrections|

**credit\_memo** — `invoice\_id`, `memo\_number` (pattern `CM-{YYYY}-{SEQ:4}`), `date`, `reason\_code` enum `HOURS\_CORRECTION`,`RATE\_CORRECTION`,`WRITE\_OFF`,`DUPLICATE`,`OTHER`, `amount\_cents`, `notes`, `status` enum `DRAFT`,`APPROVED`, `qbo\_credit\_memo\_id`.

**invoice\_template** — `name`, `layout\_key` (one of the preconfigured layouts: `CLASSIC`, `COMPACT`, `DETAILED\_DAILY`), `show\_fields` jsonb (booleans per field), `footer\_text`, `is\_default`.

**number\_sequence** — `firm\_id`, `sequence\_key` (e.g. `INV:GLBX:2026`), `next\_value` int. Incremented with `SELECT … FOR UPDATE` inside the approval transaction.

### 5.6 Vendor payables

**vendor\_bill**

|Column|Type|Notes|
|-|-|-|
|sub\_vendor\_party\_id|UUID||
|period\_start, period\_end|date||
|status|enum (Section 6.3)||
|expected\_total\_cents|bigint|From expected lines|
|vendor\_invoice\_number|text, nullable|From the vendor's document. Unique per (firm, vendor)|
|vendor\_invoice\_date|date, nullable||
|vendor\_invoice\_total\_cents|bigint, nullable||
|vendor\_invoice\_file\_id|UUID, nullable||
|extraction\_id|UUID, nullable||
|approved\_total\_cents|bigint, nullable||
|due\_date|date, nullable|NET terms|
|amount\_released\_cents, amount\_paid\_cents|bigint||
|qbo\_bill\_id, qbo\_sync\_status|text, enum||

**vendor\_bill\_line**

|Column|Type|Notes|
|-|-|-|
|vendor\_bill\_id|UUID||
|engagement\_id, consultant\_id, timesheet\_id|UUID||
|service\_start, service\_end|date||
|hours|numeric(7,2)||
|pay\_rate\_cents|int||
|expected\_amount\_cents|bigint||
|vendor\_hours, vendor\_rate\_cents, vendor\_amount\_cents|nullable|From the vendor's invoice|
|linked\_invoice\_line\_id|UUID, nullable|The client invoice line for the same hours (for pay-when-paid)|
|released\_cents|bigint|Amount payable now|
|match\_status|enum `UNMATCHED`,`MATCHED`,`HOURS\_DIFF`,`RATE\_DIFF`,`MISSING\_ON\_VENDOR`,`EXTRA\_ON\_VENDOR`||

**vendor\_bill\_exception** — `vendor\_bill\_id`, `code`, `message`, `resolved\_by`, `resolved\_at`, `resolution` enum `ACCEPT\_VENDOR`,`ACCEPT\_EXPECTED`,`VENDOR\_TO\_REISSUE`,`OVERRIDE`, `reason`.

**payment\_run** — `run\_date`, `status` enum `DRAFT`,`APPROVED`,`COMPLETED`, `approved\_by`, `total\_cents`.

**vendor\_payment** — `payment\_run\_id` (nullable), `sub\_vendor\_party\_id`, `paid\_date`, `method` enum `ACH`,`WIRE`,`CHECK`,`CARD\_OR\_PAYMENT\_APP`,`OTHER`, `reference`, `amount\_cents`, `confirmation\_file\_id`, `remittance\_file\_id`, `remittance\_sent\_at`, `qbo\_bill\_payment\_id`.

**vendor\_payment\_allocation** — `vendor\_payment\_id`, `vendor\_bill\_id`, `amount\_cents`.

### 5.7 Receipts (incoming payments)

**receipt**

|Column|Type|Notes|
|-|-|-|
|payer\_party\_id|UUID, nullable|Null = unidentified|
|received\_date|date||
|method|enum `ACH`,`WIRE`,`CHECK`,`OTHER`||
|reference|text||
|amount\_cents|bigint||
|kind|enum `CUSTOMER\_PAYMENT`,`FACTOR\_ADVANCE`,`FACTOR\_REBATE`||
|remittance\_file\_id|UUID, nullable||
|extraction\_id|UUID, nullable||
|unapplied\_cents|bigint|Maintained by the domain|
|status|enum `UNAPPLIED`,`PARTIALLY\_APPLIED`,`APPLIED`||
|qbo\_payment\_id|text||

**receipt\_application** — `receipt\_id`, `invoice\_id`, `applied\_cents`, `deduction\_cents` (expected prime deduction recorded as fee), `shortfall\_cents`, `shortfall\_reason` enum `HOURS\_DIFF\_VMS`,`RATE\_DIFF`,`UNEXPECTED\_FEE`,`UNKNOWN`, nullable.

**customer\_credit** — `party\_id`, `source\_receipt\_id`, `amount\_cents`, `remaining\_cents` (overpayments).

**factoring\_profile** — `factor\_party\_id`, `advance\_bps` (e.g. 9000), `fee\_bps` (e.g. 300), `fee\_basis` enum `FLAT\_ON\_FACE`, `remit\_to\_text`, `qbo\_advance\_liability\_account\_id`, `qbo\_fee\_expense\_account\_id`. v1 supports flat fee on face value only.

**factoring\_assignment** — `invoice\_id`, `factoring\_profile\_id`, `assigned\_date`, `advance\_cents`, `advance\_receipt\_id`, `collected\_date`, `rebate\_cents`, `rebate\_receipt\_id`, `fee\_cents`, `status` enum `ASSIGNED`,`ADVANCED`,`COLLECTED`,`SETTLED`.

### 5.8 QuickBooks integration

**qbo\_connection** — `firm\_id` (unique), `realm\_id`, `access\_token` (encrypted), `refresh\_token` (encrypted), `access\_expires\_at`, `refresh\_expires\_at`, `status` enum `CONNECTED`,`NEEDS\_RECONNECT`,`DISCONNECTED`, `connected\_by`.

**qbo\_mapping** — `firm\_id`, `mapping\_type` enum `CUSTOMER`,`VENDOR`,`ITEM\_SERVICE`,`INCOME\_ACCOUNT`,`EXPENSE\_ACCOUNT`,`DEDUCTION\_EXPENSE\_ACCOUNT`,`FACTOR\_LIABILITY\_ACCOUNT`,`FACTOR\_FEE\_ACCOUNT`,`ACCRUED\_REVENUE\_ACCOUNT`,`ACCRUED\_COST\_ACCOUNT`,`DEPOSIT\_ACCOUNT`, `local\_id` (nullable), `qbo\_id`, `qbo\_name`.

**qbo\_sync\_job** — `entity\_type`, `entity\_id`, `operation` enum `CREATE`,`VOID`, `idempotency\_key` (unique), `status` enum `PENDING`,`RUNNING`,`SUCCEEDED`,`FAILED`,`BLOCKED`, `attempts`, `last\_error`, `qbo\_id`, `request\_json`, `response\_json`.

### 5.9 Notifications and reminders

**notification** — `firm\_id`, `user\_id` (nullable), `to\_email`, `type`, `entity\_type`, `entity\_id`, `channel` enum `IN\_APP`,`EMAIL`, `sent\_at`, `read\_at`, `dedupe\_key` (unique).

\---

## 6\. Status machines

Implement these in `packages/domain/state/`. Each is a pure function `transition(current, event, context) → next | throws`. Any transition not listed is invalid.

### 6.1 Timesheet

|From|Event|To|Guard|
|-|-|-|-|
|NOT\_STARTED|save\_entries|DRAFT||
|DRAFT|submit|SUBMITTED|≥ 1 entry; if evidence\_required then ≥ 1 evidence file|
|SUBMITTED|checks\_pass|VERIFIED|No unresolved BLOCK checks|
|SUBMITTED|checks\_fail|NEEDS\_REVIEW|≥ 1 unresolved BLOCK check|
|NEEDS\_REVIEW|resolve\_all|VERIFIED|Every BLOCK check resolved with a reason (Manager/Finance)|
|SUBMITTED, NEEDS\_REVIEW, VERIFIED|return|RETURNED|Reason required; VERIFIED only if not yet on an approved invoice|
|RETURNED|save\_entries|DRAFT||
|VERIFIED|add\_to\_approved\_invoice|INVOICED|Done inside the invoice approval transaction|
|INVOICED|—|—|Locked (R4). Corrections via adjustment|

### 6.2 Invoice

|From|Event|To|Guard|
|-|-|-|-|
|DRAFT|approve|APPROVED|Manager or Admin; ≥ 1 line; assigns number and dates; locks timesheets|
|DRAFT|discard|(deleted)|Drafts only; no number was assigned|
|APPROVED|send|SENT|PDF and evidence pack frozen; email sent or portal task completed|
|SENT, PARTIALLY\_PAID, OVERDUE|apply\_receipt (balance > 0)|PARTIALLY\_PAID||
|SENT, PARTIALLY\_PAID, OVERDUE, DISPUTED|apply\_receipt (balance = 0)|PAID||
|SENT, PARTIALLY\_PAID|due\_date\_passed|OVERDUE|Nightly job|
|SENT, PARTIALLY\_PAID, OVERDUE|dispute|DISPUTED|Reason required|
|DISPUTED|resolve\_dispute|previous status, recalculated||
|APPROVED, SENT, OVERDUE, DISPUTED|void\_with\_credit\_memo|VOIDED|Full credit memo approved; number stays used|

Balance = total − amount\_paid − amount\_credited − recorded deductions. An invoice with balance 0 is PAID.

### 6.3 Vendor bill

|From|Event|To|Guard|
|-|-|-|-|
|—|create\_from\_verified\_hours|EXPECTED||
|EXPECTED|attach\_vendor\_invoice|RECEIVED||
|RECEIVED|match\_ok|MATCHED|All lines MATCHED within tolerance|
|RECEIVED|match\_fail|EXCEPTION||
|EXCEPTION|resolve|MATCHED|All exceptions resolved|
|RECEIVED, EXCEPTION|hold|ON\_HOLD|e.g. timesheets not yet verified|
|ON\_HOLD|release\_hold|RECEIVED|Re-run match|
|MATCHED|approve|APPROVED|Manager or Admin; compliance documents valid or overridden|
|APPROVED|add\_to\_payment\_run|SCHEDULED|released\_cents > 0|
|SCHEDULED|record\_payment (fully paid)|PAID||
|SCHEDULED|record\_payment (partial)|PARTIALLY\_PAID||
|PARTIALLY\_PAID|add\_to\_payment\_run|SCHEDULED||

### 6.4 Receipt

`UNAPPLIED` → `PARTIALLY\_APPLIED` → `APPLIED`, driven by unapplied\_cents. Applications can be reversed (logged) until the related QBO payment is synced; after that, reversal requires a reason and creates a QBO void job.

\---

## 7\. Business rules and calculations

All functions in this section live in `packages/domain`, with tests from Section 18.

### 7.1 Periods

`periodsFor(engagement, fromDate, toDate) → \[{start, end}]`

* WEEKLY: 7-day periods starting on firm.week\_start.
* BIWEEKLY: 14-day periods aligned to engagement.biweekly\_anchor\_date.
* SEMIMONTHLY: 1st–15th, and 16th–last day of the month.
* MONTHLY: calendar month.
* Clip the first and last periods to the engagement start and end dates.

A nightly job creates `NOT\_STARTED` timesheets for every active engagement period that has started.

### 7.2 Rate resolution

`resolveRate(rates, side, rateKind, date) → rate\_cents | error`. Exactly one matching rate must cover the date; otherwise return `NO\_RATE` (blocks invoicing for that day).

### 7.3 Line building (rate splitting)

`buildLines(timesheetEntries, rates, side) → Line\[]`

1. Group entries by rate\_kind.
2. Within each group, walk the dates in order. Start a new segment whenever the resolved rate changes.
3. Each segment produces one line: service\_start, service\_end, hours (sum), rate\_cents, amount = round\_half\_up(hours × rate\_cents).
4. If the invoice cycle is longer than the timesheet cycle (e.g. monthly invoice over weekly timesheets), combine contiguous segments that have the same rate across timesheets into one line per consultant per rate segment, keeping the timesheet IDs on the line (via a join table `invoice\_line\_timesheet`).

### 7.4 Invoice number generation

Tokens:

|Token|Meaning|
|-|-|
|`{CLIENT}`|bill-to party.code|
|`{YYYY}`, `{YY}`, `{MM}`|Invoice date parts|
|`{SEQ:n}`|Sequence, zero-padded to n digits|
|Any other text|Literal|

The sequence key is built from the pattern's scope: if the pattern contains `{CLIENT}`, the sequence is per client; the reset rule (NEVER / YEARLY / MONTHLY) adds the year or month to the key. Numbers are assigned inside the approve transaction with a row lock on `number\_sequence`. Validation: the pattern must contain `{SEQ:n}`; the generated number must be ≤ 30 characters and unique.

### 7.5 Expected deduction and expected receipt

* `deduction\_bps = engagement.deduction\_bps\_override ?? bill\_to.standard\_deduction\_bps ?? 0`. For a multi-engagement invoice, all lines must share the same deduction\_bps; otherwise split the invoice.
* `expected\_deduction\_cents = round\_half\_up(total\_cents × deduction\_bps / 10000)`.
* `expected\_receipt\_cents = total\_cents − expected\_deduction\_cents`.

### 7.6 Timesheet checks

Run automatically on submit and again whenever evidence or entries change.

|Code|Severity|Rule|
|-|-|-|
|`NO\_EVIDENCE`|BLOCK|evidence\_required and no evidence attached|
|`EXTRACTION\_PENDING`|BLOCK|Evidence attached, extraction not DONE|
|`HOURS\_MISMATCH`|BLOCK|Extracted total hours ≠ entered total hours (exact, to 0.01). If daily hours were extracted, also compare per day|
|`PERIOD\_MISMATCH`|BLOCK|Extracted period doesn't overlap the timesheet period by at least 80% of its days|
|`NOT\_APPROVED`|BLOCK|evidence\_required and extracted approval status ≠ APPROVED|
|`NAME\_MISMATCH`|WARN|Extracted consultant name doesn't fuzzy-match (token similarity < 0.8)|
|`LOW\_CONFIDENCE`|WARN|Extraction overall\_confidence < 0.80, or any hours field < 0.85|
|`DUPLICATE\_EVIDENCE`|BLOCK|Same sha256 already linked to another timesheet, or perceptual-hash distance ≤ 5|
|`OUTSIDE\_ENGAGEMENT`|BLOCK|Hours on a date outside the engagement's start/end|
|`NO\_RATE`|BLOCK|No bill rate (or no pay rate for contractors) for a date with hours|
|`HOLIDAY\_HOURS`|INFO|Hours on a firm holiday|
|`HIGH\_HOURS`|WARN|Hours in any week > max\_weekly\_hours\_warning|
|`PO\_EXCEEDED`|WARN|Billing this timesheet would push the PO's billed total over its amount|
|`RATE\_CHANGE\_IN\_PERIOD`|INFO|Lines will be split|

Resolving a BLOCK check requires Manager, Finance or Admin, plus a reason. It's logged.

### 7.7 Invoice run assembly

Given `(bill\_to\_party\_id, period\_start, period\_end, selected\_engagement\_ids)`:

1. Include VERIFIED timesheets whose period lies within the run period, for the selected engagements, not yet invoiced.
2. Include VERIFIED timesheets from earlier periods not yet invoiced as **prior-period lines** (is\_prior\_period = true), if the user ticks "include late timesheets".
3. Produce a **missing list**: selected engagements with any timesheet in the period that isn't VERIFIED.
4. Group into invoices by `invoice\_layout`: PER\_CONSULTANT → one invoice per engagement; COMBINED → one invoice per (bill-to, PO number, deduction\_bps).
5. Build lines with 7.3. Compute totals and expected deduction.
6. Set expected\_payment\_date (7.11).

### 7.8 Expected vendor bills

When a CONTRACTOR timesheet becomes VERIFIED:

1. Find or create the vendor bill (status EXPECTED) for (sub\_vendor, vendor invoice cycle period). The vendor's cycle defaults to the engagement's timesheet cycle.
2. Build PAY-side lines with 7.3 and add them.
3. When that timesheet becomes INVOICED, set `linked\_invoice\_line\_id` on each vendor bill line to the client invoice line covering the same dates and rate segment (by date overlap).

### 7.9 Three-way match

Inputs: the vendor's extracted invoice (lines with consultant, period, hours, rate, amount), the expected lines, and verified hours.

1. Match vendor lines to expected lines by consultant (fuzzy name or email) plus period overlap.
2. For each pair: hours must be equal (to 0.01); rate must be equal; amount difference ≤ firm.match\_tolerance\_cents.
3. Expected lines with no vendor line → `MISSING\_ON\_VENDOR`. Vendor lines with no expected line → `EXTRA\_ON\_VENDOR`.
4. Vendor invoice total must equal the sum of its lines (± tolerance), otherwise raise a `TOTAL\_MISMATCH` exception.
5. Duplicate (vendor, vendor\_invoice\_number) → `DUPLICATE\_INVOICE` exception, blocks.
6. All lines MATCHED → bill MATCHED; otherwise EXCEPTION with one exception row per problem.

### 7.10 Vendor payment release

* **NET terms:** at approval, `due\_date = vendor\_invoice\_date + vendor\_net\_days`; `released\_cents = approved amount` from the due date. Payment runs include bills with due\_date ≤ run\_date + 7 days (configurable look-ahead).
* **PAY\_WHEN\_PAID:** for each vendor bill line, `released\_cents = round\_half\_up(line\_expected\_amount × paid\_fraction\_of\_linked\_invoice\_line)`, where `paid\_fraction = min(1, (amount applied to the linked invoice + deductions recorded on it) / linked invoice total)` (applied in proportion across all lines of the invoice). If vendor\_net\_days > 0, the released amount becomes payable vendor\_net\_days after the client payment date.
* **Factored invoices:** by default, pay-when-paid releases when the factoring assignment is COLLECTED (client paid the factor), not when the advance arrives. A firm setting can switch this to "release on advance".
* **Compliance block:** if any `party\_document` with required\_for\_payment is missing or expired on the run date, the bill can't be added to a payment run unless an Admin overrides it with a reason.
* Released amounts never exceed the approved amount; cumulative payments never exceed released amounts.

### 7.11 Expected payment date and cash gap

* `expected\_payment\_date = invoice\_date + bill\_to.payment\_terms\_days + (bill\_to.pays\_when\_paid\_upstream ? bill\_to.upstream\_buffer\_days : 0)`.
* **Cash gap report:** for each vendor bill line with a `linked\_invoice\_line\_id`, gap\_days = vendor payable date − linked invoice expected\_payment\_date. A line is "funded by the Firm" when its vendor payable date is before the expected client payment and the client invoice isn't paid. The report lists the amounts at risk per week for the next 13 weeks.

### 7.12 Receipt application

`suggestApplications(receipt, openInvoices, remittance?) → proposals`

1. If the remittance lists invoice numbers, propose those first, with the amounts shown.
2. Otherwise try: one open invoice where amount = expected\_receipt\_cents ± deduction tolerance; then one where amount = balance; then a combination of up to 5 open invoices from the same payer whose expected receipts sum to the amount (subset-sum, capped search).
3. For each application: if `applied = expected\_receipt` (± tolerance), record `deduction\_cents = expected\_deduction` and mark the invoice PAID. If applied < expected receipt, the user picks one of two modes: **Partial payment** (more money expected later; deduction recorded in proportion = round\_half\_up(applied / expected\_receipt × expected\_deduction); no shortfall) or **Final settlement** (no more money expected; full expected deduction recorded; the remainder is `shortfall\_cents` and needs a reason code before saving). See tests T6 and T7. If the receipt exceeds what's applied, the remainder stays unapplied or (by user choice) becomes a customer\_credit.
4. Deductions are pushed to QBO as a discount line (or an expense journal entry, by mapping setting) so the QBO invoice closes.

### 7.13 Factoring

* Assign: create factoring\_assignment; advance\_cents = round\_half\_up(total × advance\_bps / 10000); fee\_cents = round\_half\_up(total × fee\_bps / 10000).
* Advance receipt (kind FACTOR\_ADVANCE): recorded against the assignment, not applied to the invoice. QBO: journal entry debit Deposit account, credit Factor advance liability.
* Collected (factor confirms the client paid): invoice marked PAID (factored) by an application from a system-generated receipt of the full amount paid to the factor. QBO: Payment on the invoice deposited to the factor liability account (clears AR), which offsets the liability.
* Rebate receipt: rebate = total − advance − fee. QBO: journal entry debit Deposit (rebate), debit Factoring fee expense (fee), credit Factor advance liability (rebate + fee).
* The accounting treatment MUST be confirmable per firm (setting reviewed with the firm's CPA). Implement the mapping above as the default.

### 7.14 Month-end accruals (optional per firm)

* Unbilled revenue = Σ round\_half\_up(hours × bill rate) for VERIFIED + SUBMITTED hours with work\_date ≤ month end, not yet invoiced.
* Unbilled cost = the same on the PAY side for contractor hours not yet on an APPROVED vendor bill.
* Push auto-reversing journal entries dated the last day of the month, reversed on the 1st.

### 7.15 Period lock

A locked month blocks: entry edits on timesheets with dates in it, invoice approvals dated in it, receipts and vendor payments dated in it. Unlock needs Admin plus a reason (logged).

\---

## 8\. AI extraction

### 8.1 Provider interface

```ts
interface Extractor {
  extractTimesheet(file: FileRef, hints: { consultantName?: string; periodStart?: string; periodEnd?: string }): Promise<TimesheetExtraction>;
  extractVendorInvoice(file: FileRef, hints: { vendorName?: string }): Promise<VendorInvoiceExtraction>;
  extractRemittance(file: FileRef, hints: { payerName?: string }): Promise<RemittanceExtraction>;
}
```

* Accept PNG, JPG, HEIC (convert to JPG), PDF (render each page to an image, max 10 pages).
* Run in a background job. Store the raw response and the validated result.
* Validate output with Zod. On validation failure, retry once with the validation errors appended to the prompt; then mark FAILED and route to manual entry.
* Never let the model's output change records directly. Extraction creates **proposals** that pass through the checks in 7.6 and 7.9.
* Log the model name, prompt version and cost on every extraction.

### 8.2 Timesheet extraction schema

```json
{
  "document\_type": "VMS\_TIMESHEET | EMAIL\_APPROVAL | OTHER",
  "vms\_name": "string | null",
  "consultant\_name": "string | null",
  "worker\_id": "string | null",
  "timesheet\_id": "string | null",
  "period\_start": "YYYY-MM-DD | null",
  "period\_end": "YYYY-MM-DD | null",
  "daily\_hours": \[{ "date": "YYYY-MM-DD", "hours": 0.0, "rate\_kind": "REGULAR | OVERTIME | UNKNOWN" }],
  "total\_hours": 0.0,
  "approval\_status": "APPROVED | SUBMITTED | REJECTED | DRAFT | UNKNOWN",
  "approver\_name": "string | null",
  "approved\_at": "YYYY-MM-DD | null",
  "confidence": {
    "overall": 0.0,
    "period": 0.0,
    "total\_hours": 0.0,
    "daily\_hours": 0.0,
    "approval\_status": 0.0
  },
  "notes": "string | null"
}
```

### 8.3 Timesheet extraction prompt (versioned `ts-v1`)

```
You read images of timesheets exported from vendor management systems (SAP Fieldglass, Beeline, others)
or emails approving timesheets. Extract only what is visible. Do not guess.

Return JSON that matches the schema exactly.
- Dates: ISO format YYYY-MM-DD. If the year is not shown, use the hint period year.
- Hours: decimal numbers (7:30 = 7.5). Do not include breaks if shown separately.
- total\_hours: the total shown on the document if visible; otherwise the sum of daily\_hours.
- approval\_status: APPROVED only if the document explicitly shows an approved state
  (e.g. "Approved", a green approved badge, or an approval email from a client manager).
- If a field is not visible, return null. Set its confidence low.
- Confidence: 0.0–1.0 reflecting how clearly the value is visible.

Hints (may be wrong; never override visible content): {hints\_json}
```

### 8.4 Vendor invoice extraction schema

```json
{
  "vendor\_name": "string | null",
  "invoice\_number": "string | null",
  "invoice\_date": "YYYY-MM-DD | null",
  "bill\_to\_name": "string | null",
  "lines": \[{
    "consultant\_name": "string | null",
    "service\_start": "YYYY-MM-DD | null",
    "service\_end": "YYYY-MM-DD | null",
    "hours": 0.0,
    "rate": 0.0,
    "amount": 0.0,
    "description": "string | null"
  }],
  "subtotal": 0.0,
  "total": 0.0,
  "currency": "USD",
  "confidence": { "overall": 0.0, "lines": 0.0, "total": 0.0 }
}
```

Convert dollar amounts to cents in code (`Math.round(amount \* 100)`, applied to the decimal string, not to a float product).

### 8.5 Remittance extraction schema

```json
{
  "payer\_name": "string | null",
  "payment\_date": "YYYY-MM-DD | null",
  "payment\_reference": "string | null",
  "payment\_amount": 0.0,
  "items": \[{ "invoice\_number": "string | null", "amount\_paid": 0.0, "deduction": 0.0, "deduction\_label": "string | null" }],
  "confidence": { "overall": 0.0 }
}
```

### 8.6 Matching extracted timesheets to consultants (email and bulk paths)

1. Email path: match `from\_address` to consultant.emails. If none, extracted consultant\_name fuzzy match against active consultants (similarity ≥ 0.85, single best match). Otherwise → UNMATCHED queue.
2. Choose the engagement: the consultant's ACTIVE engagement(s) covering the extracted period. If more than one, use the worker\_id against prime\_consultant\_ref or end\_client\_worker\_ref; otherwise ask Finance.
3. Choose the timesheet: the engagement's timesheet overlapping the extracted period the most.
4. If the timesheet has no entries, pre-fill entries from daily\_hours (or put total\_hours on the last working day if no daily breakdown) and set the status to DRAFT for the consultant or Finance to confirm. Never auto-submit.

### 8.7 Quality targets

Build a fixture set of at least 30 anonymized screenshots (Fieldglass, Beeline, other, phone photos of screens, partial crops). Target: total-hours accuracy ≥ 98% on clear images, and every wrong extraction caught by a BLOCK or WARN check. Keep the fixtures and expected outputs in `/packages/integrations/ai/fixtures` and run them as an evaluation script (not in CI by default, because of cost).

\---

## 9\. Email intake

* Two inbound addresses per firm (timesheets and AP). Inbound webhook verifies the provider signature, stores the raw message, and de-duplicates by Message-ID.
* Attachments → file records (virus scan) → extraction job. Inline images count as attachments. Ignore signatures and logos (images < 20 KB or < 200 px on the shorter side).
* Timesheet inbox: if the sender matches a consultant, link the result to that consultant; otherwise UNMATCHED.
* AP inbox: match the sender's domain or address to a sub-vendor's ar\_emails or contact emails. Vendor invoice extraction → attach to the matching EXPECTED vendor bill for that vendor and period (largest overlap). Remittance-looking documents from a bill-to party → create a draft receipt with the remittance attached.
* Auto-reply (configurable): "Received — we'll let you know if anything is missing." Never reply to auto-generated mail (check `Auto-Submitted` and `Precedence` headers) to avoid loops.
* Reject emails larger than 25 MB, and any attachment type other than images, PDF, XLSX or CSV (XLSX/CSV are stored but not extracted in v1).

\---

## 10\. QuickBooks Online integration

### 10.1 Connection

* OAuth 2.0 authorization-code flow; scope `com.intuit.quickbooks.accounting`.
* Store tokens encrypted. Refresh the access token before it expires (access tokens last about one hour). On refresh failure, set NEEDS\_RECONNECT, pause sync jobs, and notify Admin and Finance.
* Provide a reconnect page URL (Intuit's developer portal requires one).
* Sandbox and production credentials kept separate by environment.

### 10.2 Setup and mapping (read calls — keep these minimal)

* At connect: read Accounts, Items (Service), Customers, Vendors, Terms. Cache them in `qbo\_mapping` candidates. Refresh only when the user clicks "Refresh lists".
* Mapping wizard:

  1. Bill-to parties → existing QBO customers (suggest by name) or "Create in QBO".
  2. Sub-vendors → existing QBO vendors or "Create in QBO".
  3. One service item for consultant billing (e.g. "Consulting Services") and its income account.
  4. Expense account for vendor bills (e.g. "Subcontractor Expense").
  5. Accounts for deductions, factoring (liability and fee), accruals, and the deposit account for receipts ("Undeposited Funds" by default).

Writes (create and update) to the QuickBooks Online Accounting API are free and unmetered under Intuit's App Partner Program; reads are metered, with 500,000 per month included on the free Builder tier and blocked beyond that ([Intuit Developer](https://help.developer.intuit.com/s/article/platform-service-fees)). Design for push-only, with cached reads.

### 10.3 Push rules

|App event|QBO entity|Key fields|
|-|-|-|
|Party mapped "create"|Customer / Vendor|DisplayName (must be unique in QBO; append the code if it clashes), billing address, email|
|Invoice SENT|Invoice|CustomerRef, DocNumber = our invoice number, TxnDate, DueDate, one SalesItemLine per invoice line (or summarized per consultant, by setting) with Qty = hours, UnitPrice = rate, Description, CustomerMemo with the PO / work order number and period|
|Credit memo APPROVED|CreditMemo|Linked by memo text to the invoice number; amount lines|
|Receipt application saved|Payment|CustomerRef, TotalAmt, Line → LinkedTxn (Invoice), DepositToAccountRef|
|Expected deduction recorded|Discount line on the Payment, or a CreditMemo, by mapping setting|Account = deduction expense|
|Vendor bill APPROVED|Bill|VendorRef, DocNumber = vendor invoice number, TxnDate, DueDate, AccountBasedExpenseLine per consultant|
|Vendor payment recorded|BillPayment|VendorRef, PayType = Check, LinkedTxn (Bill)|
|Factoring advance / rebate / fee|JournalEntry|Per 7.13|
|Month-end accruals|JournalEntry (and reversing JE dated the 1st)|Per 7.14|

### 10.4 Reliability

* Every push is a `qbo\_sync\_job` with idempotency key `{entity\_type}:{entity\_id}:{operation}:{version}`. Before creating, check whether `qbo\_\*\_id` is already set.
* Use Intuit's `requestid` query parameter for idempotent retries where supported.
* Respect rate limits: at most 500 requests per minute per company and 10 concurrent requests ([Truto](https://truto.one/blog/how-to-integrate-with-the-quickbooks-online-api-2026-guide/)). Use a per-realm queue with concurrency 4 and exponential backoff on 429 or 5xx (max 6 attempts).
* Validation errors (e.g. missing mapping) → BLOCKED with a clear message and a "Fix mapping" link.
* Never update or delete QBO records after creation, except to void through a new job when a credit memo or void is recorded in the app.
* Sync log screen: filters by status and entity, error text, retry button, link to the QBO record.

\---

## 11\. Documents: invoices, evidence packs, remittances

### 11.1 Invoice PDF (all templates)

Required content:

* Firm logo, legal name, address, phone, email
* "INVOICE", invoice number, invoice date, due date, terms
* Bill-to: party legal name, address, AP contact
* Subject; PO / prime work order number; end client name; prime consultant reference if set
* Table: description (consultant — role — service dates), hours, rate, amount; prior-period lines labeled
* Subtotal, total, amount due
* Remit-to instructions (or the factor's remit-to if factored)
* Footer text

Templates:

* `CLASSIC`: one table, totals at the bottom.
* `COMPACT`: minimal header, for combined invoices with many consultants.
* `DETAILED\_DAILY`: adds a daily hours grid per consultant on a second page.

The template's `show\_fields` toggles optional fields. The PDF is frozen (stored) at SENT; later edits to firm settings don't change sent PDFs.

### 11.2 Evidence pack

One PDF: a cover page listing each consultant, period, verified hours and evidence source; then each evidence file (images placed on pages, PDFs appended). Attached when the bill-to party requires backup.

### 11.3 Vendor remittance advice

PDF or email body: vendor, payment date, method, reference, and a table of vendor invoice numbers, consultants, periods, hours, amounts paid.

\---

## 12\. Permissions (enforced server-side)

|Capability|ADMIN|MANAGER|FINANCE|CONSULTANT|
|-|-|-|-|-|
|Manage users and roles; firm settings; numbering; templates; QBO connect and mapping|✔||||
|Create/edit parties, consultants, engagements, POs|✔|✔|view||
|Create/edit rates|✔|✔|view||
|View own engagements (no rates)||||✔|
|Enter/upload/submit own timesheets||||✔|
|Enter/upload timesheets for anyone; bulk upload|✔|✔|✔||
|Resolve checks, verify, return timesheets|✔|✔|✔||
|Create invoice runs and draft invoices|✔|✔|✔||
|Approve invoices; approve credit memos|✔|✔|||
|Send invoices; mark portal upload done|✔|✔|✔||
|Record receipts; apply; record shortfalls|✔||✔||
|Attach vendor invoices; resolve match exceptions|✔|✔|✔||
|Approve vendor bills; approve payment runs|✔|✔|||
|Record vendor payments; send remittances|✔||✔||
|Compliance override; period unlock|✔||||
|Reports|✔|✔|✔|own hours only|
|Sync log and retry|✔||✔||
|Billing: plan, payment method, AI overage mode, promotion code (Section 22)|✔||view||
|CPA package: generate, send to CPA, revoke links (Section 23)|✔|download|✔||

A firm MAY run with three roles by giving Manager users the Finance permissions too (setting: "Managers also act as Finance").

Segregation warning: if the same user both approves and records payment for the same vendor bill, show a warning and log it (not blocked in v1).

\---

## 13\. Screens

### 13.1 Consultant (mobile-first)

1. **My timesheets** — list by period with status chips; a big "Submit this week" button.
2. **Timesheet editor** — daily grid (date, hours), upload evidence (camera or file), evidence thumbnails, check results in plain language, Submit.
3. **Returned** — reason and what to fix.

### 13.2 Finance / Manager

1. **Dashboard** — counts: missing timesheets, needs review, ready to invoice, invoices overdue, vendor exceptions, bills due this week, unapplied receipts, sync errors; cash gap for the next 4 weeks.
2. **Timesheet inbox** — table of submitted / needs review / unmatched items; side-by-side review screen: evidence image on the left (zoom), extracted values and entered values on the right, differences highlighted, resolve or return.
3. **Unmatched intake** — emails and files not matched to a consultant; assign manually.
4. **Parties** — prime vendors, sub-vendors, end clients, factors; detail pages with contacts, documents (with expiry), terms, deduction, QBO mapping status.
5. **Consultants** — list; detail with engagements.
6. **Engagement detail** — billing chain diagram, rates timeline (bill and pay), POs with burn bar, timesheets, margin preview.
7. **Invoice run wizard** — pick bill-to and period → select consultants → review missing list → preview invoices → submit for approval.
8. **Invoices** — list with status, aging bucket, expected payment date; detail with lines, PDF preview, evidence pack, receipts applied, credit memos, QBO status.
9. **Approvals** — invoices and vendor bills awaiting approval; payment runs awaiting approval.
10. **Vendor bills** — list by status; detail with three-way match table (expected vs vendor vs verified), exceptions, release status per line (with the linked client invoice payment status).
11. **Receipts** — record receipt, upload remittance, apply screen with suggestions, shortfall reason picker, unapplied queue.
12. **Payment runs** — build run (due and released bills, blocked items with reasons), approve, record payments, send remittances.
13. **Reports** — section 15.
14. **Month-end** — checklist: unbilled report, accruals push, aging review, sync log clean, lock period, CPA package (section 23.10).
15. **Sync log** — section 10.4.

### 13.3 Admin

1. **Firm settings** — profile, logo, timezone, week start, terms, remit-to, tolerances, holiday calendar, CPA contact and package schedule (section 23.10).
2. **Users and roles** — invite, change role, disable, require MFA.
3. **Invoice numbering** — pattern editor with live preview and validation.
4. **Templates** — choose layout, toggle fields, preview with sample data.
5. **QuickBooks** — connect, mapping wizard, refresh lists, disconnect.
6. **Factoring** — profiles.
7. **Audit log** — searchable.
8. **Billing** — plan, active consultant count, AI reads meter, promotion and end date, bills (Section 22.8).

UI rules: every list is filterable, sortable and exportable to CSV. Every money value is right-aligned with two decimals. Every status chip uses the same colors throughout. Every destructive or financial action has a confirmation dialog stating exactly what will happen.

\---

## 14\. Background jobs and schedules

|Job|Trigger|Action|
|-|-|-|
|`create\_period\_timesheets`|Nightly 01:00 firm time|Create NOT\_STARTED timesheets for started periods|
|`timesheet\_reminders`|Daily 09:00 firm time|Remind consultants with timesheets not submitted 1 day after period end, then daily (max 5). Dedupe per day|
|`process\_inbound\_email`|Webhook|Store, scan, extract, match|
|`run\_extraction`|On file upload / email|Call extractor, validate, store, run checks|
|`run\_timesheet\_checks`|On submit or change|Section 7.6|
|`build\_expected\_vendor\_bill`|Timesheet VERIFIED (contractor)|Section 7.8|
|`match\_vendor\_invoice`|Vendor invoice extracted|Section 7.9|
|`mark\_overdue`|Nightly|SENT/PARTIALLY\_PAID past due → OVERDUE|
|`overdue\_reminders`|Daily|Optional emails to bill-to AP at +1, +15, +30 days past due|
|`release\_pay\_when\_paid`|On receipt application or factoring collection|Section 7.10|
|`po\_burn\_alerts`|On invoice approval|Section 5.3 thresholds|
|`compliance\_expiry\_alerts`|Daily|Documents expiring in 30 days; work authorization in 60/30 days|
|`qbo\_sync\_worker`|Continuous|Process sync jobs|
|`qbo\_token\_refresh`|Every 30 minutes|Refresh tokens close to expiry|
|CPA package jobs|See 23.10|Scheduled and on-demand package builds, link expiry (M7)|
|Subscription and usage jobs|See 22.8|Monthly bills, AI allowance alerts, promotion notices, trial and past-due reminders (M9)|

\---

## 15\. Reports

All reports filter by date range, bill-to party, sub-vendor, consultant and end client, and export to CSV.

|Report|Definition|
|-|-|
|**AR aging**|Open invoices by bill-to party: current, 1–30, 31–60, 61–90, 90+ days past due; also by expected payment date|
|**AP aging**|Approved, unpaid vendor bills by sub-vendor, by due date (NET) or release status (pay-when-paid)|
|**Margin**|Per consultant / engagement / bill-to / sub-vendor / month: billed revenue, expected deductions, vendor cost (contractors), gross margin = revenue − deductions − vendor cost, margin %. W-2 consultants show revenue only (cost comes from payroll, not in the app)|
|**Unbilled hours**|Verified and submitted hours not yet invoiced, valued at bill rate; with age|
|**Missing timesheets**|Periods ended and not submitted, by consultant|
|**PO burn**|Billed to date vs PO amount, % used, days to end date|
|**Cash gap (13 weeks)**|Section 7.11|
|**Collections forecast**|Expected receipts by week (expected\_payment\_date, net of deductions)|
|**Deductions**|Total prime deductions by bill-to party and month|
|**Timesheet exceptions**|Checks raised and how they were resolved, by consultant and code|

\---

## 16\. Server actions and API surface

Use server actions for UI mutations and REST route handlers for webhooks and the job runner. Every action: validate input with Zod → load session → check permission → call a domain function → persist in one transaction → write audit events → enqueue jobs.

|Area|Actions|
|-|-|
|Auth|signUpFirm, inviteUser, acceptInvite, signIn, enableMfa, switchFirm|
|Settings|updateFirm, setNumberingPattern, previewInvoiceNumber, saveTemplate, setHolidays|
|Parties|createParty, updateParty, addContact, uploadPartyDocument, archiveParty|
|Consultants|createConsultant, updateConsultant, archiveConsultant|
|Engagements|createEngagement, updateEngagement, addRate, endRate, addPurchaseOrder, endEngagement|
|Timesheets|saveTimesheetEntries, uploadEvidence, submitTimesheet, resolveCheck, verifyTimesheet, returnTimesheet, assignUnmatchedFile|
|Invoicing|createInvoiceRun, previewInvoiceRun, generateDraftInvoices, editDraftInvoice, approveInvoice, sendInvoice, markPortalUploaded, disputeInvoice, resolveDispute, createCreditMemo, approveCreditMemo, createSupplementalInvoice, createRateAdjustmentInvoice|
|Payables|attachVendorInvoice, rerunMatch, resolveVendorException, holdVendorBill, approveVendorBill, createPaymentRun, approvePaymentRun, recordVendorPayment, sendRemittance|
|Receipts|recordReceipt, uploadRemittance, suggestApplications, applyReceipt, reverseApplication, convertToCredit|
|Factoring|assignToFactor, recordAdvance, markCollected, recordRebate|
|Close|runAccruals, lockPeriod, unlockPeriod|
|QBO|startQboConnect, qboCallback, refreshQboLists, saveMapping, retrySyncJob|
|Webhooks|POST /api/inbound-email/:provider, POST /api/jobs (if using an external job runner)|
|Health|GET /api/health, GET /api/health/deep (internal token) — Section 24.8|

\---

## 17\. Security, privacy and operations

* HTTPS only; secure, HTTP-only, SameSite cookies; CSRF protection on mutations.
* MFA required for ADMIN and FINANCE; optional for others.
* Application-level encryption for EIN, remit/bank details, QBO tokens.
* Presigned upload URLs with size (≤ 15 MB per file) and type limits; virus scan before files are viewable or sent to the AI provider.
* Files sent to the AI provider: use a provider and settings that don't retain or train on customer data; document this on a trust page.
* Rate limiting on auth and upload endpoints.
* Daily database backups with point-in-time recovery; tested restore procedure documented. Production setup, cross-region exports and the quarterly restore drill are in Section 24.6.
* Structured logs never contain tokens, bank details or full document text.
* Data export per firm (CSV of all tables + files) and firm deletion process (documented; financial records kept for the retention period the firm chooses).

\---

## 18\. Seed data and golden test scenarios

Create `packages/db/seed.ts` with this data. The tests below MUST pass exactly. CPA package tests C1–C7 are in section 23.11. Pricing tests P1–P13 are in section 22.9; seed the two price versions and the promotions `LAUNCH25` and `PILOT25` from section 22.

### 18.1 Seed

* Firm: **Lonestar Data Consulting LLC**, Dallas TX, timezone America/Chicago, week starts Monday, pattern `{CLIENT}-{YYYY}{MM}-{SEQ:4}`, yearly reset.
* Users: admin@lonestar.test (ADMIN), manager@lonestar.test (MANAGER), finance@lonestar.test (FINANCE), ravi@lonestar.test (CONSULTANT → Ravi Kumar), meera@lonestar.test (CONSULTANT → Meera Shah).
* Parties:

  * **Globex Solutions** — PRIME\_VENDOR, code `GLBX`, net 45, pays\_when\_paid\_upstream = true, buffer 15 days, standard deduction 200 bps ("MSP fee"), PER\_CONSULTANT, backup required.
  * **Initech Corp** — END\_CLIENT.
  * **Apex Talent Inc** — SUB\_VENDOR, PAY\_WHEN\_PAID, net 0 days. W-9 and COI valid.
  * **Summit Factoring** — FACTOR; profile advance 9000 bps, fee 300 bps.
* Consultants:

  * **Ravi Kumar** — CONTRACTOR via Apex.
  * **Meera Shah** — W2.
* Engagements:

  * **E1:** Ravi @ Initech via Globex, SAP Analyst, start 2026-09-01, MONTHLY timesheets and invoices. BILL REGULAR $95.00 from 2026-09-01; PAY REGULAR $75.00 from 2026-09-01. PO `GLX-WO-7781`, amount $60,000.00.
  * **E2:** Meera @ Initech via Globex, Data Engineer, start 2026-09-01, MONTHLY. BILL REGULAR $110.00 from 2026-09-01.

October 2026 has 22 weekdays (Oct 1 is a Thursday).

### 18.2 Golden tests

**T1 — Basic monthly invoice (E1, October 2026)**

* Ravi enters 8.00 hours each weekday Oct 1–31 → 176.00 hours.
* Invoice: 176.00 × $95.00 = **$16,720.00**.
* Expected deduction 2% = **$334.40**. Expected receipt = **$16,385.60**.
* Invoice number on approval with invoice date 2026-11-02: **`GLBX-202611-0001`**.
* Due date = 2026-11-02 + 45 = **2026-12-17**. Expected payment date = + 15 days = **2027-01-01**.
* Expected vendor bill (Apex): 176.00 × $75.00 = **$13,200.00**.
* Margin: 16,720.00 − 334.40 − 13,200.00 = **$3,185.60** (19.05%).

**T2 — Rate change mid-period**

* Add BILL REGULAR $100.00 effective 2026-10-16 (end the $95 rate on 2026-10-15).
* Oct 1–15 weekdays = 11 days = 88.00 h × $95.00 = $8,360.00; Oct 16–31 = 11 days = 88.00 h × $100.00 = $8,800.00.
* Invoice has **2 lines**, total **$17,160.00**. Deduction **$343.20**. Expected receipt **$16,816.80**.
* Vendor bill unchanged at $13,200.00 (pay rate unchanged), **1 line**.

**T3 — Hours mismatch blocks verification**

* Ravi enters 176.00; screenshot extraction total\_hours = 168.00 → `HOURS\_MISMATCH` (BLOCK), status NEEDS\_REVIEW. The invoice run lists E1 as missing.

**T4 — Duplicate evidence**

* Upload the same October screenshot to Meera's timesheet → `DUPLICATE\_EVIDENCE` (BLOCK).

**T5 — Payment with expected deduction (T1 invoice)**

* Globex pays $16,385.60 → application applied 16,385.60, deduction 334.40, shortfall 0. Invoice **PAID**, balance $0.00.
* Pay-when-paid: Apex bill line released **$13,200.00**.

**T6 — Partial payment releases proportionally**

* Globex pays $8,192.80 (half the expected receipt) → paid fraction = (8,192.80 + 167.20) / 16,720.00 = 0.5 → Apex release **$6,600.00**. Invoice PARTIALLY\_PAID; balance $8,360.00.
* Rule for partial payments: deduction recorded in proportion to the amount applied (applied / expected receipt × expected deduction, rounded half up).

**T7 — Short-pay**

* Globex pays $16,000.00 against T1 → shortfall vs expected receipt = **$385.60**. Saving requires a reason code.
* Rule for short-pays applied as a single settlement: record the full expected deduction ($334.40), applied $16,000.00, shortfall $385.60. Balance = 16,720.00 − 16,000.00 − 334.40 = **$385.60**.
* With reason `HOURS\_DIFF\_VMS`, the user chooses: mark the invoice DISPUTED (balance stays $385.60), or write off with a credit memo of $385.60 (Manager approval) → PAID.
* Pay-when-paid release for Apex = round\_half\_up(13,200.00 × (16,000.00 + 334.40) / 16,720.00) = **$12,895.58**.

**T8 — Vendor invoice three-way match**

* Apex invoice: 176.00 h × $75.00 = $13,200.00, number APX-1009 → MATCHED.
* Apex invoice: 180.00 h × $75.00 = $13,500.00 → line `HOURS\_DIFF`, bill EXCEPTION.
* Second Apex invoice also numbered APX-1009 → `DUPLICATE\_INVOICE`, blocked.

**T9 — Compliance block**

* Set Apex COI expiry to 2026-10-31. Payment run on 2026-11-05 → Apex bill blocked; Admin override with a reason allows it, and the override is in the audit log.

**T10 — Factoring (T1 invoice factored with Summit)**

* Advance 90% = **$15,048.00**. Fee 3% = **$501.60**. Rebate = 16,720.00 − 15,048.00 − 501.60 = **$1,170.40**.
* Pay-when-paid for Apex releases only when the assignment is COLLECTED (default setting).

**T11 — Numbering sequence and gaps**

* Approve two more Globex invoices in November → `GLBX-202611-0002`, `-0003`. Discard a draft before approval → no number consumed. Void `-0002` with a credit memo → number stays used; the next is `-0004`.

**T12 — Tenant isolation**

* Create a second firm with its own data. Every API route, called with Firm B's session and Firm A's IDs, returns 404 or 403 and changes nothing.

**T13 — Immutability**

* Attempt to edit a timesheet entry on an INVOICED timesheet → rejected. Attempt to change hours on an APPROVED invoice line → rejected.

**T14 — Period lock**

* Lock October 2026. Editing an Oct 20 entry → rejected. Admin unlock with reason → allowed and logged.

**T15 — QBO idempotency**

* Run the sync for invoice `GLBX-202611-0001` twice (simulate a timeout after QBO accepted the first call) → exactly one QBO invoice exists; the job is SUCCEEDED with one qbo\_invoice\_id.

**T16 — W-2 consultant**

* Meera, October, 176.00 h × $110.00 = **$19,360.00** invoice; no vendor bill; margin report shows revenue $19,360.00 less deduction $387.20, with "cost from payroll — not tracked".

\---

## 19\. Milestones (build in order)

Each milestone lists its scope, the sections the agent needs, acceptance criteria, and a prompt to paste.

### M0 — Foundation (sections 1–4, 12, 17)

**Scope:** monorepo, docker-compose (Postgres, MinIO, Mailpit, ClamAV), Next.js app shell, auth with MFA, firm sign-up, memberships and roles, permission helper, entitlement helper `requireFeature` (returns true for every feature until M9, section 22.3), audit log, file upload with scan, CI pipeline.
**Acceptance:** sign up a firm; invite users of all four roles; MFA enforced for Admin/Finance; uploading a file stores it and marks it CLEAN; T12 (isolation) passes for the routes that exist; CI green; staging on Google Cloud is created by Terraform and a merge to `main` deploys there (Section 24.11, M0 row).
**Prompt:**

> Read docs/build-spec.md sections 1–4, 12 and 17. Set up the monorepo exactly as in section 4 with the stack in section 3. Implement auth, firms, memberships, roles, server-side permission checks, the audit log and file uploads with virus scanning. Add row-level security on every tenant table. Write the tenant-isolation test (T12) for every route you create. Then read section 24 and build the M0 row of 24.11: Terraform for the shared and staging projects, Workload Identity Federation for GitHub Actions, and a pipeline that deploys every merge to staging. Don't build any business features yet. List anything ambiguous before you start.

### M1 — Master data (sections 5.1–5.3, 13.2 items 4–6, 13.3 items 1–3)

**Scope:** parties (all kinds), contacts, documents with expiry, consultants, engagements, billing chain, effective-dated rates with no-overlap enforcement, POs, firm settings, numbering pattern editor with preview, holiday calendar, seed data (18.1).
**Acceptance:** seed loads; overlapping rates rejected; numbering preview shows `GLBX-202611-0001` for the seed; engagement page shows the billing chain, rates timeline and margin preview ($20.00/h, 21.05% for E1).
**Prompt:**

> Implement section 5.1–5.3 tables, the domain functions for rate resolution (7.2) and invoice number formatting (7.4, formatting only, no sequence yet), and the screens in 13.2 items 4–6 and 13.3 items 1–3. Write unit tests for rate overlap and resolution first. Load the seed data from 18.1.

### M2 — Timesheets and evidence (sections 5.4, 6.1, 7.1, 7.6, 8, 9 \[timesheet inbox only], 13.1, 13.2 items 2–3, 14)

**Scope:** period generation, consultant timesheet editor (mobile), evidence upload, extraction job with the provider interface, checks, review screen, return/verify, unmatched queue, inbound timesheet email, reminders. Write an `ai\_usage\_event` for every extraction with the billable flag and reason (section 22.4); don't enforce the allowance yet.
**Acceptance:** T3, T4, T13 (timesheet half) pass; an emailed screenshot from ravi@ creates a pre-filled draft on the right timesheet; the review screen shows image and values side by side with differences highlighted; the AI fixture evaluation script runs and reports accuracy.
**Prompt:**

> Implement timesheets per sections 5.4, 6.1, 7.1 and 7.6, AI extraction per section 8 (provider behind the Extractor interface, Zod validation, retry once), and the timesheet email inbox per section 9. Build the consultant screens (13.1) mobile-first and the review screens (13.2 items 2–3). Write tests for every check code in 7.6 and for the timesheet state machine before implementing them. Extraction results are proposals only and never change records directly.

### M3 — Invoicing (sections 5.5, 6.2, 7.3–7.5, 7.7, 11.1–11.2, 13.2 items 7–9)

**Scope:** invoice runs, line building with rate splits, missing list, draft invoices, approval with numbering and locking, templates, PDF, evidence pack, send by email, portal task, disputes, credit memos, supplemental and rate-adjustment invoices.
**Acceptance:** T1 (invoice parts), T2, T11, T13 (invoice half) pass; the PDF contains every field in 11.1; the evidence pack opens and lists all evidence; the email arrives in Mailpit with both attachments.
**Prompt:**

> Implement invoicing per sections 5.5, 6.2, 7.3–7.5 and 7.7, documents per 11.1–11.2, and screens 13.2 items 7–9. Number assignment must happen inside the approval transaction with a row lock. Write tests T1, T2, T11 and the immutability parts of T13 first.

### M4 — Vendor payables (sections 5.6, 6.3, 7.8–7.10 \[NET and pay-when-paid], 9 \[AP inbox, vendor invoices], 11.3, 13.2 items 10 and 12)

**Scope:** expected vendor bills, AP inbox and vendor invoice extraction, three-way match, exceptions, approval, compliance block and override, payment runs, recording payments, remittance advice.
**Acceptance:** T1 (vendor bill part), T8, T9 pass; a vendor invoice emailed to the AP inbox attaches to the right expected bill and matches.
**Prompt:**

> Implement vendor payables per sections 5.6, 6.3 and 7.8–7.10, the AP inbox for vendor invoices (section 9), remittance advice (11.3), and screens 13.2 items 10 and 12. Release logic for pay-when-paid must read from receipt applications, which come in M5; for now, expose the function and test it with fixture data. Write T8 and T9 first.

### M5 — Receipts and reconciliation (sections 5.7, 6.4, 7.10 \[pay-when-paid wiring], 7.11–7.13, 13.2 item 11)

**Scope:** record receipts, remittance extraction, application suggestions, expected deductions, shortfalls with reasons, overpayments and credits, unapplied queue, factoring, pay-when-paid release wired to applications, expected payment dates.
**Acceptance:** T5, T6, T7, T10 pass; releasing works end-to-end from a Globex payment to an Apex payment run.
**Prompt:**

> Implement receipts per sections 5.7, 6.4, 7.11–7.13 and wire pay-when-paid release (7.10) to receipt applications and factoring collection. Build screen 13.2 item 11. Write T5, T6, T7 and T10 first.

### M6 — QuickBooks Online (section 10)

**Scope:** connect, token refresh, reconnect page, list cache, mapping wizard, sync jobs for every row in 10.3, sync log.
**Acceptance:** against a QBO sandbox company: seed data maps; T1 invoice, T5 payment (with deduction), Apex bill and bill payment, and T10 factoring entries all appear correctly in QBO; T15 passes; read calls per firm setup < 100.
**Prompt:**

> Implement the QuickBooks Online integration per section 10, one-way push only. Use the qbo\_sync\_job table with idempotency keys and a per-realm queue. Never update or delete QBO records after creation. Build the mapping wizard and sync log screens. Write T15 first, using a mocked QBO server, then verify against the sandbox.

### M7 — Reports, month-end and polish (sections 7.14–7.15, 13.2 items 1, 13–15, 14, 15, 23)

**Scope:** dashboard, all reports in section 15 including the cash gap, accruals, period lock, overdue and compliance jobs, notifications, CSV exports, CPA package export (section 23).
**Acceptance:** T14 and T16 pass; the cash gap report for the seed shows the Apex bill against the Globex expected payment date; month-end checklist completes for October 2026; C1–C7 pass; the November 2026 workbook opens in Excel with correct dates and amounts.
**Prompt:**

> Implement reports (section 15), the dashboard, month-end accruals and period lock (7.14–7.15), and all scheduled jobs in section 14. Write T14 and T16 first. Every report must export to CSV.
> Then implement the CPA package per section 23: write the pure dataset, tie-out and 1099 functions with tests C1–C4 first, then the CSV/XLSX/ZIP writers, versioning, delivery links and screens, then C5–C7. Generating a package must never change any record. Don't add financial statements (P\&L, balance sheet).

### M8 — Pilot hardening

**Scope:** accessibility pass (keyboard, contrast), performance (lists paginate server-side; invoice run with 200 consultants in under 10 seconds), error states, empty states, onboarding checklist for a new firm, data export, backup restore drill, security review checklist.
**Acceptance:** a new firm can go from sign-up to sent invoice in under 30 minutes with the onboarding checklist; restore drill documented; production deployment acceptance in Section 24.11 passes.

### M9 — Plans, usage and subscription billing (section 22)

See section 22.10 for scope, acceptance criteria and the prompt. Pilot firms can run on `PILOT25` or a trial before M9 ships.

\---

## 20\. Out of scope for v1

* Moving money (ACH origination, card payments, bill pay)
* General ledger, payroll, tax, 1099 filing, bank reconciliation
* Bank feed import
* Vendor, prime or client portals and logins
* Direct VMS integrations (Fieldglass, Beeline APIs)
* Native mobile apps
* Multi-currency and sales tax
* Xero and QuickBooks Desktop
* Recruiting / applicant tracking
* Approver email links (workflow path D) and prime confirmation requests (path E) — design the evidence `source` enum for them now; build later

\---

## 21\. Open decisions for the product owner

1. Pricing — set in section 22 (Essentials $14.99 and Professional $29.99 per company, $5.99 per active consultant, AI read allowance, `LAUNCH25` and `PILOT25`). Still open:

   * the overage price per AI read ($0.10 placeholder) and the pool size (10 per consultant, minimum 30), checked against the provider's real cost per page
   * annual billing, consolidated billing across companies, and sales tax on the subscription
   * the `LAUNCH25` redemption limit (50) and whether to add a `redeem\_by` date
2. Whether Managers also act as Finance by default.
3. Deduction treatment in QBO: discount line on the payment vs. credit memo vs. journal entry — confirm with a pilot firm's CPA.
4. Factoring accounting treatment and the default release trigger (collected vs. advance).
5. Default match tolerance ($1.00 suggested) and whether hours must match exactly.
6. Whether consultants can see their own bill rate (default: no).
7. Which Gemini model on Vertex AI to use (section 24.9), and confirming the zero-data-retention settings.
8. Which 2–3 pilot firms provide the screenshot fixture set and the October test month.
9. CPA package (section 23): review the file list and columns with one or two pilot firms' CPAs before M7; confirm the 1099 threshold for each tax year; decide whether automatic sending to the CPA should be on by default.
10. Google Cloud (section 24): confirm the region (`us-south1` vs `us-central1`) once service availability is checked; set the monthly budget per project; decide who receives "Page" alerts and how (phone, SMS, Slack).

\---

## 22\. Pricing, plans and usage limits

This section defines what the firm pays us (the platform), not what the firm bills its clients. Build it in milestone M9, but record AI usage from M2 onward (22.4) and route every gated feature through the entitlement check from M0 (22.3).

### 22.1 Plans and list prices

|Plan|Company fee (per company per month)|Consultant fee (per active consultant per month)|AI read allowance|
|-|-|-|-|
|**Essentials**|$14.99|$5.99|22.4|
|**Professional**|$29.99|$5.99|22.4|

* A **company** is one `firm` (tenant). A person who manages two companies pays two company fees.
* Admin, Manager and Finance users are **unlimited and free** on both plans. Only active consultants are charged.
* Prices are stored as data (`plan\_price\_version`), never hard-coded. A price change creates a new version; existing subscriptions keep their version until moved, with 30 days' email notice to the company's Admins.
* Billing is **monthly in arrears**: the bill for calendar month M (in the firm's time zone) is computed on the 1st of month M+1 and charged then.
* Annual billing, consolidated billing across several companies, and sales tax on our subscription are not in v1 (see 21).

### 22.2 Active consultant (the billing unit)

A consultant is **active in month M** if, for any engagement of the firm, either:

* a `timesheet\_entry` with hours > 0 has a work date in M, or
* an evidence file is attached to a timesheet whose period overlaps M.

Rules:

* Counted **once per month**, no matter how many engagements or timesheets they have.
* W-2 employees and contractors are counted the same way.
* Consultants with no hours and no evidence in M (on the bench, ended, not started) are not counted.
* Users with only Admin, Manager or Finance roles are never counted.
* The count is final when the month's bill is computed. Entries added later don't change an issued bill (R4), and a consultant is never charged twice for the same month.
* The billing page shows the running count for the current month, with the names of the consultants counted.

### 22.3 Feature entitlements

|Feature|Essentials|Professional|Sections|
|-|-|-|-|
|Timesheets, screenshot reading (AI), email and bulk intake, checks|✔|✔|5.4, 7.6, 8, 9|
|Invoicing to prime vendors, numbering, templates, PDFs, evidence packs|✔|✔|5.5, 7.3–7.7, 11|
|Receipts with expected deductions, partial payments and short-pays|✔|✔|5.7, 7.12|
|Vendor bills on NET terms: expected bill, attach vendor invoice, approve, record payment, remittance|✔|✔|5.6, 7.8, 11.3|
|Standard reports: AR and AP aging, margin, unbilled hours, missing timesheets, PO burn, deductions, timesheet exceptions|✔|✔|15|
|CSV exports|✔|✔|13|
|CPA package export|✔|✔|23|
|QuickBooks Online sync||✔|10|
|Three-way match with automatic exceptions||✔|7.9|
|Pay-when-paid release||✔|7.10|
|Cash gap and collections forecast||✔|7.11, 15|
|Factoring||✔|7.13|
|Month-end accruals||✔|7.14|

Enforcement:

* One server-side helper, `requireFeature(firmId, feature)`, checked in every gated server action, route and job (R8). In M0–M8 it returns true for every feature; M9 connects it to the subscription.
* Hidden menu items are not enforcement.
* On Essentials, vendor invoices are attached and approved manually; the match table is shown for information but raises no blocking exceptions.

Plan changes:

* **Upgrade** takes effect immediately. The whole month in which the upgrade happens is billed at the higher plan.
* **Downgrade** takes effect on the 1st of the next month. It is **blocked** while any of these exist: unreleased pay-when-paid bill lines, factoring assignments not SETTLED, or QBO sync jobs PENDING, RUNNING or FAILED. The screen lists the blocking items.
* After a downgrade, data from Professional features stays readable and exportable; no new records are created through them, and no new QBO sync jobs are created.
* On a later upgrade, the Admin MAY run a one-time QBO backfill from a chosen date. It creates sync jobs through the normal idempotent path (10.4).

### 22.4 AI read allowance

**What counts as one read**

* One page or image processed by the extractor (8.1), of any document type: timesheet, vendor invoice or remittance. A 3-page PDF is 3 reads.
* **Not counted** (recorded with `billable = false` and a reason):

  * the automatic retry after a validation failure (8.1)
  * extractions that fail because of a provider or system error
  * files rejected before extraction as duplicates (same `sha256`) or by the virus scan
* A user-requested re-extraction of the same file counts.

**Monthly pool (per company)**

* Pool = max(**30**, **10 × active consultants so far in the month**). Same on both plans.
* The pool is recalculated as consultants become active; the final pool uses the final active count (22.2).
* Unused reads don't roll over.

**Over the pool**

* Overage price: **$0.10 per read** (placeholder; confirm against the provider's real cost before launch, see 21). Stored on the price version.
* Overage is billed in arrears on the same monthly bill. Discounts never apply to overage (22.5).
* `ai\_overage\_mode` per company, set by the Admin:

  * `SOFT` (default): extraction continues and overage is billed.
  * `HARD\_CAP`: once the pool is used up, new files are stored but not extracted. They go to manual entry with the message "This month's AI reads are used up; enter hours by hand or ask your Admin to allow overage."
* Safety cap in `SOFT` mode: at **3× the pool**, extraction pauses as in `HARD\_CAP` until an Admin lifts the cap for the rest of the month (logged, R5).
* Alerts to Admin and Finance at **80%** and **100%** of the pool, and when the safety cap is hit (deduped once per threshold per month).
* Never block a consultant from submitting hours because of the allowance. Only the AI reading stops.

**Free trial**

* 30 days, Professional features, no card required.
* Fixed pool of **100 reads**, always `HARD\_CAP` (no overage without a payment method).

### 22.5 Introductory discount

Promotions are stored as data (`promotion`) so they can be changed without code. Two promotions are seeded:

|Code|Discount|Applies to|Duration|Eligibility|How granted|
|-|-|-|-|-|-|
|`LAUNCH25`|25% (2500 bps)|Company fee only|First 12 paid months|New companies; first **50** redemptions; optional `redeem\_by` date|Code entered by the Admin at checkout or within the first paid month|
|`PILOT25`|25% (2500 bps)|Company fee and consultant fee|First 12 paid months|Pilot firms only; max **10**|Granted by the platform operator (seed or CLI script), not by firms|

Rules (apply to every promotion):

1. **Fees only.** Discounts apply to the company fee and, if stated, the consultant fee. Never to AI overage or one-time services.
2. **Rounding.** Discount per bill line = round\_half\_up(line amount × bps / 10000), in cents (R1).
3. **Fixed duration.** Counted in whole billing months from the first paid month (22.6). Every month counts, including months with a small or unpaid bill.
4. **One promotion per company at a time.** No stacking; a second code is rejected while one is active. If annual billing is added later, a promotion and annual billing don't combine.
5. **Once per company.** A company that cancels and comes back doesn't get the same promotion again.
6. **Plan changes keep the promotion.** The remaining months continue, and the percentage applies to the new plan's fees.
7. **Price lock.** During the promotion, the discount applies to the price version held on the subscription at redemption.
8. **Visible end date.** The billing page shows the promotion name, discount, months remaining and end date from the first day.
9. **Notice.** Email the company's Admins at least **30 days** before the first full-price month starts, showing the current and the next monthly amount at the current active count.
10. **Automatic return** to list price after the last discounted month. No action needed from the firm.
11. Every redemption, rejection and operator grant writes an audit event (R5).

### 22.6 Trial, conversion and non-payment

* **Trial:** starts at sign-up; 30 days; Professional features; 100-read hard cap.
* **Conversion:** when the Admin picks a plan and adds a payment method (during or after the trial), access is restored or continued immediately. Paid billing starts on the **1st of the next month**; the rest of the current month is free and keeps trial entitlements. This avoids proration.
* **Trial ends without conversion:** the company becomes `READ\_ONLY`. Users can sign in, view and export everything; nothing new can be created; extraction is off. Data is kept for at least 90 days.
* **Failed payment:** `PAST\_DUE` with reminders on days 1, 7 and 13. After 14 days the company becomes `READ\_ONLY` until paid. Exports always work.
* **Cancellation:** effective at the end of the current month; that month is billed normally.

### 22.7 Data model additions

|Table|Key columns|
|-|-|
|**plan\_price\_version**|`plan\_code` enum `ESSENTIALS`,`PROFESSIONAL`; `company\_fee\_cents`; `consultant\_fee\_cents`; `reads\_per\_consultant` (10); `min\_read\_pool` (30); `overage\_cents\_per\_read` (10); `safety\_cap\_multiple` (3); `effective\_from`; `features` jsonb (22.3)|
|**subscription**|`firm\_id` (unique); `plan\_code`; `price\_version\_id`; `status` enum `TRIALING`,`ACTIVE`,`PAST\_DUE`,`READ\_ONLY`,`CANCELED`; `trial\_ends\_at`; `paid\_start\_month` (DATE, 1st of month); `pending\_plan\_code` and `pending\_effective\_month` (downgrades); `ai\_overage\_mode` enum `SOFT`,`HARD\_CAP`; `safety\_cap\_lifted\_month` (nullable); `payment\_customer\_ref`|
|**promotion**|`code` (unique); `name`; `discount\_bps`; `applies\_to` enum `COMPANY\_FEE`,`ALL\_SUBSCRIPTION\_FEES`; `duration\_months`; `max\_redemptions` (nullable); `redeem\_by` (nullable); `grant\_mode` enum `CODE`,`OPERATOR\_ONLY`; `active`|
|**promotion\_redemption**|`firm\_id`; `promotion\_id`; `price\_version\_id`; `first\_month`; `last\_month`; `notice\_sent\_at`; `status` enum `ACTIVE`,`ENDED`,`REVOKED`. Unique (`firm\_id`, `promotion\_id`)|
|**ai\_usage\_event**|`firm\_id`; `extraction\_id`; `file\_id`; `document\_kind`; `pages`; `billable` bool; `non\_billable\_reason` enum `VALIDATION\_RETRY`,`PROVIDER\_ERROR`,`DUPLICATE`,`SCAN\_REJECTED` (nullable); `usage\_month`; `provider\_cost\_cents`|
|**subscription\_bill**|`firm\_id`; `billing\_month`; `plan\_code`; `price\_version\_id`; `active\_consultant\_count`; `active\_consultant\_ids` jsonb; `read\_pool`; `billable\_reads`; `overage\_reads`; `lines` jsonb (type, description, amount\_cents); `total\_cents`; `status` enum `DRAFT`,`ISSUED`,`PAID`,`FAILED`,`VOID`; `payment\_ref`. Immutable once ISSUED (R4)|

`subscription\_bill` and `ai\_usage\_event` are tenant tables under row-level security (R3). `plan\_price\_version` and `promotion` are platform tables, readable by all tenants and writable only by the operator script.

Domain functions (pure, R2):

* `countActiveConsultants(entries, evidence, month) → { count, ids }`
* `readPool(activeCount, priceVersion) → reads`
* `computeSubscriptionBill({ planCode, priceVersion, activeCount, billableReads, redemption, month }) → { lines, totalCents }`, with lines in this order: company fee, company fee discount, consultant fee, consultant fee discount, AI overage.
* `promotionMonthsRemaining(redemption, month)` and `canDowngrade(firmState) → { allowed, blockers\[] }`.

Payment collection: use a hosted payment provider (default Stripe: hosted checkout for the card, one invoice per `subscription\_bill`). The app computes every amount; the provider only collects. Store no card data. Webhooks update `subscription\_bill.status` idempotently (R7).

### 22.8 Screens, permissions and jobs

* **Admin → Billing (13.3 item 8):** plan and prices; running active consultant count with names; AI reads used vs pool (meter) and overage mode; promotion with months remaining and end date; change plan (with downgrade blockers); payment method; bill history with PDF.
* **Permissions:** Admin manages billing; Finance can view it; Manager and Consultant have no access.
* **Jobs (add to 14):**

|Job|Trigger|Action|
|-|-|-|
|`compute\_subscription\_bills`|1st of month, 02:00 firm time|Compute and issue last month's bill per company; charge through the provider|
|`ai\_allowance\_alerts`|After each billable usage event|Alerts at 80%, 100% and the safety cap (deduped per month)|
|`promotion\_end\_notices`|Daily|Send notices 30 days before the first full-price month|
|`trial\_reminders`|Daily|Remind Admins 7 days and 1 day before the trial ends|
|`past\_due\_followup`|Daily|Reminders on days 1, 7, 13; move to READ\_ONLY after 14 days|

### 22.9 Pricing golden tests

All amounts are exact. Use the seed firm unless stated.

**P1 — Essentials, no promotion.** 5 active consultants in November 2026, 40 billable reads. Bill = 14.99 + 5 × 5.99 (29.95) = **$44.94**. Pool = max(30, 50) = 50; no overage.

**P2 — Professional with `LAUNCH25`.** 8 active consultants. Company fee 29.99 − discount round\_half\_up(29.99 × 0.25 = 7.4975) 7.50 = 22.49; consultant fee 8 × 5.99 = 47.92 (not discounted). Bill = **$70.41** (list price would be $77.91). Pool = 80.

**P3 — Active count.** The firm has 6 consultants. In November: Ravi has hours; Meera has hours until her engagement ends on Nov 10; one consultant has no hours and no evidence; one has evidence only (screenshot uploaded, hours not yet entered); two more have hours. Count = **5** (Ravi, Meera, the evidence-only consultant, the two others). The Admin user is not counted.

**P4 — Overage.** P1 firm with 62 billable reads, plus 2 validation retries and 1 rejected duplicate (both non-billable). Overage = 62 − 50 = 12 × $0.10 = $1.20. Bill = **$46.14**. A 3-page PDF timesheet in the same month counts as 3 reads.

**P5 — Minimum pool.** Essentials, 1 active consultant. Bill = 14.99 + 5.99 = **$20.98**. Pool = max(30, 10) = **30**.

**P6 — Hard cap.** P1 firm in `HARD\_CAP` mode. The 51st read is not extracted; the file is stored and routed to manual entry with the message from 22.4; the consultant can still submit. Trial company: the 101st read is likewise not extracted.

**P7 — Safety cap.** P1 firm in `SOFT` mode reaches 150 billable reads (3 × 50): extraction pauses, Admin and Finance are alerted; Admin lifts the cap (audit event with reason) and extraction resumes for the rest of the month.

**P8 — `PILOT25` and rounding; overage not discounted.** Essentials, 5 active, 62 billable reads. Company fee 14.99 − round\_half\_up(3.7475) 3.75 = 11.24; consultant fee 29.95 − round\_half\_up(7.4875) 7.49 = 22.46; overage 12 reads = 1.20 (no discount). Bill = **$34.90**.

**P9 — Promotion dates and notice.** Sign-up 2026-10-20; trial ends 2026-11-19. The Admin picks Essentials, adds a card on 2026-11-10 and enters `LAUNCH25`. Paid start = **2026-12-01**; November is free. Discounted months: **December 2026 to November 2027**. The first bill (December) is issued 2027-01-01. The end notice is sent on **2027-11-01** (30 days before 2027-12-01). December 2027 bills the full company fee.

**P10 — Promotion limits.** (a) A company with active `LAUNCH25` enters another code → rejected, no change. (b) The 51st company enters `LAUNCH25` → rejected ("This offer is no longer available"). (c) A company that cancelled after using `LAUNCH25` re-subscribes and enters it again → rejected. (d) A firm user tries to apply `PILOT25` → rejected (operator only). Each rejection writes an audit event.

**P11 — Upgrade during promotion.** P9 firm upgrades to Professional on 2027-03-10. Features unlock immediately. The March 2027 bill uses the Professional company fee with 25% off: 29.99 − 7.50 = **$22.49**, plus consultant fees. The promotion still ends after November 2027.

**P12 — Downgrade blocked.** A Professional firm with an unreleased pay-when-paid Apex bill line (T6 state) requests Essentials → blocked; the screen lists the Apex bill. After the release and a clean sync log, the downgrade is accepted and takes effect on the 1st of the next month.

**P13 — Entitlement enforcement.** On Essentials, calling `startQboConnect`, `assignToFactor` or the cash gap report route directly returns 403 and changes nothing (R8).

### 22.10 Milestone M9 — Plans, usage and subscription billing

**Scope:** sections 22.1–22.8; payment provider integration; Billing screen; jobs in 22.8.
**Before M9:** M0 adds `requireFeature` (always true); M2 writes `ai\_usage\_event` for every extraction (billable flag and reason per 22.4).
**Acceptance:** P1–P13 pass; a trial company converts with a test card, receives its first bill on the 1st, and the provider webhook marks it PAID; the downgrade blocker list matches P12.
**Prompt:**

> Read section 22. Implement the pure domain functions in 22.7 first, with tests P1–P5, P8, P9 and P11 written before the code. Then add the tables, the Billing screen, the jobs in 22.8, payment collection through the provider's hosted checkout and webhooks, entitlement checks via `requireFeature` on every gated action (P13), and the AI allowance controls (P6, P7). Prices and promotions must come from the database, never from constants in code. Don't build annual billing, consolidated multi-company billing or sales tax.

\---

## 23\. CPA package export

### 23.1 Purpose and principles

Many small firms don't use QuickBooks. Their CPA keeps the books and prepares taxes from bank statements plus whatever the firm sends. The CPA package gives the CPA, once a month, everything the app knows about invoices, payments received, vendor bills and vendor payments, in files that open in Excel and tie out.

* Available on **both plans** (22.3). Firms on QuickBooks MAY use it too.
* **It is not a financial statement.** The app doesn't hold bank balances, payroll, rent or other expenses, so the package never claims to be a P\&L or balance sheet. The summary says this in plain words.
* **Read-only and reproducible.** Generating a package changes no records. The same data always produces byte-identical CSV files (fixed sort order, fixed formats), with checksums in the manifest.
* **Built from dated events, "as of" month end.** Balances at month end are computed from invoice dates, receipt dates, credit memo dates, bill dates and payment dates on or before the last day of the month, not from current status.
* **Tax wording is advisory.** The 1099 file flags vendors as "likely reportable" or "likely exempt"; the CPA decides. The app doesn't file 1099s (section 20).

### 23.2 Periods, timing and versions

* **Monthly package** for any calendar month (firm time zone). **Year-end package** for a calendar year: same files covering January–December, plus the 1099 file at December 31 and copies of current vendor W-9s.
* **On demand:** Admin or Finance can generate a package for any past month at any time.
* **Scheduled:** if `cpa\_auto\_generate` is on, the job `generate\_cpa\_packages` builds last month's package on day `cpa\_auto\_generate\_day` (default **5**) at 03:00 firm time, and sends it if `cpa\_auto\_send` is on.
* **Preliminary flag:** if the month isn't locked (7.15) when the package is built, the summary, file names and email say **"Preliminary — period not locked."**
* **Versions:** regenerating a month creates version 2, 3, … The old version is kept and marked superseded. The new summary lists what changed since the previous version (counts and totals per file, and AR/AP at month end).
* **Change after sending:** if a record dated in a month changes after that month's package was sent (only possible after an unlock), show a banner on the Month-end screen: "November 2026 changed after the CPA package was sent. Regenerate and resend?"

### 23.3 Package contents

One ZIP file: `CPA\_Package\_<FIRM>\_<YYYY-MM>\_v<N>.zip`, where `<FIRM>` is the firm's display name as a slug (e.g. `Lonestar-Data-Consulting`) (year-end: `<YYYY>-YE`). Preliminary packages add `\_PRELIM`.

|#|File|Contents|
|-|-|-|
|00|`00\_Summary.pdf`|Cover and "Month at a glance" (23.5), tie-out checks (23.6), list of files with row counts, notes and column glossary|
|01|`01\_Invoice\_Register.csv`|Every invoice with `invoice\_date` in the period|
|02|`02\_Credit\_Memos.csv`|Every approved credit memo dated in the period|
|03|`03\_Deposits\_for\_Bank\_Match.csv`|Every receipt (all kinds, including factor advances and rebates) with `received\_date` in the period — one row per deposit, for matching bank statement lines|
|04|`04\_Receipt\_Applications.csv`|One row per receipt application in the period: how each deposit was applied to invoices, with deductions and shortfalls|
|05|`05\_Deductions\_and\_Shortfalls.csv`|Prime deductions and shortfalls in the period, with reason codes, by bill-to party|
|06|`06\_Vendor\_Bills.csv`|Every approved vendor bill with bill date in the period|
|07|`07\_Vendor\_Payments\_for\_Bank\_Match.csv`|Every vendor payment with `paid\_date` in the period — one row per payment, for matching bank statement lines|
|08|`08\_AR\_Open\_at\_Month\_End.csv`|Every invoice with a balance > 0 at month end, with aging|
|09|`09\_AP\_Open\_at\_Month\_End.csv`|Every approved vendor bill with an unpaid amount > 0 at month end, split into released and not yet released (pay-when-paid)|
|10|`10\_Vendor\_1099\_YTD.csv`|Year-to-date payments per sub-vendor (23.7)|
|11|`11\_Unapplied\_Cash\_and\_Credits.csv`|Unapplied receipt amounts and customer credits at month end|
|12|`12\_Factoring.csv`|Factoring assignments, advances, fees and rebates in the period (only if the firm has any)|
|—|`CPA\_Package\_<FIRM>\_<YYYY-MM>.xlsx`|Workbook with one sheet per CSV above (same columns), plus a Summary sheet|
|—|`documents/invoices/`|Invoice PDFs for file 01 (`<invoice\_number>.pdf`)|
|—|`documents/credit\_memos/`|Credit memo PDFs for file 02|
|—|`documents/vendor\_invoices/`|Vendor invoice files for file 06 (`<VENDORCODE>\_<vendor\_invoice\_number>.<ext>`)|
|—|`documents/remittances/`|Remittance files received (file 03) and remittance advice sent (file 07)|
|—|`documents/evidence\_packs/`|Evidence packs — **off by default** (setting `cpa\_include\_evidence\_packs`)|
|—|`documents/w9/`|Year-end package only: current W-9 for each sub-vendor in file 10|
|—|`manifest.json`|Firm, period, version, preliminary flag, generated\_at, generated\_by, row count and sha256 per file, totals per file|

Files with no rows are still included, with the header row only. If the month has no activity at all, the summary says "No activity recorded in this period."

### 23.4 Columns

Formats (all CSV files):

* UTF-8 with BOM (Excel opens it correctly), comma separated, CRLF line endings, header row, values quoted only when needed.
* Dates `YYYY-MM-DD`. Money as plain decimals with two places and a leading minus for negatives, no currency symbols or thousands separators (e.g. `16720.00`). Hours with two decimals.
* Party names as display names; codes in their own column.
* Fixed sort order given per file. Ties broken by internal id.
* The XLSX sheets use the same columns, with real date and number cell types, money formatted `#,##0.00`, frozen header row and auto filters.

|File|Columns (in order)|Sort|
|-|-|-|
|01 Invoice register|invoice\_number, invoice\_date, due\_date, invoice\_type, bill\_to, bill\_to\_code, end\_client, po\_number, period\_start, period\_end, consultants (semicolon-separated names), hours, total, expected\_deduction, expected\_receipt, status\_at\_month\_end, balance\_at\_month\_end, factored (Y/N), qbo\_synced (Y/N/—), pdf\_file|invoice\_date, invoice\_number|
|02 Credit memos|memo\_number, memo\_date, invoice\_number, bill\_to, reason\_code, amount, notes, pdf\_file|memo\_date, memo\_number|
|03 Deposits|received\_date, payer, payer\_code, kind (`CUSTOMER\_PAYMENT`, `FACTOR\_ADVANCE`, `FACTOR\_REBATE`), method, reference, amount, applied\_amount, unapplied\_amount, invoices\_applied (semicolon-separated numbers), remittance\_file|received\_date, reference|
|04 Receipt applications|received\_date, receipt\_reference, payer, invoice\_number, invoice\_total, applied, deduction, shortfall, shortfall\_reason, application\_mode (`FULL`, `PARTIAL`, `FINAL\_SETTLEMENT`), invoice\_balance\_after|received\_date, receipt\_reference, invoice\_number|
|05 Deductions and shortfalls|date, bill\_to, bill\_to\_code, invoice\_number, type (`DEDUCTION`, `SHORTFALL`), label (e.g. "MSP fee") or reason\_code, amount|bill\_to\_code, date, invoice\_number|
|06 Vendor bills|bill\_date, vendor, vendor\_code, vendor\_invoice\_number, period\_start, period\_end, consultants, hours, approved\_total, pay\_terms (`NET`, `PAY\_WHEN\_PAID`), due\_date, linked\_client\_invoices, status\_at\_month\_end, unpaid\_at\_month\_end, vendor\_invoice\_file|bill\_date, vendor\_code, vendor\_invoice\_number|
|07 Vendor payments|paid\_date, vendor, vendor\_code, method, reference, amount, bills\_paid (semicolon-separated vendor invoice numbers), remittance\_file|paid\_date, reference|
|08 AR open|bill\_to, bill\_to\_code, invoice\_number, invoice\_date, due\_date, expected\_payment\_date, total, paid\_to\_date, deductions\_to\_date, credits\_to\_date, balance, days\_past\_due, aging\_bucket (`CURRENT`, `1-30`, `31-60`, `61-90`, `90+`), factored, disputed|bill\_to\_code, invoice\_date, invoice\_number|
|09 AP open|vendor, vendor\_code, vendor\_invoice\_number, bill\_date, pay\_terms, due\_date, approved\_total, paid\_to\_date, unpaid, released\_unpaid, not\_yet\_released, linked\_client\_invoices|vendor\_code, bill\_date|
|10 Vendor 1099 YTD|see 23.7|vendor\_code|
|11 Unapplied and credits|type (`UNAPPLIED\_RECEIPT`, `CUSTOMER\_CREDIT`), date, party, reference, original\_amount, remaining\_at\_month\_end|type, date|
|12 Factoring|invoice\_number, factor, assigned\_date, invoice\_total, advance, advance\_date, fee, rebate, rebate\_date, collected\_date, status\_at\_month\_end|assigned\_date, invoice\_number|

Definitions:

* `expected\_receipt` = total − expected\_deduction (7.5).
* Bill date for a vendor bill = `vendor\_invoice\_date` if present, otherwise the date it was approved.
* "At month end" values are computed from dated events up to and including the last day of the period (23.1).

### 23.5 Summary: month at a glance

The first page of `00\_Summary.pdf` (and the Summary sheet) shows:

|Line|Definition|
|-|-|
|Invoiced|Sum of `total` in file 01 (count of invoices)|
|Credit memos|Sum of file 02|
|Cash received|Sum of `amount` in file 03 (count of deposits), split by kind|
|Prime deductions|Sum of `DEDUCTION` rows in file 05|
|Shortfalls|Sum of `SHORTFALL` rows in file 05|
|Vendor bills|Sum of `approved\_total` in file 06|
|Vendor payments|Sum of file 07|
|AR at month end|Sum of `balance` in file 08|
|AP at month end|Sum of `unpaid` in file 09 (of which not yet released)|
|Unapplied cash and credits|Sum of file 11|

Below it, in plain words: "This package lists what was recorded in \[app name]. It doesn't include bank balances, payroll, rent or other expenses, and it isn't a profit and loss statement or balance sheet. Use the two 'for Bank Match' files to match bank statement lines."

### 23.6 Tie-out checks

Run before the package is marked READY. Each check shows **Ties out** or **Doesn't tie — difference $X** with the rows involved. A failed check doesn't block the package; it's shown on the summary and the generate screen, and logged.

1. **AR roll-forward:** AR at start of period + invoiced − cash applied to invoices − deductions − credit memos = AR at month end.
2. **AP roll-forward:** AP at start + vendor bills − vendor payments allocated to bills = AP at month end.
3. **Deposits:** for every receipt, applied + unapplied = amount. Customer-payment deposits total = applications + new unapplied amounts.
4. **Vendor payments:** for every payment, sum of allocations = amount.
5. **Register to documents:** every invoice in file 01 and credit memo in file 02 has its PDF in `documents/`; every vendor bill in file 06 with a vendor file has it attached. Missing files are listed.

Shortfalls stay in the invoice balance until a credit memo writes them off, so they're not a separate term in check 1.

### 23.7 Vendor 1099 year-to-date file

One row per sub-vendor paid in the calendar year up to the period end.

|Column|Definition|
|-|-|
|vendor, vendor\_code, legal\_name|From party|
|tin\_masked|Last 4 digits only (e.g. `\*\*\*-\*\*-1234` or `\*\*-\*\*\*1234`); full TINs are never exported in CSV|
|w9\_tax\_classification|From the latest W-9 (23.8); `UNKNOWN` if none|
|w9\_on\_file, w9\_date|Y/N and the W-9 effective date|
|ytd\_paid\_total|All vendor payments in the year|
|ytd\_paid\_by\_card\_or\_app|Payments with method `CARD\_OR\_PAYMENT\_APP`|
|ytd\_reportable\_amount|ytd\_paid\_total − ytd\_paid\_by\_card\_or\_app|
|threshold|Reporting threshold for the tax year, from config|
|status|`LIKELY\_REPORTABLE`, `LIKELY\_EXEMPT\_CORPORATION`, `BELOW\_THRESHOLD`, `NEEDS\_W9`|
|note|Plain-language reason, ending "CPA to confirm"|

Rules (advisory; based on the IRS instructions for Forms 1099-MISC and 1099-NEC):

* Payments by credit card, debit card or payment apps are reported by the processor on Form 1099-K, so they're excluded from `ytd\_reportable\_amount` ([IRS instructions](https://www.irs.gov/instructions/i1099mec)).
* Payments to C and S corporations, including LLCs taxed as either, are generally not reported. Status `LIKELY\_EXEMPT\_CORPORATION` ([IRS instructions](https://www.irs.gov/instructions/i1099mec)). Legal and medical services are exceptions, but they don't arise for sub-vendors in this product.
* Threshold by tax year, stored as config, not code: **$600** for 2025 and **$2,000** for payments made in 2026 onward, as raised by the One Big Beautiful Bill Act ([Asure](https://www.asuresoftware.com/1099-filing-obligations-for-vendors-and-contractors-frequently-asked-questions/), [QuickBooks](https://quickbooks.intuit.com/r/taxes/small-business-guide-to-1099-form/)). Confirm the value each year before release.
* Status logic, in order: no W-9 or classification `UNKNOWN` → `NEEDS\_W9`; classification C corporation, S corporation, LLC taxed as C or S → `LIKELY\_EXEMPT\_CORPORATION`; ytd\_reportable\_amount < threshold → `BELOW\_THRESHOLD`; otherwise `LIKELY\_REPORTABLE`.
* W-2 consultants never appear (they have no vendor payments).

### 23.8 Data model additions

|Table / change|Columns|
|-|-|
|**party** (add, sub-vendors)|`w9\_tax\_classification` enum `INDIVIDUAL\_SOLE\_PROP\_SMLLC`,`C\_CORP`,`S\_CORP`,`PARTNERSHIP`,`TRUST\_ESTATE`,`LLC\_C`,`LLC\_S`,`LLC\_P`,`OTHER`,`UNKNOWN` (default `UNKNOWN`; set when a W-9 is uploaded, editable by Admin/Finance); `tin` (encrypted, R11); `tin\_type` enum `EIN`,`SSN`|
|**vendor\_payment.method** (extend enum)|add `CARD\_OR\_PAYMENT\_APP`|
|**vendor\_bill** (add)|`approved\_at` timestamptz (used for bill date when there's no vendor invoice date)|
|**receipt\_application** (add)|`mode` enum `FULL`,`PARTIAL`,`FINAL\_SETTLEMENT` (7.12), set when the application is saved|
|**firm** (add)|`cpa\_contact\_name`; `cpa\_emails` text\[]; `cpa\_auto\_generate` bool (default false); `cpa\_auto\_generate\_day` int 1–28 (default 5); `cpa\_auto\_send` bool (default false); `cpa\_include\_evidence\_packs` bool (default false)|
|**tax\_year\_config** (platform table)|`tax\_year`; `form\_1099\_nec\_threshold\_cents` (2025: 60000; 2026: 200000)|
|**cpa\_package**|`firm\_id`; `period\_type` enum `MONTH`,`YEAR`; `period\_start`; `period\_end`; `version` int; `preliminary` bool; `status` enum `GENERATING`,`READY`,`FAILED`; `zip\_file\_id`; `manifest` jsonb; `tie\_out\_results` jsonb; `changes\_since\_previous` jsonb; `superseded\_by\_id` (nullable); `generated\_by` (user or `SYSTEM`); `generated\_at`. Unique (`firm\_id`, `period\_type`, `period\_start`, `version`)|
|**cpa\_package\_delivery**|`cpa\_package\_id`; `to\_email`; `sent\_at`; `link\_token\_hash`; `link\_expires\_at`; `first\_downloaded\_at`; `download\_count`; `revoked\_at`|

Domain functions (pure, R2): `buildCpaDatasets(snapshot, period) → { files: Record<name, rows\[]> }`, `computeMonthAtAGlance(datasets)`, `runTieOuts(datasets, openingBalances)`, `classify1099(vendor, ytd, threshold)`, `diffPackages(previous, current)`. CSV and XLSX writers live in `packages/integrations/export` and only format; they never compute amounts.

### 23.9 Delivery, permissions and security

* **Generate, download, send:** Admin and Finance. Manager can view and download. Consultants have no access.
* **Send to CPA:** emails each address in `cpa\_emails` a link to the ZIP. The link is a random token (store only its hash), expires after **14 days**, can be revoked, and logs every download (time, IP). No CPA login or portal (section 20).
* **No attachments:** the ZIP is never attached to email, because it contains financial data and vendor documents.
* **Masked TINs only** in CSV and XLSX. Full TINs appear only inside the W-9 copies in the year-end package; including W-9s requires the Admin to confirm when generating or sending.
* Generation runs as a background job against a consistent database snapshot (single repeatable-read transaction), so the files agree with each other.
* Size: if the ZIP would exceed **500 MB**, build it without `documents/evidence\_packs/` and say so on the summary.
* Every generation, send, download and revocation writes an audit event (R5).

### 23.10 Screens and jobs

* **Month-end screen (13.2 item 14):** add a step "CPA package" with Generate, preview of the month at a glance and tie-out results, Download, Send to CPA, version history with deliveries and downloads, and the change-after-sending banner (23.2).
* **Firm settings (13.3 item 1):** CPA contact and emails, automatic generation day, automatic send, include evidence packs.
* **Parties → sub-vendor detail:** W-9 tax classification and TIN (masked after save).
* **Jobs:** `generate\_cpa\_packages` (daily at 03:00 firm time; acts on firms whose day matches); `build\_cpa\_package` (on demand, queued); `expire\_cpa\_links` (daily).

### 23.11 CPA package golden tests

Scenario for C1–C4, using the seed (18.1). The seed firm is on Professional because Apex uses pay-when-paid; the package output is the same on Essentials.

* October hours: Ravi 176.00 h (E1), Meera 176.00 h (E2), both verified.
* Invoices approved and sent on 2026-11-02: **GLBX-202611-0001** (Ravi, $16,720.00, expected deduction $334.40) and **GLBX-202611-0002** (Meera, $19,360.00, expected deduction $387.20).
* Apex vendor invoice **APX-1009**, dated 2026-11-03, $13,200.00, matched and approved.
* 2026-11-27: Globex pays $16,385.60 by ACH, reference `GLBX-ACH-5521`, applied in full to -0001 (deduction $334.40). Apex line released $13,200.00.
* 2026-11-30: Apex paid $13,200.00 by ACH, reference `PMT-0001`.
* No activity before November (AR and AP at the start of November are $0.00).
* November 2026 locked before the package is generated.

**C1 — November 2026 package contents.**

* File 01: 2 rows, total **$36,080.00**. File 02: 0 rows (header only).
* File 03: 1 row, $16,385.60, applied $16,385.60, unapplied $0.00. File 04: 1 row, applied $16,385.60, deduction $334.40, shortfall $0.00, mode `FULL`, balance after $0.00.
* File 05: 1 row, `DEDUCTION`, "MSP fee", $334.40.
* File 06: 1 row, APX-1009, $13,200.00, unpaid at month end $0.00. File 07: 1 row, $13,200.00.
* File 08: 1 row, GLBX-202611-0002, balance **$19,360.00**, due 2026-12-17, bucket `CURRENT`. File 09: 0 rows.
* Month at a glance: invoiced $36,080.00 (2); cash received $16,385.60 (1); deductions $334.40; shortfalls $0.00; credit memos $0.00; vendor bills $13,200.00; vendor payments $13,200.00; AR at month end **$19,360.00**; AP at month end **$0.00**; unapplied $0.00.
* Not preliminary. File name `CPA\_Package\_<FIRM>\_2026-11\_v1.zip`. `documents/` holds 2 invoice PDFs, `APX-1009` and the remittance advice for `PMT-0001`.

**C2 — Tie-outs.** AR: 0.00 + 36,080.00 − 16,385.60 − 334.40 − 0.00 = **19,360.00** → Ties out. AP: 0.00 + 13,200.00 − 13,200.00 = **0.00** → Ties out. Deposits and vendor payment checks tie out. Then corrupt one application's `applied\_cents` in a test fixture by +$1.00 → the AR check shows "Doesn't tie — difference $1.00" and names GLBX-202611-0001; the package still builds.

**C3 — 1099 file (November 2026, tax year 2026, threshold $2,000.00).**

* Apex classified `C\_CORP` with a W-9 on file → ytd\_paid\_total $13,200.00, ytd\_reportable\_amount $13,200.00, status **`LIKELY\_EXEMPT\_CORPORATION`**.
* Change Apex to `INDIVIDUAL\_SOLE\_PROP\_SMLLC` → **`LIKELY\_REPORTABLE`**.
* Add a $500.00 Apex payment on 2026-11-30 with method `CARD\_OR\_PAYMENT\_APP` (against a separate approved $500.00 bill) → ytd\_paid\_total $13,700.00, ytd\_paid\_by\_card\_or\_app $500.00, ytd\_reportable\_amount **$13,200.00**.
* A second sub-vendor with no W-9 → **`NEEDS\_W9`**. A sub-vendor paid $1,500.00 (individual, W-9 on file) → **`BELOW\_THRESHOLD`**.
* The TIN column shows only the last 4 digits.

**C4 — Regenerate after a change.** After v1 is sent: Admin unlocks November (reason logged), approves credit memo **CM-2026-0001** for $1,000.00 on GLBX-202611-0002 dated 2026-11-20 (reason `HOURS\_CORRECTION`), and locks again. The Month-end screen shows the change-after-sending banner. v2: file 02 has 1 row ($1,000.00); AR at month end **$18,360.00**; AR roll-forward 0.00 + 36,080.00 − 16,385.60 − 334.40 − 1,000.00 = 18,360.00 → Ties out; "Changed since v1" lists: credit memos 0 → 1 ($0.00 → $1,000.00), AR at month end $19,360.00 → $18,360.00. v1 is kept and marked superseded by v2.

**C5 — Preliminary, empty and determinism.**

* Generating December 2026 before it's locked → file names end `\_PRELIM` and the summary says "Preliminary — period not locked."
* Generating a month with no activity → every CSV has a header and no rows; the summary says "No activity recorded in this period."
* Generating the November package twice from the same data → identical CSV bytes and identical sha256 values in the manifest.

**C6 — Delivery and access.** Send to two CPA emails → two delivery rows, links expire 14 days later, no attachment in the email (check Mailpit). Download after expiry → 410 page; revoked link → 410. A Consultant calling the generate or download route → 403. Firm B's session with Firm A's package id → 404 (R3). Every action has an audit event.

**C7 — Year-end package (2026).** Covers 2026-01-01 to 2026-12-31; the 1099 file is at December 31; `documents/w9/` contains each listed sub-vendor's current W-9 only after the Admin confirms; file name `CPA\_Package\_<FIRM>\_2026-YE\_v1.zip`.

\---

## 24\. Google Cloud deployment

This section replaces the generic hosting row in section 3. Infrastructure is defined as code (Terraform in `/infra`) so staging and production are built the same way. Nothing in production is created by hand in the console, except the first billing account and organization setup.

### 24.1 Environments

|Environment|Purpose|Data|External services|
|-|-|-|-|
|**Local**|Development|Seed data (18.1)|docker-compose: Postgres, MinIO, Mailpit, ClamAV (section 4); AI calls mocked or sent to the staging project|
|**Staging**|Every merge to `main` deploys here; demos; pilot rehearsals|Seed and synthetic data only. **Never copy production data into staging**|QBO **sandbox**, Stripe **test mode**, a separate Postmark server and inbound domain, Vertex AI in the staging project|
|**Production**|Customers|Real firm data|QBO production app, Stripe live mode, production Postmark server and inbound domain, Vertex AI in the production project|

Domains (example): `app.<domain>` (production), `staging.<domain>` (staging); inbound email `inbound.<domain>` and `inbound.staging.<domain>`.

### 24.2 Projects and region

* Three Google Cloud projects under one organization and billing account:

  * `<name>-shared`: Artifact Registry (container images), Terraform state bucket, CI identity.
  * `<name>-staging`
  * `<name>-prod`
* **Region:** `us-south1` (Dallas) for all regional resources. Before running Terraform, confirm that Cloud Run worker pools, the chosen Cloud SQL edition and the chosen Gemini model are offered in `us-south1`. If any isn't, use `us-central1` (Iowa) for **all** resources, not a mix.
* All customer data stays in US locations.

### 24.3 Services per environment

|Component|Google service|Staging|Production|
|-|-|-|-|
|Web app (Next.js)|Cloud Run **service** `web`|min 0, max 3 instances; 1 vCPU, 1 GiB|min 1, max 10; 2 vCPU, 2 GiB; startup CPU boost|
|Background jobs (pg-boss)|Cloud Run **worker pool** `worker`|1 instance; 1 vCPU, 2 GiB|1–3 instances; 2 vCPU, 4 GiB (headless Chrome for PDFs, CPA package ZIPs)|
|Virus scan|Cloud Run service `clamav`, **internal ingress only**|min 1; 1 vCPU, 3 GiB|min 1, max 3; 2 vCPU, 4 GiB|
|Database migrations|Cloud Run **job** `migrate`|Runs before each deploy|Runs before each deploy|
|Database|**Cloud SQL for PostgreSQL 16**, Enterprise edition, private IP only|Single zone; smallest dedicated-core tier|**High availability (regional)**; 2 vCPU, 8 GB to start; storage auto-increase on|
|Files|**Cloud Storage** bucket `files`|Regional|Location `US` (multi-region), so files survive a regional outage|
|CPA packages and exports|Bucket `exports`|Regional; objects deleted after 30 days|Regional; objects deleted after 400 days (packages stay re-generatable)|
|Database exports (DR)|Bucket `db-exports` in a **different region** (24.6)|Not used|`us-central1` if the app runs in `us-south1` (or the reverse); retention lock|
|Secrets|**Secret Manager**|Per project|Per project|
|Encryption keys for R11|**Cloud KMS** key ring `app`|1 key|1 key, 90-day automatic rotation|
|AI extraction|**Gemini on Vertex AI** via service account (no API keys)|Same model as prod|Data retention settings per 24.9|
|Ingress|Global external Application Load Balancer + Google-managed certificate + **Cloud Armor**|Same|Same; rate-limit rules on `/api/auth/\*`, upload and inbound-email routes (section 17)|
|Email|Postmark (not Google)|Separate server|Separate server|
|Payments|Stripe (not Google)|Test mode|Live mode|

Networking:

* One VPC per environment. Cloud Run `web`, `worker` and `migrate` reach Cloud SQL over **Direct VPC egress to a private IP** ([Cloud SQL: connect from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-run)). Cloud SQL has no public IP.
* `clamav` accepts internal traffic only; only `web` and `worker` may call it (IAM invoker role).
* Postmark and Stripe webhooks reach `web` through the load balancer and are verified by signature (section 16).

Storage adapter: implement `packages/integrations/storage` with the **native Cloud Storage client** using the service account's identity in staging and production, and keep the S3 adapter for local MinIO. Don't create long-lived HMAC keys.

### 24.4 Identity and access

|Service account|Used by|Roles (least privilege, per project)|
|-|-|-|
|`sa-web`|`web`|Cloud SQL Client; Storage Object User on `files` and `exports`; Secret Manager Secret Accessor (named secrets only); KMS Encrypter/Decrypter on `app` key; Run Invoker on `clamav`; Vertex AI User; Log Writer; Monitoring Metric Writer|
|`sa-worker`|`worker`|Same as `sa-web`|
|`sa-migrate`|`migrate` job|Cloud SQL Client; Secret Accessor (database secret only)|
|`sa-deployer`|GitHub Actions via **Workload Identity Federation** (no key files)|Artifact Registry Writer (shared); Run Admin; Service Account User on the three runtime accounts|
|`sa-backup`|Scheduled DB export (24.6)|Cloud SQL Viewer + export permission; Storage Object Creator on `db-exports` only|

* People get access through Google groups (`eng-admins`, `eng-readonly`), not individual grants. Production data access requires the admin group and is logged with Cloud Audit Logs (Data Access logs on for Cloud SQL, Cloud Storage, Secret Manager and KMS).
* No service account keys anywhere. GitHub authenticates with Workload Identity Federation ([Google Cloud blog](https://cloud.google.com/blog/products/devops-sre/deploy-to-cloud-run-with-github-actions/)).

### 24.5 Configuration and secrets

Environment variables set on Cloud Run (non-secret): `APP\_ENV` (`staging`/`production`), `APP\_BASE\_URL`, `GCP\_PROJECT`, `GCP\_REGION`, `FILES\_BUCKET`, `EXPORTS\_BUCKET`, `KMS\_KEY\_NAME`, `CLAMAV\_URL`, `VERTEX\_MODEL`, `QBO\_ENVIRONMENT` (`sandbox`/`production`), `LOG\_LEVEL`.

Secrets in Secret Manager (mounted as env vars, pinned to a version, never in code or images, R11): `DATABASE\_URL`, `AUTH\_SECRET`, `POSTMARK\_SERVER\_TOKEN`, `POSTMARK\_INBOUND\_WEBHOOK\_SECRET`, `STRIPE\_SECRET\_KEY`, `STRIPE\_WEBHOOK\_SECRET`, `QBO\_CLIENT\_ID`, `QBO\_CLIENT\_SECRET`, `SENTRY\_DSN` (if Sentry is kept).

Application-level encryption (R11): envelope encryption. A data key per firm is encrypted with the Cloud KMS `app` key and stored in the database; the app decrypts it through KMS and caches it in memory briefly. Key rotation re-wraps data keys without re-encrypting all data.

### 24.6 Backups and recovery

**Targets**

* Database: lose at most **5 minutes** of data for in-region problems (point-in-time recovery), and at most **24 hours** if the whole region is lost.
* Service restored within **4 hours** for in-region problems, **1 business day** for a regional outage.

**Database (production)**

* **Point-in-time recovery on, 7 days of logs** (the maximum on Enterprise edition; Enterprise Plus allows up to 35) ([Cloud SQL PITR](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/configure-pitr)).
* **Enhanced backups** stored in a backup vault: daily, kept 35 days; monthly, kept 13 months. The vault's backups are immutable and independent of the project ([Cloud SQL backup options](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/backup-options)).
* Final backup on instance deletion: on, kept 365 days. **Deletion protection** on the instance.
* **Cross-region copy:** enhanced backups don't support cross-region restore, so a nightly scheduled job (Cloud Scheduler → Cloud Run job as `sa-backup`) runs a Cloud SQL export of the full database to `db-exports` in the other US region. That bucket has a **locked retention policy of 400 days** and object versioning, so exports can't be deleted early, even by an admin.
* Staging: automated daily backups, 7 days; PITR off; no exports.

**Files (production)**

* `files` bucket: location `US` (multi-region), **object versioning on**, **soft delete 30 days** (allowed range 7–90 days; [Cloud Storage soft delete](https://docs.cloud.google.com/storage/docs/soft-delete)), uniform bucket-level access, public access prevention enforced.
* The app never overwrites or deletes evidence or invoice files (R4); versioning and soft delete protect against mistakes and bad code.
* Lifecycle: noncurrent versions deleted after 90 days.

**Retention of financial records**

* Database rows follow the firm's chosen retention period (section 17). Backups expire on the schedule above; they don't replace the firm's own exports (CPA packages, section 23, and the full data export in section 17).

**Runbooks** (store in `/docs/runbooks/`, written in M8):

1. **Restore the database to a point in time:** clone to a new instance at the chosen time → run integrity checks (row counts, latest invoice numbers, `audit\_event` max timestamp) → put the app in maintenance mode → switch the `DATABASE\_URL` secret to a new version → redeploy `web` and `worker` → leave the old instance stopped for 7 days, then delete.
2. **Recover a deleted or overwritten file:** restore the noncurrent version or the soft-deleted object; log the action.
3. **Regional outage:** create a Cloud SQL instance in the other region from the latest export in `db-exports` → deploy `web`, `worker` and `clamav` there from the same image digests (Terraform variable `region`) → point the load balancer at the new backends → tell firms that up to 24 hours of entries may need re-entry, and show them the last-restored timestamp.
4. **Leaked secret:** add a new secret version → redeploy → revoke the old credential at the provider (Postmark, Stripe, Intuit) → review audit logs.
5. **QuickBooks tokens failing for many firms:** pause `qbo\_sync\_worker`, check the Intuit status page and app credentials, resume; jobs are idempotent (R7).

**Restore drill:** every quarter, restore production to a **temporary isolated instance in the production project** (never staging), run the integrity checks, record the time taken against the 4-hour target in `/docs/runbooks/restore-log.md`, then delete the instance. The first drill is an M8 acceptance item.

### 24.7 Build, deploy and rollback

Pipeline (GitHub Actions, authenticating with Workload Identity Federation):

1. **Pull request:** typecheck, lint, unit and integration tests (R9), Terraform `plan` for changed infra. No deploy.
2. **Merge to `main`:**

   * build the image **once**, tagged with the git SHA, and push it to Artifact Registry (shared project)
   * vulnerability scan: block on critical findings
   * deploy to **staging**: run the `migrate` job, deploy `web` and `worker`, then run Playwright smoke tests against staging (sign in, upload a screenshot, generate a draft invoice)
3. **Release to production** (manual approval in GitHub):

   * promote the **same image digest** (never rebuild)
   * run the `migrate` job
   * deploy `web` as a new revision with **no traffic**, run smoke tests against its tagged URL, then shift 100% of traffic
   * update `worker`
4. **Rollback:** shift traffic back to the previous `web` revision and redeploy the previous `worker` image digest. This works because migrations are **backward-compatible** (expand, then contract): add columns and tables first; remove or rename only in a later release after no running code uses them. A migration that can't be rolled back needs a written plan in the PR.

Other rules:

* Deploys to production only on business days, not after 3 p.m. Central, except for urgent fixes.
* `worker` finishes in-flight jobs on shutdown (pg-boss graceful stop, up to the Cloud Run termination grace period); jobs are idempotent (R7), so a killed job is safe to retry.
* Terraform applies to production also require manual approval.

### 24.8 Monitoring and alerting

**Health endpoints** (add to section 16):

* `GET /api/health`: process up; used by the load balancer.
* `GET /api/health/deep`: database query, storage write/read of a probe object, KMS decrypt of a test value, ClamAV ping, job queue reachable. Requires an internal token; used by uptime checks.
* The worker writes a heartbeat log line every 60 seconds (`event = "worker.heartbeat"`).

**Logs:** structured JSON (pino) to Cloud Logging with `firm\_id`, `user\_id`, `request\_id`, `job\_name`, `job\_id` fields. Never log tokens, bank details, TINs or document text (section 17). Log-based metrics for the job and integration events below.

**Errors:** Cloud Error Reporting for both services (Sentry MAY be used instead; pick one).

**Alert policies (production; staging gets the same with email-only notifications):**

|Alert|Condition|Severity|
|-|-|-|
|Site down|Uptime check on `/api/health` fails from 2+ locations for 2 minutes|Page|
|Deep health failing|`/api/health/deep` fails for 5 minutes|Page|
|Server errors|5xx rate > 2% of requests over 5 minutes|Page|
|Slow|p95 latency > 2 seconds for 10 minutes|Warn|
|Worker stopped|No `worker.heartbeat` for 5 minutes|Page|
|Jobs backing up|Oldest pending job > 15 minutes, or failed jobs > 20 in an hour|Warn|
|QuickBooks sync failing|Sync jobs FAILED > 10 in an hour, or any firm `NEEDS\_RECONNECT`|Warn|
|AI extraction failing|Extraction failure rate > 10% over an hour, or provider errors > 20 in 15 minutes|Warn|
|Inbound email|No inbound webhook calls for 24 hours on a business day, or webhook signature failures > 5 in an hour|Warn|
|Stripe webhooks|Signature failures or processing errors > 3 in an hour; monthly billing job not completed by 06:00 on the 1st|Warn|
|Database|CPU > 80% for 15 minutes; storage > 80%; connections > 80% of max; replication or failover event|Warn (failover: Page)|
|Backups|Cloud SQL backup failed; nightly export to `db-exports` missing|Page|
|Security|IAM policy change in prod; Secret Manager access by a person; Cloud Armor blocking > 1,000 requests in 5 minutes|Warn|
|Certificate|Managed certificate not active|Warn|
|Budget|Monthly spend reaches 50%, 90%, 100% of budget (per project)|Email|

Notification channels: email to the engineering group; a phone or SMS channel for "Page" alerts; optional Slack.

**Dashboards:** one per environment with request rate, errors, latency, instance counts, Cloud SQL CPU, memory, storage and connections, job queue depth and age, extraction volume and cost (from `ai\_usage\_event`), QBO sync success rate, and backup status.

**Status page:** a simple external status page (any hosted provider) updated during incidents; link it from the app's footer.

### 24.9 AI data handling on Vertex AI

* Call Gemini through Vertex AI in the same project and region as the app, using `sa-worker`. Google states that Vertex AI customer data isn't used to train its models ([Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/gemini-support-on-vertex-ai)).
* Configure the project for **zero data retention** as described in Google's documentation ([Vertex AI zero data retention](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention?authuser=31)), and record the settings on the trust page (section 17).
* Keep the provider behind the `Extractor` interface (8.1) so another model can be swapped in.

### 24.10 Cost controls

* Budgets and alerts per project (24.8). Staging `web` scales to zero; staging Cloud SQL uses the smallest dedicated tier.
* Always-on costs in production: Cloud SQL (HA doubles the instance cost), `web` min 1, `worker` 1, `clamav` 1, load balancer. Price these with the Google Cloud pricing calculator before launch and review monthly.
* Track AI cost per firm from `ai\_usage\_event.provider\_cost\_cents` against the allowance in section 22.4.
* Apply for Google for Startups credits if eligible; the setup doesn't change either way.

### 24.11 Delivery in the milestones

|Milestone|Deployment work|
|-|-|
|**M0**|`/infra` Terraform for shared and staging projects; Artifact Registry; Workload Identity Federation; CI pipeline steps 1–2; staging `web`, `worker`, `clamav`, `migrate`, Cloud SQL, buckets, Secret Manager, KMS; `/api/health`; structured logging|
|**M2**|Vertex AI in staging (24.9); extraction metrics|
|**M6**|QBO sandbox credentials in staging secrets; sync alerts|
|**M8**|Production project via the same Terraform; HA Cloud SQL, PITR, enhanced backups, nightly cross-region export, file bucket protections; Cloud Armor rules; full alert policies and dashboards; runbooks; **first restore drill**; production release step with manual approval|
|**M9**|Stripe live mode secrets; billing job alert|

**Acceptance for deployment (end of M8):**

* Staging and production are created from the same Terraform with only variables differing; `terraform plan` on production shows no drift.
* A merge to `main` reaches staging automatically and passes smoke tests; a production release promotes the same image digest after approval.
* Rolling back `web` to the previous revision takes under 5 minutes.
* Cloud SQL has no public IP; `clamav` isn't reachable from the internet; no service account keys exist (`gcloud iam service-accounts keys list` shows only Google-managed keys).
* Every alert in 24.8 has fired once in staging through a test (e.g. stop the worker, fail a deep health check) and reached the right channel.
* The restore drill restores production to a point in time in under 4 hours, and the nightly export exists in the other region.
* A deleted test file in `files` is recovered from soft delete.

