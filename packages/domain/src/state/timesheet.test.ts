import { describe, expect, it } from "vitest";
import type { Role } from "../roles";
import { InvalidTransitionError } from "./machine";
import {
  TIMESHEET_EVENTS,
  TIMESHEET_STATUSES,
  TransitionGuardError,
  isTimesheetEditable,
  isTimesheetLocked,
  timesheetEventsFrom,
  transitionTimesheet,
  type TimesheetEvent,
  type TimesheetGuardContext,
  type TimesheetStatus,
} from "./timesheet";

const ok = (status: TimesheetStatus, event: TimesheetEvent, ctx: TimesheetGuardContext = {}) =>
  transitionTimesheet(status, event, ctx);

const block = (resolved: boolean, reason: string | null = resolved ? "checked with client" : null, role: Role = "FINANCE") => ({
  severity: "BLOCK" as const,
  resolved,
  reason,
  resolvedByRole: resolved ? role : null,
});

describe("timesheet state machine (6.1)", () => {
  /** Every (from, event) pair in the spec table; anything else must throw. */
  const LISTED: Record<string, TimesheetStatus> = {
    "NOT_STARTED:save_entries": "DRAFT",
    "DRAFT:save_entries": "DRAFT",
    "DRAFT:submit": "SUBMITTED",
    "SUBMITTED:checks_pass": "VERIFIED",
    "SUBMITTED:checks_fail": "NEEDS_REVIEW",
    "NEEDS_REVIEW:resolve_all": "VERIFIED",
    "SUBMITTED:return": "RETURNED",
    "NEEDS_REVIEW:return": "RETURNED",
    "VERIFIED:return": "RETURNED",
    "RETURNED:save_entries": "DRAFT",
    "VERIFIED:add_to_approved_invoice": "INVOICED",
  };

  it("lists every transition in the spec table and nothing else", () => {
    for (const s of TIMESHEET_STATUSES) {
      const expected = TIMESHEET_EVENTS.filter((e) => `${s}:${e}` in LISTED);
      expect(timesheetEventsFrom(s).slice().sort()).toEqual(expected.slice().sort());
    }
  });

  it("rejects every unlisted (status, event) pair with InvalidTransitionError", () => {
    for (const s of TIMESHEET_STATUSES) {
      for (const e of TIMESHEET_EVENTS) {
        if (`${s}:${e}` in LISTED) continue;
        expect(() => ok(s, e), `${s} --${e}-->`).toThrow(InvalidTransitionError);
      }
    }
  });

  it("NOT_STARTED and RETURNED go to DRAFT on save_entries; DRAFT stays DRAFT", () => {
    expect(ok("NOT_STARTED", "save_entries")).toBe("DRAFT");
    expect(ok("RETURNED", "save_entries")).toBe("DRAFT");
    expect(ok("DRAFT", "save_entries")).toBe("DRAFT");
  });

  describe("submit", () => {
    it("needs at least one entry", () => {
      expect(() => ok("DRAFT", "submit", { entryCount: 0, evidenceCount: 1, evidenceRequired: true })).toThrow(
        TransitionGuardError,
      );
    });
    it("needs evidence when the engagement requires it", () => {
      expect(() => ok("DRAFT", "submit", { entryCount: 3, evidenceCount: 0, evidenceRequired: true })).toThrow(
        /screenshot|evidence/i,
      );
    });
    it("allows no evidence when it isn't required", () => {
      expect(ok("DRAFT", "submit", { entryCount: 3, evidenceCount: 0, evidenceRequired: false })).toBe("SUBMITTED");
    });
    it("submits with entries and evidence", () => {
      expect(ok("DRAFT", "submit", { entryCount: 1, evidenceCount: 1, evidenceRequired: true })).toBe("SUBMITTED");
    });
    it("treats a missing guard context as failing (never permissive by default)", () => {
      expect(() => ok("DRAFT", "submit", {})).toThrow(TransitionGuardError);
    });
  });

  describe("checks_pass / checks_fail", () => {
    it("checks_pass needs no unresolved BLOCK", () => {
      expect(ok("SUBMITTED", "checks_pass", { checks: [] })).toBe("VERIFIED");
      expect(ok("SUBMITTED", "checks_pass", { checks: [{ severity: "WARN", resolved: false, reason: null, resolvedByRole: null }] })).toBe(
        "VERIFIED",
      );
      expect(() => ok("SUBMITTED", "checks_pass", { checks: [block(false)] })).toThrow(TransitionGuardError);
    });
    it("checks_fail needs at least one unresolved BLOCK", () => {
      expect(ok("SUBMITTED", "checks_fail", { checks: [block(false)] })).toBe("NEEDS_REVIEW");
      expect(() => ok("SUBMITTED", "checks_fail", { checks: [block(true)] })).toThrow(TransitionGuardError);
    });
    it("needs the checks in the context", () => {
      expect(() => ok("SUBMITTED", "checks_pass", {})).toThrow(TransitionGuardError);
    });
  });

  describe("resolve_all", () => {
    it("verifies when every BLOCK is resolved with a reason by a reviewer", () => {
      expect(ok("NEEDS_REVIEW", "resolve_all", { checks: [block(true), block(true, "ok", "MANAGER")] })).toBe("VERIFIED");
      expect(ok("NEEDS_REVIEW", "resolve_all", { checks: [block(true, "ok", "ADMIN")] })).toBe("VERIFIED");
    });
    it("verifies when the blocking conditions went away on re-run", () => {
      expect(ok("NEEDS_REVIEW", "resolve_all", { checks: [] })).toBe("VERIFIED");
    });
    it("rejects an unresolved BLOCK", () => {
      expect(() => ok("NEEDS_REVIEW", "resolve_all", { checks: [block(true), block(false)] })).toThrow(TransitionGuardError);
    });
    it("rejects a BLOCK resolved without a reason", () => {
      expect(() => ok("NEEDS_REVIEW", "resolve_all", { checks: [block(true, "  ")] })).toThrow(/reason/i);
    });
    it("rejects a BLOCK resolved by a consultant", () => {
      expect(() => ok("NEEDS_REVIEW", "resolve_all", { checks: [block(true, "fine", "CONSULTANT")] })).toThrow(
        TransitionGuardError,
      );
    });
  });

  describe("return", () => {
    for (const from of ["SUBMITTED", "NEEDS_REVIEW", "VERIFIED"] as const) {
      it(`returns from ${from} with a reason`, () => {
        expect(ok(from, "return", { reason: "Wrong week attached", onApprovedInvoice: false })).toBe("RETURNED");
      });
      it(`requires a reason from ${from}`, () => {
        expect(() => ok(from, "return", { reason: " ", onApprovedInvoice: false })).toThrow(/reason/i);
        expect(() => ok(from, "return", { onApprovedInvoice: false })).toThrow(TransitionGuardError);
      });
    }
    it("can't return a VERIFIED timesheet that is on an approved invoice", () => {
      expect(() => ok("VERIFIED", "return", { reason: "late fix", onApprovedInvoice: true })).toThrow(/invoice/i);
    });
    it("needs onApprovedInvoice to be known for VERIFIED", () => {
      expect(() => ok("VERIFIED", "return", { reason: "late fix" })).toThrow(TransitionGuardError);
    });
  });

  it("add_to_approved_invoice moves VERIFIED to INVOICED", () => {
    expect(ok("VERIFIED", "add_to_approved_invoice")).toBe("INVOICED");
  });

  it("INVOICED is locked: no event leaves it (R4)", () => {
    expect(timesheetEventsFrom("INVOICED")).toEqual([]);
    expect(isTimesheetLocked("INVOICED")).toBe(true);
    for (const e of TIMESHEET_EVENTS) expect(() => ok("INVOICED", e, { reason: "x", entryCount: 1 })).toThrow(InvalidTransitionError);
  });

  it("entries are editable only where save_entries is allowed", () => {
    const editable = TIMESHEET_STATUSES.filter(isTimesheetEditable);
    expect(editable.sort()).toEqual(["DRAFT", "NOT_STARTED", "RETURNED"]);
  });
});
