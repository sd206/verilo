/**
 * M2 flows against real Postgres (runtime role, RLS): golden tests T3, T4 and T13 (timesheet
 * half), the extraction job, email intake, the unmatched queue, review actions and the scheduled
 * jobs. The AI provider is scripted; everything else is the production code path.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ModelExtractor, ScriptedClient } from "@verilo/ai";
import { withOwnerClient } from "@verilo/db/testing";
import type { MemoryQueue } from "@verilo/jobs";
import type { Deps } from "./deps";
import * as consultantsH from "./handlers/consultants";
import * as engagementsH from "./handlers/engagements";
import * as tsH from "./handlers/timesheets";
import { drainJobs } from "./jobs/processors";
import { receiveInboundEmail } from "./jobs/inbound";
import { createPeriodTimesheetsJob, timesheetRemindersJob } from "./jobs/scheduled";
import {
  addConsultantUser,
  addMember,
  closeTestDb,
  createFirmWithAdmin,
  createMasterData,
  screenshotPng,
  testDeps,
  uploadFile,
  type Actor,
  type CapturingEmail,
} from "./testing";

const OCT_WEEKDAYS = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`).filter((d) => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6;
});
const octEntries = (hours = "8.00") => OCT_WEEKDAYS.map((workDate) => ({ workDate, hours }));

function extraction(over: Record<string, unknown> = {}) {
  return {
    document_type: "VMS_TIMESHEET",
    vms_name: "SAP Fieldglass",
    consultant_name: "Ravi Kumar",
    worker_id: null,
    timesheet_id: "FG-1001",
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

interface World {
  d: Deps;
  client: ScriptedClient;
  admin: Actor;
  finance: Actor;
  ravi: Actor;
  raviConsultantId: string;
  raviName: string;
  engagementId: string;
  firmId: string;
}

async function world(label: string): Promise<World> {
  const client = new ScriptedClient();
  const d = testDeps({ extractor: new ModelExtractor(client, { providerRetryDelayMs: 0 }) });
  const { firmId, admin } = await createFirmWithAdmin(d, label);
  const md = await createMasterData(d, admin, label);
  const detail = await consultantsH.getConsultantDetail(d, admin.ctx, { consultantId: md.consultantId });
  const ravi = await addConsultantUser(d, admin, md.consultantId, detail.consultant.emails[0]!);
  const finance = await addMember(d, admin, "FINANCE");
  return {
    d,
    client,
    admin,
    finance,
    ravi,
    raviConsultantId: md.consultantId,
    raviName: `${detail.consultant.firstName} ${detail.consultant.lastName}`,
    engagementId: md.engagementId,
    firmId,
  };
}

async function octFor(w: World, actor: Actor = w.ravi) {
  const mine = await tsH.listMyTimesheets(w.d, actor.ctx);
  const oct = mine.timesheets.find((t) => t.periodStart === "2026-10-01");
  expect(oct).toBeDefined();
  return oct!.id;
}

async function attach(w: World, actor: Actor, timesheetId: string | undefined, png: Buffer, name = "oct.png") {
  const f = await uploadFile(w.d, actor, png, name, "image/png");
  return tsH.uploadEvidence(w.d, actor.ctx, { ...(timesheetId ? { timesheetId } : {}), fileId: f.id });
}

const detail = (w: World, actor: Actor, timesheetId: string) => tsH.getTimesheetDetail(w.d, actor.ctx, { timesheetId });

async function usage(fileId?: string) {
  return withOwnerClient(async (c) =>
    (await c.query(`select * from ai_usage_event ${fileId ? "where file_id = $1" : ""} order by created_at`, fileId ? [fileId] : [])).rows,
  );
}

let A: World;

beforeAll(async () => {
  A = await world("M2A");
});

afterAll(async () => {
  await closeTestDb();
});

describe("periods (7.1)", () => {
  it("activating an engagement creates NOT_STARTED timesheets for started periods", async () => {
    const mine = await tsH.listMyTimesheets(A.d, A.ravi.ctx);
    const sep = mine.timesheets.find((t) => t.periodStart === "2026-09-01");
    expect(sep).toMatchObject({ periodEnd: "2026-09-30", status: "NOT_STARTED", period: "Sep 2026" });
    expect(mine.cta).toBe("Submit this month");
  });

  it("the nightly job is idempotent", async () => {
    const r1 = await createPeriodTimesheetsJob(A.d, new Date("2026-10-17T12:00:00Z"));
    const r2 = await createPeriodTimesheetsJob(A.d, new Date("2026-10-17T12:00:00Z"));
    expect(r2.created).toBe(0);
    expect(r1.created).toBeGreaterThanOrEqual(0);
  });
});

describe("T3: Ravi enters 176.00, the screenshot says 168.00", () => {
  let id: string;
  let fileId: string;

  it("consultant enters hours, attaches the screenshot and submits", async () => {
    id = await octFor(A);
    const saved = await tsH.saveTimesheetEntries(A.d, A.ravi.ctx, { timesheetId: id, entries: octEntries() });
    expect(saved).toMatchObject({ status: "DRAFT", totalHours: "176.00" });
    const ev = await attach(A, A.ravi, id, await screenshotPng(3));
    fileId = (await withOwnerClient((c) => c.query("select file_id from evidence where id = $1", [ev.evidenceId]))).rows[0].file_id;
    // Before the read finishes the check is pending, in plain language.
    expect((await detail(A, A.ravi, id)).checks.find((c) => c.code === "EXTRACTION_PENDING")?.message).toMatch(/still reading/);
    A.client.push(extraction({ total_hours: 168, consultant_name: A.raviName }));
    const sub = await tsH.submitTimesheet(A.d, A.ravi.ctx, { timesheetId: id });
    expect(sub.status).toBe("SUBMITTED"); // waits for the extraction
  });

  it("the extraction job reads it; the checks find HOURS_MISMATCH and the timesheet needs review", async () => {
    await drainJobs(A.d);
    const v = await detail(A, A.finance, id);
    expect(v.timesheet.status).toBe("NEEDS_REVIEW");
    const hm = v.checks.find((c) => c.code === "HOURS_MISMATCH");
    expect(hm).toMatchObject({ severity: "BLOCK", resolved: false });
    expect(hm!.message).toContain("168.00");
    expect(hm!.message).toContain("176.00");
    expect(v.comparison).toMatchObject({ enteredTotal: "176.00", extractedTotal: "168.00", totalsDiffer: true });
    expect(v.evidence[0]!.pages).toHaveLength(1);
    expect(v.evidence[0]!.extraction?.result?.totalHours).toBe("168.00");
  });

  it("the proposal never changed the entries (extraction is a proposal only)", async () => {
    const v = await detail(A, A.ravi, id);
    expect(v.entries).toHaveLength(22);
    expect(v.timesheet.totalHours).toBe("176.00");
  });

  it("logs model, prompt version and one billable read (22.4)", async () => {
    const x = (await withOwnerClient((c) => c.query("select * from extraction where file_id = $1", [fileId]))).rows[0];
    expect(x).toMatchObject({ status: "DONE", model: "scripted", prompt_version: "ts-v1", overall_confidence: "0.95" });
    expect(x.raw_json.attempts).toHaveLength(1);
    const u = await usage(fileId);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ billable: true, pages: 1, document_kind: "TIMESHEET", non_billable_reason: null });
    expect(String(u[0].usage_month).length).toBeGreaterThan(0);
    // The image hash was stored for the duplicate check.
    const f = (await withOwnerClient((c) => c.query("select perceptual_hash from file where id = $1", [fileId]))).rows[0];
    expect(f.perceptual_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("a consultant can't resolve checks; Finance resolves with a reason and verifies (audited override)", async () => {
    const v = await detail(A, A.finance, id);
    const block = v.checks.find((c) => c.code === "HOURS_MISMATCH")!;
    await expect(tsH.resolveCheck(A.d, A.ravi.ctx, { checkId: block.id, reason: "fine" })).rejects.toMatchObject({ status: 403 });
    await expect(tsH.resolveCheck(A.d, A.finance.ctx, { checkId: block.id, reason: "" })).rejects.toMatchObject({ status: 400 });
    // Verify is refused while a BLOCK is open.
    await expect(tsH.verifyTimesheet(A.d, A.finance.ctx, { timesheetId: id })).rejects.toMatchObject({ status: 409 });
    for (const c of v.checks.filter((c) => c.severity === "BLOCK")) {
      await tsH.resolveCheck(A.d, A.finance.ctx, { checkId: c.id, reason: "Client confirmed 176 hours by email" });
    }
    const r = await tsH.verifyTimesheet(A.d, A.finance.ctx, { timesheetId: id });
    expect(r.status).toBe("VERIFIED");
    const audit = (await withOwnerClient((c) => c.query("select action, reason from audit_event where entity_type = 'timesheet_check' and entity_id = $1", [block.id]))).rows;
    expect(audit).toEqual([{ action: "override", reason: "Client confirmed 176 hours by email" }]);
  });

  it("Finance can return a VERIFIED timesheet (not on an approved invoice) with a reason; the consultant is emailed", async () => {
    const before = (A.d.email as CapturingEmail).sent.length;
    await expect(tsH.returnTimesheet(A.d, A.finance.ctx, { timesheetId: id, reason: "" })).rejects.toMatchObject({ status: 400 });
    const r = await tsH.returnTimesheet(A.d, A.finance.ctx, { timesheetId: id, reason: "Please attach the client-approved screenshot" });
    expect(r.status).toBe("RETURNED");
    const mail = (A.d.email as CapturingEmail).sent.slice(before);
    expect(mail[0]!.text).toContain("Please attach the client-approved screenshot");
    const v = await detail(A, A.ravi, id);
    expect(v.timesheet.returnedReason).toBe("Please attach the client-approved screenshot");
    expect(v.checks.every((c) => !c.resolved)).toBe(true);
    expect(v.can.edit).toBe(true);
    // Saving again moves it back to DRAFT (6.1).
    const s = await tsH.saveTimesheetEntries(A.d, A.ravi.ctx, { timesheetId: id, entries: octEntries() });
    expect(s.status).toBe("DRAFT");
  });
});

describe("T4: the same screenshot on Meera's timesheet", () => {
  it("is flagged DUPLICATE_EVIDENCE and isn't read a second time", async () => {
    const meeraC = await consultantsH.createConsultant(A.d, A.admin.ctx, {
      firstName: "Meera",
      lastName: "Shah",
      emails: [`meera-${randomUUID().slice(0, 6)}@example.com`],
      employmentType: "W2",
    });
    const raviEng = await engagementsH.getEngagementDetail(A.d, A.admin.ctx, { engagementId: A.engagementId });
    const e2 = await engagementsH.createEngagement(A.d, A.admin.ctx, {
      consultantId: meeraC.id,
      billToPartyId: raviEng.engagement.billToPartyId,
      endClientPartyId: raviEng.engagement.endClientPartyId,
      primePartyId: raviEng.engagement.primePartyId,
      startDate: "2026-09-01",
      timesheetCycle: "MONTHLY",
      invoiceCycle: "MONTHLY",
      evidenceRequired: true,
    });
    await engagementsH.addRate(A.d, A.admin.ctx, { engagementId: e2.id, side: "BILL", rate: "110.00", effectiveFrom: "2026-09-01" });
    await engagementsH.setEngagementStatus(A.d, A.admin.ctx, { engagementId: e2.id, status: "ACTIVE" });
    const meera = await addConsultantUser(A.d, A.admin, meeraC.id, (await consultantsH.getConsultantDetail(A.d, A.admin.ctx, { consultantId: meeraC.id })).consultant.emails[0]!);

    const id = await octFor(A, meera);
    await tsH.saveTimesheetEntries(A.d, meera.ctx, { timesheetId: id, entries: octEntries() });
    const callsBefore = A.client.calls.length;
    await attach(A, meera, id, await screenshotPng(3), "same.png"); // the bytes Ravi attached
    await tsH.submitTimesheet(A.d, meera.ctx, { timesheetId: id });
    await drainJobs(A.d);
    expect(A.client.calls.length).toBe(callsBefore); // no second AI read

    const staff = await detail(A, A.finance, id);
    expect(staff.timesheet.status).toBe("NEEDS_REVIEW");
    const dup = staff.checks.find((c) => c.code === "DUPLICATE_EVIDENCE");
    expect(dup?.severity).toBe("BLOCK");
    expect(dup?.message).toContain(A.raviName);
    // The consultant sees a plain message without the other consultant's name.
    const own = await detail(A, meera, id);
    expect(own.checks.find((c) => c.code === "DUPLICATE_EVIDENCE")?.message).not.toContain("Ravi");
    // Recorded as a non-billable duplicate (22.4).
    const u = (await usage()).filter((r) => r.non_billable_reason === "DUPLICATE");
    expect(u.length).toBeGreaterThanOrEqual(1);
  });
});

describe("T13 (timesheet half): an INVOICED timesheet is locked", () => {
  it("rejects edits through the handler and directly in the database", async () => {
    const B = await world("M2T13");
    const id = await octFor(B);
    await tsH.saveTimesheetEntries(B.d, B.ravi.ctx, { timesheetId: id, entries: octEntries() });
    // Invoices arrive in M3; put the timesheet in INVOICED as the invoice approval will.
    await withOwnerClient((c) => c.query("update timesheet set status = 'INVOICED' where id = $1", [id]));
    await expect(tsH.saveTimesheetEntries(B.d, B.ravi.ctx, { timesheetId: id, entries: octEntries("7.00") })).rejects.toMatchObject({ status: 409 });
    await expect(tsH.saveTimesheetEntries(B.d, B.finance.ctx, { timesheetId: id, entries: octEntries("7.00") })).rejects.toMatchObject({ status: 409 });
    await expect(tsH.returnTimesheet(B.d, B.finance.ctx, { timesheetId: id, reason: "late change" })).rejects.toMatchObject({ status: 409 });
    // The trigger is the guarantee (R4), even for the owner role.
    await expect(withOwnerClient((c) => c.query("update timesheet_entry set hours = 7 where timesheet_id = $1", [id]))).rejects.toThrow(/locked/);
    await expect(withOwnerClient((c) => c.query("delete from timesheet_entry where timesheet_id = $1", [id]))).rejects.toThrow(/locked/);
    await expect(withOwnerClient((c) => c.query("update timesheet set total_hours = 1 where id = $1", [id]))).rejects.toThrow(/locked/);
    const v = await detail(B, B.ravi, id);
    expect(v.timesheet.totalHours).toBe("176.00");
    expect(v.can.edit).toBe(false);
  });
});

describe("consultant isolation inside a firm", () => {
  it("a consultant gets 404 for another consultant's timesheet", async () => {
    const other = await addMember(A.d, A.admin, "CONSULTANT", "other");
    const id = await octFor(A);
    await expect(detail(A, other, id)).rejects.toMatchObject({ status: 404 });
    await expect(tsH.saveTimesheetEntries(A.d, other.ctx, { timesheetId: id, entries: [] })).rejects.toMatchObject({ status: 404 });
  });
  it("hours must be inside the period and 0–24", async () => {
    const id = await octFor(A);
    await expect(tsH.saveTimesheetEntries(A.d, A.ravi.ctx, { timesheetId: id, entries: [{ workDate: "2026-11-01", hours: "8" }] })).rejects.toMatchObject({ status: 400 });
    await expect(tsH.saveTimesheetEntries(A.d, A.ravi.ctx, { timesheetId: id, entries: [{ workDate: "2026-10-01", hours: "25" }] })).rejects.toMatchObject({ status: 400 });
    await expect(tsH.saveTimesheetEntries(A.d, A.ravi.ctx, { timesheetId: id, entries: [{ workDate: "2026-10-01", hours: "abc" }] })).rejects.toMatchObject({ status: 400 });
  });
  it("submit needs evidence when the engagement requires it", async () => {
    const C = await world("M2SUB");
    const id = await octFor(C);
    await tsH.saveTimesheetEntries(C.d, C.ravi.ctx, { timesheetId: id, entries: octEntries() });
    await expect(tsH.submitTimesheet(C.d, C.ravi.ctx, { timesheetId: id })).rejects.toThrow(/screenshot/);
  });
});

describe("extraction retry and failure (8.1)", () => {
  it("retries once on a validation failure; the retry isn't billable", async () => {
    const W = await world("M2RETRY");
    const id = await octFor(W);
    await tsH.saveTimesheetEntries(W.d, W.ravi.ctx, { timesheetId: id, entries: octEntries() });
    W.client.push({ ...extraction({ consultant_name: W.raviName }), total_hours: "many" }, extraction({ consultant_name: W.raviName }));
    const ev = await attach(W, W.ravi, id, await screenshotPng(11));
    await tsH.submitTimesheet(W.d, W.ravi.ctx, { timesheetId: id });
    await drainJobs(W.d);
    expect((await detail(W, W.finance, id)).timesheet.status).toBe("VERIFIED");
    const fileId = (await withOwnerClient((c) => c.query("select file_id from evidence where id = $1", [ev.evidenceId]))).rows[0].file_id;
    expect((await usage(fileId)).map((u) => [u.billable, u.non_billable_reason])).toEqual([
      [true, null],
      [false, "VALIDATION_RETRY"],
    ]);
  });

  it("after two bad answers the extraction FAILS and routes to manual review", async () => {
    const W = await world("M2FAIL");
    const id = await octFor(W);
    await tsH.saveTimesheetEntries(W.d, W.ravi.ctx, { timesheetId: id, entries: octEntries() });
    W.client.push("garbage", "{}");
    await attach(W, W.ravi, id, await screenshotPng(12));
    await tsH.submitTimesheet(W.d, W.ravi.ctx, { timesheetId: id });
    await drainJobs(W.d);
    const v = await detail(W, W.finance, id);
    expect(v.timesheet.status).toBe("NEEDS_REVIEW");
    expect(v.checks.find((c) => c.code === "EXTRACTION_PENDING")?.message).toMatch(/by hand/);
    expect(v.evidence[0]!.extraction?.status).toBe("FAILED");
  });
});

// ---------------------------------------------------------------------------------------------------
// Email intake (section 9, 8.6)
// ---------------------------------------------------------------------------------------------------

async function inboxOf(firmId: string) {
  return (await withOwnerClient((c) => c.query("select timesheet_inbox_address from firm where id = $1", [firmId]))).rows[0].timesheet_inbox_address as string;
}

function postmarkRequest(body: object, auth = "postmark:test-inbound-webhook-secret") {
  return new Request("http://localhost/api/inbound-email/postmark", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(auth).toString("base64")}` },
    body: JSON.stringify(body),
  });
}

async function emailPayload(firmId: string, from: string, attachments: { name: string; type: string; content: Buffer }[], extra: Record<string, unknown> = {}) {
  return {
    From: from,
    FromFull: { Email: from, Name: "" },
    ToFull: [{ Email: await inboxOf(firmId), Name: "" }],
    Subject: "My October timesheet",
    MessageID: randomUUID(),
    Date: new Date().toUTCString(),
    Headers: [{ Name: "Message-ID", Value: `<${randomUUID()}@mail.test>` }],
    Attachments: attachments.map((a) => ({ Name: a.name, ContentType: a.type, Content: a.content.toString("base64"), ContentLength: a.content.length })),
    ...extra,
  };
}

describe("inbound email", () => {
  let E: World;
  beforeAll(async () => {
    E = await world("M2MAIL");
  });

  it("refuses a webhook call without the basic-auth secret, and unknown providers", async () => {
    const body = await emailPayload(E.firmId, "x@y.test", []);
    expect((await receiveInboundEmail(E.d, postmarkRequest(body, "postmark:wrong"), "postmark")).status).toBe(401);
    expect((await receiveInboundEmail(E.d, postmarkRequest(body), "sendgrid")).status).toBe(404);
    expect((await receiveInboundEmail(E.d, postmarkRequest({ nope: true }), "postmark")).status).toBe(400);
  });

  it("an emailed screenshot from Ravi creates a pre-filled DRAFT on the right timesheet (never submitted)", async () => {
    const consultantEmail = E.ravi.email;
    const daily = OCT_WEEKDAYS.map((date) => ({ date, hours: 8, rate_kind: "REGULAR" }));
    E.client.push(extraction({ consultant_name: E.raviName, daily_hours: daily }));
    const body = await emailPayload(E.firmId, consultantEmail.toUpperCase(), [{ name: "fieldglass-oct.png", type: "image/png", content: await screenshotPng(21) }]);
    const res = await receiveInboundEmail(E.d, postmarkRequest(body), "postmark");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: 1 });
    // The same message again is de-duplicated by Message-ID.
    expect(await (await receiveInboundEmail(E.d, postmarkRequest(body), "postmark")).json()).toEqual({ ok: true, stored: 0 });

    const sentBefore = (E.d.email as CapturingEmail).sent.length;
    await drainJobs(E.d);
    const id = await octFor(E);
    const v = await detail(E, E.finance, id);
    expect(v.timesheet.status).toBe("DRAFT");
    expect(v.entries).toHaveLength(22);
    expect(v.timesheet.totalHours).toBe("176.00");
    expect(v.evidence[0]).toMatchObject({ source: "EMAIL" });
    expect(v.checks.filter((c) => c.severity === "BLOCK")).toEqual([]);
    const email = (await withOwnerClient((c) => c.query("select status, matched_consultant_id from inbound_email where firm_id = $1", [E.firmId]))).rows;
    expect(email).toEqual([{ status: "PROCESSED", matched_consultant_id: E.raviConsultantId }]);
    // Auto-reply, marked so other responders don't answer it.
    const reply = (E.d.email as CapturingEmail).sent.slice(sentBefore).find((m) => m.to === consultantEmail);
    expect(reply?.text).toMatch(/Received/);
    expect(reply?.headers?.["Auto-Submitted"]).toBe("auto-replied");
    // The prefill is audited as such.
    const a = (await withOwnerClient((c) => c.query("select action, reason, actor_user_id from audit_event where entity_id = $1 and action = 'prefill_from_extraction'", [id]))).rows;
    expect(a).toEqual([{ action: "prefill_from_extraction", reason: expect.stringMatching(/confirm/), actor_user_id: null }]);
  });

  it("doesn't auto-reply to auto-generated mail, and ignores logos and disallowed types", async () => {
    const before = (E.d.email as CapturingEmail).sent.length;
    const logo = await screenshotPng(5, 120, 60);
    const body = await emailPayload(
      E.firmId,
      E.ravi.email,
      [
        { name: "logo.png", type: "image/png", content: logo },
        { name: "notes.exe", type: "application/octet-stream", content: Buffer.from("MZ") },
      ],
      { Headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }] },
    );
    await receiveInboundEmail(E.d, postmarkRequest(body), "postmark");
    await drainJobs(E.d);
    expect((E.d.email as CapturingEmail).sent.length).toBe(before);
    const row = (await withOwnerClient((c) => c.query("select status, status_reason from inbound_email where firm_id = $1 order by created_at desc limit 1", [E.firmId]))).rows[0];
    expect(row.status).toBe("REJECTED");
    expect(row.status_reason).toMatch(/notes\.exe/);
  });

  it("an unknown sender with an unknown name lands in the unmatched queue; Finance assigns it", async () => {
    E.client.push(extraction({ consultant_name: "Nobody Atall", period_start: "2026-09-01", period_end: "2026-09-30", total_hours: 160 }));
    const body = await emailPayload(E.firmId, "stranger@elsewhere.test", [{ name: "sep.png", type: "image/png", content: await screenshotPng(22) }]);
    await receiveInboundEmail(E.d, postmarkRequest(body), "postmark");
    await drainJobs(E.d);
    const q = await tsH.listUnmatched(E.d, E.finance.ctx);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ fromAddress: "stranger@elsewhere.test", extracted: { totalHours: "160.00", period: "Sep 2026" } });
    expect(q.items[0]!.reason).toMatch(/No consultant/);
    const emailRow = (await withOwnerClient((c) => c.query("select status from inbound_email where firm_id = $1 order by created_at desc limit 1", [E.firmId]))).rows[0];
    expect(emailRow.status).toBe("UNMATCHED");

    await expect(tsH.listUnmatched(E.d, E.ravi.ctx)).rejects.toMatchObject({ status: 403 });
    const sep = (await tsH.listMyTimesheets(E.d, E.ravi.ctx)).timesheets.find((t) => t.periodStart === "2026-09-01")!;
    await tsH.assignUnmatchedFile(E.d, E.finance.ctx, { evidenceId: q.items[0]!.id, timesheetId: sep.id });
    expect((await tsH.listUnmatched(E.d, E.finance.ctx)).items).toHaveLength(0);
    const v = await detail(E, E.finance, sep.id);
    expect(v.timesheet.status).toBe("DRAFT"); // pre-filled for confirmation, never submitted
    expect(v.timesheet.totalHours).toBe("160.00");
    expect(v.checks.map((c) => c.code)).toContain("NAME_MISMATCH");
    const emailAfter = (await withOwnerClient((c) => c.query("select status from inbound_email where firm_id = $1 order by created_at desc limit 1", [E.firmId]))).rows[0];
    expect(emailAfter.status).toBe("PROCESSED");
  });

  it("Finance can bulk-upload a screenshot without choosing a timesheet; matching uses the name on it", async () => {
    const W = await world("M2BULK");
    W.client.push(extraction({ consultant_name: W.raviName }));
    await attach(W, W.finance, undefined, await screenshotPng(31));
    await drainJobs(W.d);
    const id = await octFor(W);
    const v = await detail(W, W.finance, id);
    expect(v.evidence[0]?.source).toBe("BULK_UPLOAD");
    expect(v.timesheet.totalHours).toBe("176.00");
    await expect(attach(W, W.ravi, undefined, await screenshotPng(32))).rejects.toMatchObject({ status: 400 });
  });
});

describe("reminders (section 14)", () => {
  it("emails once per day, from one day after the period ends, at most 5 times", async () => {
    const R = await world("M2REM");
    const mail = R.d.email as CapturingEmail;
    const sent = () => mail.sent.filter((m) => m.to === R.ravi.email && /Reminder/.test(m.subject)).length;
    // 10:00 in Chicago on Oct 17: September is overdue.
    await timesheetRemindersJob(R.d, new Date("2026-10-17T15:00:00Z"));
    expect(sent()).toBe(1);
    await timesheetRemindersJob(R.d, new Date("2026-10-17T16:00:00Z"));
    expect(sent()).toBe(1); // same day
    // Before 09:00 local nothing is sent.
    await timesheetRemindersJob(R.d, new Date("2026-10-18T12:00:00Z"));
    expect(sent()).toBe(1);
    for (const day of ["18", "19", "20", "21", "22"]) await timesheetRemindersJob(R.d, new Date(`2026-10-${day}T15:00:00Z`));
    expect(sent()).toBe(5);
    expect(mail.sent.find((m) => m.to === R.ravi.email && /Reminder/.test(m.subject))?.subject).toContain("Sep 2026");
  });
});

describe("job queue", () => {
  it("queues extraction with an idempotency key", async () => {
    const W = await world("M2Q");
    const id = await octFor(W);
    await attach(W, W.ravi, id, await screenshotPng(41));
    const q = W.d.jobs as MemoryQueue;
    expect(q.jobs.map((j) => j.name)).toEqual(["run_extraction"]);
    expect(q.jobs[0]!.singletonKey).toBeTruthy();
    W.client.push(extraction({ consultant_name: W.raviName }));
    await drainJobs(W.d);
    // Running the same job again does nothing (R7).
    const { runExtractionJob } = await import("./jobs/extraction");
    const x = (await withOwnerClient((c) => c.query("select id from extraction where firm_id = $1", [W.firmId]))).rows[0];
    const calls = W.client.calls.length;
    await runExtractionJob(W.d, { firmId: W.firmId, extractionId: x.id });
    expect(W.client.calls.length).toBe(calls);
  });
});
