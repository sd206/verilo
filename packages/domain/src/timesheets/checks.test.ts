import { describe, expect, it } from "vitest";
import type { Rate } from "../rates/rates";
import {
  CHECK_CODES,
  CHECK_SEVERITY,
  compareHours,
  runTimesheetChecks,
  type CheckEvidence,
  type ExtractedTimesheet,
  type TimesheetCheckInput,
} from "./checks";

// --- Fixtures --------------------------------------------------------------------------------------
// Ravi Kumar, monthly October 2026 timesheet, $95 bill / $75 pay (section 18.1).

const OCT_WEEKDAYS = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`).filter((d) => {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
});
// 22 weekdays in October 2026 → 176.00 hours at 8/day.

const rates: Rate[] = [
  { id: "bill-1", side: "BILL", rateKind: "REGULAR", rateCents: 9500, effectiveFrom: "2026-09-01", effectiveTo: null },
  { id: "pay-1", side: "PAY", rateKind: "REGULAR", rateCents: 7500, effectiveFrom: "2026-09-01", effectiveTo: null },
];

function extracted(over: Partial<ExtractedTimesheet> = {}): ExtractedTimesheet {
  return {
    document_type: "VMS_TIMESHEET",
    vms_name: "SAP Fieldglass",
    consultant_name: "Ravi Kumar",
    worker_id: null,
    timesheet_id: null,
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    daily_hours: [],
    total_hours: 176,
    approval_status: "APPROVED",
    approver_name: "Pat Manager",
    approved_at: "2026-11-02",
    confidence: { overall: 0.95, period: 0.95, total_hours: 0.95, daily_hours: 0.95, approval_status: 0.95 },
    notes: null,
    ...over,
  };
}

function ev(over: Partial<CheckEvidence> = {}, result: ExtractedTimesheet | null = extracted()): CheckEvidence {
  return {
    evidenceId: "ev-1",
    fileId: "file-1",
    sha256: "a".repeat(64),
    perceptualHash: "ffff0000ffff0000",
    extraction: result ? { status: "DONE", result } : null,
    ...over,
  };
}

function input(over: Partial<TimesheetCheckInput> = {}): TimesheetCheckInput {
  return {
    period: { start: "2026-10-01", end: "2026-10-31" },
    entries: OCT_WEEKDAYS.map((d) => ({ workDate: d, hours: 800, rateKind: "REGULAR" as const })),
    engagement: {
      startDate: "2026-09-01",
      endDate: null,
      evidenceRequired: true,
      maxWeeklyHoursWarning: 5000,
      employmentType: "CONTRACTOR",
    },
    weekStart: "MON",
    consultantName: "Ravi Kumar",
    evidence: [ev()],
    otherEvidence: [],
    rates,
    holidays: [],
    purchaseOrder: null,
    ...over,
  };
}

const codes = (i: TimesheetCheckInput) => runTimesheetChecks(i).map((c) => c.code).sort();
const find = (i: TimesheetCheckInput, code: string) => runTimesheetChecks(i).find((c) => c.code === code);

describe("runTimesheetChecks (7.6)", () => {
  it("a clean timesheet raises nothing", () => {
    expect(runTimesheetChecks(input())).toEqual([]);
  });

  it("every code has the severity the spec gives it", () => {
    expect(CHECK_SEVERITY).toEqual({
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
    });
    expect(CHECK_CODES).toHaveLength(14);
  });

  it("each result carries the code's severity and a plain-language message", () => {
    const all = runTimesheetChecks(input({ evidence: [], holidays: [{ date: "2026-10-12", name: "Columbus Day" }] }));
    for (const c of all) {
      expect(c.severity).toBe(CHECK_SEVERITY[c.code]);
      expect(c.message.length).toBeGreaterThan(10);
    }
  });

  describe("NO_EVIDENCE", () => {
    it("fires when evidence is required and none is attached", () => {
      expect(codes(input({ evidence: [] }))).toEqual(["NO_EVIDENCE"]);
    });
    it("doesn't fire when evidence isn't required", () => {
      const i = input({ evidence: [] });
      i.engagement.evidenceRequired = false;
      expect(codes(i)).toEqual([]);
    });
  });

  describe("EXTRACTION_PENDING", () => {
    for (const status of ["QUEUED", "RUNNING", "FAILED"] as const) {
      it(`fires while an extraction is ${status}`, () => {
        expect(codes(input({ evidence: [ev({ extraction: { status, result: null } })] }))).toContain("EXTRACTION_PENDING");
      });
    }
    it("fires for evidence that has no extraction at all", () => {
      expect(codes(input({ evidence: [ev({}, null)] }))).toEqual(["EXTRACTION_PENDING"]);
    });
    it("says a FAILED read needs checking by hand", () => {
      expect(find(input({ evidence: [ev({ extraction: { status: "FAILED", result: null } })] }), "EXTRACTION_PENDING")?.message).toMatch(
        /by hand/i,
      );
    });
    it("doesn't fire once every extraction is DONE", () => {
      expect(codes(input())).not.toContain("EXTRACTION_PENDING");
    });
  });

  describe("HOURS_MISMATCH", () => {
    it("T3: Ravi enters 176.00 but the screenshot says 168.00", () => {
      const c = find(input({ evidence: [ev({}, extracted({ total_hours: 168 }))] }), "HOURS_MISMATCH");
      expect(c?.severity).toBe("BLOCK");
      expect(c?.message).toContain("168.00");
      expect(c?.message).toContain("176.00");
    });
    it("is exact to 0.01", () => {
      expect(codes(input({ evidence: [ev({}, extracted({ total_hours: 175.99 }))] }))).toContain("HOURS_MISMATCH");
      expect(codes(input({ evidence: [ev({}, extracted({ total_hours: 176.0 }))] }))).not.toContain("HOURS_MISMATCH");
    });
    it("compares per day when daily hours were extracted, even if totals agree", () => {
      // Same 176 total, but 8 hours moved from Oct 1 to Oct 3 (a Saturday).
      const daily = OCT_WEEKDAYS.map((d) => ({ date: d, hours: d === "2026-10-01" ? 0 : 8, rate_kind: "REGULAR" as const }));
      daily.push({ date: "2026-10-03", hours: 8, rate_kind: "REGULAR" });
      const c = find(input({ evidence: [ev({}, extracted({ daily_hours: daily }))] }), "HOURS_MISMATCH");
      expect(c).toBeDefined();
      expect(c?.message).toMatch(/Oct 1/);
      expect(c?.message).toMatch(/Oct 3/);
    });
    it("sums several weekly screenshots on one monthly timesheet", () => {
      const weeks = [
        // The VMS splits weeks at the month boundary.
        ["2026-10-01", "2026-10-04", 16],
        ["2026-10-05", "2026-10-11", 40],
        ["2026-10-12", "2026-10-18", 40],
        ["2026-10-19", "2026-10-25", 40],
        ["2026-10-26", "2026-10-31", 40],
      ] as const;
      const evidence = weeks.map(([s, e, h], n) =>
        ev({ evidenceId: `ev-${n}`, fileId: `f-${n}`, sha256: String(n).repeat(64), perceptualHash: null }, extracted({ period_start: s, period_end: e, total_hours: h })),
      );
      expect(codes(input({ evidence }))).toEqual([]);
    });
    it("doesn't double-count a day that appears on two documents with the same hours", () => {
      const day = [{ date: "2026-10-01", hours: 8, rate_kind: "REGULAR" as const }];
      const i = input({
        period: { start: "2026-10-01", end: "2026-10-01" },
        entries: [{ workDate: "2026-10-01", hours: 800, rateKind: "REGULAR" }],
        evidence: [
          ev({ evidenceId: "a", fileId: "fa", sha256: "1".repeat(64), perceptualHash: null }, extracted({ period_start: "2026-10-01", period_end: "2026-10-01", daily_hours: day, total_hours: 8 })),
          ev({ evidenceId: "b", fileId: "fb", sha256: "2".repeat(64), perceptualHash: null }, extracted({ document_type: "EMAIL_APPROVAL", period_start: "2026-10-01", period_end: "2026-10-01", daily_hours: day, total_hours: 8 })),
        ],
      });
      expect(codes(i)).toEqual([]);
    });
    it("ignores extracted days outside the timesheet period when daily hours exist", () => {
      // A week spanning Sep 28 – Oct 4 on the October timesheet.
      const i = input({
        period: { start: "2026-10-01", end: "2026-10-04" },
        entries: ["2026-10-01", "2026-10-02"].map((d) => ({ workDate: d, hours: 800, rateKind: "REGULAR" as const })),
        evidence: [
          ev({}, extracted({
            period_start: "2026-09-28",
            period_end: "2026-10-04",
            total_hours: 40,
            daily_hours: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((d) => ({ date: d, hours: 8, rate_kind: "REGULAR" as const })),
          })),
        ],
      });
      expect(codes(i)).not.toContain("HOURS_MISMATCH");
    });
    it("isn't evaluated without a DONE extraction", () => {
      expect(codes(input({ evidence: [ev({ extraction: { status: "QUEUED", result: null } })] }))).not.toContain("HOURS_MISMATCH");
    });
  });

  describe("PERIOD_MISMATCH", () => {
    it("fires when the extracted period covers less than 80% of the timesheet's days", () => {
      // Oct 1–24 is 24 of 31 days = 77%.
      expect(codes(input({ evidence: [ev({}, extracted({ period_start: "2026-10-01", period_end: "2026-10-24" }))] }))).toContain(
        "PERIOD_MISMATCH",
      );
    });
    it("passes at exactly 80% or more", () => {
      // 25 of 31 = 80.6%.
      expect(codes(input({ evidence: [ev({}, extracted({ period_start: "2026-10-01", period_end: "2026-10-25" }))] }))).not.toContain(
        "PERIOD_MISMATCH",
      );
    });
    it("fires for the wrong month", () => {
      expect(codes(input({ evidence: [ev({}, extracted({ period_start: "2026-09-01", period_end: "2026-09-30" }))] }))).toContain(
        "PERIOD_MISMATCH",
      );
    });
    it("fires when no period could be read", () => {
      expect(codes(input({ evidence: [ev({}, extracted({ period_start: null, period_end: null }))] }))).toContain("PERIOD_MISMATCH");
    });
    it("uses the period implied by daily hours when the header period is missing", () => {
      const daily = OCT_WEEKDAYS.map((d) => ({ date: d, hours: 8, rate_kind: "REGULAR" as const }));
      expect(codes(input({ evidence: [ev({}, extracted({ period_start: null, period_end: null, daily_hours: daily }))] }))).not.toContain(
        "PERIOD_MISMATCH",
      );
    });
  });

  describe("NOT_APPROVED", () => {
    for (const s of ["SUBMITTED", "REJECTED", "DRAFT", "UNKNOWN"] as const) {
      it(`fires when the screenshot shows ${s}`, () => {
        expect(codes(input({ evidence: [ev({}, extracted({ approval_status: s }))] }))).toContain("NOT_APPROVED");
      });
    }
    it("doesn't fire when evidence isn't required", () => {
      const i = input({ evidence: [ev({}, extracted({ approval_status: "SUBMITTED" }))] });
      i.engagement.evidenceRequired = false;
      expect(codes(i)).not.toContain("NOT_APPROVED");
    });
    it("an approval email makes a SUBMITTED screenshot acceptable", () => {
      const i = input({
        evidence: [
          ev({}, extracted({ approval_status: "SUBMITTED" })),
          ev({ evidenceId: "ev-2", fileId: "f-2", sha256: "b".repeat(64), perceptualHash: null }, extracted({ document_type: "EMAIL_APPROVAL", approval_status: "APPROVED" })),
        ],
      });
      expect(codes(i)).not.toContain("NOT_APPROVED");
    });
  });

  describe("NAME_MISMATCH", () => {
    it("fires for a different person", () => {
      expect(find(input({ evidence: [ev({}, extracted({ consultant_name: "Meera Shah" }))] }), "NAME_MISMATCH")?.severity).toBe("WARN");
    });
    it("accepts reordered names, case and punctuation", () => {
      expect(codes(input({ evidence: [ev({}, extracted({ consultant_name: "KUMAR, Ravi" }))] }))).toEqual([]);
    });
    it("accepts an initial for the last name", () => {
      expect(codes(input({ evidence: [ev({}, extracted({ consultant_name: "Ravi K." }))] }))).toEqual([]);
    });
    it("doesn't fire when no name was read", () => {
      expect(codes(input({ evidence: [ev({}, extracted({ consultant_name: null }))] }))).toEqual([]);
    });
  });

  describe("LOW_CONFIDENCE", () => {
    const conf = (c: Partial<ExtractedTimesheet["confidence"]>) =>
      extracted({ confidence: { overall: 0.95, period: 0.95, total_hours: 0.95, daily_hours: 0.95, approval_status: 0.95, ...c } });
    it("fires when overall < 0.80", () => {
      expect(codes(input({ evidence: [ev({}, conf({ overall: 0.79 }))] }))).toContain("LOW_CONFIDENCE");
      expect(codes(input({ evidence: [ev({}, conf({ overall: 0.8 }))] }))).not.toContain("LOW_CONFIDENCE");
    });
    it("fires when an hours field < 0.85", () => {
      expect(codes(input({ evidence: [ev({}, conf({ total_hours: 0.84 }))] }))).toContain("LOW_CONFIDENCE");
      expect(codes(input({ evidence: [ev({}, conf({ daily_hours: 0.84 }))] }))).toContain("LOW_CONFIDENCE");
      expect(codes(input({ evidence: [ev({}, conf({ total_hours: 0.85, daily_hours: 0.85 }))] }))).not.toContain("LOW_CONFIDENCE");
    });
    it("counts the daily-hours confidence as an hours field", () => {
      expect(codes(input({ evidence: [ev({}, conf({ daily_hours: 0.2 }))] }))).toContain("LOW_CONFIDENCE");
    });
  });

  describe("DUPLICATE_EVIDENCE", () => {
    it("T4: the same screenshot (sha256) already on another timesheet", () => {
      const c = find(
        input({ otherEvidence: [{ timesheetId: "ts-meera", fileId: "file-9", sha256: "a".repeat(64), perceptualHash: null, label: "Meera Shah, Oct 2026", extracted: null }] }),
        "DUPLICATE_EVIDENCE",
      );
      expect(c?.severity).toBe("BLOCK");
      expect(c?.message).toContain("Meera Shah, Oct 2026");
    });
    // Image similarity alone isn't enough: screenshots from the same VMS share a layout and hash
    // within a few bits of each other. A near-identical image counts only when its content matches.
    const near = "fffe0000ffff000f"; // 1 + 4 = 5 bits from the evidence's ffff0000ffff0000
    it("a near-identical image (distance ≤ 5) with the same content: same VMS timesheet id", () => {
      const other = { timesheetId: "ts-x", fileId: "f-x", sha256: "c".repeat(64), perceptualHash: near, label: "x", extracted: extracted({ timesheet_id: "FG-1", consultant_name: "Someone Else" }) };
      const i = input({ otherEvidence: [other], evidence: [ev({}, extracted({ timesheet_id: "FG-1" }))] });
      expect(codes(i)).toContain("DUPLICATE_EVIDENCE");
    });
    it("a near-identical image with the same name, period and total", () => {
      const other = { timesheetId: "ts-x", fileId: "f-x", sha256: "c".repeat(64), perceptualHash: near, label: "x", extracted: extracted({ consultant_name: "KUMAR, Ravi" }) };
      expect(codes(input({ otherEvidence: [other] }))).toContain("DUPLICATE_EVIDENCE");
    });
    it("a near-identical image with different content (another week, same VMS layout) is not a duplicate", () => {
      const otherWeek = extracted({ period_start: "2026-09-01", period_end: "2026-09-30", total_hours: 168 });
      const other = { timesheetId: "ts-x", fileId: "f-x", sha256: "c".repeat(64), perceptualHash: "ffff0000ffff0000", label: "x", extracted: otherWeek };
      expect(codes(input({ otherEvidence: [other] }))).not.toContain("DUPLICATE_EVIDENCE");
    });
    it("a near-identical image whose content wasn't read can't be confirmed, so it isn't flagged", () => {
      const other = { timesheetId: "ts-x", fileId: "f-x", sha256: "c".repeat(64), perceptualHash: near, label: "x", extracted: null };
      expect(codes(input({ otherEvidence: [other] }))).not.toContain("DUPLICATE_EVIDENCE");
    });
    it("distance 6 is not a duplicate even with the same content", () => {
      const other = { timesheetId: "ts-x", fileId: "f-x", sha256: "c".repeat(64), perceptualHash: "fffc0000ffff000f", label: "x", extracted: extracted() };
      expect(codes(input({ otherEvidence: [other] }))).not.toContain("DUPLICATE_EVIDENCE");
    });
    it("the same file on the same timesheet is not a duplicate of itself", () => {
      expect(codes(input({ otherEvidence: [] }))).not.toContain("DUPLICATE_EVIDENCE");
    });
  });

  describe("OUTSIDE_ENGAGEMENT", () => {
    it("fires for hours before the engagement start", () => {
      const i = input();
      i.engagement.startDate = "2026-10-05";
      expect(find(i, "OUTSIDE_ENGAGEMENT")?.message).toMatch(/Oct 1/);
    });
    it("fires for hours after the engagement end", () => {
      const i = input();
      i.engagement.endDate = "2026-10-29";
      expect(codes(i)).toContain("OUTSIDE_ENGAGEMENT");
    });
    it("ignores zero-hour days", () => {
      const i = input({ entries: [{ workDate: "2026-10-01", hours: 0, rateKind: "REGULAR" }, ...input().entries.slice(1)] });
      i.engagement.startDate = "2026-10-02";
      expect(codes(i)).not.toContain("OUTSIDE_ENGAGEMENT");
    });
  });

  describe("NO_RATE", () => {
    it("fires without a bill rate", () => {
      expect(codes(input({ rates: rates.filter((r) => r.side !== "BILL") }))).toContain("NO_RATE");
    });
    it("fires without a pay rate for a contractor", () => {
      expect(find(input({ rates: rates.filter((r) => r.side !== "PAY") }), "NO_RATE")?.message).toMatch(/pay rate/i);
    });
    it("doesn't need a pay rate for a W-2 employee", () => {
      const i = input({ rates: rates.filter((r) => r.side !== "PAY") });
      i.engagement.employmentType = "W2";
      expect(codes(i)).not.toContain("NO_RATE");
    });
    it("checks the entry's rate kind (overtime needs an overtime rate)", () => {
      const i = input({ evidence: [ev({}, extracted({ total_hours: 178 }))] });
      i.entries = [...i.entries, { workDate: "2026-10-01", hours: 200, rateKind: "OVERTIME" }];
      expect(codes(i)).toEqual(["NO_RATE"]);
    });
  });

  it("HOLIDAY_HOURS: hours on a firm holiday (INFO)", () => {
    const c = find(input({ holidays: [{ date: "2026-10-12", name: "Columbus Day" }] }), "HOLIDAY_HOURS");
    expect(c?.severity).toBe("INFO");
    expect(c?.message).toContain("Columbus Day");
  });

  describe("HIGH_HOURS", () => {
    it("fires when a week exceeds max_weekly_hours_warning", () => {
      const i = input();
      i.engagement.maxWeeklyHoursWarning = 3900; // 39.00
      expect(find(i, "HIGH_HOURS")?.severity).toBe("WARN");
    });
    it("doesn't fire at exactly the limit", () => {
      const i = input();
      i.engagement.maxWeeklyHoursWarning = 4000;
      expect(codes(i)).not.toContain("HIGH_HOURS");
    });
    it("groups by the firm's week start", () => {
      // Fri + Sat + Sun at 20 h: one 60 h week when weeks start Monday; 40 h + 20 h when they start Sunday.
      const entries = ["2026-10-02", "2026-10-03", "2026-10-04"].map((d) => ({ workDate: d, hours: 2000, rateKind: "REGULAR" as const }));
      const base = input({ entries, evidence: [ev({}, extracted({ total_hours: 60 }))], period: { start: "2026-10-01", end: "2026-10-07" } });
      base.engagement.maxWeeklyHoursWarning = 5000;
      expect(codes({ ...base, weekStart: "MON" })).toContain("HIGH_HOURS");
      expect(codes({ ...base, weekStart: "SUN" })).not.toContain("HIGH_HOURS");
    });
  });

  describe("PO_EXCEEDED", () => {
    // 176 h × $95 = $16,720.00
    it("fires when this timesheet pushes the billed total over the PO amount", () => {
      const c = find(input({ purchaseOrder: { poNumber: "GLX-WO-7781", amountCents: 6_000_000, billedCents: 4_400_000 } }), "PO_EXCEEDED");
      expect(c?.severity).toBe("WARN");
      expect(c?.message).toContain("GLX-WO-7781");
    });
    it("doesn't fire when it lands exactly on the amount", () => {
      expect(codes(input({ purchaseOrder: { poNumber: "P", amountCents: 6_000_000, billedCents: 6_000_000 - 1_672_000 } }))).not.toContain(
        "PO_EXCEEDED",
      );
    });
    it("doesn't fire for a PO without an amount", () => {
      expect(codes(input({ purchaseOrder: { poNumber: "P", amountCents: null, billedCents: 99_999_999 } }))).not.toContain("PO_EXCEEDED");
    });
  });

  describe("RATE_CHANGE_IN_PERIOD", () => {
    it("fires when the bill rate changes inside the period (INFO)", () => {
      const r: Rate[] = [
        { id: "b1", side: "BILL", rateKind: "REGULAR", rateCents: 9500, effectiveFrom: "2026-09-01", effectiveTo: "2026-10-15" },
        { id: "b2", side: "BILL", rateKind: "REGULAR", rateCents: 10000, effectiveFrom: "2026-10-16", effectiveTo: null },
        rates[1]!,
      ];
      const c = find(input({ rates: r }), "RATE_CHANGE_IN_PERIOD");
      expect(c?.severity).toBe("INFO");
      expect(c?.message).toMatch(/split/i);
    });
    it("fires when the pay rate changes for a contractor", () => {
      const r: Rate[] = [
        rates[0]!,
        { id: "p1", side: "PAY", rateKind: "REGULAR", rateCents: 7500, effectiveFrom: "2026-09-01", effectiveTo: "2026-10-15" },
        { id: "p2", side: "PAY", rateKind: "REGULAR", rateCents: 8000, effectiveFrom: "2026-10-16", effectiveTo: null },
      ];
      expect(codes(input({ rates: r }))).toContain("RATE_CHANGE_IN_PERIOD");
    });
  });

  it("returns results in a stable order (severity, then code)", () => {
    const i = input({ evidence: [], holidays: [{ date: "2026-10-12", name: "Columbus Day" }] });
    i.engagement.maxWeeklyHoursWarning = 1000;
    expect(runTimesheetChecks(i).map((c) => c.code)).toEqual(["NO_EVIDENCE", "HIGH_HOURS", "HOLIDAY_HOURS"]);
  });
});

describe("compareHours (review screen)", () => {
  it("lines up entered and extracted hours per day and flags differences", () => {
    const i = input({
      entries: [
        { workDate: "2026-10-01", hours: 800, rateKind: "REGULAR" },
        { workDate: "2026-10-02", hours: 800, rateKind: "REGULAR" },
      ],
    });
    const cmp = compareHours(i.period, i.entries, [
      extracted({ total_hours: 15, daily_hours: [{ date: "2026-10-01", hours: 8, rate_kind: "REGULAR" }, { date: "2026-10-02", hours: 7, rate_kind: "REGULAR" }] }),
    ]);
    expect(cmp.enteredTotal).toBe(1600);
    expect(cmp.extractedTotal).toBe(1500);
    expect(cmp.totalsDiffer).toBe(true);
    expect(cmp.days.find((d) => d.date === "2026-10-02")).toEqual({ date: "2026-10-02", entered: 800, extracted: 700, differs: true });
    expect(cmp.days.find((d) => d.date === "2026-10-01")?.differs).toBe(false);
    expect(cmp.days).toHaveLength(31);
  });
  it("has null extracted days when only a total was read", () => {
    const cmp = compareHours({ start: "2026-10-01", end: "2026-10-02" }, [], [extracted({ total_hours: 8 })]);
    expect(cmp.hasDaily).toBe(false);
    expect(cmp.days[0]?.extracted).toBeNull();
    expect(cmp.extractedTotal).toBe(800);
  });
  it("has a null extracted total with no extractions", () => {
    expect(compareHours({ start: "2026-10-01", end: "2026-10-01" }, [], []).extractedTotal).toBeNull();
  });
});
