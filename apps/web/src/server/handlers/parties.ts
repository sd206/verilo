/** Parties, contacts and documents (5.2; 13.2 item 4; section 16 "Parties"). */
import { z } from "zod";
import { can, ConflictError, NotFoundError, requirePermission, ValidationError, type FirmContext } from "@verilo/auth";
import {
  archiveContact as archiveContactRepo,
  archiveDocument as archiveDocumentRepo,
  getContact,
  getDocument,
  getFile,
  getFirm,
  getParty,
  insertContact,
  insertDocument,
  insertParty,
  listConsultants,
  listContacts,
  listDocuments,
  listEngagements,
  listParties as listPartiesRepo,
  updateParty as updatePartyRepo,
  withTenant,
  writeAudit,
  type PartyRow,
  type Queryable,
} from "@verilo/db";
import { documentStatus, formatBps, PARTY_KINDS, validateParty } from "@verilo/domain";
import type { Deps } from "../deps";
import { parse, uuid } from "./common";
import { firmCipher, maskTail } from "./firm-crypto";
import { bool, emailList, optionalInt, optionalIsoDate, optionalPercent, optionalText, text, todayIn } from "./fields";

function requireView(ctx: FirmContext) {
  requirePermission(ctx, "VIEW_MASTER_DATA");
}
function requireEdit(ctx: FirmContext) {
  requirePermission(ctx, "EDIT_MASTER_DATA");
}

/** Audit-safe view: encrypted fields are recorded only as changed/unchanged. */
function auditView(p: PartyRow) {
  const { remitDetails, tin, ...rest } = p;
  return { ...rest, remitDetails: remitDetails ? "[encrypted]" : null, tin: tin ? "[encrypted]" : null };
}

async function audit(tx: Queryable, ctx: FirmContext, entityType: string, entityId: string, action: string, before: unknown, after: unknown) {
  await writeAudit(tx, {
    firmId: ctx.firmId,
    actorUserId: ctx.userId,
    entityType,
    entityId,
    action,
    before,
    after,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

// --- list / detail ---------------------------------------------------------------------------

export async function listParties(d: Deps, ctx: FirmContext, input: unknown = {}) {
  requireView(ctx);
  const { includeArchived } = parse(z.strictObject({ includeArchived: z.boolean().optional() }), input);
  const rows = await withTenant(d.db, ctx, (tx) => listPartiesRepo(tx, ctx.firmId, { includeArchived }));
  return rows.map((p) => ({
    id: p.id,
    kind: p.kind,
    displayName: p.displayName,
    legalName: p.legalName,
    code: p.code,
    paymentTermsDays: p.paymentTermsDays,
    vendorPayTerms: p.vendorPayTerms,
    deduction: p.standardDeductionBps === null ? null : formatBps(p.standardDeductionBps),
    qboMapped: Boolean(p.qboCustomerId || p.qboVendorId),
    archived: p.archivedAt !== null,
  }));
}

export async function getPartyDetail(d: Deps, ctx: FirmContext, input: unknown) {
  requireView(ctx);
  const { partyId } = parse(z.strictObject({ partyId: uuid }), input);
  return withTenant(d.db, ctx, async (tx) => {
    const p = await getParty(tx, ctx.firmId, partyId);
    if (!p) throw new NotFoundError();
    const firm = await getFirm(tx, ctx.firmId);
    const today = todayIn(firm!.timezone);
    const cipher = await firmCipher(d, tx, ctx.firmId);
    const engagements = (await listEngagements(tx, ctx.firmId)).filter(
      (e) => e.billToPartyId === partyId,
    );
    const consultants = (await listConsultants(tx, ctx.firmId)).filter((c) => c.subVendorPartyId === partyId);
    // Bank and remit details are for the people who pay vendors; others see that they exist.
    const showRemit = can(ctx.role, "EDIT_MASTER_DATA") || can(ctx.role, "RECORD_VENDOR_PAYMENTS");
    return {
      party: {
        ...auditView(p),
        remitDetails: showRemit ? cipher.decrypt(p.remitDetails) : p.remitDetails ? "••••" : null,
        tinMasked: maskTail(cipher.decrypt(p.tin)),
        deductionPercent: p.standardDeductionBps === null ? "" : (p.standardDeductionBps / 100).toFixed(2),
      },
      contacts: await listContacts(tx, ctx.firmId, partyId),
      documents: (await listDocuments(tx, ctx.firmId, partyId)).map((doc) => ({
        ...doc,
        status: documentStatus(doc.expiryDate, today),
      })),
      engagements,
      consultants: consultants.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, status: c.status })),
      qbo: { customerId: p.qboCustomerId, vendorId: p.qboVendorId },
      canEdit: can(ctx.role, "EDIT_MASTER_DATA"),
    };
  });
}

// --- create / update / archive ------------------------------------------------------------------

const partyFields = {
  legalName: text(200, 1),
  displayName: text(100, 1),
  code: optionalText(10).transform((v) => (v ? v.toUpperCase() : null)),
  addressLine1: optionalText(),
  addressLine2: optionalText(),
  city: optionalText(100),
  state: optionalText(50),
  postalCode: optionalText(20),
  country: optionalText(2).transform((v) => v ?? "US"),
  phone: optionalText(50),
  apEmails: emailList,
  arEmails: emailList,
  paymentTermsDays: optionalInt(0, 365),
  paysWhenPaidUpstream: bool,
  upstreamBufferDays: optionalInt(0, 365).transform((v) => v ?? 15),
  standardDeduction: optionalPercent,
  deductionLabel: optionalText(50),
  invoiceLayout: z.enum(["PER_CONSULTANT", "COMBINED"]).optional(),
  deliveryMethod: z.enum(["EMAIL", "PORTAL"]).optional(),
  backupRequired: bool,
  poRequired: bool,
  timesheetConfirmEmail: optionalText(254),
  vendorPayTerms: z.enum(["NET", "PAY_WHEN_PAID"]).nullable().optional(),
  vendorNetDays: optionalInt(0, 365),
  /** Empty keeps the current value on update. */
  remitDetails: optionalText(2000),
  w9TaxClassification: z
    .enum(["INDIVIDUAL_SOLE_PROP_SMLLC", "C_CORP", "S_CORP", "PARTNERSHIP", "TRUST_ESTATE", "LLC_C", "LLC_S", "LLC_P", "OTHER", "UNKNOWN"])
    .optional(),
  tin: optionalText(11).refine((v) => !v || /^\d{2}-?\d{7}$|^\d{3}-?\d{2}-?\d{4}$/.test(v), "TIN must be an EIN or SSN"),
  tinType: z.enum(["EIN", "SSN"]).nullable().optional(),
};

const createSchema = z.strictObject({ kind: z.enum(PARTY_KINDS), ...partyFields });
const updateSchema = z.strictObject({ partyId: uuid, ...partyFields });

type PartyInput = z.infer<typeof createSchema>;

function toRow(kind: PartyRow["kind"], data: Omit<PartyInput, "kind">) {
  const isSub = kind === "SUB_VENDOR";
  const isBillTo = kind === "PRIME_VENDOR" || kind === "IMPLEMENTATION_PARTNER" || kind === "END_CLIENT";
  return {
    legalName: data.legalName,
    displayName: data.displayName,
    code: data.code,
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    city: data.city,
    state: data.state,
    postalCode: data.postalCode,
    country: data.country,
    phone: data.phone,
    apEmails: data.apEmails,
    arEmails: data.arEmails,
    paymentTermsDays: data.paymentTermsDays,
    paysWhenPaidUpstream: isBillTo && data.paysWhenPaidUpstream,
    upstreamBufferDays: data.upstreamBufferDays,
    standardDeductionBps: isBillTo ? data.standardDeduction : null,
    deductionLabel: isBillTo ? data.deductionLabel : null,
    invoiceLayout: data.invoiceLayout ?? "PER_CONSULTANT",
    deliveryMethod: data.deliveryMethod ?? "EMAIL",
    backupRequired: data.backupRequired,
    poRequired: data.poRequired,
    timesheetConfirmEmail: data.timesheetConfirmEmail,
    vendorPayTerms: isSub ? (data.vendorPayTerms ?? null) : null,
    vendorNetDays: isSub ? (data.vendorPayTerms === "PAY_WHEN_PAID" ? (data.vendorNetDays ?? 0) : data.vendorNetDays) : null,
    w9TaxClassification: isSub ? (data.w9TaxClassification ?? "UNKNOWN") : "UNKNOWN",
    tinType: isSub ? (data.tinType ?? null) : null,
  } as const;
}

function check(kind: PartyRow["kind"], row: ReturnType<typeof toRow>) {
  const r = validateParty({
    kind,
    code: row.code,
    vendorPayTerms: row.vendorPayTerms,
    vendorNetDays: row.vendorNetDays,
    standardDeductionBps: row.standardDeductionBps,
    paymentTermsDays: row.paymentTermsDays,
  });
  if (!r.ok) throw new ValidationError(r.message);
}

function uniqueCodeError(e: unknown): never {
  const msg = String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? "");
  if (msg.includes("party_firm_code_key")) throw new ConflictError("Another party already uses that code");
  throw e;
}

export async function createParty(d: Deps, ctx: FirmContext, input: unknown) {
  requireEdit(ctx);
  const data = parse(createSchema, input);
  const row = toRow(data.kind, data);
  check(data.kind, row);
  return withTenant(d.db, ctx, async (tx) => {
    const cipher = await firmCipher(d, tx, ctx.firmId);
    const isSub = data.kind === "SUB_VENDOR";
    const p = await insertParty(tx, ctx.firmId, ctx.userId, {
      kind: data.kind,
      ...row,
      remitDetails: isSub ? cipher.encrypt(data.remitDetails) : null,
      tin: isSub ? cipher.encrypt(data.tin) : null,
    }).catch(uniqueCodeError);
    await audit(tx, ctx, "party", p.id, "create", null, auditView(p));
    return { id: p.id };
  });
}

export async function updateParty(d: Deps, ctx: FirmContext, input: unknown) {
  requireEdit(ctx);
  const { partyId, ...data } = parse(updateSchema, input);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getParty(tx, ctx.firmId, partyId);
    if (!before) throw new NotFoundError();
    const row = toRow(before.kind, data);
    check(before.kind, row);
    const cipher = await firmCipher(d, tx, ctx.firmId);
    const isSub = before.kind === "SUB_VENDOR";
    const after = await updatePartyRepo(tx, ctx.firmId, partyId, {
      ...row,
      ...(isSub && data.remitDetails ? { remitDetails: cipher.encrypt(data.remitDetails) } : {}),
      ...(isSub && data.tin ? { tin: cipher.encrypt(data.tin) } : {}),
    }).catch(uniqueCodeError);
    await audit(tx, ctx, "party", partyId, "update", auditView(before), auditView(after));
    return { id: partyId };
  });
}

/** archiveParty (soft delete). Refused while active engagements or consultants depend on it. */
export async function archiveParty(d: Deps, ctx: FirmContext, input: unknown) {
  requireEdit(ctx);
  const { partyId } = parse(z.strictObject({ partyId: uuid }), input);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getParty(tx, ctx.firmId, partyId);
    if (!before) throw new NotFoundError();
    if (before.archivedAt) return { id: partyId };
    const inUse = (await listEngagements(tx, ctx.firmId)).some((e) => e.status !== "ENDED" && e.billToPartyId === partyId);
    const subFor = (await listConsultants(tx, ctx.firmId)).some((c) => c.subVendorPartyId === partyId && c.status === "ACTIVE");
    if (inUse || subFor) throw new ConflictError("This party is used by active engagements or consultants");
    const after = await updatePartyRepo(tx, ctx.firmId, partyId, { archivedAt: new Date() });
    await audit(tx, ctx, "party", partyId, "archive", auditView(before), auditView(after));
    return { id: partyId };
  });
}

// --- contacts ------------------------------------------------------------------------------------

const contactSchema = z.strictObject({
  partyId: uuid,
  name: text(200, 1),
  email: optionalText(254).refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email"),
  phone: optionalText(50),
  roleLabel: optionalText(100),
});

export async function addContact(d: Deps, ctx: FirmContext, input: unknown) {
  requireEdit(ctx);
  const data = parse(contactSchema, input);
  return withTenant(d.db, ctx, async (tx) => {
    if (!(await getParty(tx, ctx.firmId, data.partyId))) throw new NotFoundError();
    const c = await insertContact(tx, ctx.firmId, ctx.userId, data);
    await audit(tx, ctx, "party_contact", c.id, "create", null, c);
    return { id: c.id };
  });
}

export async function archiveContact(d: Deps, ctx: FirmContext, input: unknown) {
  requireEdit(ctx);
  const { contactId } = parse(z.strictObject({ contactId: uuid }), input);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getContact(tx, ctx.firmId, contactId);
    if (!before) throw new NotFoundError();
    const after = await archiveContactRepo(tx, ctx.firmId, contactId);
    await audit(tx, ctx, "party_contact", contactId, "archive", before, after);
    return { id: contactId };
  });
}

// --- documents (uploadPartyDocument) ------------------------------------------------------------

const documentSchema = z.strictObject({
  partyId: uuid,
  fileId: uuid,
  docType: z.enum(["W9", "COI", "MSA", "WORK_ORDER", "OTHER"]),
  effectiveDate: optionalIsoDate,
  expiryDate: optionalIsoDate,
  requiredForPayment: bool,
});

/** Attaches an uploaded, virus-scanned file to a party (the upload itself uses requestUpload/completeUpload). */
export async function attachPartyDocument(d: Deps, ctx: FirmContext, input: unknown) {
  requireEdit(ctx);
  const data = parse(documentSchema, input);
  if (data.effectiveDate && data.expiryDate && data.expiryDate < data.effectiveDate) {
    throw new ValidationError("Expiry must be on or after the effective date");
  }
  return withTenant(d.db, ctx, async (tx) => {
    if (!(await getParty(tx, ctx.firmId, data.partyId))) throw new NotFoundError();
    const f = await getFile(tx, ctx.firmId, data.fileId);
    if (!f) throw new NotFoundError("File not found");
    if (f.scanStatus !== "CLEAN") throw new ValidationError("Only files that passed the virus scan can be attached");
    const doc = await insertDocument(tx, ctx.firmId, ctx.userId, data);
    await audit(tx, ctx, "party_document", doc.id, "create", null, doc);
    return { id: doc.id };
  });
}

export async function archivePartyDocument(d: Deps, ctx: FirmContext, input: unknown) {
  requireEdit(ctx);
  const { documentId } = parse(z.strictObject({ documentId: uuid }), input);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getDocument(tx, ctx.firmId, documentId);
    if (!before) throw new NotFoundError();
    const after = await archiveDocumentRepo(tx, ctx.firmId, documentId);
    await audit(tx, ctx, "party_document", documentId, "archive", before, after);
    return { id: documentId };
  });
}
