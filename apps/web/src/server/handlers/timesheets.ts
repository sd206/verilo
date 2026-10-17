/**
 * Timesheets (5.4, 6.1, 7.6; section 16 "Timesheets"; screens 13.1 and 13.2 items 2–3).
 * Consultants reach only their own timesheets (anything else is a 404); everyone else needs the
 * section 12 capability for the action (R8).
 */
import { z } from "zod";
import {
  can,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  requirePermission,
  ValidationError,
  type FirmContext,
} from "@verilo/auth";
import {
  getCheck,
  getConsultant,
  getEngagement,
  getEvidenceByFile,
  getExtraction,
  getParty,
  insertNotificationOnce,
  listHolidays,
  markNotificationSent,
  getEvidence,
  getFile,
  getFirm,
  getTimesheet,
  listChecks,
  listEngagementRows,
  listEntries,
  listEvidenceForTimesheet,
  listTimesheets,
  listUnmatchedEvidence,
  lockTimesheet,
  deleteEvidence,
  updateCheck,
  updateEvidence,
  withTenant,
  type EngagementRow,
  type Queryable,
} from "@verilo/db";
import {
  canAttachEvidence,
  InvalidTransitionError,
  isTimesheetEditable,
  parseHours,
  periodDays,
  periodLabel,
  TransitionGuardError,
  validDayHours,
  formatHours,
  isWeekend,
  type CheckCode,
} from "@verilo/domain";
import { timesheetReturnedEmail } from "@verilo/email";
import type { Deps } from "../deps";
import { parse, uuid } from "./common";
import { optionalText, text, todayIn } from "./fields";
import {
  applyTransition,
  attachEvidence,
  audit,
  comparisonFor,
  derivedPageKey,
  ensureTimesheets,
  extractionResultOf,
  prefillIfEmpty,
  runChecks,
  saveEntries,
  settleInboundEmail,
  submit,
  TimesheetLockedError,
  toCheckEntries,
  type Actor,
  type PendingJob,
} from "../timesheets/service";

const actorOf = (ctx: FirmContext): Actor => ({ firmId: ctx.firmId, userId: ctx.userId, role: ctx.role, ip: ctx.ip, userAgent: ctx.userAgent });
const isConsultant = (ctx: FirmContext) => ctx.role === "CONSULTANT";

/** Domain refusals become 409s with the domain's plain-language message. */
async function domainErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TransitionGuardError || e instanceof TimesheetLockedError) throw new ConflictError(e.message);
    if (e instanceof InvalidTransitionError) throw new ConflictError(`This timesheet can't do that while it's ${e.from.toLowerCase().replace("_", " ")}`);
    const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code;
    if (code === "55000") throw new ConflictError("This timesheet is invoiced and locked; corrections go through an adjustment");
    throw e;
  }
}

async function sendJobs(d: Deps, jobs: PendingJob[]) {
  for (const j of jobs) await d.jobs.send(j.name, j.data as never, { singletonKey: j.singletonKey });
}

type Access = "view" | "enter" | "review";

/** Loads a timesheet the caller may act on; another firm's id or another consultant's is a 404. */
async function loadFor(tx: Queryable, ctx: FirmContext, timesheetId: string, access: Access, lock = false) {
  if (isConsultant(ctx)) {
    if (access === "review") throw new ForbiddenError();
    requirePermission(ctx, "SUBMIT_OWN_TIMESHEETS");
  } else if (access === "enter") {
    requirePermission(ctx, "ENTER_ANY_TIMESHEETS");
  } else if (access === "review") {
    requirePermission(ctx, "REVIEW_TIMESHEETS");
  } else if (!can(ctx.role, "ENTER_ANY_TIMESHEETS") && !can(ctx.role, "REVIEW_TIMESHEETS")) {
    throw new ForbiddenError();
  }
  const ts = lock ? await lockTimesheet(tx, ctx.firmId, timesheetId) : await getTimesheet(tx, ctx.firmId, timesheetId);
  if (!ts) throw new NotFoundError();
  const e = (await getEngagement(tx, ctx.firmId, ts.engagementId))!;
  if (isConsultant(ctx) && e.consultantId !== ctx.consultantId) throw new NotFoundError();
  return { ts, engagement: e };
}

const cycleWord = (c: EngagementRow["timesheetCycle"]) => (c === "WEEKLY" ? "week" : c === "MONTHLY" ? "month" : "period");

// ---------------------------------------------------------------------------------------------------
// 13.1 My timesheets
// ---------------------------------------------------------------------------------------------------

export async function listMyTimesheets(d: Deps, ctx: FirmContext) {
  requirePermission(ctx, "SUBMIT_OWN_TIMESHEETS");
  if (!ctx.consultantId) return { timesheets: [], current: null, cta: null };
  const consultantId = ctx.consultantId;
  return withTenant(d.db, ctx, async (tx) => {
    const firm = (await getFirm(tx, ctx.firmId))!;
    const engagements = await listEngagementRows(tx, ctx.firmId, { consultantId });
    await ensureTimesheets(tx, actorOf(ctx), firm, engagements);
    const rows = await listTimesheets(tx, ctx.firmId, { consultantId });
    const today = todayIn(firm.timezone);
    const open = rows.filter((r) => ["NOT_STARTED", "DRAFT", "RETURNED"].includes(r.status));
    // The big button: the open timesheet for the current period, else the oldest open one.
    const current = open.find((r) => r.periodStart <= today && today <= r.periodEnd) ?? open.at(-1) ?? null;
    const eng = current ? engagements.find((e) => e.id === current.engagementId) : null;
    return {
      timesheets: rows.map((r) => ({
        id: r.id,
        period: periodLabel({ start: r.periodStart, end: r.periodEnd }),
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        status: r.status,
        totalHours: r.totalHours,
        client: r.billToName,
        roleTitle: r.roleTitle,
        returnedReason: r.returnedReason,
        evidenceCount: r.evidenceCount,
      })),
      current: current?.id ?? null,
      cta: current && eng ? `Submit this ${cycleWord(eng.timesheetCycle)}` : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// Detail (editor and review)
// ---------------------------------------------------------------------------------------------------

/** Consultants don't see bill amounts (open decision 6) or other consultants' names. */
function consultantMessage(code: CheckCode, message: string): string | null {
  if (code === "PO_EXCEEDED" || code === "RATE_CHANGE_IN_PERIOD") return null;
  if (code === "NO_RATE") return "This engagement isn't set up for billing on some of these days. Your firm has been told; you can still submit.";
  if (code === "DUPLICATE_EVIDENCE") return "This screenshot is already attached to another timesheet. Attach the screenshot for this period.";
  return message;
}

async function pageUrls(d: Deps, firmId: string, fileId: string, pages: number) {
  const out: string[] = [];
  for (let i = 0; i < pages; i++) out.push(await d.storage.createSignedDownload({ key: derivedPageKey(firmId, fileId, i), filename: `page-${i + 1}.jpg` }));
  return out;
}

const BROWSER_IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function getTimesheetDetail(d: Deps, ctx: FirmContext, input: unknown) {
  const { timesheetId } = parse(z.strictObject({ timesheetId: uuid }), input);
  const data = await withTenant(d.db, ctx, async (tx) => {
    const { ts, engagement } = await loadFor(tx, ctx, timesheetId, "view");
    const firm = (await getFirm(tx, ctx.firmId))!;
    const c = (await getConsultant(tx, ctx.firmId, engagement.consultantId))!;
    const billTo = await getParty(tx, ctx.firmId, engagement.billToPartyId);
    const entries = await listEntries(tx, ctx.firmId, ts.id);
    const evidence = await listEvidenceForTimesheet(tx, ctx.firmId, ts.id);
    const checks = await listChecks(tx, ctx.firmId, ts.id);
    const holidays = (await listHolidays(tx, ctx.firmId)).filter((h) => h.holidayDate >= ts.periodStart && h.holidayDate <= ts.periodEnd);
    return { ts, engagement, firm, c, billTo, entries, evidence, checks, holidays };
  });
  const { ts, engagement, firm, c, billTo, entries, evidence, checks } = data;
  const results = evidence.flatMap((e) => (e.extractionStatus === "DONE" && e.extractionResult ? [extractionResultOf(e.extractionResult)!] : []));
  const cmp = comparisonFor(ts, toCheckEntries(entries), results);
  const holidays = new Map(data.holidays.map((h) => [h.holidayDate, h.name]));
  const consultant = isConsultant(ctx);
  const editable = isTimesheetEditable(ts.status);
  const canEnter = consultant ? true : can(ctx.role, "ENTER_ANY_TIMESHEETS");
  const canReview = !consultant && can(ctx.role, "REVIEW_TIMESHEETS");

  const evidenceViews = [];
  for (const e of evidence) {
    const raw = (e.extractionRaw ?? null) as { pages?: number; fileId?: string } | null;
    const pages = raw?.pages ?? 0;
    const pageFile = raw?.fileId ?? e.fileId;
    const urls = pages > 0 ? await pageUrls(d, ctx.firmId, pageFile, pages) : [];
    const original =
      urls.length === 0 && e.scanStatus === "CLEAN" && BROWSER_IMAGES.includes(e.mimeType)
        ? [await d.storage.createSignedDownload({ key: `firms/${ctx.firmId}/files/${e.fileId}`, filename: e.filename })]
        : [];
    const r = e.extractionStatus === "DONE" ? extractionResultOf(e.extractionResult) : null;
    evidenceViews.push({
      id: e.id,
      filename: e.filename,
      source: e.source,
      createdAt: e.createdAt,
      pages: urls.length ? urls : original,
      extraction: e.extractionId
        ? {
            status: e.extractionStatus!,
            error: consultant ? null : e.extractionError,
            model: consultant ? null : e.extractionModel,
            confidence: e.extractionConfidence,
            result: r && {
              consultantName: r.consultant_name,
              vmsName: r.vms_name,
              period: r.period_start && r.period_end ? periodLabel({ start: r.period_start, end: r.period_end }) : null,
              periodStart: r.period_start,
              periodEnd: r.period_end,
              totalHours: r.total_hours === null ? null : formatHours(Math.round(r.total_hours * 100)),
              approvalStatus: r.approval_status,
              approverName: r.approver_name,
              approvedAt: r.approved_at,
              documentType: r.document_type,
              workerId: r.worker_id,
              confidence: r.confidence,
            },
          }
        : null,
      canRemove: editable && canEnter,
    });
  }

  const visibleChecks = checks
    .map((k) => ({
      id: k.id,
      code: k.checkCode,
      severity: k.severity,
      message: consultant ? consultantMessage(k.checkCode, k.message) : k.message,
      resolved: k.resolvedAt !== null,
      resolvedAt: k.resolvedAt,
      resolvedByName: k.resolvedByName,
      resolutionReason: k.resolutionReason,
    }))
    .filter((k): k is typeof k & { message: string } => k.message !== null);
  const openBlocks = checks.filter((k) => k.severity === "BLOCK" && !k.resolvedAt).length;
  const pending = evidence.some((e) => e.extractionStatus === "QUEUED" || e.extractionStatus === "RUNNING");

  const period = { start: ts.periodStart, end: ts.periodEnd };
  return {
    timesheet: {
      id: ts.id,
      status: ts.status,
      period: periodLabel(period),
      periodStart: ts.periodStart,
      periodEnd: ts.periodEnd,
      totalHours: ts.totalHours,
      submittedAt: ts.submittedAt,
      verifiedAt: ts.verifiedAt,
      returnedReason: ts.returnedReason,
    },
    consultant: { id: c.id, name: `${c.firstName} ${c.lastName}` },
    engagement: {
      id: engagement.id,
      roleTitle: engagement.roleTitle,
      client: billTo?.displayName ?? "",
      startDate: engagement.startDate,
      endDate: engagement.endDate,
      evidenceRequired: engagement.evidenceRequired,
    },
    days: periodDays(period).map((date) => ({
      date,
      weekend: isWeekend(date),
      holiday: holidays.get(date) ?? null,
      inEngagement: date >= engagement.startDate && (engagement.endDate === null || date <= engagement.endDate),
    })),
    entries: entries.map((e) => ({ workDate: e.workDate, hours: e.hours, rateKind: e.rateKind, note: e.note })),
    evidence: evidenceViews,
    checks: visibleChecks,
    comparison: {
      enteredTotal: formatHours(cmp.enteredTotal),
      extractedTotal: cmp.extractedTotal === null ? null : formatHours(cmp.extractedTotal),
      totalsDiffer: cmp.totalsDiffer,
      hasDaily: cmp.hasDaily,
      days: cmp.days.map((x) => ({
        date: x.date,
        entered: formatHours(x.entered),
        extracted: x.extracted === null ? null : formatHours(x.extracted),
        differs: x.differs,
      })),
      notes: cmp.notes,
    },
    extractionPending: pending,
    today: todayIn(firm.timezone),
    can: {
      edit: editable && canEnter,
      submit: ts.status === "DRAFT" && canEnter,
      attach: canAttachEvidence(ts.status) && canEnter,
      review: canReview && (ts.status === "SUBMITTED" || ts.status === "NEEDS_REVIEW"),
      verify: canReview && ((ts.status === "NEEDS_REVIEW" && openBlocks === 0) || (ts.status === "SUBMITTED" && openBlocks === 0 && !pending)),
      return: canReview && ["SUBMITTED", "NEEDS_REVIEW", "VERIFIED"].includes(ts.status) && ts.invoiceId === null,
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Entering and submitting (13.1)
// ---------------------------------------------------------------------------------------------------

const entrySchema = z.strictObject({
  workDate: z.string(),
  hours: z.preprocess((v) => (typeof v === "number" ? String(v) : (v ?? "")), z.string().trim()),
  rateKind: z.enum(["REGULAR", "OVERTIME", "HOLIDAY"]).optional().default("REGULAR"),
  note: optionalText(500),
});

export async function saveTimesheetEntries(d: Deps, ctx: FirmContext, input: unknown) {
  const { timesheetId, entries } = parse(z.strictObject({ timesheetId: uuid, entries: z.array(entrySchema).max(400) }), input);
  return domainErrors(() =>
    withTenant(d.db, ctx, async (tx) => {
      const { ts } = await loadFor(tx, ctx, timesheetId, "enter", true);
      const days = new Set(periodDays({ start: ts.periodStart, end: ts.periodEnd }));
      const seen = new Set<string>();
      const rows = entries.map((e) => {
        if (!days.has(e.workDate)) throw new ValidationError(`${e.workDate} isn't in this timesheet's period`);
        const key = `${e.workDate}|${e.rateKind}`;
        if (seen.has(key)) throw new ValidationError(`${e.workDate} is entered twice`);
        seen.add(key);
        const h = e.hours === "" ? 0 : parseHours(e.hours);
        if (h === null || !validDayHours(h)) throw new ValidationError(`Hours on ${e.workDate} must be between 0 and 24`);
        return { workDate: e.workDate, hours: h, rateKind: e.rateKind, note: e.note };
      });
      const dayTotals = new Map<string, number>();
      for (const r of rows) dayTotals.set(r.workDate, (dayTotals.get(r.workDate) ?? 0) + r.hours);
      for (const [day, h] of dayTotals) if (h > 2400) throw new ValidationError(`${day} has more than 24 hours in total`);
      const after = await saveEntries(tx, actorOf(ctx), ts, rows);
      return { id: after.id, status: after.status, totalHours: after.totalHours };
    }),
  );
}

export async function submitTimesheet(d: Deps, ctx: FirmContext, input: unknown) {
  const { timesheetId } = parse(z.strictObject({ timesheetId: uuid }), input);
  return domainErrors(() =>
    withTenant(d.db, ctx, async (tx) => {
      const { ts } = await loadFor(tx, ctx, timesheetId, "enter", true);
      const after = (await submit(tx, actorOf(ctx), ts))!;
      return { id: after.id, status: after.status };
    }),
  );
}

/**
 * uploadEvidence: attach an uploaded (scanned, clean) file. Consultants attach to their own
 * timesheet; Finance and Managers can also upload without a timesheet (bulk upload, 8.6), which
 * the extraction then matches or leaves in the unmatched queue.
 */
export async function uploadEvidence(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "UPLOAD_FILES");
  const { timesheetId, fileId } = parse(z.strictObject({ timesheetId: uuid.optional(), fileId: uuid }), input);
  if (!timesheetId && isConsultant(ctx)) throw new ValidationError("Choose the timesheet this screenshot is for");
  const { jobs, result } = await domainErrors(() =>
    withTenant(d.db, ctx, async (tx) => {
      const ts = timesheetId ? (await loadFor(tx, ctx, timesheetId, "enter", true)).ts : null;
      if (!ts) requirePermission(ctx, "ENTER_ANY_TIMESHEETS");
      const file = await getFile(tx, ctx.firmId, fileId);
      // Only your own upload; anything else looks missing (T12).
      if (!file || file.uploadedBy !== ctx.userId) throw new NotFoundError("File not found");
      if (file.scanStatus !== "CLEAN") throw new ConflictError("This file can't be attached until its virus scan is clean");
      const already = await getEvidenceByFile(tx, ctx.firmId, file.id);
      if (already) throw new ConflictError("This file is already attached");
      const r = await attachEvidence(tx, actorOf(ctx), {
        timesheet: ts,
        file,
        source: isConsultant(ctx) ? "CONSULTANT_UPLOAD" : "BULK_UPLOAD",
      });
      return { jobs: r.jobs, result: { evidenceId: r.evidence.id } };
    }),
  );
  await sendJobs(d, jobs);
  return result;
}

export async function removeEvidence(d: Deps, ctx: FirmContext, input: unknown) {
  const { evidenceId } = parse(z.strictObject({ evidenceId: uuid }), input);
  return domainErrors(() =>
    withTenant(d.db, ctx, async (tx) => {
      const ev = await getEvidence(tx, ctx.firmId, evidenceId);
      if (!ev?.timesheetId) throw new NotFoundError();
      const { ts } = await loadFor(tx, ctx, ev.timesheetId, "enter", true);
      if (!isTimesheetEditable(ts.status)) throw new ConflictError("Screenshots can only be removed before the timesheet is submitted");
      await deleteEvidence(tx, ctx.firmId, ev.id);
      await audit(tx, actorOf(ctx), "evidence", ev.id, "delete", ev, null);
      await runChecks(tx, actorOf(ctx), ts.id);
      return { id: ev.id };
    }),
  );
}

// ---------------------------------------------------------------------------------------------------
// Review (13.2 item 2): resolve, verify, return
// ---------------------------------------------------------------------------------------------------

const reason = text(1000, 3);

/** Resolving a check is an override: Manager, Finance or Admin, with a reason, logged (7.6, R5). */
export async function resolveCheck(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "REVIEW_TIMESHEETS");
  const data = parse(z.strictObject({ checkId: uuid, reason }), input);
  return domainErrors(() =>
    withTenant(d.db, ctx, async (tx) => {
      const check = await getCheck(tx, ctx.firmId, data.checkId);
      if (!check) throw new NotFoundError();
      const { ts } = await loadFor(tx, ctx, check.timesheetId, "review", true);
      if (ts.status !== "SUBMITTED" && ts.status !== "NEEDS_REVIEW") throw new ConflictError("Only submitted timesheets have checks to resolve");
      if (check.resolvedAt) throw new ConflictError("This check is already resolved");
      const after = await updateCheck(tx, ctx.firmId, check.id, { resolvedAt: new Date(), resolvedBy: ctx.userId, resolutionReason: data.reason });
      await audit(
        tx,
        actorOf(ctx),
        "timesheet_check",
        check.id,
        "override",
        { code: check.checkCode, severity: check.severity, resolved: false },
        { code: after.checkCode, resolved: true },
        data.reason,
      );
      return { id: check.id };
    }),
  );
}

export async function verifyTimesheet(d: Deps, ctx: FirmContext, input: unknown) {
  const { timesheetId } = parse(z.strictObject({ timesheetId: uuid }), input);
  return domainErrors(() =>
    withTenant(d.db, ctx, async (tx) => {
      const { ts } = await loadFor(tx, ctx, timesheetId, "review", true);
      const a = actorOf(ctx);
      // Re-run first so the decision uses current evidence and entries.
      const fresh = (await runChecks(tx, a, ts.id))!;
      if (fresh.status === "VERIFIED") return { id: fresh.id, status: fresh.status };
      const checks = (await listChecks(tx, ctx.firmId, ts.id)).map((c) => ({
        severity: c.severity,
        resolved: c.resolvedAt !== null,
        reason: c.resolutionReason,
        resolvedByRole: c.resolvedByRole,
      }));
      const evidence = await listEvidenceForTimesheet(tx, ctx.firmId, ts.id);
      if (evidence.some((e) => e.extractionStatus === "QUEUED" || e.extractionStatus === "RUNNING")) {
        throw new ConflictError("The attached file is still being read. Try again in a minute.");
      }
      const event = fresh.status === "SUBMITTED" ? "checks_pass" : "resolve_all";
      const after = await applyTransition(tx, a, fresh, event, { checks }, { verifiedAt: new Date(), verifiedBy: ctx.userId });
      return { id: after.id, status: after.status };
    }),
  );
}

export async function returnTimesheet(d: Deps, ctx: FirmContext, input: unknown) {
  const data = parse(z.strictObject({ timesheetId: uuid, reason }), input);
  const r = await domainErrors(() =>
    withTenant(d.db, ctx, async (tx) => {
      const { ts, engagement } = await loadFor(tx, ctx, data.timesheetId, "review", true);
      const a = actorOf(ctx);
      const after = await applyTransition(
        tx,
        a,
        ts,
        "return",
        // On an approved invoice once invoicing exists (M3); timesheet.invoice_id is set then.
        { reason: data.reason, onApprovedInvoice: ts.invoiceId !== null },
        { returnedReason: data.reason, verifiedAt: null, verifiedBy: null },
        data.reason,
      );
      // A returned timesheet starts review over: earlier resolutions don't carry into the resubmission.
      for (const c of await listChecks(tx, ctx.firmId, ts.id)) {
        if (c.resolvedAt) await updateCheck(tx, ctx.firmId, c.id, { resolvedAt: null, resolvedBy: null, resolutionReason: null });
      }
      const c = (await getConsultant(tx, ctx.firmId, engagement.consultantId))!;
      const firm = (await getFirm(tx, ctx.firmId))!;
      const to = c.emails[0] ?? null;
      const n = to
        ? await insertNotificationOnce(tx, ctx.firmId, {
            toEmail: to,
            type: "timesheet_returned",
            entityType: "timesheet",
            entityId: ts.id,
            channel: "EMAIL",
            dedupeKey: `timesheet_returned:${ts.id}:${Date.now()}`,
          })
        : null;
      return {
        after,
        mail:
          n && to
            ? {
                notificationId: n.id,
                msg: timesheetReturnedEmail({
                  to,
                  firmName: firm.displayName,
                  consultantName: c.firstName,
                  period: periodLabel({ start: ts.periodStart, end: ts.periodEnd }),
                  reason: data.reason,
                  link: `${d.config.baseUrl}/app/timesheets/${ts.id}`,
                }),
              }
            : null,
      };
    }),
  );
  if (r.mail && d.email.enabled) {
    try {
      await d.email.send(r.mail.msg);
      await withTenant(d.db, ctx, (tx) => markNotificationSent(tx, ctx.firmId, r.mail!.notificationId));
    } catch (err) {
      d.log.warn({ err, firm_id: ctx.firmId }, "returned-timesheet email failed");
    }
  }
  return { id: r.after.id, status: r.after.status };
}

// ---------------------------------------------------------------------------------------------------
// Review queues (13.2 items 2–3)
// ---------------------------------------------------------------------------------------------------

const QUEUE_STATUSES = ["NOT_STARTED", "DRAFT", "SUBMITTED", "NEEDS_REVIEW", "VERIFIED", "RETURNED", "INVOICED"] as const;

export async function listTimesheetInbox(d: Deps, ctx: FirmContext, input: unknown = {}) {
  requirePermission(ctx, "REVIEW_TIMESHEETS");
  const { statuses } = parse(z.strictObject({ statuses: z.array(z.enum(QUEUE_STATUSES)).optional() }), input);
  const rows = await withTenant(d.db, ctx, (tx) => listTimesheets(tx, ctx.firmId, { statuses: statuses ?? ["SUBMITTED", "NEEDS_REVIEW"] }));
  return rows.map((r) => ({
    id: r.id,
    consultantName: r.consultantName,
    client: r.billToName,
    period: periodLabel({ start: r.periodStart, end: r.periodEnd }),
    periodStart: r.periodStart,
    status: r.status,
    totalHours: r.totalHours,
    submittedAt: r.submittedAt,
    openBlocks: r.openBlocks,
    openWarnings: r.openWarnings,
    evidenceCount: r.evidenceCount,
  }));
}

export async function listUnmatched(d: Deps, ctx: FirmContext) {
  requirePermission(ctx, "REVIEW_TIMESHEETS");
  return withTenant(d.db, ctx, async (tx) => {
    const rows = await listUnmatchedEvidence(tx, ctx.firmId);
    const open = await listTimesheets(tx, ctx.firmId, { statuses: ["NOT_STARTED", "DRAFT", "RETURNED", "SUBMITTED", "NEEDS_REVIEW"] });
    const items = [];
    for (const r of rows) {
      const raw = (r.extractionRaw ?? null) as { pages?: number; fileId?: string } | null;
      const pages = raw?.pages ? await pageUrls(d, ctx.firmId, raw.fileId ?? r.fileId, Math.min(raw.pages, 1)) : [];
      const x = r.extractionStatus === "DONE" ? extractionResultOf(r.extractionResult) : null;
      items.push({
        id: r.id,
        filename: r.filename,
        source: r.source,
        createdAt: r.createdAt,
        fromAddress: r.fromAddress,
        subject: r.subject,
        reason: r.emailStatusReason,
        consultantName: r.consultantName,
        extractionStatus: r.extractionStatus,
        thumbnail: pages[0] ?? null,
        extracted: x && {
          consultantName: x.consultant_name,
          period: x.period_start && x.period_end ? periodLabel({ start: x.period_start, end: x.period_end }) : null,
          totalHours: x.total_hours === null ? null : formatHours(Math.round(x.total_hours * 100)),
          approvalStatus: x.approval_status,
        },
      });
    }
    return {
      items,
      timesheets: open.map((t) => ({ id: t.id, label: `${t.consultantName} — ${periodLabel({ start: t.periodStart, end: t.periodEnd })} (${t.status.toLowerCase().replace("_", " ")})` })),
    };
  });
}

/** assignUnmatchedFile: Finance links a file from the unmatched queue to a timesheet. */
export async function assignUnmatchedFile(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "REVIEW_TIMESHEETS");
  const { evidenceId, timesheetId } = parse(z.strictObject({ evidenceId: uuid, timesheetId: uuid }), input);
  return domainErrors(() =>
    withTenant(d.db, ctx, async (tx) => {
      const ev = await getEvidence(tx, ctx.firmId, evidenceId);
      if (!ev || ev.timesheetId) throw new NotFoundError();
      const { ts } = await loadFor(tx, ctx, timesheetId, "review", true);
      if (!canAttachEvidence(ts.status)) throw new ConflictError(`Files can't be added to a ${ts.status.toLowerCase().replace("_", " ")} timesheet`);
      const a = actorOf(ctx);
      const e = (await getEngagement(tx, ctx.firmId, ts.engagementId))!;
      await updateEvidence(tx, ctx.firmId, ev.id, { timesheetId: ts.id, consultantId: e.consultantId });
      await audit(tx, a, "evidence", ev.id, "update", { timesheetId: null }, { timesheetId: ts.id }, "Assigned from the unmatched queue");
      const x = ev.extractionId ? await getExtraction(tx, ctx.firmId, ev.extractionId) : null;
      const result = x?.status === "DONE" ? extractionResultOf(x.resultJson) : null;
      const filled = result ? await prefillIfEmpty(tx, a, ts, result) : false;
      if (!filled) await runChecks(tx, a, ts.id);
      if (ev.inboundEmailId) await settleInboundEmail(tx, a, ev.inboundEmailId, null);
      return { id: ev.id, timesheetId: ts.id };
    }),
  );
}
