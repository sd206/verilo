/** Timesheet periods (7.1). */
import { addDays, daysBetween, type IsoDate } from "../dates";
import type { Cycle } from "../master/cycles";

export type WeekStart = "MON" | "SUN";

export interface Period {
  start: IsoDate;
  end: IsoDate;
}

export interface PeriodEngagement {
  timesheetCycle: Cycle;
  startDate: IsoDate;
  endDate: IsoDate | null;
  biweeklyAnchorDate: IsoDate | null;
  weekStart: WeekStart;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function isWeekend(date: IsoDate): boolean {
  const d = dayOfWeek(date);
  return d === 0 || d === 6;
}

function lastDayOfMonth(date: IsoDate): IsoDate {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The unclipped cycle period that contains `date`. */
function rawPeriod(e: PeriodEngagement, date: IsoDate): Period {
  switch (e.timesheetCycle) {
    case "MONTHLY":
      return { start: `${date.slice(0, 8)}01`, end: lastDayOfMonth(date) };
    case "SEMIMONTHLY":
      return Number(date.slice(8)) <= 15
        ? { start: `${date.slice(0, 8)}01`, end: `${date.slice(0, 8)}15` }
        : { start: `${date.slice(0, 8)}16`, end: lastDayOfMonth(date) };
    case "WEEKLY": {
      const first = e.weekStart === "MON" ? 1 : 0;
      const back = (dayOfWeek(date) - first + 7) % 7;
      const start = addDays(date, -back);
      return { start, end: addDays(start, 6) };
    }
    case "BIWEEKLY": {
      if (!e.biweeklyAnchorDate) throw new Error("A biweekly engagement needs an anchor date");
      const offset = daysBetween(e.biweeklyAnchorDate, date);
      const k = Math.floor(offset / 14);
      const start = addDays(e.biweeklyAnchorDate, k * 14);
      return { start, end: addDays(start, 13) };
    }
  }
}

function clip(e: PeriodEngagement, p: Period): Period | null {
  const start = p.start < e.startDate ? e.startDate : p.start;
  const end = e.endDate !== null && p.end > e.endDate ? e.endDate : p.end;
  return start <= end ? { start, end } : null;
}

/** Periods touching [from, to], clipped to the engagement's start and end. */
export function periodsFor(e: PeriodEngagement, from: IsoDate, to: IsoDate): Period[] {
  if (from > to) throw new Error("from must not be after to");
  const out: Period[] = [];
  let cursor = from < e.startDate ? e.startDate : from;
  const last = e.endDate !== null && e.endDate < to ? e.endDate : to;
  while (cursor <= last) {
    const raw = rawPeriod(e, cursor);
    const p = clip(e, raw);
    if (p) out.push(p);
    cursor = addDays(raw.end, 1);
  }
  return out;
}

export function periodContaining(e: PeriodEngagement, date: IsoDate): Period | null {
  if (date < e.startDate || (e.endDate !== null && date > e.endDate)) return null;
  return clip(e, rawPeriod(e, date));
}

/** Every period that has started on or before `today` (the nightly job creates a timesheet for each). */
export function startedPeriods(e: PeriodEngagement, today: IsoDate): Period[] {
  if (today < e.startDate) return [];
  return periodsFor(e, e.startDate, today);
}

export function periodDays(p: Period): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function overlapDays(a: Period, b: Period): number {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? daysBetween(start, end) + 1 : 0;
}

/** "Oct 2026", "Oct 1 – 7, 2026", "Sep 28 – Oct 4, 2026". */
export function periodLabel(p: Period): string {
  const mon = (d: IsoDate) => MONTHS[Number(d.slice(5, 7)) - 1]!;
  const day = (d: IsoDate) => Number(d.slice(8));
  const y = (d: IsoDate) => d.slice(0, 4);
  if (p.start.slice(8) === "01" && p.end === lastDayOfMonth(p.start)) return `${mon(p.start)} ${y(p.start)}`;
  if (p.start.slice(0, 7) === p.end.slice(0, 7)) return `${mon(p.start)} ${day(p.start)} – ${day(p.end)}, ${y(p.end)}`;
  if (y(p.start) === y(p.end)) return `${mon(p.start)} ${day(p.start)} – ${mon(p.end)} ${day(p.end)}, ${y(p.end)}`;
  return `${mon(p.start)} ${day(p.start)}, ${y(p.start)} – ${mon(p.end)} ${day(p.end)}, ${y(p.end)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 3" */
export function shortDate(d: IsoDate): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}`;
}
