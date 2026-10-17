/**
 * Work dates are calendar dates stored as DATE and handled as "YYYY-MM-DD" strings (R12).
 * They're never converted through a time zone, so lexical order is date order.
 */
export type IsoDate = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= days;
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive ranges; `null` end means open-ended. */
export function rangesOverlap(aFrom: IsoDate, aTo: IsoDate | null, bFrom: IsoDate, bTo: IsoDate | null): boolean {
  const aEndsBeforeB = aTo !== null && aTo < bFrom;
  const bEndsBeforeA = bTo !== null && bTo < aFrom;
  return !aEndsBeforeB && !bEndsBeforeA;
}

export function rangeContains(from: IsoDate, to: IsoDate | null, date: IsoDate): boolean {
  return from <= date && (to === null || date <= to);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const t = (s: IsoDate) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** The calendar date of `instant` in an IANA time zone (R12: work dates are firm-local). */
export function localDate(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The hour (0–23) of `instant` in an IANA time zone. */
export function localHour(instant: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(instant);
  return Number(h) % 24;
}

/** First day of the month containing `date`. */
export function monthStart(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}
