/**
 * Timesheet workflow shared by the handlers (user actions) and the jobs (worker). Everything runs
 * inside a caller's tenant transaction. Status changes go through domain/state (R6); every write is
 * audited (R5); extraction results are only ever proposals, compared by the checks or used to
 * pre-fill an empty DRAFT for a person to confirm (8.6 step 4) — never submitted or verified.
 */
import {
  canAttachEvidence,
  chooseEngagement,
  chooseTimesheet,
  compareHours,
  extractedPeriod,
  formatHours,
  inboundEmailMachine,
  isTimesheetEditable,
  matchConsultant,
  monthStart,
  parseHours,
  periodLabel,
  poCoversPeriod,
  prefillEntries,
  runTimesheetChecks,
  startedPeriods,
  transitionTimesheet,
  type CheckEntry,
  type CheckResult,
  type ExtractedTimesheet,
  type Rate,
  type Role,
  type TimesheetEvent,
  type TimesheetGuardContext,
  type TimesheetStatus,
} from "@verilo/domain";
import {
  countEvidenceForEmail,
  deleteCheck,
  evidenceForDuplicateCheck,
  findDoneExtractionBySha,
  getConsultant,
  getEngagement,
  getExtraction,
  listUnmatchedEvidence,
  getFirm,
  getInboundEmail,
  insertAiUsageEvent,
  insertCheck,
  insertEvidence,
  insertExtraction,
  insertMissingTimesheets,
  listChecks,
  listConsultants,
  listEngagementRows,
  listEntries,
  listEvidenceForTimesheet,
  listHolidays,
  listPurchaseOrders,
  listRates,
  listTimesheetsForEngagements,
  lockTimesheet,
  replaceEntries,
  updateCheck,
  updateEvidence,
  updateInboundEmail,
  updateTimesheet,
  writeAudit,
  type EngagementRow,
  type EvidenceRow,
  type FileRow,
  type FirmRow,
  type Queryable,
  type TimesheetRow,
} from "@verilo/db";
import { isExtractable } from "@verilo/ai";
import type { JobName, JobPayloads } from "@verilo/jobs";
import { todayIn } from "../handlers/fields";

/** Who is acting: a signed-in user, or the system (jobs and the webhook) with a null user. */
export interface Actor {
  firmId: string;
  userId: string | null;
  role: Role | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Jobs to enqueue once the transaction has committed. */
export type PendingJob = { [K in JobName]: { name: K; data: JobPayloads[K]; singletonKey?: string } }[JobName];

export async function audit(
  tx: Queryable,
  a: Actor,
  entityType: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
  reason?: string | null,
) {
  await writeAudit(tx, {
    firmId: a.firmId,
    actorUserId: a.userId,
    entityType,
    entityId,
    action,
    before,
    after,
    reason: reason ?? null,
    ip: a.ip ?? null,
    userAgent: a.userAgent ?? null,
  });
}

export class TimesheetLockedError extends Error {}

const DERIVED = (firmId: string, fileId: string, page: number) => `firms/${firmId}/derived/${fileId}/page-${page}.jpg`;
export const derivedPageKey = DERIVED;

// ---------------------------------------------------------------------------------------------------
// Periods (7.1)
// ---------------------------------------------------------------------------------------------------

/** Creates NOT_STARTED timesheets for every started period of the given ACTIVE engagements. */
export async function ensureTimesheets(tx: Queryable, a: Actor, firm: FirmRow, engagements: EngagementRow[], now = new Date()) {
  const today = todayIn(firm.timezone, now);
  let created = 0;
  for (const e of engagements) {
    if (e.status !== "ACTIVE") continue;
    const periods = startedPeriods(
      { timesheetCycle: e.timesheetCycle, startDate: e.startDate, endDate: e.endDate, biweeklyAnchorDate: e.biweeklyAnchorDate, weekStart: firm.weekStart },
      today,
    );
    const rows = await insertMissingTimesheets(
      tx,
      a.firmId,
      a.userId,
      periods.map((p) => ({ engagementId: e.id, periodStart: p.start, periodEnd: p.end, status: "NOT_STARTED" as const })),
    );
    for (const r of rows) await audit(tx, a, "timesheet", r.id, "create", null, { engagementId: r.engagementId, periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status });
    created += rows.length;
  }
  return created;
}

// ---------------------------------------------------------------------------------------------------
// Transitions (6.1)
// ---------------------------------------------------------------------------------------------------

export async function applyTransition(
  tx: Queryable,
  a: Actor,
  ts: TimesheetRow,
  event: TimesheetEvent,
  guard: TimesheetGuardContext,
  patch: Partial<Pick<TimesheetRow, "submittedAt" | "verifiedAt" | "verifiedBy" | "returnedReason" | "totalHours">> = {},
  reason?: string,
): Promise<TimesheetRow> {
  const next = transitionTimesheet(ts.status, event, guard);
  const after = await updateTimesheet(tx, a.firmId, ts.id, { ...patch, status: next });
  if (next !== ts.status) {
    await audit(tx, a, "timesheet", ts.id, "status_change", { status: ts.status }, { status: next, event, ...patch }, reason ?? null);
  }
  return after;
}

// ---------------------------------------------------------------------------------------------------
// Checks (7.6)
// ---------------------------------------------------------------------------------------------------

const toRate = (r: Awaited<ReturnType<typeof listRates>>[number]): Rate => ({
  id: r.id,
  side: r.side,
  rateKind: r.rateKind,
  rateCents: r.rateCents,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
});

export const toCheckEntries = (rows: Awaited<ReturnType<typeof listEntries>>): CheckEntry[] =>
  rows.map((e) => ({ workDate: e.workDate, hours: parseHours(e.hours) ?? 0, rateKind: e.rateKind }));

export function extractionResultOf(json: unknown): ExtractedTimesheet | null {
  return json && typeof json === "object" ? (json as ExtractedTimesheet) : null;
}

/** Everything the pure checks need, loaded inside the transaction. */
export async function loadCheckInput(tx: Queryable, firmId: string, ts: TimesheetRow) {
  const e = (await getEngagement(tx, firmId, ts.engagementId))!;
  const c = (await getConsultant(tx, firmId, e.consultantId))!;
  const firm = (await getFirm(tx, firmId))!;
  const entries = toCheckEntries(await listEntries(tx, firmId, ts.id));
  const ev = await listEvidenceForTimesheet(tx, firmId, ts.id);
  const shas = ev.map((x) => x.sha256).filter((s): s is string => !!s);
  const others = await evidenceForDuplicateCheck(tx, firmId, ts.id, shas);
  const period = { start: ts.periodStart, end: ts.periodEnd };
  const pos = (await listPurchaseOrders(tx, firmId, e.id)).filter((p) => poCoversPeriod(p, period));
  const holidays = (await listHolidays(tx, firmId)).filter((h) => h.holidayDate >= ts.periodStart && h.holidayDate <= ts.periodEnd);
  return {
    engagement: e,
    consultant: c,
    firm,
    evidence: ev,
    input: {
      period,
      entries,
      engagement: {
        startDate: e.startDate,
        endDate: e.endDate,
        evidenceRequired: e.evidenceRequired,
        maxWeeklyHoursWarning: parseHours(e.maxWeeklyHoursWarning) ?? 5000,
        employmentType: c.employmentType,
      },
      weekStart: firm.weekStart,
      consultantName: `${c.firstName} ${c.lastName}`,
      evidence: ev.map((x) => ({
        evidenceId: x.id,
        fileId: x.fileId,
        sha256: x.sha256,
        perceptualHash: x.perceptualHash,
        extraction: x.extractionId ? { status: x.extractionStatus!, result: extractionResultOf(x.extractionResult) } : null,
      })),
      otherEvidence: others.map((o) => ({
        timesheetId: o.timesheetId!,
        fileId: o.fileId,
        sha256: o.sha256,
        perceptualHash: o.perceptualHash,
        label: `${o.consultantName}, ${periodLabel({ start: o.periodStart, end: o.periodEnd })}`,
      })),
      rates: (await listRates(tx, firmId, e.id)).map(toRate),
      holidays: holidays.map((h) => ({ date: h.holidayDate, name: h.name })),
      // "Billed" means invoiced; invoices arrive in M3, so nothing is billed against a PO yet.
      purchaseOrder: pos[0] ? { poNumber: pos[0].poNumber, amountCents: pos[0].amountCents, billedCents: 0 } : null,
    },
  };
}

/** Writes the current results: unchanged checks keep their resolution; changed ones reopen. */
async function syncChecks(tx: Queryable, a: Actor, ts: TimesheetRow, results: CheckResult[]) {
  const existing = await listChecks(tx, a.firmId, ts.id);
  const byCode = new Map(existing.map((c) => [c.checkCode, c]));
  let changed = false;
  for (const r of results) {
    const cur = byCode.get(r.code);
    if (!cur) {
      await insertCheck(tx, a.firmId, { timesheetId: ts.id, checkCode: r.code, severity: r.severity, message: r.message });
      changed = true;
    } else if (cur.message !== r.message || cur.severity !== r.severity) {
      await updateCheck(tx, a.firmId, cur.id, { message: r.message, severity: r.severity, resolvedAt: null, resolvedBy: null, resolutionReason: null });
      changed = true;
    }
    byCode.delete(r.code);
  }
  for (const stale of byCode.values()) {
    await deleteCheck(tx, a.firmId, stale.id);
    changed = true;
  }
  if (changed) {
    await audit(
      tx,
      a,
      "timesheet",
      ts.id,
      "checks_run",
      { checks: existing.map((c) => ({ code: c.checkCode, resolved: c.resolvedAt !== null })) },
      { checks: results.map((r) => ({ code: r.code, severity: r.severity, message: r.message })) },
    );
  }
  return listChecks(tx, a.firmId, ts.id);
}

const guardChecks = (rows: Awaited<ReturnType<typeof listChecks>>) =>
  rows.map((c) => ({ severity: c.severity, resolved: c.resolvedAt !== null, reason: c.resolutionReason, resolvedByRole: c.resolvedByRole }));

/**
 * Runs the 7.6 checks and moves SUBMITTED/NEEDS_REVIEW timesheets on (6.1). A SUBMITTED timesheet
 * waits while any extraction is still QUEUED/RUNNING; a NEEDS_REVIEW timesheet is verified by the
 * system only when no blocking check is left at all (anything a person resolved needs a person
 * to verify).
 */
export async function runChecks(tx: Queryable, a: Actor, timesheetId: string) {
  const ts = await lockTimesheet(tx, a.firmId, timesheetId);
  if (!ts || ts.status === "VERIFIED" || ts.status === "INVOICED") return ts;
  const loaded = await loadCheckInput(tx, a.firmId, ts);
  const results = runTimesheetChecks(loaded.input);
  const checks = await syncChecks(tx, a, ts, results);
  const pending = loaded.evidence.some((x) => x.extractionStatus === "QUEUED" || x.extractionStatus === "RUNNING");
  const g = { checks: guardChecks(checks) };
  if (ts.status === "SUBMITTED" && !pending) {
    const openBlock = g.checks.some((c) => c.severity === "BLOCK" && !c.resolved);
    return openBlock
      ? applyTransition(tx, a, ts, "checks_fail", g)
      : applyTransition(tx, a, ts, "checks_pass", g, { verifiedAt: new Date(), verifiedBy: a.userId });
  }
  if (ts.status === "NEEDS_REVIEW" && !g.checks.some((c) => c.severity === "BLOCK")) {
    return applyTransition(tx, a, ts, "resolve_all", g, { verifiedAt: new Date(), verifiedBy: a.userId });
  }
  return ts;
}

// ---------------------------------------------------------------------------------------------------
// Entries and submit
// ---------------------------------------------------------------------------------------------------

export interface EntryInput {
  workDate: string;
  hours: number; // hundredths
  rateKind: "REGULAR" | "OVERTIME" | "HOLIDAY";
  note: string | null;
}

export async function saveEntries(tx: Queryable, a: Actor, ts: TimesheetRow, entries: EntryInput[], action = "update_entries", reason?: string) {
  if (!isTimesheetEditable(ts.status)) throw new TimesheetLockedError(`A ${ts.status.toLowerCase().replace("_", " ")} timesheet can't be edited`);
  const before = (await listEntries(tx, a.firmId, ts.id)).map((e) => ({ workDate: e.workDate, hours: e.hours, rateKind: e.rateKind, note: e.note }));
  const kept = entries.filter((e) => e.hours > 0 || e.note);
  const rows = await replaceEntries(
    tx,
    a.firmId,
    a.userId,
    ts.id,
    kept.map((e) => ({ workDate: e.workDate, hours: formatHours(e.hours), rateKind: e.rateKind, note: e.note })),
  );
  const total = kept.reduce((s, e) => s + e.hours, 0);
  await audit(tx, a, "timesheet", ts.id, action, { entries: before, totalHours: ts.totalHours }, { entries: rows.map((e) => ({ workDate: e.workDate, hours: e.hours, rateKind: e.rateKind, note: e.note })), totalHours: formatHours(total) }, reason);
  const after = await applyTransition(tx, a, ts, "save_entries", {}, { totalHours: formatHours(total) });
  await runChecks(tx, a, ts.id);
  return after;
}

export async function submit(tx: Queryable, a: Actor, ts: TimesheetRow) {
  const entries = (await listEntries(tx, a.firmId, ts.id)).filter((e) => (parseHours(e.hours) ?? 0) > 0);
  const e = (await getEngagement(tx, a.firmId, ts.engagementId))!;
  const evidence = await listEvidenceForTimesheet(tx, a.firmId, ts.id);
  await applyTransition(
    tx,
    a,
    ts,
    "submit",
    { entryCount: entries.length, evidenceCount: evidence.length, evidenceRequired: e.evidenceRequired },
    { submittedAt: new Date() },
  );
  return runChecks(tx, a, ts.id);
}

// ---------------------------------------------------------------------------------------------------
// Evidence and extraction
// ---------------------------------------------------------------------------------------------------

export async function recordUsage(
  tx: Queryable,
  firm: FirmRow,
  e: { extractionId: string | null; fileId: string; pages: number; billable: boolean; reason: "VALIDATION_RETRY" | "PROVIDER_ERROR" | "DUPLICATE" | "SCAN_REJECTED" | null; costCents: number | null },
) {
  await insertAiUsageEvent(tx, firm.id, {
    extractionId: e.extractionId,
    fileId: e.fileId,
    documentKind: "TIMESHEET",
    pages: e.pages,
    billable: e.billable,
    nonBillableReason: e.billable ? null : e.reason,
    usageMonth: monthStart(todayIn(firm.timezone)),
    providerCostCents: e.costCents,
  });
}

/**
 * Attaches a CLEAN file as evidence and queues its extraction. A file whose bytes were already read
 * (same sha256) reuses that extraction instead of a second AI read (22.4 DUPLICATE); spreadsheets
 * are stored without extraction (section 9).
 */
export async function attachEvidence(
  tx: Queryable,
  a: Actor,
  input: {
    timesheet: TimesheetRow | null;
    file: FileRow;
    source: EvidenceRow["source"];
    inboundEmailId?: string | null;
    consultantId?: string | null;
  },
): Promise<{ evidence: EvidenceRow; jobs: PendingJob[] }> {
  const { timesheet: ts, file } = input;
  if (file.scanStatus !== "CLEAN") throw new Error("Only clean files can be evidence");
  if (ts && !canAttachEvidence(ts.status)) throw new TimesheetLockedError(`Evidence can't be added to a ${ts.status.toLowerCase()} timesheet`);
  const jobs: PendingJob[] = [];
  let extractionId: string | null = null;
  if (isExtractable(file.mimeType)) {
    const reuse = file.sha256 ? await findDoneExtractionBySha(tx, a.firmId, file.sha256, file.id) : null;
    const firm = (await getFirm(tx, a.firmId))!;
    if (reuse) {
      extractionId = reuse;
      await recordUsage(tx, firm, { extractionId: reuse, fileId: file.id, pages: 0, billable: false, reason: "DUPLICATE", costCents: null });
    } else {
      const x = await insertExtraction(tx, a.firmId, a.userId, file.id);
      extractionId = x.id;
      await audit(tx, a, "extraction", x.id, "create", null, { fileId: file.id, status: x.status });
      jobs.push({ name: "run_extraction", data: { firmId: a.firmId, extractionId: x.id }, singletonKey: x.id });
    }
  }
  const ev = await insertEvidence(tx, a.firmId, a.userId, {
    timesheetId: ts?.id ?? null,
    fileId: file.id,
    source: input.source,
    extractionId,
    inboundEmailId: input.inboundEmailId ?? null,
    consultantId: input.consultantId ?? null,
  });
  await audit(tx, a, "evidence", ev.id, "create", null, ev);
  if (ts) await runChecks(tx, a, ts.id);
  else if (extractionId && !jobs.length) {
    // A duplicate of an already-read file: match it now, as the extraction job would.
    await matchUnlinkedEvidence(tx, a, ev);
  }
  return { evidence: ev, jobs };
}

/** 8.6 step 4: pre-fill an empty, editable timesheet from the proposal. Never submits. */
export async function prefillIfEmpty(tx: Queryable, a: Actor, ts: TimesheetRow, result: ExtractedTimesheet) {
  if (!isTimesheetEditable(ts.status)) return false;
  if ((await listEntries(tx, a.firmId, ts.id)).length > 0) return false;
  const rows = prefillEntries(result, { start: ts.periodStart, end: ts.periodEnd });
  if (rows.length === 0) return false;
  await saveEntries(
    tx,
    a,
    ts,
    rows.map((r) => ({ ...r, note: null })),
    "prefill_from_extraction",
    "Pre-filled from the attached document; confirm before submitting",
  );
  return true;
}

/** Links evidence that arrived without a timesheet (email, bulk upload) using 8.6 steps 1–4. */
export async function matchUnlinkedEvidence(
  tx: Queryable,
  a: Actor,
  ev: EvidenceRow,
): Promise<{ linked: true; timesheetId: string } | { linked: false; reason: string }> {
  if (ev.timesheetId) return { linked: true, timesheetId: ev.timesheetId };
  const x = ev.extractionId ? await getExtractionResult(tx, a.firmId, ev.extractionId) : null;
  if (!x) return { linked: false, reason: "The attachment couldn't be read automatically" };
  if (x.document_type === "OTHER") return { linked: false, reason: "This doesn't look like a timesheet" };

  let consultantId = ev.consultantId;
  if (!consultantId) {
    const all = await listConsultants(tx, a.firmId);
    const m = matchConsultant(
      { fromAddress: null, extractedName: x.consultant_name },
      all.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, emails: c.emails, active: c.status === "ACTIVE" && !c.archivedAt })),
    );
    if (!m.matched) return { linked: false, reason: m.reason === "AMBIGUOUS_NAME" ? "More than one consultant matches the name on the document" : "No consultant matches the sender or the name on the document" };
    consultantId = m.consultantId;
    ev = await updateEvidence(tx, a.firmId, ev.id, { consultantId });
  }

  const engagements = await listEngagementRows(tx, a.firmId, { consultantId });
  const period = extractedPeriod(x);
  const choice = chooseEngagement(engagements, period, x.worker_id);
  if (!choice.ok) {
    return { linked: false, reason: choice.reason === "AMBIGUOUS" ? "The consultant has more than one active engagement for this period" : "No active engagement covers the document's period" };
  }
  const firm = (await getFirm(tx, a.firmId))!;
  await ensureTimesheets(tx, a, firm, engagements.filter((e) => e.id === choice.engagementId));
  const sheets = await listTimesheetsForEngagements(tx, a.firmId, [choice.engagementId]);
  const tsId = chooseTimesheet(sheets, period);
  if (!tsId) return { linked: false, reason: "No timesheet matches the document's period" };
  const ts = (await lockTimesheet(tx, a.firmId, tsId))!;
  if (!canAttachEvidence(ts.status)) return { linked: false, reason: `The matching timesheet is already ${ts.status.toLowerCase().replace("_", " ")}` };

  const before = { timesheetId: ev.timesheetId };
  await updateEvidence(tx, a.firmId, ev.id, { timesheetId: ts.id });
  await audit(tx, a, "evidence", ev.id, "update", before, { timesheetId: ts.id }, "Matched automatically (8.6)");
  const filled = await prefillIfEmpty(tx, a, ts, x);
  if (!filled) await runChecks(tx, a, ts.id);
  return { linked: true, timesheetId: ts.id };
}

async function getExtractionResult(tx: Queryable, firmId: string, extractionId: string) {
  const row = await getExtraction(tx, firmId, extractionId);
  return row?.status === "DONE" ? extractionResultOf(row.resultJson) : null;
}

/** After its attachments are matched (or not), the email is PROCESSED or UNMATCHED. */
export async function settleInboundEmail(tx: Queryable, a: Actor, inboundEmailId: string, reason: string | null) {
  const email = await getInboundEmail(tx, a.firmId, inboundEmailId);
  if (!email || email.status === "PROCESSED" || email.status === "REJECTED") return;
  const counts = await countEvidenceForEmail(tx, a.firmId, inboundEmailId);
  const evs = await listUnmatchedEvidence(tx, a.firmId);
  const pending = evs.some((e) => e.inboundEmailId === inboundEmailId && (e.extractionStatus === "QUEUED" || e.extractionStatus === "RUNNING"));
  if (pending) return;
  const next = counts.unmatched === 0 ? "PROCESSED" : "UNMATCHED";
  if (next === email.status) {
    if (reason && reason !== email.statusReason) await updateInboundEmail(tx, a.firmId, email.id, email.status, { statusReason: reason });
    return;
  }
  const to = inboundEmailMachine.transition(email.status, next);
  await updateInboundEmail(tx, a.firmId, email.id, email.status, { status: to, statusReason: next === "UNMATCHED" ? reason : null });
  await audit(tx, a, "inbound_email", email.id, "status_change", { status: email.status }, { status: to, reason });
}

/** For the review screens: entered vs extracted, day by day. */
export function comparisonFor(ts: TimesheetRow, entries: CheckEntry[], results: ExtractedTimesheet[]) {
  return compareHours({ start: ts.periodStart, end: ts.periodEnd }, entries, results);
}

export type { TimesheetStatus };
