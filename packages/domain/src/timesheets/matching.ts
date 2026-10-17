/** Matching extracted timesheets to consultants, engagements and timesheets (8.6). */
import { rangeContains, type IsoDate } from "../dates";
import type { RateKind } from "../rates/rates";
import { documentPeriod, type CheckEntry, type ExtractedTimesheet } from "./checks";
import { hoursFromNumber, MAX_DAY_HOURS } from "./hours";
import { isWeekend, overlapDays, periodDays, type Period } from "./periods";
import { nameSimilarity } from "./similarity";

export const CONSULTANT_NAME_MATCH_MIN = 0.85;

export interface MatchCandidate {
  id: string;
  name: string;
  emails: readonly string[];
  active: boolean;
}

export type ConsultantMatch =
  | { matched: true; consultantId: string; by: "EMAIL" | "NAME" }
  | { matched: false; reason: "NO_MATCH" | "AMBIGUOUS_NAME" };

/** Step 1: sender address first, then the extracted name (≥ 0.85, a single best active consultant). */
export function matchConsultant(
  input: { fromAddress: string | null; extractedName: string | null },
  consultants: readonly MatchCandidate[],
): ConsultantMatch {
  const from = input.fromAddress?.trim().toLowerCase();
  if (from) {
    const byEmail = consultants.find((c) => c.emails.some((e) => e.toLowerCase() === from));
    if (byEmail) return { matched: true, consultantId: byEmail.id, by: "EMAIL" };
  }
  const name = input.extractedName?.trim();
  if (!name) return { matched: false, reason: "NO_MATCH" };
  const scored = consultants
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, s: nameSimilarity(name, c.name) }))
    .filter((x) => x.s >= CONSULTANT_NAME_MATCH_MIN)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) return { matched: false, reason: "NO_MATCH" };
  if (scored.length > 1 && scored[1]!.s === scored[0]!.s) return { matched: false, reason: "AMBIGUOUS_NAME" };
  return { matched: true, consultantId: scored[0]!.id, by: "NAME" };
}

export interface EngagementCandidate {
  id: string;
  status: string;
  startDate: IsoDate;
  endDate: IsoDate | null;
  primeConsultantRef: string | null;
  endClientWorkerRef: string | null;
}

export type EngagementChoice = { ok: true; engagementId: string } | { ok: false; reason: "NONE" | "AMBIGUOUS" };

/** Step 2: the ACTIVE engagement covering the period; worker_id breaks a tie; otherwise Finance decides. */
export function chooseEngagement(
  engagements: readonly EngagementCandidate[],
  period: Period | null,
  workerId: string | null,
): EngagementChoice {
  const active = engagements.filter((e) => e.status === "ACTIVE");
  const covering = period
    ? active.filter((e) => overlapDays({ start: e.startDate, end: e.endDate ?? "9999-12-31" }, period) > 0)
    : active;
  if (covering.length === 0) return { ok: false, reason: "NONE" };
  if (covering.length === 1) return { ok: true, engagementId: covering[0]!.id };
  const w = workerId?.trim().toLowerCase();
  if (w) {
    const byRef = covering.filter((e) => [e.primeConsultantRef, e.endClientWorkerRef].some((r) => r?.trim().toLowerCase() === w));
    if (byRef.length === 1) return { ok: true, engagementId: byRef[0]!.id };
  }
  return { ok: false, reason: "AMBIGUOUS" };
}

/** Step 3: the timesheet overlapping the period the most (earlier period on a tie). */
export function chooseTimesheet(
  timesheets: readonly { id: string; periodStart: IsoDate; periodEnd: IsoDate }[],
  period: Period | null,
): string | null {
  if (!period) return null;
  let best: { id: string; days: number; start: IsoDate } | null = null;
  for (const t of timesheets) {
    const days = overlapDays({ start: t.periodStart, end: t.periodEnd }, period);
    if (days === 0) continue;
    if (!best || days > best.days || (days === best.days && t.periodStart < best.start)) best = { id: t.id, days, start: t.periodStart };
  }
  return best?.id ?? null;
}

/** The extracted period to match on (header, else the span of the daily hours). */
export { documentPeriod as extractedPeriod };

/**
 * Step 4: proposed entries for an empty timesheet. Daily hours inside the period are copied.
 * Without a daily breakdown the total goes on the last working day; a total over 24 hours
 * (a day's maximum, 5.4) is spread evenly over the working days, remainder on the last day.
 */
export function prefillEntries(x: ExtractedTimesheet, period: Period): CheckEntry[] {
  if (x.daily_hours.length > 0) {
    const sums = new Map<string, number>();
    for (const d of x.daily_hours) {
      if (!rangeContains(period.start, period.end, d.date)) continue;
      const kind: RateKind = d.rate_kind === "OVERTIME" ? "OVERTIME" : "REGULAR";
      const key = `${d.date}|${kind}`;
      sums.set(key, (sums.get(key) ?? 0) + hoursFromNumber(d.hours));
    }
    return [...sums.entries()]
      .filter(([, h]) => h > 0)
      .map(([k, h]) => {
        const [workDate, rateKind] = k.split("|") as [IsoDate, RateKind];
        return { workDate, hours: Math.min(h, MAX_DAY_HOURS), rateKind };
      })
      .sort((a, b) => (a.workDate < b.workDate ? -1 : a.workDate > b.workDate ? 1 : a.rateKind < b.rateKind ? 1 : -1));
  }
  const total = x.total_hours === null ? 0 : hoursFromNumber(x.total_hours);
  if (total <= 0) return [];
  const docP = documentPeriod(x);
  const span: Period =
    docP && overlapDays(docP, period) > 0
      ? { start: docP.start > period.start ? docP.start : period.start, end: docP.end < period.end ? docP.end : period.end }
      : period;
  let working = periodDays(span).filter((d) => !isWeekend(d));
  if (working.length === 0) working = periodDays(span);
  if (total <= MAX_DAY_HOURS) return [{ workDate: working[working.length - 1]!, hours: total, rateKind: "REGULAR" }];
  const n = Math.min(working.length, Math.max(Math.ceil(total / MAX_DAY_HOURS), working.length));
  const base = Math.floor(total / n);
  const days = working.slice(working.length - n);
  return days.map((d, idx) => ({ workDate: d, hours: idx === n - 1 ? total - base * (n - 1) : base, rateKind: "REGULAR" as const }));
}
