/**
 * Timesheet, evidence, extraction, check, inbound email, AI usage and notification repositories
 * (sections 5.4, 5.9, 22.4). Every function filters on the caller's firm id (R3); RLS is the
 * second safeguard. Status values are computed by the domain machines before they reach here (R6).
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  aiUsageEvent,
  consultant,
  engagement,
  evidence,
  extraction,
  file,
  inboundEmail,
  notification,
  party,
  timesheet,
  timesheetCheck,
  timesheetEntry,
} from "../schema";
import type { Queryable } from "../client";

export type TimesheetRow = typeof timesheet.$inferSelect;
export type TimesheetEntryRow = typeof timesheetEntry.$inferSelect;
export type EvidenceRow = typeof evidence.$inferSelect;
export type ExtractionRow = typeof extraction.$inferSelect;
export type TimesheetCheckRow = typeof timesheetCheck.$inferSelect;
export type InboundEmailRow = typeof inboundEmail.$inferSelect;
export type NotificationRow = typeof notification.$inferSelect;

// --- system lookups (SECURITY DEFINER, 0006) ---------------------------------------------------

export async function inboxLookup(tx: Queryable, addresses: string[]) {
  if (addresses.length === 0) return [];
  const r = await tx.execute<{ firm_id: string; inbox: "TIMESHEET" | "AP"; address: string }>(
    sql`select firm_id, inbox, address
        from app_inbox_lookup(array(select jsonb_array_elements_text(${JSON.stringify(addresses)}::jsonb)))`,
  );
  return r.rows.map((x) => ({ firmId: x.firm_id, inbox: x.inbox, address: x.address }));
}

export async function firmsForJobs(tx: Queryable): Promise<{ firmId: string; timezone: string }[]> {
  const r = await tx.execute<{ firm_id: string; timezone: string }>(sql`select firm_id, timezone from app_firms_for_jobs()`);
  return r.rows.map((x) => ({ firmId: x.firm_id, timezone: x.timezone }));
}

// --- timesheets --------------------------------------------------------------------------------

const timesheetListCols = {
  id: timesheet.id,
  engagementId: timesheet.engagementId,
  periodStart: timesheet.periodStart,
  periodEnd: timesheet.periodEnd,
  status: timesheet.status,
  totalHours: timesheet.totalHours,
  submittedAt: timesheet.submittedAt,
  verifiedAt: timesheet.verifiedAt,
  returnedReason: timesheet.returnedReason,
  updatedAt: timesheet.updatedAt,
  consultantId: engagement.consultantId,
  consultantName: sql<string>`${consultant.firstName} || ' ' || ${consultant.lastName}`,
  roleTitle: engagement.roleTitle,
  billToName: party.displayName,
  evidenceRequired: engagement.evidenceRequired,
  evidenceCount: sql<number>`(select count(*)::int from evidence ev where ev.timesheet_id = ${timesheet.id})`,
  openBlocks: sql<number>`(select count(*)::int from timesheet_check c where c.timesheet_id = ${timesheet.id} and c.severity = 'BLOCK' and c.resolved_at is null)`,
  openWarnings: sql<number>`(select count(*)::int from timesheet_check c where c.timesheet_id = ${timesheet.id} and c.severity = 'WARN')`,
};

export type TimesheetListRow = Awaited<ReturnType<typeof listTimesheets>>[number];

export async function listTimesheets(
  tx: Queryable,
  firmId: string,
  opts: { consultantId?: string; engagementId?: string; statuses?: TimesheetRow["status"][]; limit?: number } = {},
) {
  const conds = [eq(timesheet.firmId, firmId)];
  if (opts.consultantId) conds.push(eq(engagement.consultantId, opts.consultantId));
  if (opts.engagementId) conds.push(eq(timesheet.engagementId, opts.engagementId));
  if (opts.statuses?.length) conds.push(inArray(timesheet.status, opts.statuses));
  return tx
    .select(timesheetListCols)
    .from(timesheet)
    .innerJoin(engagement, and(eq(engagement.id, timesheet.engagementId), eq(engagement.firmId, firmId)))
    .innerJoin(consultant, eq(consultant.id, engagement.consultantId))
    .innerJoin(party, eq(party.id, engagement.billToPartyId))
    .where(and(...conds))
    .orderBy(desc(timesheet.periodStart), asc(consultant.lastName))
    .limit(opts.limit ?? 500);
}

export async function getTimesheet(tx: Queryable, firmId: string, id: string): Promise<TimesheetRow | null> {
  const [row] = await tx
    .select()
    .from(timesheet)
    .where(and(eq(timesheet.firmId, firmId), eq(timesheet.id, id)));
  return row ?? null;
}

/** Row lock so concurrent saves, submits and job runs on one timesheet serialize. */
export async function lockTimesheet(tx: Queryable, firmId: string, id: string): Promise<TimesheetRow | null> {
  const r = await tx.execute<{ id: string }>(sql`select id from timesheet where firm_id = ${firmId} and id = ${id} for update`);
  if (r.rows.length === 0) return null;
  return getTimesheet(tx, firmId, id);
}

/** Creates NOT_STARTED timesheets for periods that don't have one yet; returns the new rows. */
export async function insertMissingTimesheets(
  tx: Queryable,
  firmId: string,
  userId: string | null,
  rows: { engagementId: string; periodStart: string; periodEnd: string; status: TimesheetRow["status"] }[],
): Promise<TimesheetRow[]> {
  if (rows.length === 0) return [];
  return tx
    .insert(timesheet)
    .values(rows.map((r) => ({ ...r, firmId, createdBy: userId })))
    .onConflictDoNothing({ target: [timesheet.engagementId, timesheet.periodStart] })
    .returning();
}

export async function updateTimesheet(
  tx: Queryable,
  firmId: string,
  id: string,
  patch: Partial<Pick<TimesheetRow, "status" | "totalHours" | "submittedAt" | "verifiedAt" | "verifiedBy" | "returnedReason">>,
): Promise<TimesheetRow> {
  const [row] = await tx
    .update(timesheet)
    .set(patch)
    .where(and(eq(timesheet.firmId, firmId), eq(timesheet.id, id)))
    .returning();
  return row!;
}

export async function listTimesheetsForEngagements(tx: Queryable, firmId: string, engagementIds: string[]) {
  if (engagementIds.length === 0) return [];
  return tx
    .select()
    .from(timesheet)
    .where(and(eq(timesheet.firmId, firmId), inArray(timesheet.engagementId, engagementIds)))
    .orderBy(asc(timesheet.periodStart));
}

// --- entries -----------------------------------------------------------------------------------

export async function listEntries(tx: Queryable, firmId: string, timesheetId: string): Promise<TimesheetEntryRow[]> {
  return tx
    .select()
    .from(timesheetEntry)
    .where(and(eq(timesheetEntry.firmId, firmId), eq(timesheetEntry.timesheetId, timesheetId)))
    .orderBy(asc(timesheetEntry.workDate), asc(timesheetEntry.rateKind));
}

/** saveTimesheetEntries replaces the set. Zero-hour rows aren't stored. */
export async function replaceEntries(
  tx: Queryable,
  firmId: string,
  userId: string | null,
  timesheetId: string,
  entries: { workDate: string; hours: string; rateKind: TimesheetEntryRow["rateKind"]; note: string | null }[],
): Promise<TimesheetEntryRow[]> {
  await tx.delete(timesheetEntry).where(and(eq(timesheetEntry.firmId, firmId), eq(timesheetEntry.timesheetId, timesheetId)));
  if (entries.length) {
    await tx.insert(timesheetEntry).values(entries.map((e) => ({ ...e, firmId, timesheetId, createdBy: userId })));
  }
  return listEntries(tx, firmId, timesheetId);
}

// --- evidence ----------------------------------------------------------------------------------

export async function insertEvidence(
  tx: Queryable,
  firmId: string,
  userId: string | null,
  e: Omit<typeof evidence.$inferInsert, "id" | "firmId" | "createdAt" | "updatedAt" | "createdBy">,
): Promise<EvidenceRow> {
  const [row] = await tx
    .insert(evidence)
    .values({ ...e, firmId, createdBy: userId })
    .returning();
  return row!;
}

export async function getEvidence(tx: Queryable, firmId: string, id: string): Promise<EvidenceRow | null> {
  const [row] = await tx
    .select()
    .from(evidence)
    .where(and(eq(evidence.firmId, firmId), eq(evidence.id, id)));
  return row ?? null;
}

export async function getEvidenceByExtraction(tx: Queryable, firmId: string, extractionId: string): Promise<EvidenceRow[]> {
  return tx
    .select()
    .from(evidence)
    .where(and(eq(evidence.firmId, firmId), eq(evidence.extractionId, extractionId)));
}

export async function updateEvidence(
  tx: Queryable,
  firmId: string,
  id: string,
  patch: Partial<Pick<EvidenceRow, "timesheetId" | "extractionId" | "consultantId">>,
): Promise<EvidenceRow> {
  const [row] = await tx
    .update(evidence)
    .set(patch)
    .where(and(eq(evidence.firmId, firmId), eq(evidence.id, id)))
    .returning();
  return row!;
}

export async function deleteEvidence(tx: Queryable, firmId: string, id: string): Promise<void> {
  await tx.delete(evidence).where(and(eq(evidence.firmId, firmId), eq(evidence.id, id)));
}

const evidenceViewCols = {
  id: evidence.id,
  timesheetId: evidence.timesheetId,
  fileId: evidence.fileId,
  source: evidence.source,
  createdAt: evidence.createdAt,
  createdBy: evidence.createdBy,
  consultantId: evidence.consultantId,
  inboundEmailId: evidence.inboundEmailId,
  filename: file.filename,
  mimeType: file.mimeType,
  sha256: file.sha256,
  perceptualHash: file.perceptualHash,
  scanStatus: file.scanStatus,
  extractionId: extraction.id,
  extractionStatus: extraction.status,
  extractionResult: extraction.resultJson,
  extractionRaw: extraction.rawJson,
  extractionError: extraction.error,
  extractionModel: extraction.model,
  extractionConfidence: extraction.overallConfidence,
};

export type EvidenceView = Awaited<ReturnType<typeof listEvidenceForTimesheet>>[number];

export async function listEvidenceForTimesheet(tx: Queryable, firmId: string, timesheetId: string) {
  return tx
    .select(evidenceViewCols)
    .from(evidence)
    .innerJoin(file, eq(file.id, evidence.fileId))
    .leftJoin(extraction, eq(extraction.id, evidence.extractionId))
    .where(and(eq(evidence.firmId, firmId), eq(evidence.timesheetId, timesheetId)))
    .orderBy(asc(evidence.createdAt));
}

/** The unmatched queue (13.2 item 3): evidence not yet on a timesheet. */
export async function listUnmatchedEvidence(tx: Queryable, firmId: string) {
  return tx
    .select({
      ...evidenceViewCols,
      fromAddress: inboundEmail.fromAddress,
      subject: inboundEmail.subject,
      receivedAt: inboundEmail.receivedAt,
      emailStatusReason: inboundEmail.statusReason,
      consultantName: sql<string | null>`${consultant.firstName} || ' ' || ${consultant.lastName}`,
    })
    .from(evidence)
    .innerJoin(file, eq(file.id, evidence.fileId))
    .leftJoin(extraction, eq(extraction.id, evidence.extractionId))
    .leftJoin(inboundEmail, eq(inboundEmail.id, evidence.inboundEmailId))
    .leftJoin(consultant, eq(consultant.id, evidence.consultantId))
    .where(and(eq(evidence.firmId, firmId), isNull(evidence.timesheetId)))
    .orderBy(desc(evidence.createdAt))
    .limit(500);
}

/** Evidence on other timesheets, for DUPLICATE_EVIDENCE: same sha256, or any recent image hash. */
export async function evidenceForDuplicateCheck(tx: Queryable, firmId: string, timesheetId: string, sha256s: string[]) {
  const recent = sql`${evidence.createdAt} > now() - interval '400 days'`;
  return tx
    .select({
      timesheetId: evidence.timesheetId,
      fileId: evidence.fileId,
      sha256: file.sha256,
      perceptualHash: file.perceptualHash,
      consultantName: sql<string>`${consultant.firstName} || ' ' || ${consultant.lastName}`,
      periodStart: timesheet.periodStart,
      periodEnd: timesheet.periodEnd,
      extractionStatus: extraction.status,
      extractionResult: extraction.resultJson,
    })
    .from(evidence)
    .innerJoin(file, eq(file.id, evidence.fileId))
    .leftJoin(extraction, eq(extraction.id, evidence.extractionId))
    .innerJoin(timesheet, eq(timesheet.id, evidence.timesheetId))
    .innerJoin(engagement, eq(engagement.id, timesheet.engagementId))
    .innerJoin(consultant, eq(consultant.id, engagement.consultantId))
    .where(
      and(
        eq(evidence.firmId, firmId),
        isNotNull(evidence.timesheetId),
        ne(evidence.timesheetId, timesheetId),
        or(sha256s.length ? inArray(file.sha256, sha256s) : sql`false`, and(isNotNull(file.perceptualHash), recent)),
      ),
    );
}

// --- extraction --------------------------------------------------------------------------------

export async function insertExtraction(tx: Queryable, firmId: string, userId: string | null, fileId: string): Promise<ExtractionRow> {
  const [row] = await tx
    .insert(extraction)
    .values({ firmId, fileId, createdBy: userId, status: "QUEUED" })
    .returning();
  return row!;
}

export async function getExtraction(tx: Queryable, firmId: string, id: string): Promise<ExtractionRow | null> {
  const [row] = await tx
    .select()
    .from(extraction)
    .where(and(eq(extraction.firmId, firmId), eq(extraction.id, id)));
  return row ?? null;
}

/** Compare-and-set status change: returns null when another worker got there first (R7). */
export async function setExtractionStatus(
  tx: Queryable,
  firmId: string,
  id: string,
  from: ExtractionRow["status"],
  to: ExtractionRow["status"],
  patch: Partial<Pick<ExtractionRow, "model" | "promptVersion" | "rawJson" | "resultJson" | "overallConfidence" | "error" | "costCents">> = {},
): Promise<ExtractionRow | null> {
  const [row] = await tx
    .update(extraction)
    .set({ ...patch, status: to })
    .where(and(eq(extraction.firmId, firmId), eq(extraction.id, id), eq(extraction.status, from)))
    .returning();
  return row ?? null;
}

/** A finished extraction of a file with the same bytes (no second AI read for a duplicate, 22.4). */
export async function findDoneExtractionBySha(tx: Queryable, firmId: string, sha256: string, excludeFileId: string) {
  const [row] = await tx
    .select({ id: extraction.id })
    .from(extraction)
    .innerJoin(file, eq(file.id, extraction.fileId))
    .where(and(eq(extraction.firmId, firmId), eq(extraction.status, "DONE"), eq(file.sha256, sha256), ne(file.id, excludeFileId)))
    .orderBy(desc(extraction.createdAt))
    .limit(1);
  return row?.id ?? null;
}

// --- checks ------------------------------------------------------------------------------------

export async function listChecks(tx: Queryable, firmId: string, timesheetId: string) {
  return tx
    .select({
      id: timesheetCheck.id,
      timesheetId: timesheetCheck.timesheetId,
      checkCode: timesheetCheck.checkCode,
      severity: timesheetCheck.severity,
      message: timesheetCheck.message,
      resolvedBy: timesheetCheck.resolvedBy,
      resolvedAt: timesheetCheck.resolvedAt,
      resolutionReason: timesheetCheck.resolutionReason,
      // The resolver's role in this firm (6.1 guard: Manager, Finance or Admin).
      resolvedByRole: sql<"ADMIN" | "MANAGER" | "FINANCE" | "CONSULTANT" | null>`(select m.role from membership m where m.firm_id = ${timesheetCheck.firmId} and m.user_id = ${timesheetCheck.resolvedBy})`,
      resolvedByName: sql<string | null>`(select u.name from app_user u where u.id = ${timesheetCheck.resolvedBy})`,
    })
    .from(timesheetCheck)
    .where(and(eq(timesheetCheck.firmId, firmId), eq(timesheetCheck.timesheetId, timesheetId)))
    .orderBy(asc(timesheetCheck.createdAt));
}

export type CheckView = Awaited<ReturnType<typeof listChecks>>[number];

export async function insertCheck(
  tx: Queryable,
  firmId: string,
  c: { timesheetId: string; checkCode: TimesheetCheckRow["checkCode"]; severity: TimesheetCheckRow["severity"]; message: string },
) {
  await tx.insert(timesheetCheck).values({ ...c, firmId });
}

export async function updateCheck(
  tx: Queryable,
  firmId: string,
  id: string,
  patch: Partial<Pick<TimesheetCheckRow, "message" | "severity" | "resolvedBy" | "resolvedAt" | "resolutionReason">>,
): Promise<TimesheetCheckRow> {
  const [row] = await tx
    .update(timesheetCheck)
    .set(patch)
    .where(and(eq(timesheetCheck.firmId, firmId), eq(timesheetCheck.id, id)))
    .returning();
  return row!;
}

export async function deleteCheck(tx: Queryable, firmId: string, id: string): Promise<void> {
  await tx.delete(timesheetCheck).where(and(eq(timesheetCheck.firmId, firmId), eq(timesheetCheck.id, id)));
}

export async function getCheck(tx: Queryable, firmId: string, id: string): Promise<TimesheetCheckRow | null> {
  const [row] = await tx
    .select()
    .from(timesheetCheck)
    .where(and(eq(timesheetCheck.firmId, firmId), eq(timesheetCheck.id, id)));
  return row ?? null;
}

// --- inbound email -----------------------------------------------------------------------------

/** De-duplicates by Message-ID (section 9): returns null when the message was already stored. */
export async function insertInboundEmail(
  tx: Queryable,
  firmId: string,
  e: Omit<typeof inboundEmail.$inferInsert, "id" | "firmId" | "createdAt" | "updatedAt" | "createdBy" | "status">,
): Promise<InboundEmailRow | null> {
  const [row] = await tx
    .insert(inboundEmail)
    .values({ ...e, firmId, status: "RECEIVED" })
    .onConflictDoNothing({ target: [inboundEmail.firmId, inboundEmail.inbox, inboundEmail.messageId] })
    .returning();
  return row ?? null;
}

export async function getInboundEmail(tx: Queryable, firmId: string, id: string): Promise<InboundEmailRow | null> {
  const [row] = await tx
    .select()
    .from(inboundEmail)
    .where(and(eq(inboundEmail.firmId, firmId), eq(inboundEmail.id, id)));
  return row ?? null;
}

export async function updateInboundEmail(
  tx: Queryable,
  firmId: string,
  id: string,
  from: InboundEmailRow["status"],
  patch: Partial<Pick<InboundEmailRow, "status" | "statusReason" | "matchedConsultantId" | "matchedPartyId">>,
): Promise<InboundEmailRow | null> {
  const [row] = await tx
    .update(inboundEmail)
    .set(patch)
    .where(and(eq(inboundEmail.firmId, firmId), eq(inboundEmail.id, id), eq(inboundEmail.status, from)))
    .returning();
  return row ?? null;
}

export async function listInboundEmails(tx: Queryable, firmId: string, opts: { statuses?: InboundEmailRow["status"][] } = {}) {
  const conds = [eq(inboundEmail.firmId, firmId), eq(inboundEmail.inbox, "TIMESHEET")];
  if (opts.statuses?.length) conds.push(inArray(inboundEmail.status, opts.statuses));
  return tx
    .select()
    .from(inboundEmail)
    .where(and(...conds))
    .orderBy(desc(inboundEmail.receivedAt))
    .limit(200);
}

export async function countEvidenceForEmail(tx: Queryable, firmId: string, inboundEmailId: string) {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      unmatched: sql<number>`count(*) filter (where ${evidence.timesheetId} is null)::int`,
    })
    .from(evidence)
    .where(and(eq(evidence.firmId, firmId), eq(evidence.inboundEmailId, inboundEmailId)));
  return row ?? { total: 0, unmatched: 0 };
}

// --- AI usage (22.4) ---------------------------------------------------------------------------

export async function insertAiUsageEvent(
  tx: Queryable,
  firmId: string,
  e: Omit<typeof aiUsageEvent.$inferInsert, "id" | "firmId" | "createdAt" | "updatedAt" | "createdBy">,
) {
  await tx.insert(aiUsageEvent).values({ ...e, firmId });
}

export async function listAiUsage(tx: Queryable, firmId: string, fileId: string) {
  return tx
    .select()
    .from(aiUsageEvent)
    .where(and(eq(aiUsageEvent.firmId, firmId), eq(aiUsageEvent.fileId, fileId)))
    .orderBy(asc(aiUsageEvent.createdAt));
}

// --- notifications (5.9) -----------------------------------------------------------------------

/** Inserts unless the dedupe key exists; returns null for a duplicate. */
export async function insertNotificationOnce(
  tx: Queryable,
  firmId: string,
  n: Omit<typeof notification.$inferInsert, "id" | "firmId" | "createdAt" | "updatedAt" | "createdBy">,
): Promise<NotificationRow | null> {
  const [row] = await tx
    .insert(notification)
    .values({ ...n, firmId })
    .onConflictDoNothing({ target: notification.dedupeKey })
    .returning();
  return row ?? null;
}

export async function countNotifications(tx: Queryable, firmId: string, type: string, entityId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.firmId, firmId), eq(notification.type, type), eq(notification.entityId, entityId)));
  return row?.n ?? 0;
}

export async function markNotificationSent(tx: Queryable, firmId: string, id: string): Promise<void> {
  await tx
    .update(notification)
    .set({ sentAt: new Date() })
    .where(and(eq(notification.firmId, firmId), eq(notification.id, id)));
}

/** Overdue, unsubmitted timesheets on active engagements (reminder job). */
export async function listTimesheetsNeedingReminder(tx: Queryable, firmId: string, periodEndOnOrBefore: string) {
  return tx
    .select({
      id: timesheet.id,
      periodStart: timesheet.periodStart,
      periodEnd: timesheet.periodEnd,
      consultantId: consultant.id,
      consultantName: sql<string>`${consultant.firstName} || ' ' || ${consultant.lastName}`,
      emails: consultant.emails,
    })
    .from(timesheet)
    .innerJoin(engagement, eq(engagement.id, timesheet.engagementId))
    .innerJoin(consultant, eq(consultant.id, engagement.consultantId))
    .where(
      and(
        eq(timesheet.firmId, firmId),
        inArray(timesheet.status, ["NOT_STARTED", "DRAFT", "RETURNED"]),
        sql`${timesheet.periodEnd} <= ${periodEndOnOrBefore}`,
        eq(engagement.status, "ACTIVE"),
        isNull(consultant.archivedAt),
        gt(sql`array_length(${consultant.emails}, 1)`, 0),
      ),
    );
}

export async function getEvidenceByFile(tx: Queryable, firmId: string, fileId: string): Promise<EvidenceRow | null> {
  const [row] = await tx
    .select()
    .from(evidence)
    .where(and(eq(evidence.firmId, firmId), eq(evidence.fileId, fileId)));
  return row ?? null;
}
