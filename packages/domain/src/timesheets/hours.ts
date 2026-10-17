/**
 * Hours are NUMERIC(7,2) in the database (R1). In the domain they are integer hundredths of an hour,
 * so sums and comparisons are exact ("8.00" ↔ 800).
 */

const RE = /^\s*(\d{1,5})(?:\.(\d{1,2}))?\s*$/;

/** "7.5" → 750. Null for anything that isn't a non-negative number with at most 2 decimals. */
export function parseHours(input: string): number | null {
  const m = RE.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** 750 → "7.50" (the NUMERIC text form). */
export function formatHours(hundredths: number): string {
  const sign = hundredths < 0 ? "-" : "";
  const a = Math.abs(hundredths);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** A model's decimal (7.5) → 750. Hours aren't money, so rounding a float to hundredths is fine. */
export function hoursFromNumber(n: number): number {
  return Math.round(n * 100);
}

export const MAX_DAY_HOURS = 2400;

/** Daily entry bounds from 5.4: 0–24. */
export function validDayHours(hundredths: number): boolean {
  return Number.isInteger(hundredths) && hundredths >= 0 && hundredths <= MAX_DAY_HOURS;
}

/** round_half_up(hours × rate) to whole cents, with hours in hundredths (R1). */
export function lineAmountCents(hoursHundredths: number, rateCents: number): number {
  const p = hoursHundredths * rateCents;
  return Math.floor((p + 50) / 100);
}
