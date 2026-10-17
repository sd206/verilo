/**
 * Master data repositories (sections 5.1–5.3). Every function takes the firm id from the
 * caller's FirmContext and filters on it (R3); RLS is the second safeguard.
 */
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  consultant,
  engagement,
  file,
  firm,
  firmHoliday,
  party,
  partyContact,
  partyDocument,
  purchaseOrder,
  rate,
} from "../schema";
import type { Queryable } from "../client";

export type PartyRow = typeof party.$inferSelect;
export type NewParty = Omit<typeof party.$inferInsert, "id" | "firmId" | "createdAt" | "updatedAt">;
export type PartyContactRow = typeof partyContact.$inferSelect;
export type PartyDocumentRow = typeof partyDocument.$inferSelect;
export type ConsultantRow = typeof consultant.$inferSelect;
export type NewConsultant = Omit<typeof consultant.$inferInsert, "id" | "firmId" | "createdAt" | "updatedAt">;
export type EngagementRow = typeof engagement.$inferSelect;
export type NewEngagement = Omit<typeof engagement.$inferInsert, "id" | "firmId" | "createdAt" | "updatedAt">;
export type RateRow = typeof rate.$inferSelect;
export type PurchaseOrderRow = typeof purchaseOrder.$inferSelect;
export type FirmHolidayRow = typeof firmHoliday.$inferSelect;
export type FirmRowPatch = Partial<Omit<typeof firm.$inferInsert, "id" | "createdAt" | "createdBy" | "wrappedDataKey">>;

// --- firm settings ------------------------------------------------------------------

export async function updateFirm(tx: Queryable, firmId: string, patch: FirmRowPatch) {
  const [row] = await tx.update(firm).set(patch).where(eq(firm.id, firmId)).returning();
  return row!;
}

export async function listHolidays(tx: Queryable, firmId: string): Promise<FirmHolidayRow[]> {
  return tx.select().from(firmHoliday).where(eq(firmHoliday.firmId, firmId)).orderBy(asc(firmHoliday.holidayDate));
}

/** setHolidays (section 16): replaces the calendar with the given set. */
export async function replaceHolidays(
  tx: Queryable,
  firmId: string,
  userId: string,
  holidays: { holidayDate: string; name: string }[],
): Promise<FirmHolidayRow[]> {
  await tx.delete(firmHoliday).where(eq(firmHoliday.firmId, firmId));
  if (holidays.length) {
    await tx.insert(firmHoliday).values(holidays.map((h) => ({ ...h, firmId, createdBy: userId })));
  }
  return listHolidays(tx, firmId);
}

// --- parties --------------------------------------------------------------------------

export async function listParties(tx: Queryable, firmId: string, opts: { includeArchived?: boolean } = {}) {
  const conds = [eq(party.firmId, firmId)];
  if (!opts.includeArchived) conds.push(isNull(party.archivedAt));
  return tx.select().from(party).where(and(...conds)).orderBy(asc(party.displayName));
}

export async function getParty(tx: Queryable, firmId: string, id: string): Promise<PartyRow | null> {
  const [row] = await tx.select().from(party).where(and(eq(party.firmId, firmId), eq(party.id, id)));
  return row ?? null;
}

export async function getPartiesByIds(tx: Queryable, firmId: string, ids: string[]): Promise<PartyRow[]> {
  if (!ids.length) return [];
  return tx.select().from(party).where(and(eq(party.firmId, firmId), inArray(party.id, ids)));
}

export async function insertParty(tx: Queryable, firmId: string, userId: string, p: NewParty): Promise<PartyRow> {
  const [row] = await tx.insert(party).values({ ...p, firmId, createdBy: userId }).returning();
  return row!;
}

export async function updateParty(tx: Queryable, firmId: string, id: string, patch: Partial<NewParty>): Promise<PartyRow> {
  const [row] = await tx.update(party).set(patch).where(and(eq(party.firmId, firmId), eq(party.id, id))).returning();
  return row!;
}

// --- contacts ---------------------------------------------------------------------------

export async function listContacts(tx: Queryable, firmId: string, partyId: string) {
  return tx
    .select()
    .from(partyContact)
    .where(and(eq(partyContact.firmId, firmId), eq(partyContact.partyId, partyId), isNull(partyContact.archivedAt)))
    .orderBy(asc(partyContact.name));
}

export async function getContact(tx: Queryable, firmId: string, id: string): Promise<PartyContactRow | null> {
  const [row] = await tx.select().from(partyContact).where(and(eq(partyContact.firmId, firmId), eq(partyContact.id, id)));
  return row ?? null;
}

export async function insertContact(
  tx: Queryable,
  firmId: string,
  userId: string,
  c: { partyId: string; name: string; email: string | null; phone: string | null; roleLabel: string | null },
): Promise<PartyContactRow> {
  const [row] = await tx.insert(partyContact).values({ ...c, firmId, createdBy: userId }).returning();
  return row!;
}

export async function archiveContact(tx: Queryable, firmId: string, id: string): Promise<PartyContactRow> {
  const [row] = await tx
    .update(partyContact)
    .set({ archivedAt: new Date() })
    .where(and(eq(partyContact.firmId, firmId), eq(partyContact.id, id)))
    .returning();
  return row!;
}

// --- documents ----------------------------------------------------------------------------

export async function listDocuments(tx: Queryable, firmId: string, partyId: string) {
  return tx
    .select({
      id: partyDocument.id,
      docType: partyDocument.docType,
      effectiveDate: partyDocument.effectiveDate,
      expiryDate: partyDocument.expiryDate,
      requiredForPayment: partyDocument.requiredForPayment,
      fileId: partyDocument.fileId,
      filename: file.filename,
      scanStatus: file.scanStatus,
      createdAt: partyDocument.createdAt,
    })
    .from(partyDocument)
    .innerJoin(file, eq(file.id, partyDocument.fileId))
    .where(and(eq(partyDocument.firmId, firmId), eq(partyDocument.partyId, partyId), isNull(partyDocument.archivedAt)))
    .orderBy(asc(partyDocument.docType), desc(partyDocument.createdAt));
}

export async function getDocument(tx: Queryable, firmId: string, id: string): Promise<PartyDocumentRow | null> {
  const [row] = await tx.select().from(partyDocument).where(and(eq(partyDocument.firmId, firmId), eq(partyDocument.id, id)));
  return row ?? null;
}

export async function insertDocument(
  tx: Queryable,
  firmId: string,
  userId: string,
  d: {
    partyId: string;
    docType: PartyDocumentRow["docType"];
    fileId: string;
    effectiveDate: string | null;
    expiryDate: string | null;
    requiredForPayment: boolean;
  },
): Promise<PartyDocumentRow> {
  const [row] = await tx.insert(partyDocument).values({ ...d, firmId, createdBy: userId }).returning();
  return row!;
}

export async function archiveDocument(tx: Queryable, firmId: string, id: string): Promise<PartyDocumentRow> {
  const [row] = await tx
    .update(partyDocument)
    .set({ archivedAt: new Date() })
    .where(and(eq(partyDocument.firmId, firmId), eq(partyDocument.id, id)))
    .returning();
  return row!;
}

// --- consultants -----------------------------------------------------------------------------

export async function listConsultants(tx: Queryable, firmId: string, opts: { includeArchived?: boolean } = {}) {
  const conds = [eq(consultant.firmId, firmId)];
  if (!opts.includeArchived) conds.push(isNull(consultant.archivedAt));
  const rows = await tx
    .select({
      id: consultant.id,
      firstName: consultant.firstName,
      lastName: consultant.lastName,
      emails: consultant.emails,
      employmentType: consultant.employmentType,
      status: consultant.status,
      workAuthExpiry: consultant.workAuthExpiry,
      subVendorPartyId: consultant.subVendorPartyId,
      subVendorName: party.displayName,
      archivedAt: consultant.archivedAt,
    })
    .from(consultant)
    .leftJoin(party, eq(party.id, consultant.subVendorPartyId))
    .where(and(...conds))
    .orderBy(asc(consultant.lastName), asc(consultant.firstName));
  const counts = await tx
    .select({ consultantId: engagement.consultantId, n: count() })
    .from(engagement)
    .where(and(eq(engagement.firmId, firmId), eq(engagement.status, "ACTIVE")))
    .groupBy(engagement.consultantId);
  const byId = new Map(counts.map((c) => [c.consultantId, Number(c.n)]));
  return rows.map((r) => ({ ...r, activeEngagements: byId.get(r.id) ?? 0 }));
}

export async function getConsultant(tx: Queryable, firmId: string, id: string): Promise<ConsultantRow | null> {
  const [row] = await tx.select().from(consultant).where(and(eq(consultant.firmId, firmId), eq(consultant.id, id)));
  return row ?? null;
}

export async function insertConsultant(tx: Queryable, firmId: string, userId: string, c: NewConsultant): Promise<ConsultantRow> {
  const [row] = await tx.insert(consultant).values({ ...c, firmId, createdBy: userId }).returning();
  return row!;
}

export async function updateConsultant(
  tx: Queryable,
  firmId: string,
  id: string,
  patch: Partial<NewConsultant>,
): Promise<ConsultantRow> {
  const [row] = await tx
    .update(consultant)
    .set(patch)
    .where(and(eq(consultant.firmId, firmId), eq(consultant.id, id)))
    .returning();
  return row!;
}

// --- engagements ------------------------------------------------------------------------------

export async function listEngagements(tx: Queryable, firmId: string, opts: { consultantId?: string } = {}) {
  const conds = [eq(engagement.firmId, firmId)];
  if (opts.consultantId) conds.push(eq(engagement.consultantId, opts.consultantId));
  return tx
    .select({
      id: engagement.id,
      consultantId: engagement.consultantId,
      consultantName: sql<string>`${consultant.firstName} || ' ' || ${consultant.lastName}`,
      billToPartyId: engagement.billToPartyId,
      billToName: party.displayName,
      projectName: engagement.projectName,
      roleTitle: engagement.roleTitle,
      startDate: engagement.startDate,
      endDate: engagement.endDate,
      status: engagement.status,
    })
    .from(engagement)
    .innerJoin(consultant, eq(consultant.id, engagement.consultantId))
    .innerJoin(party, eq(party.id, engagement.billToPartyId))
    .where(and(...conds))
    .orderBy(desc(engagement.startDate));
}

export async function getEngagement(tx: Queryable, firmId: string, id: string): Promise<EngagementRow | null> {
  const [row] = await tx.select().from(engagement).where(and(eq(engagement.firmId, firmId), eq(engagement.id, id)));
  return row ?? null;
}

export async function insertEngagement(tx: Queryable, firmId: string, userId: string, e: NewEngagement): Promise<EngagementRow> {
  const [row] = await tx.insert(engagement).values({ ...e, firmId, createdBy: userId }).returning();
  return row!;
}

export async function updateEngagement(
  tx: Queryable,
  firmId: string,
  id: string,
  patch: Partial<NewEngagement>,
): Promise<EngagementRow> {
  const [row] = await tx
    .update(engagement)
    .set(patch)
    .where(and(eq(engagement.firmId, firmId), eq(engagement.id, id)))
    .returning();
  return row!;
}

// --- rates ---------------------------------------------------------------------------------------

export async function listRates(tx: Queryable, firmId: string, engagementId: string): Promise<RateRow[]> {
  return tx
    .select()
    .from(rate)
    .where(and(eq(rate.firmId, firmId), eq(rate.engagementId, engagementId)))
    .orderBy(asc(rate.side), asc(rate.rateKind), asc(rate.effectiveFrom));
}

export async function getRate(tx: Queryable, firmId: string, id: string): Promise<RateRow | null> {
  const [row] = await tx.select().from(rate).where(and(eq(rate.firmId, firmId), eq(rate.id, id)));
  return row ?? null;
}

export async function insertRate(
  tx: Queryable,
  firmId: string,
  userId: string,
  r: Pick<RateRow, "engagementId" | "side" | "rateKind" | "rateCents" | "effectiveFrom" | "effectiveTo">,
): Promise<RateRow> {
  const [row] = await tx.insert(rate).values({ ...r, firmId, createdBy: userId }).returning();
  return row!;
}

export async function setRateEnd(tx: Queryable, firmId: string, id: string, effectiveTo: string): Promise<RateRow> {
  const [row] = await tx
    .update(rate)
    .set({ effectiveTo })
    .where(and(eq(rate.firmId, firmId), eq(rate.id, id)))
    .returning();
  return row!;
}

/** Locks the engagement row so concurrent rate changes are checked one at a time. */
export async function lockEngagement(tx: Queryable, firmId: string, id: string): Promise<void> {
  await tx.execute(sql`select 1 from ${engagement} where ${engagement.firmId} = ${firmId} and ${engagement.id} = ${id} for update`);
}

// --- purchase orders -----------------------------------------------------------------------------

export async function listPurchaseOrders(tx: Queryable, firmId: string, engagementId: string): Promise<PurchaseOrderRow[]> {
  return tx
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.firmId, firmId), eq(purchaseOrder.engagementId, engagementId)))
    .orderBy(desc(purchaseOrder.startDate));
}

export async function insertPurchaseOrder(
  tx: Queryable,
  firmId: string,
  userId: string,
  p: Pick<PurchaseOrderRow, "engagementId" | "poNumber" | "amountCents" | "startDate" | "endDate" | "alertThresholdsBps">,
): Promise<PurchaseOrderRow> {
  const [row] = await tx.insert(purchaseOrder).values({ ...p, firmId, createdBy: userId }).returning();
  return row!;
}

/** Full engagement rows (period generation and matching). */
export async function listEngagementRows(
  tx: Queryable,
  firmId: string,
  opts: { consultantId?: string; status?: EngagementRow["status"] } = {},
): Promise<EngagementRow[]> {
  const conds = [eq(engagement.firmId, firmId)];
  if (opts.consultantId) conds.push(eq(engagement.consultantId, opts.consultantId));
  if (opts.status) conds.push(eq(engagement.status, opts.status));
  return tx.select().from(engagement).where(and(...conds)).orderBy(asc(engagement.startDate));
}
