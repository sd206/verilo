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
    /**
     * Required when role = CONSULTANT (section 5.1). The consultant table arrives in M1;
     * the foreign key and the CHECK constraint are added then.
     */
    consultantId: uuid("consultant_id"),
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

/** Tenant-owned tables: `firm` itself plus every table with firm_id. A test checks RLS on each. */
export const TENANT_TABLES = ["firm", "membership", "audit_event", "file", "invitation"] as const;
