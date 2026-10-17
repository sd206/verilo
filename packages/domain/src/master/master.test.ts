import { describe, expect, it } from "vitest";
import { invoiceCycleAllowed } from "./cycles";
import { billingChain, effectiveDeductionBps, validateEngagement, type EngagementRules } from "./engagements";
import { documentStatus, validateParty } from "./parties";
import { normalizeEmails, validateConsultant } from "./consultants";

describe("cycles", () => {
  it("invoice cycle must be ≥ timesheet cycle", () => {
    expect(invoiceCycleAllowed("MONTHLY", "MONTHLY")).toBe(true);
    expect(invoiceCycleAllowed("WEEKLY", "MONTHLY")).toBe(true);
    expect(invoiceCycleAllowed("MONTHLY", "WEEKLY")).toBe(false);
    expect(invoiceCycleAllowed("SEMIMONTHLY", "BIWEEKLY")).toBe(false);
  });
});

describe("validateParty", () => {
  const base = { code: null, vendorPayTerms: null, vendorNetDays: null, standardDeductionBps: null, paymentTermsDays: null };
  it("accepts the seed parties", () => {
    expect(validateParty({ ...base, kind: "PRIME_VENDOR", code: "GLBX", paymentTermsDays: 45, standardDeductionBps: 200 })).toEqual({ ok: true });
    expect(validateParty({ ...base, kind: "END_CLIENT" })).toEqual({ ok: true });
    expect(validateParty({ ...base, kind: "SUB_VENDOR", vendorPayTerms: "PAY_WHEN_PAID", vendorNetDays: 0 })).toEqual({ ok: true });
    expect(validateParty({ ...base, kind: "FACTOR" })).toEqual({ ok: true });
  });
  it("requires a code for prime vendors and checks its format", () => {
    expect(validateParty({ ...base, kind: "PRIME_VENDOR" })).toMatchObject({ ok: false, field: "code" });
    expect(validateParty({ ...base, kind: "PRIME_VENDOR", code: "glbx" })).toMatchObject({ ok: false, field: "code" });
    expect(validateParty({ ...base, kind: "PRIME_VENDOR", code: "TOOLONGCODE1" })).toMatchObject({ ok: false, field: "code" });
  });
  it("keeps sub-vendor and bill-to fields on the right kinds", () => {
    expect(validateParty({ ...base, kind: "SUB_VENDOR" })).toMatchObject({ ok: false, field: "vendorPayTerms" });
    expect(validateParty({ ...base, kind: "SUB_VENDOR", vendorPayTerms: "NET" })).toMatchObject({ ok: false, field: "vendorNetDays" });
    expect(validateParty({ ...base, kind: "PRIME_VENDOR", code: "AB", vendorPayTerms: "NET", vendorNetDays: 30 })).toMatchObject({ ok: false });
    expect(validateParty({ ...base, kind: "SUB_VENDOR", vendorPayTerms: "NET", vendorNetDays: 30, standardDeductionBps: 100 })).toMatchObject({
      ok: false,
      field: "standardDeductionBps",
    });
    expect(validateParty({ ...base, kind: "PRIME_VENDOR", code: "AB", standardDeductionBps: 10_001 })).toMatchObject({ ok: false });
  });
});

describe("documentStatus", () => {
  it("flags expired and soon-expiring documents", () => {
    expect(documentStatus(null, "2026-10-17")).toBe("NO_EXPIRY");
    expect(documentStatus("2026-10-16", "2026-10-17")).toBe("EXPIRED");
    expect(documentStatus("2026-10-17", "2026-10-17")).toBe("EXPIRING");
    expect(documentStatus("2026-11-16", "2026-10-17")).toBe("EXPIRING");
    expect(documentStatus("2026-11-17", "2026-10-17")).toBe("VALID");
  });
});

describe("validateConsultant", () => {
  it("requires a sub-vendor for contractors and none for W-2", () => {
    expect(validateConsultant({ employmentType: "CONTRACTOR", subVendor: null, emails: [] })).toMatchObject({ ok: false });
    expect(validateConsultant({ employmentType: "CONTRACTOR", subVendor: { kind: "SUB_VENDOR" }, emails: [] })).toEqual({ ok: true });
    expect(validateConsultant({ employmentType: "CONTRACTOR", subVendor: { kind: "PRIME_VENDOR" }, emails: [] })).toMatchObject({ ok: false });
    expect(validateConsultant({ employmentType: "W2", subVendor: { kind: "SUB_VENDOR" }, emails: [] })).toMatchObject({ ok: false });
  });
  it("normalizes and validates emails", () => {
    expect(normalizeEmails([" Ravi@Lonestar.test", "ravi@lonestar.test", ""])).toEqual(["ravi@lonestar.test"]);
    expect(validateConsultant({ employmentType: "W2", subVendor: null, emails: ["nope"] })).toMatchObject({ ok: false, field: "emails" });
  });
});

describe("validateEngagement", () => {
  const e1: EngagementRules = {
    startDate: "2026-09-01",
    endDate: null,
    timesheetCycle: "MONTHLY",
    invoiceCycle: "MONTHLY",
    biweeklyAnchorDate: null,
    expectedWeeklyHours: "40",
    maxWeeklyHoursWarning: "50",
    deductionBpsOverride: null,
    billTo: { kind: "PRIME_VENDOR" },
    endClient: { kind: "END_CLIENT" },
    prime: { kind: "PRIME_VENDOR" },
    implementationPartner: null,
  };
  it("accepts the seed engagement E1", () => expect(validateEngagement(e1)).toEqual({ ok: true }));
  it("rejects bad dates, cycles, anchors, hours and chain kinds", () => {
    expect(validateEngagement({ ...e1, endDate: "2026-08-31" })).toMatchObject({ field: "endDate" });
    expect(validateEngagement({ ...e1, timesheetCycle: "MONTHLY", invoiceCycle: "WEEKLY" })).toMatchObject({ field: "invoiceCycle" });
    expect(validateEngagement({ ...e1, timesheetCycle: "BIWEEKLY", invoiceCycle: "MONTHLY" })).toMatchObject({ field: "biweeklyAnchorDate" });
    expect(validateEngagement({ ...e1, expectedWeeklyHours: "40.555" })).toMatchObject({ field: "expectedWeeklyHours" });
    expect(validateEngagement({ ...e1, maxWeeklyHoursWarning: "30" })).toMatchObject({ field: "maxWeeklyHoursWarning" });
    expect(validateEngagement({ ...e1, billTo: { kind: "SUB_VENDOR" } })).toMatchObject({ field: "billToPartyId" });
    expect(validateEngagement({ ...e1, endClient: { kind: "PRIME_VENDOR" } })).toMatchObject({ field: "endClientPartyId" });
    expect(validateEngagement({ ...e1, implementationPartner: { kind: "END_CLIENT" } })).toMatchObject({ field: "implementationPartnerPartyId" });
  });
  it("uses the override deduction, else the party's", () => {
    expect(effectiveDeductionBps(200, null)).toBe(200);
    expect(effectiveDeductionBps(200, 150)).toBe(150);
    expect(effectiveDeductionBps(null, null)).toBe(0);
  });
});

describe("billingChain", () => {
  it("builds E1's chain with the bill-to marked", () => {
    const chain = billingChain({
      endClient: { id: "ini", name: "Initech Corp" },
      prime: { id: "glbx", name: "Globex Solutions" },
      implementationPartner: null,
      billToPartyId: "glbx",
      firmName: "Lonestar Data Consulting",
      subVendor: { id: "apex", name: "Apex Talent Inc" },
      consultantName: "Ravi Kumar",
    });
    expect(chain.map((n) => n.role)).toEqual(["END_CLIENT", "PRIME_VENDOR", "FIRM", "SUB_VENDOR", "CONSULTANT"]);
    expect(chain.find((n) => n.billTo)?.name).toBe("Globex Solutions");
  });
});
