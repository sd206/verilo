import { isIsoDate, rangeContains, rangesOverlap, type IsoDate } from "../dates";

export const RATE_SIDES = ["BILL", "PAY"] as const;
export type RateSide = (typeof RATE_SIDES)[number];
export const RATE_KINDS = ["REGULAR", "OVERTIME", "HOLIDAY"] as const;
export type RateKind = (typeof RATE_KINDS)[number];
export type EmploymentType = "W2" | "CONTRACTOR";

/** Section 5.3: effective-dated, `effectiveTo` inclusive, rate in integer cents per hour (R1). */
export interface Rate {
  id: string;
  side: RateSide;
  rateKind: RateKind;
  rateCents: number;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
}

/** The first existing rate that covers any day of `candidate` for the same side and kind. */
export function findOverlap(existing: readonly Rate[], candidate: Rate): Rate | null {
  return (
    existing.find(
      (e) =>
        e.id !== candidate.id &&
        e.side === candidate.side &&
        e.rateKind === candidate.rateKind &&
        rangesOverlap(e.effectiveFrom, e.effectiveTo, candidate.effectiveFrom, candidate.effectiveTo),
    ) ?? null
  );
}

export type RateCheck =
  | { ok: true }
  | { ok: false; code: "INVALID_AMOUNT" | "INVALID_RANGE" | "PAY_RATE_W2" | "END_LATER"; message: string }
  | { ok: false; code: "OVERLAP"; message: string; conflictId: string };

export function validateNewRate(
  existing: readonly Rate[],
  candidate: Rate,
  engagement: { employmentType: EmploymentType },
): RateCheck {
  if (!Number.isSafeInteger(candidate.rateCents) || candidate.rateCents <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Rate must be a positive amount in whole cents" };
  }
  if (
    !isIsoDate(candidate.effectiveFrom) ||
    (candidate.effectiveTo !== null && !isIsoDate(candidate.effectiveTo)) ||
    (candidate.effectiveTo !== null && candidate.effectiveTo < candidate.effectiveFrom)
  ) {
    return { ok: false, code: "INVALID_RANGE", message: "The end date must be on or after the start date" };
  }
  if (candidate.side === "PAY" && engagement.employmentType !== "CONTRACTOR") {
    return { ok: false, code: "PAY_RATE_W2", message: "Pay rates apply only to contractor engagements" };
  }
  const conflict = findOverlap(existing, candidate);
  if (conflict) {
    return {
      ok: false,
      code: "OVERLAP",
      conflictId: conflict.id,
      message: `Overlaps the ${conflict.side.toLowerCase()} ${conflict.rateKind.toLowerCase()} rate starting ${conflict.effectiveFrom}. End that rate first.`,
    };
  }
  return { ok: true };
}

/** endRate: sets an end date. Only shortening is allowed; moving it later could overlap a later rate. */
export function validateRateEnd(rate: Rate, endDate: IsoDate): RateCheck {
  if (!isIsoDate(endDate) || endDate < rate.effectiveFrom) {
    return { ok: false, code: "INVALID_RANGE", message: "The end date must be on or after the start date" };
  }
  if (rate.effectiveTo !== null && endDate > rate.effectiveTo) {
    return { ok: false, code: "END_LATER", message: "A rate's end date can only be moved earlier. Add a new rate instead." };
  }
  return { ok: true };
}

export type RateResolution = { ok: true; rateCents: number; rateId: string } | { ok: false; error: "NO_RATE" };

/** Section 7.2: exactly one rate must cover the date; otherwise NO_RATE (blocks invoicing that day). */
export function resolveRate(rates: readonly Rate[], side: RateSide, rateKind: RateKind, date: IsoDate): RateResolution {
  const matches = rates.filter(
    (r) => r.side === side && r.rateKind === rateKind && rangeContains(r.effectiveFrom, r.effectiveTo, date),
  );
  if (matches.length !== 1) return { ok: false, error: "NO_RATE" };
  return { ok: true, rateCents: matches[0]!.rateCents, rateId: matches[0]!.id };
}
