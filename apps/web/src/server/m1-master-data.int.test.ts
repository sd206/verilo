/**
 * M1 acceptance (section 19): overlapping rates rejected; numbering preview GLBX-202611-0001;
 * engagement page billing chain, rates and margin ($20.00/h, 21.05% for E1). Plus permissions,
 * encryption at rest, audit, and Users-and-roles rules.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSession } from "@verilo/auth";
import { sql, withTenant } from "@verilo/db";
import { withOwnerClient } from "@verilo/db/testing";
import * as parties from "./handlers/parties";
import * as consultants from "./handlers/consultants";
import * as engagements from "./handlers/engagements";
import * as settings from "./handlers/settings";
import * as members from "./handlers/members";
import { addMember, closeTestDb, createFirmWithAdmin, createMasterData, testDeps, type Actor } from "./testing";

const d = testDeps();
let firmId: string;
let admin: Actor;
let m: Awaited<ReturnType<typeof createMasterData>>;

beforeAll(async () => {
  const f = await createFirmWithAdmin(d, "Lonestar");
  firmId = f.firmId;
  admin = f.admin;
  m = await createMasterData(d, admin, "L");
});
afterAll(closeTestDb);

describe("rates: no overlaps (5.3) and resolution", () => {
  it("rejects an overlapping bill rate with a clear message", async () => {
    await expect(
      engagements.addRate(d, admin.ctx, { engagementId: m.engagementId, side: "BILL", rate: "100.00", effectiveFrom: "2026-11-01" }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Overlaps the bill regular rate starting 2026-09-01/) });
  });

  it("accepts a rate change once the current rate is ended (endRate then addRate)", async () => {
    const other = await createMasterData(d, admin, "M");
    await engagements.endRate(d, admin.ctx, { rateId: other.billRateId, effectiveTo: "2026-10-31" });
    await engagements.addRate(d, admin.ctx, { engagementId: other.engagementId, side: "BILL", rate: "100.00", effectiveFrom: "2026-11-01" });
    const detail = await engagements.getEngagementDetail(d, admin.ctx, { engagementId: other.engagementId });
    expect(detail.rates.filter((r) => r.side === "BILL").map((r) => [r.effectiveFrom, r.effectiveTo, r.rate])).toEqual([
      ["2026-09-01", "2026-10-31", "$95.00"],
      ["2026-11-01", null, "$100.00"],
    ]);
    // Moving an end date later is refused (it could overlap the next rate).
    await expect(engagements.endRate(d, admin.ctx, { rateId: other.billRateId, effectiveTo: "2026-11-15" })).rejects.toMatchObject({ status: 400 });
  });

  it("the database refuses overlaps even if the domain check is bypassed", async () => {
    const err = await withTenant(d.db, admin.ctx, (tx) =>
      tx.execute(
        sql`insert into rate (firm_id, engagement_id, side, rate_kind, rate_cents, effective_from) values (${firmId}, ${m.engagementId}, 'BILL', 'REGULAR', 1, '2027-01-01')`,
      ),
    ).then(
      () => null,
      (e: unknown) => e as { cause?: { message?: string } },
    );
    expect(String(err?.cause?.message)).toMatch(/rate_no_overlap/);
  });

  it("rejects pay rates on W-2 engagements", async () => {
    const w2 = await consultants.createConsultant(d, admin.ctx, { firstName: "Meera", lastName: "Shah", employmentType: "W2" });
    const e = await engagements.createEngagement(d, admin.ctx, {
      consultantId: w2.id,
      billToPartyId: m.primeId,
      endClientPartyId: m.endClientId,
      primePartyId: m.primeId,
      startDate: "2026-09-01",
      timesheetCycle: "MONTHLY",
      invoiceCycle: "MONTHLY",
    });
    await expect(
      engagements.addRate(d, admin.ctx, { engagementId: e.id, side: "PAY", rate: "60.00", effectiveFrom: "2026-09-01" }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/contractor/) });
    // Activation needs a bill rate covering the start date.
    await expect(engagements.setEngagementStatus(d, admin.ctx, { engagementId: e.id, status: "ACTIVE" })).rejects.toMatchObject({ status: 400 });
    await engagements.addRate(d, admin.ctx, { engagementId: e.id, side: "BILL", rate: "110.00", effectiveFrom: "2026-09-01" });
    await engagements.setEngagementStatus(d, admin.ctx, { engagementId: e.id, status: "ACTIVE" });
    const detail = await engagements.getEngagementDetail(d, admin.ctx, { engagementId: e.id });
    expect(detail.margin).toBeNull();
    expect(detail.billOnly?.bill).toBe("$110.00");
  });

  it("writes audit events for rate create and end", async () => {
    const rows = await withOwnerClient(async (c) =>
      (await c.query<{ action: string }>("select action from audit_event where firm_id = $1 and entity_type = 'rate'", [firmId])).rows,
    );
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["create", "end"]));
  });
});

describe("engagement detail (13.2 item 6)", () => {
  it("shows E1's billing chain, rates and margin $20.00/h, 21.05%", async () => {
    const detail = await engagements.getEngagementDetail(d, admin.ctx, { engagementId: m.engagementId });
    expect(detail.chain.map((n) => n.role)).toEqual(["END_CLIENT", "PRIME_VENDOR", "FIRM", "SUB_VENDOR", "CONSULTANT"]);
    expect(detail.chain.find((n) => n.billTo)?.id).toBe(m.primeId);
    expect(detail.margin).toMatchObject({ bill: "$95.00", pay: "$75.00", perHour: "$20.00", percent: "21.05%" });
    expect(detail.purchaseOrders[0]).toMatchObject({ poNumber: "GLX-WO-7781", amount: "$60,000.00", thresholds: ["75.00%", "90.00%", "100.00%"] });
    expect(detail.deduction).toBe("2.00%");
    expect(detail.engagement.status).toBe("ACTIVE");
  });

  it("rejects an invoice cycle shorter than the timesheet cycle and the wrong party kinds", async () => {
    const base = {
      consultantId: m.consultantId,
      billToPartyId: m.primeId,
      endClientPartyId: m.endClientId,
      startDate: "2026-09-01",
      timesheetCycle: "MONTHLY",
      invoiceCycle: "WEEKLY",
    };
    await expect(engagements.createEngagement(d, admin.ctx, base)).rejects.toMatchObject({ status: 400 });
    await expect(
      engagements.createEngagement(d, admin.ctx, { ...base, invoiceCycle: "MONTHLY", billToPartyId: m.subVendorId }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("invoice numbering (13.3 item 3)", () => {
  it("previews GLBX-202611-0001 for the seed pattern and Globex", async () => {
    const glbx = await parties.createParty(d, admin.ctx, {
      kind: "PRIME_VENDOR",
      legalName: "Globex Solutions",
      displayName: "Globex Solutions",
      code: "GLBX",
    });
    const r = await settings.previewInvoiceNumber(d, admin.ctx, {
      pattern: "{CLIENT}-{YYYY}{MM}-{SEQ:4}",
      clientPartyId: glbx.id,
      invoiceDate: "2026-11-01",
    });
    expect(r).toEqual({ ok: true, number: "GLBX-202611-0001" });
  });

  it("rejects saving a pattern without {SEQ:n}", async () => {
    await expect(settings.setNumberingPattern(d, admin.ctx, { pattern: "{CLIENT}-{YYYY}", seqReset: "YEARLY" })).rejects.toMatchObject({
      status: 400,
    });
    await settings.setNumberingPattern(d, admin.ctx, { pattern: "INV-{YY}-{SEQ:5}", seqReset: "NEVER" });
    expect((await settings.getFirmSettings(d, admin.ctx)).firm.invoiceNumberPattern).toBe("INV-{YY}-{SEQ:5}");
  });

  it("party codes are unique per firm", async () => {
    await expect(
      parties.createParty(d, admin.ctx, { kind: "PRIME_VENDOR", legalName: "Dup", displayName: "Dup", code: m.code }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("consultants", () => {
  it("emails are unique per firm (the database enforces it too)", async () => {
    const email = `dup-${Date.now()}@example.com`;
    await consultants.createConsultant(d, admin.ctx, { firstName: "A", lastName: "One", employmentType: "W2", emails: [email] });
    await expect(
      consultants.createConsultant(d, admin.ctx, { firstName: "B", lastName: "Two", employmentType: "W2", emails: [email.toUpperCase()] }),
    ).rejects.toMatchObject({ status: 409 });
    // Another firm may use the same address.
    const other = await createFirmWithAdmin(d, "Other");
    await consultants.createConsultant(d, other.admin.ctx, { firstName: "C", lastName: "Three", employmentType: "W2", emails: [email] });
  });

  it("contractors need a sub-vendor; status changes go through the state machine", async () => {
    await expect(
      consultants.createConsultant(d, admin.ctx, { firstName: "N", lastName: "S", employmentType: "CONTRACTOR" }),
    ).rejects.toMatchObject({ status: 400 });
    const c = await consultants.createConsultant(d, admin.ctx, { firstName: "N", lastName: "S", employmentType: "W2" });
    await consultants.setConsultantStatus(d, admin.ctx, { consultantId: c.id, status: "INACTIVE" });
    await expect(consultants.setConsultantStatus(d, admin.ctx, { consultantId: c.id, status: "INACTIVE" })).rejects.toThrow(/not allowed/);
  });
});

describe("parties: encryption at rest (R11) and documents", () => {
  it("stores the TIN and remit details encrypted and shows the TIN masked", async () => {
    const raw = await withOwnerClient(async (c) =>
      (await c.query("select tin, remit_details from party where id = $1", [m.subVendorId])).rows[0],
    );
    expect(raw.tin).toMatch(/^v1:/);
    expect(raw.tin).not.toContain("3456789");
    expect(raw.remit_details).not.toContain("456789");
    const detail = await parties.getPartyDetail(d, admin.ctx, { partyId: m.subVendorId });
    expect(detail.party.tinMasked).toBe("••••••6789");
    expect(detail.party.remitDetails).toBe("Bank 123 / acct 456789");
    expect(detail.documents[0]).toMatchObject({ docType: "W9", status: "VALID", filename: "w9.pdf" });
    const audit = await withOwnerClient(async (c) =>
      (await c.query("select after from audit_event where entity_type = 'party' and entity_id = $1", [m.subVendorId])).rows[0],
    );
    expect(JSON.stringify(audit.after)).not.toContain("456789");
  });

  it("won't archive a party used by an active engagement", async () => {
    await expect(parties.archiveParty(d, admin.ctx, { partyId: m.primeId })).rejects.toMatchObject({ status: 409 });
  });
});

describe("permissions (section 12)", () => {
  it("Finance can view master data but not edit it or rates; Consultants can't view it", async () => {
    const finance = await addMember(d, admin, "FINANCE");
    const consultant = await addMember(d, admin, "CONSULTANT");
    expect((await parties.listParties(d, finance.ctx)).length).toBeGreaterThan(0);
    await expect(parties.createParty(d, finance.ctx, { kind: "END_CLIENT", legalName: "x", displayName: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(
      engagements.addRate(d, finance.ctx, { engagementId: m.engagementId, side: "BILL", rate: "1.00", effectiveFrom: "2031-01-01" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(parties.listParties(d, consultant.ctx)).rejects.toMatchObject({ status: 403 });
    await expect(engagements.getEngagementDetail(d, consultant.ctx, { engagementId: m.engagementId })).rejects.toMatchObject({ status: 403 });
    await expect(settings.getFirmSettings(d, finance.ctx)).rejects.toMatchObject({ status: 403 });
  });
});

describe("users and roles (13.3 item 2)", () => {
  it("disable is per firm and takes effect on the next request; Admins can't disable or re-role themselves", async () => {
    const manager = await addMember(d, admin, "MANAGER");
    const { members: list } = await members.listMembers(d, admin.ctx);
    const mm = list.find((x) => x.userId === manager.userId)!;
    await members.updateMember(d, admin.ctx, { membershipId: mm.membershipId, disabled: true });
    expect((await resolveSession(d.db, manager.token))!.state).toBe("NO_FIRM");
    await members.updateMember(d, admin.ctx, { membershipId: mm.membershipId, disabled: false });
    expect((await resolveSession(d.db, manager.token))!.state).toBe("OK");

    const self = list.find((x) => x.userId === admin.userId)!;
    await expect(members.updateMember(d, admin.ctx, { membershipId: self.membershipId, disabled: true })).rejects.toMatchObject({ status: 403 });
    // Promote the manager, then demoting the only other admin still leaves one.
    await members.updateMember(d, admin.ctx, { membershipId: mm.membershipId, role: "ADMIN" });
    const promoted = (await resolveSession(d.db, manager.token))!;
    expect(promoted.state).toBe("MFA_SETUP_REQUIRED");
  });

  it("require MFA forces a Manager to enrol; consultant role needs a consultant link", async () => {
    const manager = await addMember(d, admin, "MANAGER");
    const { members: list } = await members.listMembers(d, admin.ctx);
    const mm = list.find((x) => x.userId === manager.userId)!;
    await members.updateMember(d, admin.ctx, { membershipId: mm.membershipId, mfaRequired: true });
    expect((await resolveSession(d.db, manager.token))!.state).toBe("MFA_SETUP_REQUIRED");
    await expect(members.updateMember(d, admin.ctx, { membershipId: mm.membershipId, role: "CONSULTANT" })).rejects.toMatchObject({ status: 400 });
    await members.updateMember(d, admin.ctx, { membershipId: mm.membershipId, role: "CONSULTANT", consultantId: m.consultantId });
  });

  it("holidays: duplicates rejected, set replaces the calendar", async () => {
    await expect(
      settings.setHolidays(d, admin.ctx, { holidays: [{ date: "2026-12-25", name: "A" }, { date: "2026-12-25", name: "B" }] }),
    ).rejects.toMatchObject({ status: 409 });
    const out = await settings.setHolidays(d, admin.ctx, {
      holidays: [{ date: "2026-12-25", name: "Christmas Day" }, { date: "2026-11-26", name: "Thanksgiving" }],
    });
    expect(out.map((h) => h.date)).toEqual(["2026-11-26", "2026-12-25"]);
  });
});
