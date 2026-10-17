import { describe, expect, it } from "vitest";
import { hammingDistanceHex, nameSimilarity } from "./similarity";
import { chooseEngagement, chooseTimesheet, matchConsultant, prefillEntries } from "./matching";
import type { ExtractedTimesheet } from "./checks";

describe("nameSimilarity", () => {
  it("is 1 for the same name in any order, case or punctuation", () => {
    expect(nameSimilarity("Ravi Kumar", "ravi kumar")).toBe(1);
    expect(nameSimilarity("Ravi Kumar", "KUMAR, Ravi")).toBe(1);
  });
  it("is high for an initial or a small typo", () => {
    expect(nameSimilarity("Ravi Kumar", "Ravi K.")).toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity("Ravi Kumar", "Ravi Kumarr")).toBeGreaterThanOrEqual(0.85);
  });
  it("tolerates a middle name", () => {
    expect(nameSimilarity("Ravi Kumar", "Ravi Shankar Kumar")).toBeGreaterThanOrEqual(0.8);
  });
  it("is low for a different person", () => {
    expect(nameSimilarity("Ravi Kumar", "Meera Shah")).toBeLessThan(0.5);
    expect(nameSimilarity("Ravi Kumar", "Ravi Patel")).toBeLessThan(0.8);
  });
  it("is 0 for empty input", () => {
    expect(nameSimilarity("", "Ravi")).toBe(0);
    expect(nameSimilarity("  ", "  ")).toBe(0);
  });
});

describe("hammingDistanceHex", () => {
  it("counts differing bits", () => {
    expect(hammingDistanceHex("ffff0000ffff0000", "ffff0000ffff0000")).toBe(0);
    expect(hammingDistanceHex("ffff0000ffff0000", "fffe0000ffff000f")).toBe(5);
    expect(hammingDistanceHex("0000000000000000", "ffffffffffffffff")).toBe(64);
  });
  it("returns null for mismatched or invalid hashes", () => {
    expect(hammingDistanceHex("ff", "ffff")).toBeNull();
    expect(hammingDistanceHex("zz", "ff")).toBeNull();
  });
});

const consultants = [
  { id: "ravi", name: "Ravi Kumar", emails: ["ravi@lonestar.test", "ravi.k@gmail.test"], active: true },
  { id: "meera", name: "Meera Shah", emails: ["meera@lonestar.test"], active: true },
  { id: "old", name: "Ravi Kumaran", emails: ["old@x.test"], active: false },
];

describe("matchConsultant (8.6 step 1)", () => {
  it("matches the sender address, ignoring case", () => {
    expect(matchConsultant({ fromAddress: "Ravi.K@Gmail.test", extractedName: "Someone Else" }, consultants)).toEqual({
      matched: true,
      consultantId: "ravi",
      by: "EMAIL",
    });
  });
  it("falls back to the extracted name (≥ 0.85, active consultants only)", () => {
    expect(matchConsultant({ fromAddress: "unknown@x.test", extractedName: "Shah, Meera" }, consultants)).toEqual({
      matched: true,
      consultantId: "meera",
      by: "NAME",
    });
  });
  it("is unmatched when the best name is below 0.85", () => {
    expect(matchConsultant({ fromAddress: "unknown@x.test", extractedName: "Ravi Patel" }, consultants).matched).toBe(false);
  });
  it("is unmatched when two consultants tie for the best name", () => {
    const twins = [
      { id: "a", name: "Anil Rao", emails: [], active: true },
      { id: "b", name: "Anil Rao", emails: [], active: true },
    ];
    expect(matchConsultant({ fromAddress: null, extractedName: "Anil Rao" }, twins)).toEqual({ matched: false, reason: "AMBIGUOUS_NAME" });
  });
  it("is unmatched with neither an address nor a name", () => {
    expect(matchConsultant({ fromAddress: null, extractedName: null }, consultants)).toEqual({ matched: false, reason: "NO_MATCH" });
  });
});

const engagements = [
  { id: "e-sep", status: "ACTIVE", startDate: "2026-09-01", endDate: null, primeConsultantRef: "GX-1001", endClientWorkerRef: null },
  { id: "e-2", status: "ACTIVE", startDate: "2026-10-01", endDate: null, primeConsultantRef: null, endClientWorkerRef: "W-77" },
  { id: "e-draft", status: "DRAFT", startDate: "2026-01-01", endDate: null, primeConsultantRef: null, endClientWorkerRef: null },
  { id: "e-ended", status: "ENDED", startDate: "2026-01-01", endDate: "2026-06-30", primeConsultantRef: null, endClientWorkerRef: null },
] as const;

describe("chooseEngagement (8.6 step 2)", () => {
  it("picks the single ACTIVE engagement covering the period", () => {
    expect(chooseEngagement([...engagements], { start: "2026-09-01", end: "2026-09-30" }, null)).toEqual({ ok: true, engagementId: "e-sep" });
  });
  it("uses worker_id against prime_consultant_ref or end_client_worker_ref to break a tie", () => {
    const oct = { start: "2026-10-01", end: "2026-10-31" };
    expect(chooseEngagement([...engagements], oct, "W-77")).toEqual({ ok: true, engagementId: "e-2" });
    expect(chooseEngagement([...engagements], oct, "gx-1001")).toEqual({ ok: true, engagementId: "e-sep" });
  });
  it("asks Finance when it's still ambiguous", () => {
    expect(chooseEngagement([...engagements], { start: "2026-10-01", end: "2026-10-31" }, null)).toEqual({ ok: false, reason: "AMBIGUOUS" });
  });
  it("finds nothing when no ACTIVE engagement covers the period", () => {
    expect(chooseEngagement([...engagements], { start: "2026-03-01", end: "2026-03-31" }, null)).toEqual({ ok: false, reason: "NONE" });
  });
  it("with no extracted period, uses the only ACTIVE engagement", () => {
    expect(chooseEngagement([engagements[0]], null, null)).toEqual({ ok: true, engagementId: "e-sep" });
    expect(chooseEngagement([...engagements], null, null)).toEqual({ ok: false, reason: "AMBIGUOUS" });
  });
});

describe("chooseTimesheet (8.6 step 3)", () => {
  const sheets = [
    { id: "w1", periodStart: "2026-09-28", periodEnd: "2026-10-04" },
    { id: "w2", periodStart: "2026-10-05", periodEnd: "2026-10-11" },
  ];
  it("picks the largest overlap", () => {
    expect(chooseTimesheet(sheets, { start: "2026-10-03", end: "2026-10-09" })).toBe("w2");
    expect(chooseTimesheet(sheets, { start: "2026-09-28", end: "2026-10-04" })).toBe("w1");
  });
  it("breaks a tie with the earlier period", () => {
    expect(chooseTimesheet(sheets, { start: "2026-10-03", end: "2026-10-06" })).toBe("w1");
  });
  it("returns null without overlap or without a period", () => {
    expect(chooseTimesheet(sheets, { start: "2026-12-01", end: "2026-12-07" })).toBeNull();
    expect(chooseTimesheet(sheets, null)).toBeNull();
  });
});

const ext = (over: Partial<ExtractedTimesheet>): ExtractedTimesheet => ({
  document_type: "VMS_TIMESHEET",
  vms_name: null,
  consultant_name: null,
  worker_id: null,
  timesheet_id: null,
  period_start: "2026-10-05",
  period_end: "2026-10-11",
  daily_hours: [],
  total_hours: 40,
  approval_status: "APPROVED",
  approver_name: null,
  approved_at: null,
  confidence: { overall: 0.9, period: 0.9, total_hours: 0.9, daily_hours: 0.9, approval_status: 0.9 },
  notes: null,
  ...over,
});

describe("prefillEntries (8.6 step 4)", () => {
  const week = { start: "2026-10-05", end: "2026-10-11" };
  it("copies daily hours inside the period; UNKNOWN rate kind becomes REGULAR; zero days are skipped", () => {
    expect(
      prefillEntries(
        ext({
          daily_hours: [
            { date: "2026-10-04", hours: 8, rate_kind: "REGULAR" },
            { date: "2026-10-05", hours: 7.5, rate_kind: "UNKNOWN" },
            { date: "2026-10-06", hours: 2, rate_kind: "OVERTIME" },
            { date: "2026-10-07", hours: 0, rate_kind: "REGULAR" },
          ],
        }),
        week,
      ),
    ).toEqual([
      { workDate: "2026-10-05", hours: 750, rateKind: "REGULAR" },
      { workDate: "2026-10-06", hours: 200, rateKind: "OVERTIME" },
    ]);
  });
  it("adds up duplicate (date, rate kind) rows", () => {
    expect(
      prefillEntries(ext({ daily_hours: [{ date: "2026-10-05", hours: 4, rate_kind: "REGULAR" }, { date: "2026-10-05", hours: 4, rate_kind: "UNKNOWN" }] }), week),
    ).toEqual([{ workDate: "2026-10-05", hours: 800, rateKind: "REGULAR" }]);
  });
  it("puts a total of up to 24 hours on the last working day", () => {
    expect(prefillEntries(ext({ total_hours: 16 }), week)).toEqual([{ workDate: "2026-10-09", hours: 1600, rateKind: "REGULAR" }]);
  });
  it("spreads a larger total over the working days (a day can't exceed 24 hours)", () => {
    const rows = prefillEntries(ext({ total_hours: 42 }), week);
    expect(rows.map((r) => r.workDate)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(rows.reduce((s, r) => s + r.hours, 0)).toBe(4200);
    expect(rows.every((r) => r.hours <= 2400)).toBe(true);
    expect(rows.at(-1)?.hours).toBe(840);
  });
  it("returns nothing when no hours were read", () => {
    expect(prefillEntries(ext({ total_hours: 0 }), week)).toEqual([]);
    expect(prefillEntries(ext({ total_hours: null }), week)).toEqual([]);
  });
});
