import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@verilo/domain";
import { CAPABILITIES, can, requirePermission, type Capability } from "./permissions";
import { ForbiddenError } from "./errors";

// Section 12, transcribed independently so a change to CAPABILITIES must match the spec table.
const A = "ADMIN", M = "MANAGER", F = "FINANCE", C = "CONSULTANT";
const SPEC: Record<Capability, Role[]> = {
  MANAGE_FIRM: [A],
  EDIT_MASTER_DATA: [A, M],
  VIEW_MASTER_DATA: [A, M, F],
  EDIT_RATES: [A, M],
  VIEW_RATES: [A, M, F],
  VIEW_OWN_ENGAGEMENTS: [C],
  SUBMIT_OWN_TIMESHEETS: [C],
  ENTER_ANY_TIMESHEETS: [A, M, F],
  REVIEW_TIMESHEETS: [A, M, F],
  CREATE_INVOICES: [A, M, F],
  APPROVE_INVOICES: [A, M],
  SEND_INVOICES: [A, M, F],
  RECORD_RECEIPTS: [A, F],
  ATTACH_VENDOR_INVOICES: [A, M, F],
  APPROVE_VENDOR_BILLS: [A, M],
  RECORD_VENDOR_PAYMENTS: [A, F],
  COMPLIANCE_OVERRIDE: [A],
  VIEW_REPORTS: [A, M, F],
  VIEW_OWN_HOURS_REPORT: [C],
  VIEW_SYNC_LOG: [A, F],
  MANAGE_BILLING: [A],
  VIEW_BILLING: [A, F],
  MANAGE_CPA_PACKAGE: [A, F],
  DOWNLOAD_CPA_PACKAGE: [A, M, F],
  UPLOAD_FILES: [A, M, F, C],
  VIEW_ALL_FILES: [A, M, F],
};

describe("section 12 permission matrix", () => {
  it("covers exactly the spec capabilities", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(Object.keys(SPEC).sort());
  });

  for (const cap of Object.keys(SPEC) as Capability[]) {
    for (const role of ROLES) {
      const expected = SPEC[cap].includes(role);
      it(`${role} ${expected ? "can" : "cannot"} ${cap}`, () => {
        expect(can(role, cap)).toBe(expected);
      });
    }
  }

  it("requirePermission throws ForbiddenError when not allowed", () => {
    expect(() => requirePermission({ role: "CONSULTANT" }, "MANAGE_FIRM")).toThrow(ForbiddenError);
    expect(() => requirePermission({ role: "ADMIN" }, "MANAGE_FIRM")).not.toThrow();
  });

  it("'Managers also act as Finance' grants Finance capabilities to Managers only", () => {
    expect(can("MANAGER", "RECORD_RECEIPTS")).toBe(false);
    expect(can("MANAGER", "RECORD_RECEIPTS", { managersActAsFinance: true })).toBe(true);
    expect(can("MANAGER", "MANAGE_FIRM", { managersActAsFinance: true })).toBe(false);
    expect(can("CONSULTANT", "RECORD_RECEIPTS", { managersActAsFinance: true })).toBe(false);
  });
});
