/**
 * Timesheet checks (7.6). Pure: the caller loads everything the rules need and stores the results.
 * Extraction results are proposals; these checks are how they're compared with what was entered.
 */
import { addDays, rangeContains, type IsoDate } from "../dates";
import { formatCents } from "../money";
import { resolveRate, type EmploymentType, type Rate, type RateKind } from "../rates/rates";
import { formatHours, hoursFromNumber, lineAmountCents } from "./hours";
import { dayOfWeek, overlapDays, periodDays, shortDate, type Period, type WeekStart } from "./periods";
import { hammingDistanceHex, nameSimilarity } from "./similarity";

export const CHECK_CODES = [
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
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];
export type CheckSeverity = "BLOCK" | "WARN" | "INFO";

export const CHECK_SEVERITY: Record<CheckCode, CheckSeverity> = {
  NO_EVIDENCE: "BLOCK",
  EXTRACTION_PENDING: "BLOCK",
  HOURS_MISMATCH: "BLOCK",
  PERIOD_MISMATCH: "BLOCK",
  NOT_APPROVED: "BLOCK",
  NAME_MISMATCH: "WARN",
  LOW_CONFIDENCE: "WARN",
  DUPLICATE_EVIDENCE: "BLOCK",
  OUTSIDE_ENGAGEMENT: "BLOCK",
  NO_RATE: "BLOCK",
  HOLIDAY_HOURS: "INFO",
  HIGH_HOURS: "WARN",
  PO_EXCEEDED: "WARN",
  RATE_CHANGE_IN_PERIOD: "INFO",
};

export const NAME_MATCH_THRESHOLD = 0.8;
export const OVERALL_CONFIDENCE_MIN = 0.8;
export const HOURS_CONFIDENCE_MIN = 0.85;
export const PERIOD_OVERLAP_MIN = 0.8;
export const PHASH_DUPLICATE_DISTANCE = 5;

/** Section 8.2, as validated by the extractor. */
export interface ExtractedTimesheet {
  document_type: "VMS_TIMESHEET" | "EMAIL_APPROVAL" | "OTHER";
  vms_name: string | null;
  consultant_name: string | null;
  worker_id: string | null;
  timesheet_id: string | null;
  period_start: IsoDate | null;
  period_end: IsoDate | null;
  daily_hours: { date: IsoDate; hours: number; rate_kind: "REGULAR" | "OVERTIME" | "UNKNOWN" }[];
  total_hours: number | null;
  approval_status: "APPROVED" | "SUBMITTED" | "REJECTED" | "DRAFT" | "UNKNOWN";
  approver_name: string | null;
  approved_at: IsoDate | null;
  confidence: { overall: number; period: number; total_hours: number; daily_hours: number; approval_status: number };
  notes: string | null;
}

export type ExtractionStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

export interface CheckEntry {
  workDate: IsoDate;
  /** Hundredths of an hour. */
  hours: number;
  rateKind: RateKind;
}

export interface CheckEvidence {
  evidenceId: string;
  fileId: string;
  sha256: string | null;
  perceptualHash: string | null;
  extraction: { status: ExtractionStatus; result: ExtractedTimesheet | null } | null;
}

/** Evidence linked to other timesheets in the firm, for the duplicate check. */
export interface OtherEvidence {
  timesheetId: string;
  fileId: string;
  sha256: string | null;
  perceptualHash: string | null;
  /** e.g. "Meera Shah, Oct 2026" */
  label: string;
}

export interface TimesheetCheckInput {
  period: Period;
  entries: readonly CheckEntry[];
  engagement: {
    startDate: IsoDate;
    endDate: IsoDate | null;
    evidenceRequired: boolean;
    /** Hundredths. */
    maxWeeklyHoursWarning: number;
    employmentType: EmploymentType;
  };
  weekStart: WeekStart;
  consultantName: string;
  evidence: readonly CheckEvidence[];
  otherEvidence: readonly OtherEvidence[];
  rates: readonly Rate[];
  holidays: readonly { date: IsoDate; name: string }[];
  /** The PO covering the period, with what's already been billed against it. */
  purchaseOrder: { poNumber: string; amountCents: number | null; billedCents: number } | null;
}

export interface CheckResult {
  code: CheckCode;
  severity: CheckSeverity;
  message: string;
}

// ---------------------------------------------------------------------------------------------------
// Hours comparison (also drives the review screen's side-by-side view)
// ---------------------------------------------------------------------------------------------------

export interface HoursComparison {
  enteredTotal: number;
  /** Null when nothing was extracted. */
  extractedTotal: number | null;
  totalsDiffer: boolean;
  hasDaily: boolean;
  days: { date: IsoDate; entered: number; extracted: number | null; differs: boolean }[];
  /** Mismatches that aren't visible in `days`: documents disagreeing, or a total-only document off. */
  notes: string[];
}

const TYPE_ORDER = { VMS_TIMESHEET: 0, EMAIL_APPROVAL: 1, OTHER: 2 } as const;

/** The period a document covers: its header period, else the span of its daily hours. */
export function documentPeriod(x: ExtractedTimesheet): Period | null {
  if (x.period_start && x.period_end && x.period_start <= x.period_end) return { start: x.period_start, end: x.period_end };
  const dates = x.daily_hours.map((d) => d.date).sort();
  if (dates.length) return { start: dates[0]!, end: dates[dates.length - 1]! };
  return null;
}

/**
 * Lines up entered and extracted hours.
 * - Documents with daily hours contribute each day of their period inside the timesheet period
 *   (a day they don't list counts as 0). Two documents that disagree on a day are noted.
 * - A total-only document adds its total if its period doesn't overlap days already counted;
 *   otherwise it corroborates, and its total is compared with the entered hours in its period.
 */
export function compareHours(period: Period, entries: readonly CheckEntry[], results: readonly ExtractedTimesheet[]): HoursComparison {
  const days = periodDays(period);
  const entered = new Map<IsoDate, number>(days.map((d) => [d, 0]));
  for (const e of entries) entered.set(e.workDate, (entered.get(e.workDate) ?? 0) + e.hours);
  const enteredTotal = [...entered.values()].reduce((s, h) => s + h, 0);
  const enteredIn = (p: Period) => days.filter((d) => rangeContains(p.start, p.end, d)).reduce((s, d) => s + entered.get(d)!, 0);

  const notes: string[] = [];
  const daily = new Map<IsoDate, number>();
  const covered = new Set<IsoDate>();
  let totalOnly = 0;
  let anything = false;

  const ordered = [...results].sort((a, b) => TYPE_ORDER[a.document_type] - TYPE_ORDER[b.document_type]);
  for (const x of ordered.filter((r) => r.daily_hours.length > 0)) {
    anything = true;
    const p = documentPeriod(x)!;
    const perDay = new Map<IsoDate, number>();
    for (const d of x.daily_hours) perDay.set(d.date, (perDay.get(d.date) ?? 0) + hoursFromNumber(d.hours));
    for (const d of days) {
      if (!rangeContains(p.start, p.end, d)) continue;
      const h = perDay.get(d) ?? 0;
      if (daily.has(d) && daily.get(d) !== h) {
        notes.push(`The documents disagree on ${shortDate(d)} (${formatHours(daily.get(d)!)} vs ${formatHours(h)})`);
      }
      if (!daily.has(d)) daily.set(d, h);
      covered.add(d);
    }
  }
  for (const x of ordered.filter((r) => r.daily_hours.length === 0)) {
    if (x.total_hours === null) continue;
    anything = true;
    const t = hoursFromNumber(x.total_hours);
    const p = documentPeriod(x);
    const inPeriod = p ? days.filter((d) => rangeContains(p.start, p.end, d)) : days;
    if (inPeriod.every((d) => !covered.has(d))) {
      totalOnly += t;
      inPeriod.forEach((d) => covered.add(d));
    } else {
      const want = p ? enteredIn(p) : enteredTotal;
      if (want !== t) notes.push(`A document shows ${formatHours(t)} hours but ${formatHours(want)} were entered for its dates`);
    }
  }

  const extractedTotal = anything ? [...daily.values()].reduce((s, h) => s + h, 0) + totalOnly : null;
  return {
    enteredTotal,
    extractedTotal,
    totalsDiffer: extractedTotal !== null && extractedTotal !== enteredTotal,
    hasDaily: daily.size > 0,
    days: days.map((d) => {
      const x = daily.has(d) ? daily.get(d)! : null;
      return { date: d, entered: entered.get(d)!, extracted: x, differs: x !== null && x !== entered.get(d) };
    }),
    notes,
  };
}

// ---------------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------------

const list = (items: string[], max = 5) => (items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", "));

function weekKey(date: IsoDate, weekStart: WeekStart): IsoDate {
  const first = weekStart === "MON" ? 1 : 0;
  return addDays(date, -((dayOfWeek(date) - first + 7) % 7));
}

export function runTimesheetChecks(i: TimesheetCheckInput): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (code: CheckCode, message: string) => out.push({ code, severity: CHECK_SEVERITY[code], message });
  const worked = i.entries.filter((e) => e.hours > 0);
  const done = i.evidence.flatMap((e) => (e.extraction?.status === "DONE" && e.extraction.result ? [e.extraction.result] : []));

  // NO_EVIDENCE
  if (i.engagement.evidenceRequired && i.evidence.length === 0) {
    add("NO_EVIDENCE", "Attach a screenshot or PDF of the approved timesheet.");
  }

  // EXTRACTION_PENDING
  const notDone = i.evidence.filter((e) => e.extraction?.status !== "DONE");
  if (notDone.length) {
    const failed = notDone.some((e) => e.extraction?.status === "FAILED" || e.extraction === null);
    add(
      "EXTRACTION_PENDING",
      failed
        ? "We couldn't read an attached file automatically. Someone needs to check it by hand."
        : "We're still reading the attached file. This clears by itself in a minute or two.",
    );
  }

  if (done.length) {
    // HOURS_MISMATCH
    const cmp = compareHours(i.period, i.entries, done);
    const problems: string[] = [];
    if (cmp.extractedTotal === null) {
      problems.push("No hours could be read from the attached documents.");
    } else if (cmp.totalsDiffer) {
      problems.push(`The documents show ${formatHours(cmp.extractedTotal)} hours but ${formatHours(cmp.enteredTotal)} hours were entered.`);
    }
    const dayDiffs = cmp.days.filter((d) => d.differs);
    if (dayDiffs.length) {
      problems.push(
        `Days that differ: ${list(dayDiffs.map((d) => `${shortDate(d.date)} (document ${formatHours(d.extracted!)}, entered ${formatHours(d.entered)})`))}.`,
      );
    }
    problems.push(...cmp.notes.map((n) => `${n}.`));
    if (problems.length) add("HOURS_MISMATCH", problems.join(" "));

    // PERIOD_MISMATCH: the documents together must cover ≥ 80% of the timesheet's days.
    const tsDays = periodDays(i.period);
    const covered = new Set<IsoDate>();
    for (const x of done) {
      const p = documentPeriod(x);
      if (!p) continue;
      for (const d of tsDays) if (rangeContains(p.start, p.end, d)) covered.add(d);
    }
    if (covered.size < PERIOD_OVERLAP_MIN * tsDays.length) {
      const periods = done.map(documentPeriod).filter((p): p is Period => p !== null);
      add(
        "PERIOD_MISMATCH",
        periods.length
          ? `The documents cover ${periods.map((p) => `${shortDate(p.start)} – ${shortDate(p.end)}`).join(", ")}, which doesn't match this timesheet's period.`
          : "We couldn't read a period from the attached documents.",
      );
    }

    // NOT_APPROVED: every document must show APPROVED, unless an approval email is attached.
    if (i.engagement.evidenceRequired) {
      const approvalEmail = done.some((x) => x.document_type === "EMAIL_APPROVAL" && x.approval_status === "APPROVED");
      const unapproved = done.filter((x) => x.approval_status !== "APPROVED");
      if (!approvalEmail && unapproved.length > 0) {
        const s = unapproved[0]!.approval_status;
        add(
          "NOT_APPROVED",
          s === "UNKNOWN"
            ? "The attached timesheet doesn't show that it was approved."
            : `The attached timesheet shows "${s.toLowerCase()}", not approved.`,
        );
      }
    }

    // NAME_MISMATCH
    const names = done.map((x) => x.consultant_name).filter((n): n is string => !!n && n.trim().length > 0);
    const wrong = names.filter((n) => nameSimilarity(n, i.consultantName) < NAME_MATCH_THRESHOLD);
    if (wrong.length) add("NAME_MISMATCH", `The document shows the name "${wrong[0]}", not ${i.consultantName}.`);

    // LOW_CONFIDENCE
    const low = done.some(
      (x) =>
        x.confidence.overall < OVERALL_CONFIDENCE_MIN ||
        x.confidence.total_hours < HOURS_CONFIDENCE_MIN ||
        x.confidence.daily_hours < HOURS_CONFIDENCE_MIN,
    );
    if (low) add("LOW_CONFIDENCE", "Parts of the document were hard to read. Compare the hours with the image.");
  }

  // DUPLICATE_EVIDENCE
  const dupes: string[] = [];
  for (const e of i.evidence) {
    for (const o of i.otherEvidence) {
      const sameSha = !!e.sha256 && e.sha256 === o.sha256;
      const dist = e.perceptualHash && o.perceptualHash ? hammingDistanceHex(e.perceptualHash, o.perceptualHash) : null;
      if (sameSha || (dist !== null && dist <= PHASH_DUPLICATE_DISTANCE)) dupes.push(o.label);
    }
  }
  if (dupes.length) add("DUPLICATE_EVIDENCE", `The same document is already attached to another timesheet: ${list([...new Set(dupes)])}.`);

  // OUTSIDE_ENGAGEMENT
  const outside = worked.filter((e) => !rangeContains(i.engagement.startDate, i.engagement.endDate, e.workDate)).map((e) => e.workDate);
  if (outside.length) add("OUTSIDE_ENGAGEMENT", `Hours are entered outside the engagement dates: ${list([...new Set(outside)].sort().map(shortDate))}.`);

  // NO_RATE and RATE_CHANGE_IN_PERIOD
  const sides = i.engagement.employmentType === "CONTRACTOR" ? (["BILL", "PAY"] as const) : (["BILL"] as const);
  const missing: string[] = [];
  const rateIds = new Map<string, Set<string>>();
  let billedCents = 0;
  for (const e of worked) {
    for (const side of sides) {
      const r = resolveRate(i.rates, side, e.rateKind, e.workDate);
      if (!r.ok) {
        missing.push(`${side === "BILL" ? "bill" : "pay"} rate (${e.rateKind.toLowerCase()}) on ${shortDate(e.workDate)}`);
        continue;
      }
      const key = `${side}:${e.rateKind}`;
      rateIds.set(key, (rateIds.get(key) ?? new Set()).add(r.rateId));
      if (side === "BILL") billedCents += lineAmountCents(e.hours, r.rateCents);
    }
  }
  if (missing.length) add("NO_RATE", `There's no ${list([...new Set(missing)])}.`);

  // HOLIDAY_HOURS
  const holidays = new Map(i.holidays.map((h) => [h.date, h.name]));
  const onHoliday = [...new Set(worked.filter((e) => holidays.has(e.workDate)).map((e) => e.workDate))].sort();
  if (onHoliday.length) {
    add("HOLIDAY_HOURS", `Hours are entered on a holiday: ${list(onHoliday.map((d) => `${shortDate(d)} (${holidays.get(d)})`))}.`);
  }

  // HIGH_HOURS
  const weeks = new Map<IsoDate, number>();
  for (const e of worked) {
    const k = weekKey(e.workDate, i.weekStart);
    weeks.set(k, (weeks.get(k) ?? 0) + e.hours);
  }
  const high = [...weeks.entries()].filter(([, h]) => h > i.engagement.maxWeeklyHoursWarning).sort();
  if (high.length) {
    add(
      "HIGH_HOURS",
      `More than ${formatHours(i.engagement.maxWeeklyHoursWarning)} hours in a week: ${list(high.map(([w, h]) => `week of ${shortDate(w)} (${formatHours(h)})`))}.`,
    );
  }

  // PO_EXCEEDED
  const po = i.purchaseOrder;
  if (po && po.amountCents !== null && po.billedCents + billedCents > po.amountCents) {
    add(
      "PO_EXCEEDED",
      `Billing this timesheet (${formatCents(billedCents, { symbol: true })}) would take PO ${po.poNumber} to ${formatCents(po.billedCents + billedCents, { symbol: true })}, over its ${formatCents(po.amountCents, { symbol: true })}.`,
    );
  }

  if ([...rateIds.values()].some((s) => s.size > 1)) {
    add("RATE_CHANGE_IN_PERIOD", "A rate changes during this period, so the invoice will split the hours into separate lines.");
  }

  const sevOrder = { BLOCK: 0, WARN: 1, INFO: 2 } as const;
  return out.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || CHECK_CODES.indexOf(a.code) - CHECK_CODES.indexOf(b.code));
}

/** Checks overlap helper for callers choosing a PO. */
export function poCoversPeriod(po: { startDate: IsoDate | null; endDate: IsoDate | null }, p: Period): boolean {
  return overlapDays({ start: po.startDate ?? "0001-01-01", end: po.endDate ?? "9999-12-31" }, p) > 0;
}
