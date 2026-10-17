/**
 * Section 5.3 (rate: effective-dated, never overlapping per engagement/side/kind) and
 * section 7.2 (resolveRate). Written before the implementation.
 */
import { describe, expect, it } from "vitest";
import { findOverlap, resolveRate, validateNewRate, validateRateEnd, type Rate } from "./rates";

const r = (over: Partial<Rate>): Rate => ({
  id: over.id ?? "r1",
  side: "BILL",
  rateKind: "REGULAR",
  rateCents: 9500,
  effectiveFrom: "2026-09-01",
  effectiveTo: null,
  ...over,
});

describe("findOverlap — no two rates may cover the same day for one (side, kind)", () => {
  const existing = [r({ id: "a", effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" })];

  it("rejects a rate starting on the last day of an existing one (ranges are inclusive)", () => {
    expect(findOverlap(existing, r({ id: "n", effectiveFrom: "2026-09-30" }))?.id).toBe("a");
  });

  it("accepts a rate starting the day after", () => {
    expect(findOverlap(existing, r({ id: "n", effectiveFrom: "2026-10-01" }))).toBeNull();
  });

  it("rejects a rate ending on the first day of an existing one", () => {
    expect(
      findOverlap(existing, r({ id: "n", effectiveFrom: "2026-08-01", effectiveTo: "2026-09-01" }))?.id,
    ).toBe("a");
  });

  it("accepts a rate ending the day before", () => {
    expect(findOverlap(existing, r({ id: "n", effectiveFrom: "2026-08-01", effectiveTo: "2026-08-31" }))).toBeNull();
  });

  it("rejects a rate fully inside or fully around an existing one", () => {
    expect(findOverlap(existing, r({ effectiveFrom: "2026-09-10", effectiveTo: "2026-09-12" }))).not.toBeNull();
    expect(findOverlap(existing, r({ effectiveFrom: "2026-08-01", effectiveTo: "2026-12-31" }))).not.toBeNull();
  });

  it("treats an open end date as running forever", () => {
    const open = [r({ id: "open", effectiveFrom: "2026-09-01", effectiveTo: null })];
    expect(findOverlap(open, r({ effectiveFrom: "2030-01-01" }))?.id).toBe("open");
    expect(findOverlap(open, r({ effectiveFrom: "2026-01-01", effectiveTo: "2026-08-31" }))).toBeNull();
    expect(findOverlap(open, r({ effectiveFrom: "2026-01-01", effectiveTo: null }))?.id).toBe("open");
  });

  it("ignores other sides and other rate kinds", () => {
    const open = [r({ id: "bill", side: "BILL", rateKind: "REGULAR" })];
    expect(findOverlap(open, r({ side: "PAY" }))).toBeNull();
    expect(findOverlap(open, r({ rateKind: "OVERTIME" }))).toBeNull();
  });

  it("ignores the rate itself when re-checking an edit", () => {
    const open = [r({ id: "same" })];
    expect(findOverlap(open, r({ id: "same", effectiveTo: "2026-12-31" }))).toBeNull();
  });
});

describe("validateNewRate", () => {
  it("accepts the seed's E1 bill and pay rates", () => {
    expect(validateNewRate([], r({ rateCents: 9500 }), { employmentType: "CONTRACTOR" })).toEqual({ ok: true });
    expect(validateNewRate([], r({ side: "PAY", rateCents: 7500 }), { employmentType: "CONTRACTOR" })).toEqual({ ok: true });
  });

  it("rejects PAY rates on W-2 engagements (PAY only for CONTRACTOR)", () => {
    expect(validateNewRate([], r({ side: "PAY" }), { employmentType: "W2" })).toMatchObject({ ok: false, code: "PAY_RATE_W2" });
  });

  it("rejects non-integer, zero or negative cents (R1)", () => {
    for (const cents of [0, -100, 95.5, Number.NaN]) {
      expect(validateNewRate([], r({ rateCents: cents }), { employmentType: "W2" })).toMatchObject({ ok: false, code: "INVALID_AMOUNT" });
    }
  });

  it("rejects an end date before the start date", () => {
    expect(validateNewRate([], r({ effectiveFrom: "2026-09-10", effectiveTo: "2026-09-09" }), { employmentType: "W2" })).toMatchObject({
      ok: false,
      code: "INVALID_RANGE",
    });
  });

  it("rejects overlaps and names the conflicting rate", () => {
    const existing = [r({ id: "a" })];
    expect(validateNewRate(existing, r({ id: "b", effectiveFrom: "2026-11-01", rateCents: 10000 }), { employmentType: "W2" })).toMatchObject({
      ok: false,
      code: "OVERLAP",
      conflictId: "a",
    });
  });

  it("rejects malformed dates", () => {
    expect(validateNewRate([], r({ effectiveFrom: "2026-02-30" }), { employmentType: "W2" })).toMatchObject({ ok: false, code: "INVALID_RANGE" });
  });
});

describe("validateRateEnd — ending an open rate so a new one can start", () => {
  it("allows ending on or after the start date", () => {
    expect(validateRateEnd(r({}), "2026-10-31")).toEqual({ ok: true });
    expect(validateRateEnd(r({}), "2026-09-01")).toEqual({ ok: true });
  });
  it("rejects ending before the start date", () => {
    expect(validateRateEnd(r({}), "2026-08-31")).toMatchObject({ ok: false, code: "INVALID_RANGE" });
  });
  it("rejects moving an end date later (that could overlap a following rate; add a new rate instead)", () => {
    expect(validateRateEnd(r({ effectiveTo: "2026-09-30" }), "2026-10-15")).toMatchObject({ ok: false, code: "END_LATER" });
  });
});

describe("resolveRate (section 7.2)", () => {
  const rates = [
    r({ id: "b1", rateCents: 9500, effectiveFrom: "2026-09-01", effectiveTo: "2026-10-15" }),
    r({ id: "b2", rateCents: 10000, effectiveFrom: "2026-10-16", effectiveTo: null }),
    r({ id: "p1", side: "PAY", rateCents: 7500, effectiveFrom: "2026-09-01" }),
  ];

  it("returns the rate covering the date", () => {
    expect(resolveRate(rates, "BILL", "REGULAR", "2026-09-01")).toEqual({ ok: true, rateCents: 9500, rateId: "b1" });
    expect(resolveRate(rates, "BILL", "REGULAR", "2026-10-15")).toEqual({ ok: true, rateCents: 9500, rateId: "b1" });
    expect(resolveRate(rates, "BILL", "REGULAR", "2026-10-16")).toEqual({ ok: true, rateCents: 10000, rateId: "b2" });
    expect(resolveRate(rates, "BILL", "REGULAR", "2031-01-01")).toEqual({ ok: true, rateCents: 10000, rateId: "b2" });
    expect(resolveRate(rates, "PAY", "REGULAR", "2026-10-20")).toEqual({ ok: true, rateCents: 7500, rateId: "p1" });
  });

  it("returns NO_RATE before the first rate starts", () => {
    expect(resolveRate(rates, "BILL", "REGULAR", "2026-08-31")).toEqual({ ok: false, error: "NO_RATE" });
  });

  it("returns NO_RATE in a gap between rates", () => {
    const gap = [
      r({ id: "x", effectiveFrom: "2026-09-01", effectiveTo: "2026-09-30" }),
      r({ id: "y", effectiveFrom: "2026-10-02" }),
    ];
    expect(resolveRate(gap, "BILL", "REGULAR", "2026-10-01")).toEqual({ ok: false, error: "NO_RATE" });
  });

  it("returns NO_RATE for a kind that has no rates (e.g. OVERTIME)", () => {
    expect(resolveRate(rates, "BILL", "OVERTIME", "2026-10-01")).toEqual({ ok: false, error: "NO_RATE" });
  });

  it("returns NO_RATE when more than one rate matches (exactly one must cover the date)", () => {
    const bad = [r({ id: "x" }), r({ id: "y", effectiveFrom: "2026-09-15" })];
    expect(resolveRate(bad, "BILL", "REGULAR", "2026-10-01")).toEqual({ ok: false, error: "NO_RATE" });
  });
});
