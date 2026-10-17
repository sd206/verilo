import { describe, expect, it } from "vitest";
import { periodContaining, periodsFor, startedPeriods, type PeriodEngagement } from "./periods";

const eng = (over: Partial<PeriodEngagement> = {}): PeriodEngagement => ({
  timesheetCycle: "MONTHLY",
  startDate: "2026-01-01",
  endDate: null,
  biweeklyAnchorDate: null,
  weekStart: "MON",
  ...over,
});

describe("periodsFor (7.1)", () => {
  it("MONTHLY: calendar months, including February and leap years", () => {
    expect(periodsFor(eng({ startDate: "2028-01-01" }), "2028-01-10", "2028-03-05")).toEqual([
      { start: "2028-01-01", end: "2028-01-31" },
      { start: "2028-02-01", end: "2028-02-29" },
      { start: "2028-03-01", end: "2028-03-31" },
    ]);
  });

  it("clips the first and last periods to the engagement dates", () => {
    expect(periodsFor(eng({ startDate: "2026-09-10", endDate: "2026-11-20" }), "2026-09-01", "2026-12-31")).toEqual([
      { start: "2026-09-10", end: "2026-09-30" },
      { start: "2026-10-01", end: "2026-10-31" },
      { start: "2026-11-01", end: "2026-11-20" },
    ]);
  });

  it("returns nothing outside the engagement", () => {
    expect(periodsFor(eng({ startDate: "2026-09-01", endDate: "2026-09-30" }), "2026-10-01", "2026-12-31")).toEqual([]);
    expect(periodsFor(eng({ startDate: "2026-09-01" }), "2026-01-01", "2026-08-31")).toEqual([]);
  });

  it("SEMIMONTHLY: 1st–15th and 16th–last day", () => {
    expect(periodsFor(eng({ timesheetCycle: "SEMIMONTHLY" }), "2026-02-01", "2026-03-01")).toEqual([
      { start: "2026-02-01", end: "2026-02-15" },
      { start: "2026-02-16", end: "2026-02-28" },
      { start: "2026-03-01", end: "2026-03-15" },
    ]);
  });

  it("WEEKLY: 7-day periods starting on the firm's week start (MON)", () => {
    // 2026-10-01 is a Thursday; the engagement started earlier, so the week starts Monday 2026-09-28.
    expect(periodsFor(eng({ timesheetCycle: "WEEKLY" }), "2026-10-01", "2026-10-12")).toEqual([
      { start: "2026-09-28", end: "2026-10-04" },
      { start: "2026-10-05", end: "2026-10-11" },
      { start: "2026-10-12", end: "2026-10-18" },
    ]);
  });

  it("WEEKLY: SUN week start, clipped to an engagement starting midweek", () => {
    expect(periodsFor(eng({ timesheetCycle: "WEEKLY", weekStart: "SUN", startDate: "2026-10-01" }), "2026-10-01", "2026-10-10")).toEqual([
      { start: "2026-10-01", end: "2026-10-03" },
      { start: "2026-10-04", end: "2026-10-10" },
    ]);
  });

  it("BIWEEKLY: 14-day periods aligned to the anchor, also before the anchor", () => {
    const e = eng({ timesheetCycle: "BIWEEKLY", biweeklyAnchorDate: "2026-09-07", startDate: "2026-08-01" });
    expect(periodsFor(e, "2026-08-20", "2026-09-30")).toEqual([
      { start: "2026-08-10", end: "2026-08-23" },
      { start: "2026-08-24", end: "2026-09-06" },
      { start: "2026-09-07", end: "2026-09-20" },
      { start: "2026-09-21", end: "2026-10-04" },
    ]);
  });

  it("BIWEEKLY without an anchor is an error", () => {
    expect(() => periodsFor(eng({ timesheetCycle: "BIWEEKLY" }), "2026-01-01", "2026-01-31")).toThrow(/anchor/);
  });

  it("rejects from > to", () => {
    expect(() => periodsFor(eng(), "2026-02-01", "2026-01-01")).toThrow();
  });

  it("periodContaining returns the clipped period for a date", () => {
    expect(periodContaining(eng({ startDate: "2026-09-10" }), "2026-09-15")).toEqual({ start: "2026-09-10", end: "2026-09-30" });
    expect(periodContaining(eng({ startDate: "2026-09-10" }), "2026-09-01")).toBeNull();
  });

  it("startedPeriods lists every period that has started by today (for the nightly job)", () => {
    const e = eng({ startDate: "2026-09-01" });
    expect(startedPeriods(e, "2026-10-16")).toEqual([
      { start: "2026-09-01", end: "2026-09-30" },
      { start: "2026-10-01", end: "2026-10-31" },
    ]);
    expect(startedPeriods(eng({ startDate: "2026-11-01" }), "2026-10-16")).toEqual([]);
  });
});

describe("firm-local dates (R12)", async () => {
  const { localDate, localHour, monthStart } = await import("../dates");
  it("uses the firm's time zone, not UTC", () => {
    const t = new Date("2026-10-17T03:30:00Z"); // 22:30 on Oct 16 in Chicago (CDT)
    expect(localDate(t, "America/Chicago")).toBe("2026-10-16");
    expect(localHour(t, "America/Chicago")).toBe(22);
    expect(localDate(t, "UTC")).toBe("2026-10-17");
    expect(monthStart("2026-10-16")).toBe("2026-10-01");
  });
});
