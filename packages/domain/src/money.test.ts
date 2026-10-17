import { describe, expect, it } from "vitest";
import { divRoundHalfUp, formatBps, formatCents, marginPreview, parseDollars, parsePercentToBps } from "./money";

describe("money (R1)", () => {
  it("parses dollars into exact cents", () => {
    expect(parseDollars("95.00")).toBe(9500);
    expect(parseDollars("$60,000")).toBe(6_000_000);
    expect(parseDollars("0.1")).toBe(10);
    expect(parseDollars("75.5")).toBe(7550);
    expect(parseDollars("1.005")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
  });
  it("formats cents with two decimals and thousands separators", () => {
    expect(formatCents(6_000_000)).toBe("$60,000.00");
    expect(formatCents(-205)).toBe("-$2.05");
    expect(formatCents(5, { symbol: false })).toBe("0.05");
  });
  it("converts percentages and basis points", () => {
    expect(parsePercentToBps("2")).toBe(200);
    expect(parsePercentToBps("2.5%")).toBe(250);
    expect(parsePercentToBps("2.555")).toBeNull();
    expect(formatBps(2105)).toBe("21.05%");
    expect(formatBps(7500)).toBe("75.00%");
  });
  it("rounds half up in integer division", () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
    expect(divRoundHalfUp(200_000, 9500)).toBe(21);
  });
});

describe("marginPreview (M1 acceptance: E1 = $20.00/h, 21.05%)", () => {
  it("computes E1", () => {
    expect(marginPreview(9500, 7500)).toEqual({ perHourCents: 2000, marginBps: 2105 });
  });
  it("is unavailable without a pay rate (W-2 engagements)", () => {
    expect(marginPreview(11000, null)).toBeNull();
  });
});
