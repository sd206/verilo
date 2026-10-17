/** R1: money is integer cents; percentages are basis points. No floating point for money. */

/** "1,234.5" → 123450. Accepts up to 2 decimals; returns null for anything else. */
export function parseDollars(input: string): number | null {
  const s = input.trim().replace(/[$,\s]/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCents(cents: number, opts: { symbol?: boolean } = {}): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100).toLocaleString("en-US");
  const out = `${dollars}.${String(abs % 100).padStart(2, "0")}`;
  return `${neg ? "-" : ""}${opts.symbol === false ? "" : "$"}${out}`;
}

/** "2.5" → 250 bps; up to 2 decimals. */
export function parsePercentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export function formatBps(bps: number): string {
  const sign = bps < 0 ? "-" : "";
  const a = Math.abs(bps);
  return `${sign}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, "0")}%`;
}

/** Integer division rounding half away from zero (R1's round_half_up for non-negative values). */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error("division by zero");
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** Engagement margin preview (13.2 item 6): per hour and as basis points of the bill rate. */
export function marginPreview(billCents: number, payCents: number | null): { perHourCents: number; marginBps: number } | null {
  if (payCents === null || billCents <= 0) return null;
  const perHourCents = billCents - payCents;
  return { perHourCents, marginBps: divRoundHalfUp(perHourCents * 10_000, billCents) };
}
