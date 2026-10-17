/**
 * Database schema for M0 (section 5.1 plus the auth tables approved for M0).
 *
 * Conventions (section 5):
 *  - every table has id UUID PK, created_at, updated_at, created_by
 *  - tenant tables have firm_id UUID NOT NULL with an index and a row-level-security policy
 *    (policies live in migrations/0001_rls.sql)
 *  - timestamps are timestamptz (R12); money would be BIGINT cents (R1) — none in M0
 */
import {
  bigint,
  boolean,
  date,
  numeric,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// enums
// ---------------------------------------------------------------------------
export const weekStartEnum = pgEnum("week_start", ["MON", "SUN"]);
export const invoiceSeqResetEnum = pgEnum("invoice_seq_reset", ["NEVER", "YEARLY", "MONTHLY"]);
export const userStatusEnum = pgEnum("user_status", ["INVITED", "ACTIVE", "DISABLED"]);
export const roleEnum = pgEnum("role", ["ADMIN", "MANAGER", "FINANCE", "CONSULTANT"]);
export const scanStatusEnum = pgEnum("scan_status", ["PENDING", "CLEAN", "INFECTED"]);
export const fileSourceEnum = pgEnum("file_source", ["UPLOAD", "EMAIL", "SYSTEM"]);

// ---------------------------------------------------------------------------
// shared columns
// ---------------------------------------------------------------------------
const id = () => uuid("id").primaryKey().defaultRandom();
const tsCols = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: uuid("created_by"),
});

// ---------------------------------------------------------------------------
// 5.1 Tenancy and users
// ---------------------------------------------------------------------------
export const firm = pgTable("firm", {
  id: id(),
  ...tsCols(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  /** Encrypted with the firm's data key (R11). */
  ein: text("ein"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country").notNull().default("US"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  logoFileId: uuid("logo_file_id"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  weekStart: weekStartEnum("week_start").notNull().default("MON"),
  defaultPaymentTermsDays: integer("default_payment_terms_days").notNull().default(30),
  remitToText: text("remit_to_text"),
  invoiceNumberPattern: text("invoice_number_pattern")
    .notNull()
    .default("{CLIENT}-{YYYY}{MM}-{SEQ:4}"),
  invoiceSeqReset: invoiceSeqResetEnum("invoice_seq_reset").notNull().default("YEARLY"),
  timesheetInboxAddress: text("timesheet_inbox_address").notNull().unique(),
  apInboxAddress: text("ap_inbox_address").notNull().unique(),
  matchToleranceCents: integer("match_tolerance_cents").notNull().default(100),
  deductionToleranceCents: integer("deduction_tolerance_cents").notNull().default(100),
  /** Section 9 "Auto-reply (configurable)" for the timesheet inbox. Approved M2 addition. */
  timesheetAutoReply: boolean("timesheet_auto_reply").notNull().default(true),
  /** Per-firm data key, wrapped by the KMS `app` key (section 24.5). Approved M0 addition. */
  wrappedDataKey: text("wrapped_data_key").notNull(),
});

/** `user` is reserved in Postgres, so the table is `app_user`. */
export const appUser = pgTable(
  "app_user",
  {
    id: id(),
    ...tsCols(),
    /** Stored lower-cased and trimmed. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    /** TOTP secret, encrypted with the platform key (R11). */
    mfaSecret: text("mfa_secret"),
    /** Set when TOTP enrolment is confirmed. Approved M0 addition. */
    mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
    status: userStatusEnum("status").notNull().default("INVITED"),
  },
  (t) => [uniqueIndex("app_user_email_key").on(t.email)],
);

export const membership = pgTable(
  "membership",
  {
    id: id(),
    ...tsCols(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firm.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    role: roleEnum("role").notNull(),
    /** Required when role = CONSULTANT (section 5.1). FK and CHECK added in migration 0003. */
    consultantId: uuid("consultant_id"),
    /**
     * "Disable" on Users and roles (13.3 item 2) is per firm: app_user.status is global, and one
     * firm's Admin must not lock a user out of another firm. M1 addition.
     */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    /** "Require MFA" for a Manager or Consultant in this firm (13.3 item 2). M1 addition. */
    mfaRequired: boolean("mfa_required").notNull().default(false),
  },
  (t) => [
    index("membership_firm_id_idx").on(t.firmId),
    index("membership_user_id_idx").on(t.userId),
    uniqueIndex("membership_firm_user_key").on(t.firmId, t.userId),
  ],
);

export const auditEvent = pgTable(
  "audit_event",
  {
    id: id(),
    ...tsCols(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firm.id),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("audit_event_firm_id_idx").on(t.firmId),
    index("audit_event_entity_idx").on(t.firmId, t.entityType, t.entityId),
  ],
);

export const file = pgTable(
  "file",
  {
    id: id(),
    ...tsCols(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firm.id),
    storageKey: text("storage_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    perceptualHash: text("perceptual_hash"),
    scanStatus: scanStatusEnum("scan_status").notNull().default("PENDING"),
    uploadedBy: uuid("uploaded_by").references(() => appUser.id),
    source: fileSourceEnum("source").notNull().default("UPLOAD"),
  },
  (t) => [index("file_firm_id_idx").on(t.firmId)],
);

// ---------------------------------------------------------------------------
// Auth tables (approved M0 additions)
// ---------------------------------------------------------------------------
export const invitation = pgTable(
  "invitation",
  {
    id: id(),
    ...tsCols(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firm.id),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    /** sha256 of the token; the token itself only exists in the invite link. */
    tokenHash: text("token_hash").notNull().unique(),
    /** The consultant record a CONSULTANT invitation links to (copied to membership on accept). */
    consultantId: uuid("consultant_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => appUser.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("invitation_firm_id_idx").on(t.firmId)],
);

export const session = pgTable(
  "session",
  {
    id: id(),
    ...tsCols(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    /** sha256 of the cookie value. */
    tokenHash: text("token_hash").notNull().unique(),
    /** The firm the user is acting in; switchFirm changes it. */
    activeFirmId: uuid("active_firm_id").references(() => firm.id),
    /** Set when the user passed TOTP in this session. */
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const verificationToken = pgTable(
  "verification_token",
  {
    /** Lower-cased email the magic link was sent to. */
    identifier: text("identifier").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.tokenHash] })],
);

export const mfaRecoveryCode = pgTable(
  "mfa_recovery_code",
  {
    id: id(),
    ...tsCols(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("mfa_recovery_code_user_id_idx").on(t.userId)],
);

export const rateLimit = pgTable(
  "rate_limit",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// ---------------------------------------------------------------------------
// 5.2 Parties
// ---------------------------------------------------------------------------
export const partyKindEnum = pgEnum("party_kind", ["PRIME_VENDOR", "IMPLEMENTATION_PARTNER", "END_CLIENT", "SUB_VENDOR", "FACTOR"]);
export const invoiceLayoutEnum = pgEnum("invoice_layout", ["PER_CONSULTANT", "COMBINED"]);
export const deliveryMethodEnum = pgEnum("delivery_method", ["EMAIL", "PORTAL"]);
export const vendorPayTermsEnum = pgEnum("vendor_pay_terms", ["NET", "PAY_WHEN_PAID"]);
export const w9TaxClassificationEnum = pgEnum("w9_tax_classification", [
  "INDIVIDUAL_SOLE_PROP_SMLLC",
  "C_CORP",
  "S_CORP",
  "PARTNERSHIP",
  "TRUST_ESTATE",
  "LLC_C",
  "LLC_S",
  "LLC_P",
  "OTHER",
  "UNKNOWN",
]);
export const tinTypeEnum = pgEnum("tin_type", ["EIN", "SSN"]);
export const partyDocTypeEnum = pgEnum("party_doc_type", ["W9", "COI", "MSA", "WORK_ORDER", "OTHER"]);

const firmRef = () =>
  uuid("firm_id")
    .notNull()
    .references(() => firm.id);
const archivedAt = () => timestamp("archived_at", { withTimezone: true });

export const party = pgTable(
  "party",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    kind: partyKindEnum("kind").notNull(),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    /** Short code for invoice numbers ({CLIENT}); unique per firm. */
    code: text("code"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("US"),
    phone: text("phone"),
    apEmails: text("ap_emails").array().notNull().default([]),
    arEmails: text("ar_emails").array().notNull().default([]),
    paymentTermsDays: integer("payment_terms_days"),
    paysWhenPaidUpstream: boolean("pays_when_paid_upstream").notNull().default(false),
    upstreamBufferDays: integer("upstream_buffer_days").notNull().default(15),
    standardDeductionBps: integer("standard_deduction_bps"),
    deductionLabel: text("deduction_label"),
    invoiceLayout: invoiceLayoutEnum("invoice_layout").notNull().default("PER_CONSULTANT"),
    deliveryMethod: deliveryMethodEnum("delivery_method").notNull().default("EMAIL"),
    backupRequired: boolean("backup_required").notNull().default(false),
    poRequired: boolean("po_required").notNull().default(false),
    timesheetConfirmEmail: text("timesheet_confirm_email"),
    vendorPayTerms: vendorPayTermsEnum("vendor_pay_terms"),
    vendorNetDays: integer("vendor_net_days"),
    /** Encrypted with the firm's data key (R11). Sub-vendors only. */
    remitDetails: text("remit_details"),
    qboCustomerId: text("qbo_customer_id"),
    qboVendorId: text("qbo_vendor_id"),
    /** Section 23.8 (sub-vendors). */
    w9TaxClassification: w9TaxClassificationEnum("w9_tax_classification").notNull().default("UNKNOWN"),
    /** Encrypted with the firm's data key (R11). */
    tin: text("tin"),
    tinType: tinTypeEnum("tin_type"),
    archivedAt: archivedAt(),
  },
  (t) => [
    index("party_firm_id_idx").on(t.firmId),
    uniqueIndex("party_firm_code_key").on(t.firmId, t.code),
  ],
);

export const partyContact = pgTable(
  "party_contact",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    roleLabel: text("role_label"),
    archivedAt: archivedAt(),
  },
  (t) => [index("party_contact_firm_id_idx").on(t.firmId), index("party_contact_party_idx").on(t.partyId)],
);

export const partyDocument = pgTable(
  "party_document",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id),
    docType: partyDocTypeEnum("doc_type").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => file.id),
    effectiveDate: date("effective_date", { mode: "string" }),
    expiryDate: date("expiry_date", { mode: "string" }),
    requiredForPayment: boolean("required_for_payment").notNull().default(false),
    archivedAt: archivedAt(),
  },
  (t) => [index("party_document_firm_id_idx").on(t.firmId), index("party_document_party_idx").on(t.partyId)],
);

// ---------------------------------------------------------------------------
// 5.3 Consultants and engagements
// ---------------------------------------------------------------------------
export const employmentTypeEnum = pgEnum("employment_type", ["W2", "CONTRACTOR"]);
export const consultantStatusEnum = pgEnum("consultant_status", ["ACTIVE", "INACTIVE"]);
export const cycleEnum = pgEnum("cycle", ["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"]);
export const engagementStatusEnum = pgEnum("engagement_status", ["DRAFT", "ACTIVE", "ENDED"]);
export const rateSideEnum = pgEnum("rate_side", ["BILL", "PAY"]);
export const rateKindEnum = pgEnum("rate_kind", ["REGULAR", "OVERTIME", "HOLIDAY"]);

export const consultant = pgTable(
  "consultant",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** Every address they may send timesheets from; unique per firm (trigger in 0003). */
    emails: text("emails").array().notNull().default([]),
    phone: text("phone"),
    employmentType: employmentTypeEnum("employment_type").notNull(),
    subVendorPartyId: uuid("sub_vendor_party_id").references(() => party.id),
    workAuthType: text("work_auth_type"),
    workAuthExpiry: date("work_auth_expiry", { mode: "string" }),
    status: consultantStatusEnum("status").notNull().default("ACTIVE"),
    archivedAt: archivedAt(),
  },
  (t) => [index("consultant_firm_id_idx").on(t.firmId)],
);

export const engagement = pgTable(
  "engagement",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    consultantId: uuid("consultant_id")
      .notNull()
      .references(() => consultant.id),
    billToPartyId: uuid("bill_to_party_id")
      .notNull()
      .references(() => party.id),
    endClientPartyId: uuid("end_client_party_id")
      .notNull()
      .references(() => party.id),
    primePartyId: uuid("prime_party_id").references(() => party.id),
    implementationPartnerPartyId: uuid("implementation_partner_party_id").references(() => party.id),
    projectName: text("project_name"),
    roleTitle: text("role_title"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    timesheetCycle: cycleEnum("timesheet_cycle").notNull(),
    biweeklyAnchorDate: date("biweekly_anchor_date", { mode: "string" }),
    invoiceCycle: cycleEnum("invoice_cycle").notNull(),
    evidenceRequired: boolean("evidence_required").notNull().default(true),
    expectedWeeklyHours: numeric("expected_weekly_hours", { precision: 5, scale: 2 }).notNull().default("40"),
    maxWeeklyHoursWarning: numeric("max_weekly_hours_warning", { precision: 5, scale: 2 }).notNull().default("50"),
    deductionBpsOverride: integer("deduction_bps_override"),
    factored: boolean("factored").notNull().default(false),
    primeWorkOrderNo: text("prime_work_order_no"),
    primeConsultantRef: text("prime_consultant_ref"),
    endClientWorkerRef: text("end_client_worker_ref"),
    status: engagementStatusEnum("status").notNull().default("DRAFT"),
  },
  (t) => [index("engagement_firm_id_idx").on(t.firmId), index("engagement_consultant_idx").on(t.consultantId)],
);

/** Effective-dated; no overlaps per (engagement, side, rate_kind) — exclusion constraint in 0003. */
export const rate = pgTable(
  "rate",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagement.id),
    side: rateSideEnum("side").notNull(),
    rateKind: rateKindEnum("rate_kind").notNull().default("REGULAR"),
    rateCents: integer("rate_cents").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    /** Inclusive; null = open-ended. */
    effectiveTo: date("effective_to", { mode: "string" }),
  },
  (t) => [index("rate_firm_id_idx").on(t.firmId), index("rate_engagement_idx").on(t.engagementId)],
);

export const purchaseOrder = pgTable(
  "purchase_order",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagement.id),
    poNumber: text("po_number").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    alertThresholdsBps: integer("alert_thresholds_bps").array().notNull().default([7500, 9000, 10000]),
  },
  (t) => [index("purchase_order_firm_id_idx").on(t.firmId), index("purchase_order_engagement_idx").on(t.engagementId)],
);

/** Firm holiday calendar (13.3 item 1; approved M1 addition). */
export const firmHoliday = pgTable(
  "firm_holiday",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    holidayDate: date("holiday_date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("firm_holiday_firm_date_key").on(t.firmId, t.holidayDate)],
);

// ---------------------------------------------------------------------------
// 5.4 Timesheets and evidence (M2)
// ---------------------------------------------------------------------------
export const timesheetStatusEnum = pgEnum("timesheet_status", [
  "NOT_STARTED",
  "DRAFT",
  "SUBMITTED",
  "NEEDS_REVIEW",
  "VERIFIED",
  "RETURNED",
  "INVOICED",
]);
export const evidenceSourceEnum = pgEnum("evidence_source", [
  "CONSULTANT_UPLOAD",
  "EMAIL",
  "BULK_UPLOAD",
  "PRIME_CONFIRMATION",
  "APPROVER_LINK",
]);
export const extractionStatusEnum = pgEnum("extraction_status", ["QUEUED", "RUNNING", "DONE", "FAILED"]);
export const checkSeverityEnum = pgEnum("check_severity", ["BLOCK", "WARN", "INFO"]);
export const checkCodeEnum = pgEnum("check_code", [
  "NO_EVIDENCE",
  "EXTRACTION_PENDING",
  "HOURS_MISMATCH",
  "PERIOD_MISMATCH",
  "NOT_APPROVED",
  "NAME_MISMATCH",
  "LOW_CONFIDENCE",
  "DUPLICATE_EVIDENCE",
  "OUTSIDE_ENGAGEMENT",
  "NO_RATE",
  "HOLIDAY_HOURS",
  "HIGH_HOURS",
  "PO_EXCEEDED",
  "RATE_CHANGE_IN_PERIOD",
]);
export const inboxEnum = pgEnum("inbox", ["TIMESHEET", "AP"]);
export const inboundEmailStatusEnum = pgEnum("inbound_email_status", ["RECEIVED", "PROCESSED", "UNMATCHED", "REJECTED"]);
export const documentKindEnum = pgEnum("document_kind", ["TIMESHEET", "VENDOR_INVOICE", "REMITTANCE"]);
export const nonBillableReasonEnum = pgEnum("non_billable_reason", [
  "VALIDATION_RETRY",
  "PROVIDER_ERROR",
  "DUPLICATE",
  "SCAN_REJECTED",
]);
export const notificationChannelEnum = pgEnum("notification_channel", ["IN_APP", "EMAIL"]);

export const timesheet = pgTable(
  "timesheet",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagement.id),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    status: timesheetStatusEnum("status").notNull().default("NOT_STARTED"),
    totalHours: numeric("total_hours", { precision: 7, scale: 2 }).notNull().default("0"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => appUser.id),
    returnedReason: text("returned_reason"),
    /** Set when invoiced (M3 adds the FK to invoice). */
    invoiceId: uuid("invoice_id"),
  },
  (t) => [
    index("timesheet_firm_id_idx").on(t.firmId),
    uniqueIndex("timesheet_engagement_period_key").on(t.engagementId, t.periodStart),
  ],
);

export const timesheetEntry = pgTable(
  "timesheet_entry",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    timesheetId: uuid("timesheet_id")
      .notNull()
      .references(() => timesheet.id),
    workDate: date("work_date", { mode: "string" }).notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    rateKind: rateKindEnum("rate_kind").notNull().default("REGULAR"),
    note: text("note"),
  },
  (t) => [
    index("timesheet_entry_firm_id_idx").on(t.firmId),
    uniqueIndex("timesheet_entry_day_kind_key").on(t.timesheetId, t.workDate, t.rateKind),
  ],
);

export const extraction = pgTable(
  "extraction",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => file.id),
    status: extractionStatusEnum("status").notNull().default("QUEUED"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    /** Every raw provider response, plus the page count (8.1 "store the raw response"). */
    rawJson: jsonb("raw_json"),
    /** The Zod-validated proposal (8.2). Never applied to records directly. */
    resultJson: jsonb("result_json"),
    overallConfidence: numeric("overall_confidence", { precision: 3, scale: 2 }),
    error: text("error"),
    costCents: integer("cost_cents"),
  },
  (t) => [index("extraction_firm_id_idx").on(t.firmId), index("extraction_file_idx").on(t.fileId)],
);

export const inboundEmail = pgTable(
  "inbound_email",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    inbox: inboxEnum("inbox").notNull(),
    messageId: text("message_id").notNull(),
    fromAddress: text("from_address").notNull(),
    subject: text("subject"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    rawStorageKey: text("raw_storage_key").notNull(),
    status: inboundEmailStatusEnum("status").notNull().default("RECEIVED"),
    /** Why it was rejected or left unmatched (shown in the unmatched queue). Approved M2 addition. */
    statusReason: text("status_reason"),
    matchedConsultantId: uuid("matched_consultant_id").references(() => consultant.id),
    matchedPartyId: uuid("matched_party_id").references(() => party.id),
  },
  (t) => [
    index("inbound_email_firm_id_idx").on(t.firmId),
    // Section 9 de-duplicates by Message-ID; per firm and inbox, so one email sent to two firms reaches both.
    uniqueIndex("inbound_email_message_key").on(t.firmId, t.inbox, t.messageId),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    /** Null while the evidence waits in the unmatched queue. */
    timesheetId: uuid("timesheet_id").references(() => timesheet.id),
    fileId: uuid("file_id")
      .notNull()
      .references(() => file.id),
    source: evidenceSourceEnum("source").notNull(),
    extractionId: uuid("extraction_id").references(() => extraction.id),
    /** The email it arrived in, for the unmatched queue. Approved M2 addition. */
    inboundEmailId: uuid("inbound_email_id").references(() => inboundEmail.id),
    /** The consultant it was matched to before a timesheet was found (8.6 step 1). Approved M2 addition. */
    consultantId: uuid("consultant_id").references(() => consultant.id),
  },
  (t) => [
    index("evidence_firm_id_idx").on(t.firmId),
    index("evidence_timesheet_idx").on(t.timesheetId),
    uniqueIndex("evidence_file_key").on(t.fileId),
  ],
);

export const timesheetCheck = pgTable(
  "timesheet_check",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    timesheetId: uuid("timesheet_id")
      .notNull()
      .references(() => timesheet.id),
    checkCode: checkCodeEnum("check_code").notNull(),
    severity: checkSeverityEnum("severity").notNull(),
    message: text("message").notNull(),
    resolvedBy: uuid("resolved_by").references(() => appUser.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionReason: text("resolution_reason"),
  },
  (t) => [
    index("timesheet_check_firm_id_idx").on(t.firmId),
    uniqueIndex("timesheet_check_code_key").on(t.timesheetId, t.checkCode),
  ],
);

/** Section 22.4/22.7. Recorded from M2; the allowance is enforced in M9. */
export const aiUsageEvent = pgTable(
  "ai_usage_event",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    extractionId: uuid("extraction_id").references(() => extraction.id),
    fileId: uuid("file_id")
      .notNull()
      .references(() => file.id),
    documentKind: documentKindEnum("document_kind").notNull(),
    pages: integer("pages").notNull(),
    billable: boolean("billable").notNull(),
    nonBillableReason: nonBillableReasonEnum("non_billable_reason"),
    /** First day of the month in the firm's time zone. */
    usageMonth: date("usage_month", { mode: "string" }).notNull(),
    providerCostCents: integer("provider_cost_cents"),
  },
  (t) => [index("ai_usage_event_firm_month_idx").on(t.firmId, t.usageMonth)],
);

/** Section 5.9. */
export const notification = pgTable(
  "notification",
  {
    id: id(),
    ...tsCols(),
    firmId: firmRef(),
    userId: uuid("user_id").references(() => appUser.id),
    toEmail: text("to_email"),
    type: text("type").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    channel: notificationChannelEnum("channel").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull().unique(),
  },
  (t) => [index("notification_firm_id_idx").on(t.firmId)],
);

/** Tenant-owned tables: `firm` itself plus every table with firm_id. A test checks RLS on each. */
export const TENANT_TABLES = [
  "firm",
  "membership",
  "audit_event",
  "file",
  "invitation",
  "party",
  "party_contact",
  "party_document",
  "consultant",
  "engagement",
  "rate",
  "purchase_order",
  "firm_holiday",
  "timesheet",
  "timesheet_entry",
  "extraction",
  "inbound_email",
  "evidence",
  "timesheet_check",
  "ai_usage_event",
  "notification",
] as const;
