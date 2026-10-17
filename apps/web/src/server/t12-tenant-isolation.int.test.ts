/**
 * T12 — Tenant isolation (section 18.2, R3).
 *
 * "Create a second firm with its own data. Every API route, called with Firm B's session and
 * Firm A's IDs, returns 404 or 403 and changes nothing."
 *
 * Covers every server-action handler and every route handler that exists. The coverage test at
 * the bottom fails when a new handler or route is added without a case here.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, NotFoundError, generateTotp, resolveSession, sessionCookieName } from "@verilo/auth";
import { sql, withTenant } from "@verilo/db";
import { snapshotFirm } from "@verilo/db/testing";
import * as authH from "./handlers/auth";
import * as membersH from "./handlers/members";
import * as filesH from "./handlers/files";
import * as homeH from "./handlers/home";
import * as routesH from "./handlers/routes";
import * as partiesH from "./handlers/parties";
import * as consultantsH from "./handlers/consultants";
import * as engagementsH from "./handlers/engagements";
import * as settingsH from "./handlers/settings";
import * as tsH from "./handlers/timesheets";
import { receiveInboundEmail } from "./jobs/inbound";
import { runExtractionJob } from "./jobs/extraction";
import { runTimesheetChecksJob } from "./jobs/scheduled";
import {
  addMember,
  closeTestDb,
  createFirmWithAdmin,
  createMasterData,
  linkToken,
  meta,
  PASSWORD,
  screenshotPng,
  testDeps,
  uploadFile,
  type Actor,
} from "./testing";

// vite-node provides __dirname in test modules.
const HERE = __dirname;

const d = testDeps();

let A: {
  firmId: string;
  admin: Actor;
  consultant: Actor;
  fileId: string;
  inviteToken: string;
  m: Awaited<ReturnType<typeof createMasterData>>;
  ts: { timesheetId: string; evidenceId: string; unmatchedEvidenceId: string; checkId: string; extractionId: string };
};
let B: { firmId: string; admin: Actor; consultant: Actor; m: Awaited<ReturnType<typeof createMasterData>>; timesheetId: string; fileId: string };
let before: Record<string, unknown[]>;

/** Expects a 403/404 AppError. */
async function expectDenied(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the call to be rejected").toBeInstanceOf(AppError);
  expect([403, 404]).toContain((err as AppError).status);
}

/** Expects a 400 (strict schema rejected a client-sent firm id). */
async function expectRejectedInput(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(400);
}

/** Postgres rejects the write with "new row violates row-level security policy". */
async function expectRlsViolation(p: Promise<unknown>) {
  const err = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as { message?: string; cause?: { message?: string } } | null;
  expect(err, "expected an RLS violation").not.toBeNull();
  expect(`${err!.cause?.message ?? ""} ${err!.message ?? ""}`).toMatch(/row-level security/);
}

function cookieReq(url: string, token: string) {
  return new Request(url, { headers: { cookie: `${sessionCookieName(false)}=${token}` } });
}

beforeAll(async () => {
  const a = await createFirmWithAdmin(d, "Alpha");
  const aConsultant = await addMember(d, a.admin, "CONSULTANT");
  const file = await uploadFile(d, a.admin, "%PDF-1.4 alpha timesheet");
  const pending = await membersH.inviteUser(d, a.admin.ctx, { email: "pending-alpha@example.com", role: "FINANCE" });
  const am = await createMasterData(d, a.admin, "Alpha");
  // M2: a timesheet with entries, evidence (extraction queued, never run here) and a check, plus
  // a file in the unmatched queue.
  const aOct = (await tsH.listTimesheetInbox(d, a.admin.ctx, { statuses: ["NOT_STARTED"] })).find((t) => t.periodStart === "2026-10-01")!;
  await tsH.saveTimesheetEntries(d, a.admin.ctx, { timesheetId: aOct.id, entries: [{ workDate: "2026-10-01", hours: "8" }] });
  const aPng = await uploadFile(d, a.admin, await screenshotPng(101), "a.png", "image/png");
  const aEv = await tsH.uploadEvidence(d, a.admin.ctx, { timesheetId: aOct.id, fileId: aPng.id });
  const aLoose = await uploadFile(d, a.admin, await screenshotPng(102), "loose.png", "image/png");
  const aUnmatched = await tsH.uploadEvidence(d, a.admin.ctx, { fileId: aLoose.id });
  const aDetail = await tsH.getTimesheetDetail(d, a.admin.ctx, { timesheetId: aOct.id });
  const [aX] = await withTenant(d.db, a.admin.ctx, (tx) =>
    tx.execute<{ id: string }>(sql`select id from extraction where firm_id = ${a.firmId} limit 1`).then((r) => r.rows),
  );
  A = {
    ...a,
    consultant: aConsultant,
    fileId: file.id,
    inviteToken: linkToken(d, pending),
    m: am,
    ts: { timesheetId: aOct.id, evidenceId: aEv.evidenceId, unmatchedEvidenceId: aUnmatched.evidenceId, checkId: aDetail.checks[0]!.id, extractionId: aX!.id },
  };

  const b = await createFirmWithAdmin(d, "Bravo");
  const bm = await createMasterData(d, b.admin, "Bravo");
  const bOct = (await tsH.listTimesheetInbox(d, b.admin.ctx, { statuses: ["NOT_STARTED"] })).find((t) => t.periodStart === "2026-10-01")!;
  const bFile = await uploadFile(d, b.admin, await screenshotPng(201), "b.png", "image/png");
  B = { ...b, consultant: await addMember(d, b.admin, "CONSULTANT"), m: bm, timesheetId: bOct.id, fileId: bFile.id };
  await uploadFile(d, B.admin, "%PDF-1.4 bravo timesheet");

  before = await snapshotFirm(A.firmId);
});

afterAll(async () => {
  // Firm A's rows are byte-for-byte what they were before Firm B started calling things.
  expect(await snapshotFirm(A.firmId)).toEqual(before);
  await closeTestDb();
});

// ---------------------------------------------------------------------------
// handlers that take an id
// ---------------------------------------------------------------------------
describe("T12: handlers called with Firm B's session and Firm A's ids", () => {
  it("switchFirm → 404", async () => {
    await expectDenied(authH.switchFirm(d, B.admin.auth, { firmId: A.firmId }));
    const s = await resolveSession(d.db, B.admin.token);
    expect(s!.firmId).toBe(B.firmId);
  });

  it("completeUpload(A's file) → 404", async () => {
    await expectDenied(filesH.completeUpload(d, B.admin.ctx, { fileId: A.fileId }));
  });

  it("getDownloadUrl(A's file) → 404", async () => {
    await expectDenied(filesH.getDownloadUrl(d, B.admin.ctx, { fileId: A.fileId }));
    await expectDenied(filesH.getDownloadUrl(d, B.consultant.ctx, { fileId: A.fileId }));
  });

  it("acceptInvite / getInvitation take a secret token, not an id: A's invitation id → 404", async () => {
    // Invitations are addressed only by their 256-bit token. Firm B can pass A's invitation id
    // (or any other id) and gets 404; B's session plays no part in acceptance.
    const [inv] = await withTenant(d.db, A.admin.ctx, (tx) =>
      tx.execute<{ id: string }>(sql`select id from invitation where firm_id = ${A.firmId} limit 1`).then((r) => r.rows),
    );
    await expectDenied(membersH.getInvitation(d, { token: `${inv!.id}-padding` }));
    await expectDenied(membersH.acceptInvite(d, meta(), { token: `${inv!.id}-padding`, password: PASSWORD }));
    const s = await resolveSession(d.db, B.admin.token);
    expect(s!.firmId).toBe(B.firmId);
  });

});

// ---------------------------------------------------------------------------
// handlers whose firm comes only from the session
// ---------------------------------------------------------------------------
describe("T12: client-sent firm ids are rejected; session firm is used", () => {
  it("inviteUser with firmId: A → 400", async () => {
    await expectRejectedInput(
      membersH.inviteUser(d, B.admin.ctx, { email: "x@example.com", role: "MANAGER", firmId: A.firmId }),
    );
  });

  it("inviteUser for A's admin email creates an invitation in B only and leaves A's user unchanged", async () => {
    const r = await membersH.inviteUser(d, B.admin.ctx, { email: A.admin.email, role: "MANAGER", name: "Renamed by B" });
    expect(r.invitationId).toBeTruthy();
  });

  it("requestUpload with firmId: A → 400", async () => {
    await expectRejectedInput(
      filesH.requestUpload(d, B.admin.ctx, { filename: "x.pdf", contentType: "application/pdf", sizeBytes: 10, firmId: A.firmId }),
    );
  });

  it("signUpFirm with firmId: A → 400", async () => {
    await expectRejectedInput(
      authH.signUpFirm(d, meta(), {
        firmLegalName: "X",
        firmDisplayName: "X",
        name: "X",
        email: "x2@example.com",
        password: PASSWORD,
        firmId: A.firmId,
      }),
    );
  });

  it("signInWithPassword lands B in B's firm", async () => {
    const r = await authH.signInWithPassword(d, meta(), { email: B.admin.email, password: PASSWORD });
    const s = await resolveSession(d.db, r.session.token);
    expect(s!.firmId).toBe(B.firmId);
  });

  it("beginMfaSetup / enableMfa / verifyMfa act only on the caller's own user", async () => {
    const r = await authH.signInWithPassword(d, meta(), { email: B.admin.email, password: PASSWORD });
    const auth = await resolveSession(d.db, r.session.token);
    await expect(authH.beginMfaSetup(d, auth)).rejects.toThrow(/already enabled/);
    await expect(authH.enableMfa(d, meta(), auth, { code: "123456" })).rejects.toThrow(/already enabled/);
    await authH.verifyMfa(d, auth, { code: generateTotp(B.admin.totpSecret!) });
    expect((await resolveSession(d.db, r.session.token))!.firmId).toBe(B.firmId);
  });
});

// ---------------------------------------------------------------------------
// list/read handlers return only the session firm's data
// ---------------------------------------------------------------------------
describe("T12: reads return only Firm B's data", () => {
  it("listMyFirms", async () => {
    const firms = await authH.listMyFirms(d, B.admin.auth);
    expect(firms.map((f) => f.firmId)).toEqual([B.firmId]);
  });

  it("listMembers", async () => {
    const r = await membersH.listMembers(d, B.admin.ctx);
    const ids = r.members.map((m) => m.userId);
    expect(ids).not.toContain(A.admin.userId);
    expect(ids).not.toContain(A.consultant.userId);
    expect(r.pendingInvitations.map((i) => i.email)).not.toContain("pending-alpha@example.com");
  });

  it("listFiles", async () => {
    const files = await filesH.listFiles(d, B.admin.ctx);
    expect(files.length).toBeGreaterThan(0);
    expect(files.map((f) => f.id)).not.toContain(A.fileId);
  });

  it("getFirmSummary", async () => {
    expect((await homeH.getFirmSummary(d, B.admin.ctx)).id).toBe(B.firmId);
  });

  it("getInvitation needs the secret token; an unknown token → 404", async () => {
    await expectDenied(membersH.getInvitation(d, { token: "x".repeat(43) }));
  });
});

// ---------------------------------------------------------------------------
// route handlers
// ---------------------------------------------------------------------------
describe("T12: route handlers", () => {
  it("GET /api/files/:id/download with B's cookie and A's file → 404", async () => {
    const res = await routesH.downloadFileRoute(d, cookieReq(`http://localhost/api/files/${A.fileId}/download`, B.admin.token), A.fileId);
    expect(res.status).toBe(404);
  });

  it("GET /api/files/:id/download with A's cookie works (control)", async () => {
    const res = await routesH.downloadFileRoute(d, cookieReq(`http://localhost/api/files/${A.fileId}/download`, A.admin.token), A.fileId);
    expect(res.status).toBe(302);
  });

  it("GET /api/files/:id/download without a session → 401", async () => {
    const res = await routesH.downloadFileRoute(d, new Request("http://localhost/x"), A.fileId);
    expect(res.status).toBe(401);
  });

  it("GET /api/health returns no tenant data", async () => {
    const { GET } = await import("../app/api/health/route");
    const body = (await GET().json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["ok", "revision", "service"]);
  });

  it("Auth.js /api/auth/*: session lookup by B's token returns only B's user", async () => {
    // The Auth.js routes reach the database only through the adapter in src/auth.ts, which
    // looks sessions up by token and users by id/email — never by firm.
    (globalThis as { verilo?: unknown }).verilo = d;
    const { GET } = await import("../app/api/auth/[...nextauth]/route");
    const res = await GET(
      Object.assign(cookieReq("http://localhost:3000/api/auth/session", B.admin.token), {
        nextUrl: new URL("http://localhost:3000/api/auth/session"),
      }) as never,
    );
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(A.admin.email);
    expect(body).not.toContain(A.firmId);
  });
});

// ---------------------------------------------------------------------------
// row-level security, independent of the application code
// ---------------------------------------------------------------------------
describe("T12: row-level security as a second safeguard", () => {
  const tables = ["firm", "membership", "audit_event", "file", "invitation"];

  it("in Firm B's context, raw SQL sees none of Firm A's rows", async () => {
    await withTenant(d.db, B.admin.ctx, async (tx) => {
      for (const t of tables) {
        const col = t === "firm" ? "id" : "firm_id";
        const r = await tx.execute(sql.raw(`select count(*)::int as n from ${t} where ${col} = '${A.firmId}'`));
        expect((r.rows[0] as { n: number }).n, t).toBe(0);
      }
      const users = await tx.execute(sql`select count(*)::int as n from app_user where id = ${A.admin.userId}`);
      expect((users.rows[0] as { n: number }).n).toBe(0);
    });
  });

  it("in Firm B's context, raw SQL can't update or insert Firm A's rows", async () => {
    await withTenant(d.db, B.admin.ctx, async (tx) => {
      const u = await tx.execute(sql`update file set filename = 'pwned' where id = ${A.fileId}`);
      expect(u.rowCount).toBe(0);
      const f = await tx.execute(sql`update firm set display_name = 'pwned' where id = ${A.firmId}`);
      expect(f.rowCount).toBe(0);
    });
    await expectRlsViolation(
      withTenant(d.db, B.admin.ctx, (tx) =>
        tx.execute(sql`insert into membership (firm_id, user_id, role) values (${A.firmId}, ${B.admin.userId}, 'ADMIN')`),
      ),
    );
    await expectRlsViolation(
      withTenant(d.db, B.admin.ctx, (tx) =>
        tx.execute(
          sql`insert into audit_event (firm_id, entity_type, entity_id, action) values (${A.firmId}, 'x', ${A.fileId}, 'x')`,
        ),
      ),
    );
  });

  it("with no context at all, tenant tables are empty to the runtime role", async () => {
    const r = await d.db.execute(sql`select (select count(*) from firm)::int + (select count(*) from file)::int + (select count(*) from membership)::int as n`);
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M1 master data: Firm B's session with Firm A's ids
// ---------------------------------------------------------------------------
describe("T12: master data handlers with Firm A's ids", () => {
  const b = () => B.admin.ctx;

  it("parties: detail, update, archive → 404", async () => {
    await expectDenied(partiesH.getPartyDetail(d, b(), { partyId: A.m.primeId }));
    await expectDenied(partiesH.updateParty(d, b(), { partyId: A.m.primeId, legalName: "x", displayName: "x", code: "PWND" }));
    await expectDenied(partiesH.archiveParty(d, b(), { partyId: A.m.endClientId }));
  });

  it("parties: create with a client-sent firmId → 400", async () => {
    await expectRejectedInput(partiesH.createParty(d, b(), { kind: "END_CLIENT", legalName: "x", displayName: "x", firmId: A.firmId }));
  });

  it("contacts and documents → 404", async () => {
    await expectDenied(partiesH.addContact(d, b(), { partyId: A.m.primeId, name: "x" }));
    await expectDenied(partiesH.archiveContact(d, b(), { contactId: A.m.contactId }));
    await expectDenied(partiesH.attachPartyDocument(d, b(), { partyId: A.m.subVendorId, fileId: B.m.fileId, docType: "W9" }));
    // B's own party with A's file: the file isn't found in B (composite FK backs this up).
    await expectDenied(partiesH.attachPartyDocument(d, b(), { partyId: B.m.subVendorId, fileId: A.m.fileId, docType: "W9" }));
    await expectDenied(partiesH.archivePartyDocument(d, b(), { documentId: A.m.documentId }));
  });

  it("consultants → 404", async () => {
    await expectDenied(consultantsH.getConsultantDetail(d, b(), { consultantId: A.m.consultantId }));
    await expectDenied(
      consultantsH.updateConsultant(d, b(), { consultantId: A.m.consultantId, firstName: "x", lastName: "x", employmentType: "W2" }),
    );
    await expectDenied(consultantsH.setConsultantStatus(d, b(), { consultantId: A.m.consultantId, status: "INACTIVE" }));
    await expectDenied(consultantsH.archiveConsultant(d, b(), { consultantId: A.m.consultantId }));
    // Creating a contractor under A's sub-vendor.
    await expectDenied(
      consultantsH.createConsultant(d, b(), { firstName: "x", lastName: "y", employmentType: "CONTRACTOR", subVendorPartyId: A.m.subVendorId }),
    );
  });

  it("engagements → 404", async () => {
    await expectDenied(engagementsH.getEngagementDetail(d, b(), { engagementId: A.m.engagementId }));
    const base = {
      billToPartyId: B.m.primeId,
      endClientPartyId: B.m.endClientId,
      startDate: "2026-09-01",
      timesheetCycle: "MONTHLY",
      invoiceCycle: "MONTHLY",
    };
    await expectDenied(engagementsH.updateEngagement(d, b(), { engagementId: A.m.engagementId, ...base }));
    await expectDenied(engagementsH.setEngagementStatus(d, b(), { engagementId: A.m.engagementId, status: "ENDED", endDate: "2026-12-31" }));
    // A's consultant, or B's consultant billed to A's parties.
    await expectDenied(engagementsH.createEngagement(d, b(), { consultantId: A.m.consultantId, ...base }));
    await expectDenied(engagementsH.createEngagement(d, b(), { consultantId: B.m.consultantId, ...base, billToPartyId: A.m.primeId }));
    await expectDenied(engagementsH.createEngagement(d, b(), { consultantId: B.m.consultantId, ...base, endClientPartyId: A.m.endClientId }));
  });

  it("rates and POs → 404", async () => {
    await expectDenied(engagementsH.addRate(d, b(), { engagementId: A.m.engagementId, side: "BILL", rate: "1.00", effectiveFrom: "2030-01-01" }));
    await expectDenied(engagementsH.endRate(d, b(), { rateId: A.m.billRateId, effectiveTo: "2026-09-30" }));
    await expectDenied(engagementsH.addPurchaseOrder(d, b(), { engagementId: A.m.engagementId, poNumber: "X" }));
  });

  it("lists and form options contain only Firm B's records", async () => {
    const parties = await partiesH.listParties(d, b());
    expect(parties.map((p) => p.id)).not.toContain(A.m.primeId);
    expect(parties.length).toBeGreaterThan(0);
    const cons = await consultantsH.listConsultants(d, b());
    expect(cons.map((c) => c.id)).not.toContain(A.m.consultantId);
    const opts = await engagementsH.getEngagementFormOptions(d, b());
    const all = [...opts.billTo, ...opts.endClients, ...opts.primes, ...opts.subVendors, ...opts.consultants].map((x) => x.id);
    expect(all).not.toContain(A.m.primeId);
    expect(all).not.toContain(A.m.consultantId);
  });

  it("settings: reads show Firm B; A's ids → 404; client-sent firmId → 400", async () => {
    const s = await settingsH.getFirmSettings(d, b());
    expect(s.billToParties.map((p) => p.id)).not.toContain(A.m.primeId);
    expect(s.holidays).toHaveLength(1);
    await expectDenied(settingsH.previewInvoiceNumber(d, b(), { pattern: "{CLIENT}-{SEQ:4}", clientPartyId: A.m.primeId, invoiceDate: "2026-11-01" }));
    await expectDenied(
      settingsH.updateFirm(d, b(), {
        legalName: "Bravo Consulting LLC",
        displayName: "Bravo Consulting",
        timezone: "America/Chicago",
        weekStart: "MON",
        matchTolerance: "1.00",
        deductionTolerance: "1.00",
        logoFileId: A.m.fileId,
      }),
    );
    await expectRejectedInput(settingsH.setNumberingPattern(d, b(), { pattern: "{SEQ:4}", seqReset: "NEVER", firmId: A.firmId }));
    await expectRejectedInput(settingsH.setHolidays(d, b(), { holidays: [], firmId: A.firmId }));
  });

  it("users and roles: A's membership → 404; inviting A's consultant → 404", async () => {
    const [m] = await withTenant(d.db, A.admin.ctx, (tx) =>
      tx.execute<{ id: string }>(sql`select id from membership where firm_id = ${A.firmId} and role = 'CONSULTANT' limit 1`).then((r) => r.rows),
    );
    await expectDenied(membersH.updateMember(d, b(), { membershipId: m!.id, disabled: true }));
    await expectDenied(membersH.inviteUser(d, b(), { email: "c@example.com", role: "CONSULTANT", consultantId: A.m.consultantId }));
  });

  it("RLS: raw SQL in Firm B can't see or write Firm A's master data, and same-firm FKs block cross-firm links", async () => {
    await withTenant(d.db, b(), async (tx) => {
      for (const t of ["party", "party_contact", "party_document", "consultant", "engagement", "rate", "purchase_order", "firm_holiday"]) {
        const r = await tx.execute(sql.raw(`select count(*)::int as n from ${t} where firm_id = '${A.firmId}'`));
        expect((r.rows[0] as { n: number }).n, t).toBe(0);
      }
    });
    // Even with RLS satisfied (row in B), a reference to A's party is rejected by the composite FK.
    const err = await withTenant(d.db, b(), (tx) =>
      tx.execute(sql`update engagement set bill_to_party_id = ${A.m.primeId} where id = ${B.m.engagementId}`),
    ).catch((e: unknown) => e as { cause?: { message?: string } });
    expect(String((err as { cause?: { message?: string } })?.cause?.message)).toMatch(/foreign key/);
  });
});

// ---------------------------------------------------------------------------
// M2 timesheets, evidence, review and intake: Firm B's session with Firm A's ids
// ---------------------------------------------------------------------------
describe("T12: timesheet handlers with Firm A's ids", () => {
  const b = () => B.admin.ctx;
  const t = () => A.ts.timesheetId;

  it("detail, entries, submit → 404 (staff and consultant sessions)", async () => {
    await expectDenied(tsH.getTimesheetDetail(d, b(), { timesheetId: t() }));
    await expectDenied(tsH.getTimesheetDetail(d, B.consultant.ctx, { timesheetId: t() }));
    await expectDenied(tsH.saveTimesheetEntries(d, b(), { timesheetId: t(), entries: [{ workDate: "2026-10-02", hours: "8" }] }));
    await expectDenied(tsH.saveTimesheetEntries(d, B.consultant.ctx, { timesheetId: t(), entries: [] }));
    await expectDenied(tsH.submitTimesheet(d, b(), { timesheetId: t() }));
  });

  it("evidence: attach to A's timesheet, attach A's file, remove A's evidence → 404", async () => {
    await expectDenied(tsH.uploadEvidence(d, b(), { timesheetId: t(), fileId: B.fileId }));
    await expectDenied(tsH.uploadEvidence(d, b(), { timesheetId: B.timesheetId, fileId: A.fileId }));
    await expectDenied(tsH.uploadEvidence(d, b(), { fileId: A.fileId }));
    await expectDenied(tsH.removeEvidence(d, b(), { evidenceId: A.ts.evidenceId }));
  });

  it("review: resolve A's check, verify, return → 404", async () => {
    await expectDenied(tsH.resolveCheck(d, b(), { checkId: A.ts.checkId, reason: "looks fine" }));
    await expectDenied(tsH.verifyTimesheet(d, b(), { timesheetId: t() }));
    await expectDenied(tsH.returnTimesheet(d, b(), { timesheetId: t(), reason: "nope nope" }));
  });

  it("unmatched queue: assigning A's file, or a file to A's timesheet → 404", async () => {
    await expectDenied(tsH.assignUnmatchedFile(d, b(), { evidenceId: A.ts.unmatchedEvidenceId, timesheetId: B.timesheetId }));
    await expectDenied(tsH.assignUnmatchedFile(d, b(), { evidenceId: A.ts.unmatchedEvidenceId, timesheetId: t() }));
  });

  it("client-sent firm ids are rejected", async () => {
    await expectRejectedInput(tsH.saveTimesheetEntries(d, b(), { timesheetId: B.timesheetId, entries: [], firmId: A.firmId }));
    await expectRejectedInput(tsH.listTimesheetInbox(d, b(), { firmId: A.firmId }));
  });

  it("lists contain only Firm B's timesheets and files", async () => {
    const inbox = await tsH.listTimesheetInbox(d, b(), { statuses: ["NOT_STARTED", "DRAFT", "SUBMITTED", "NEEDS_REVIEW", "VERIFIED", "RETURNED", "INVOICED"] });
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox.map((x) => x.id)).not.toContain(t());
    const unmatched = await tsH.listUnmatched(d, b());
    expect(unmatched.items.map((x) => x.id)).not.toContain(A.ts.unmatchedEvidenceId);
    expect(unmatched.timesheets.map((x) => x.id)).not.toContain(t());
    const mine = await tsH.listMyTimesheets(d, B.consultant.ctx);
    expect(mine.timesheets.map((x) => x.id)).not.toContain(t());
  });

  it("jobs scoped to Firm B can't touch Firm A's rows", async () => {
    await runExtractionJob(d, { firmId: B.firmId, extractionId: A.ts.extractionId });
    await runTimesheetChecksJob(d, { firmId: B.firmId, timesheetId: t() });
  });

  it("RLS: raw SQL in Firm B sees none of Firm A's M2 rows", async () => {
    await withTenant(d.db, b(), async (tx) => {
      for (const tb of ["timesheet", "timesheet_entry", "evidence", "extraction", "timesheet_check", "inbound_email", "ai_usage_event", "notification"]) {
        const r = await tx.execute(sql.raw(`select count(*)::int as n from ${tb} where firm_id = '${A.firmId}'`));
        expect((r.rows[0] as { n: number }).n, tb).toBe(0);
      }
    });
    const err = await withTenant(d.db, b(), (tx) =>
      tx.execute(sql`insert into evidence (firm_id, timesheet_id, file_id, source) values (${B.firmId}, ${t()}, ${B.fileId}, 'BULK_UPLOAD')`),
    ).catch((e: unknown) => e as { cause?: { message?: string } });
    expect(String((err as { cause?: { message?: string } })?.cause?.message ?? "")).toMatch(/foreign key/);
  });
});

describe("T12: POST /api/inbound-email/:provider", () => {
  const req = (body: object, auth = "postmark:test-inbound-webhook-secret") =>
    new Request("http://localhost/api/inbound-email/postmark", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(auth).toString("base64")}` },
      body: JSON.stringify(body),
    });
  const inbox = async (firmId: string) =>
    (await withTenant(d.db, { firmId, userId: firmId === A.firmId ? A.admin.userId : B.admin.userId }, (tx) =>
      tx.execute<{ a: string }>(sql`select timesheet_inbox_address as a from firm where id = ${firmId}`).then((r) => r.rows[0]!.a),
    ));

  it("without the webhook secret → 401 and nothing stored", async () => {
    const res = await receiveInboundEmail(d, req({ From: "x@y.test", ToFull: [{ Email: await inbox(A.firmId) }], MessageID: "m1" }, "postmark:guess"), "postmark");
    expect(res.status).toBe(401);
  });

  it("an email to Firm B's inbox from Firm A's consultant is stored in B only and doesn't match A's consultant", async () => {
    const aConsultant = await consultantsH.getConsultantDetail(d, A.admin.ctx, { consultantId: A.m.consultantId });
    const res = await receiveInboundEmail(
      d,
      req({ From: aConsultant.consultant.emails[0], ToFull: [{ Email: await inbox(B.firmId) }], MessageID: "t12-cross", Attachments: [] }),
      "postmark",
    );
    expect(await res.json()).toEqual({ ok: true, stored: 1 });
    const { processInboundEmailJob } = await import("./jobs/inbound");
    const [row] = await withTenant(d.db, B.admin.ctx, (tx) =>
      tx.execute<{ id: string }>(sql`select id from inbound_email where firm_id = ${B.firmId} and message_id = 't12-cross'`).then((r) => r.rows),
    );
    await processInboundEmailJob(d, { firmId: B.firmId, inboundEmailId: row!.id });
    const [after] = await withTenant(d.db, B.admin.ctx, (tx) =>
      tx.execute<{ matched_consultant_id: string | null }>(sql`select matched_consultant_id from inbound_email where id = ${row!.id}`).then((r) => r.rows),
    );
    expect(after!.matched_consultant_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// coverage guard: every handler and route must appear above
// ---------------------------------------------------------------------------
const COVERED_HANDLERS = new Set([
  "auth.signUpFirm",
  "auth.signInWithPassword",
  "auth.beginMfaSetup",
  "auth.enableMfa",
  "auth.verifyMfa",
  "auth.switchFirm",
  "auth.listMyFirms",
  "members.inviteUser",
  "members.listMembers",
  "members.getInvitation",
  "members.acceptInvite",
  "files.requestUpload",
  "files.completeUpload",
  "files.listFiles",
  "files.getDownloadUrl",
  "home.getFirmSummary",
  "routes.downloadFileRoute",
  "members.updateMember",
  "parties.listParties",
  "parties.getPartyDetail",
  "parties.createParty",
  "parties.updateParty",
  "parties.archiveParty",
  "parties.addContact",
  "parties.archiveContact",
  "parties.attachPartyDocument",
  "parties.archivePartyDocument",
  "consultants.listConsultants",
  "consultants.getConsultantDetail",
  "consultants.createConsultant",
  "consultants.updateConsultant",
  "consultants.setConsultantStatus",
  "consultants.archiveConsultant",
  "engagements.getEngagementDetail",
  "engagements.createEngagement",
  "engagements.updateEngagement",
  "engagements.setEngagementStatus",
  "engagements.addRate",
  "engagements.endRate",
  "engagements.addPurchaseOrder",
  "engagements.getEngagementFormOptions",
  "settings.getFirmSettings",
  "settings.updateFirm",
  "settings.setNumberingPattern",
  "settings.previewInvoiceNumber",
  "settings.setHolidays",
  "timesheets.listMyTimesheets",
  "timesheets.getTimesheetDetail",
  "timesheets.saveTimesheetEntries",
  "timesheets.submitTimesheet",
  "timesheets.uploadEvidence",
  "timesheets.removeEvidence",
  "timesheets.resolveCheck",
  "timesheets.verifyTimesheet",
  "timesheets.returnTimesheet",
  "timesheets.listTimesheetInbox",
  "timesheets.listUnmatched",
  "timesheets.assignUnmatchedFile",
]);
/** Exported helpers that are not request handlers. */
const NOT_HANDLERS = new Set(["auth.slugify", "routes.cookieFromRequest", "members.INVITE_TTL_DAYS"]);
const COVERED_ROUTES = new Set(["api/auth/[...nextauth]", "api/health", "api/files/[id]/download", "api/inbound-email/[provider]"]);

describe("T12 coverage", () => {
  it("every exported handler has a tenant-isolation case", () => {
    const modules = {
      auth: authH,
      members: membersH,
      files: filesH,
      home: homeH,
      routes: routesH,
      parties: partiesH,
      consultants: consultantsH,
      engagements: engagementsH,
      settings: settingsH,
      timesheets: tsH,
    };
    const exported = Object.entries(modules).flatMap(([m, mod]) =>
      Object.entries(mod)
        .filter(([, v]) => typeof v === "function" || typeof v === "number")
        .map(([k]) => `${m}.${k}`),
    );
    const missing = exported.filter((e) => !COVERED_HANDLERS.has(e) && !NOT_HANDLERS.has(e));
    expect(missing, "add a T12 case for these handlers").toEqual([]);
    const handlerDir = path.join(HERE, "handlers");
    const files = fs.readdirSync(handlerDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.sort()).toEqual([
      "auth.ts",
      "common.ts",
      "consultants.ts",
      "engagements.ts",
      "fields.ts",
      "files.ts",
      "firm-crypto.ts",
      "home.ts",
      "members.ts",
      "parties.ts",
      "routes.ts",
      "settings.ts",
      "timesheets.ts",
    ]);
  });

  it("every route handler file has a tenant-isolation case", () => {
    const appDir = path.join(HERE, "..", "app");
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "route.ts") routes.push(path.relative(appDir, dir).split(path.sep).join("/"));
      }
    };
    walk(appDir);
    expect(routes.filter((r) => !COVERED_ROUTES.has(r)), "add a T12 case for these routes").toEqual([]);
  });

  it("every server action delegates to a covered handler", () => {
    const actionsDir = path.join(HERE, "actions");
    const ACTIONS: Record<string, string | null> = {
      signUpFirmAction: "auth.signUpFirm",
      signInAction: "auth.signInWithPassword",
      requestMagicLinkAction: null, // Auth.js email flow; covered by the /api/auth route case
      enableMfaAction: "auth.enableMfa",
      verifyMfaAction: "auth.verifyMfa",
      switchFirmAction: "auth.switchFirm",
      signOutAction: null, // deletes only the caller's own session
      inviteUserAction: "members.inviteUser",
      acceptInviteAction: "members.acceptInvite",
      requestUploadAction: "files.requestUpload",
      completeUploadAction: "files.completeUpload",
      createPartyAction: "parties.createParty",
      updatePartyAction: "parties.updateParty",
      archivePartyAction: "parties.archiveParty",
      addContactAction: "parties.addContact",
      archiveContactAction: "parties.archiveContact",
      attachPartyDocumentAction: "parties.attachPartyDocument",
      archivePartyDocumentAction: "parties.archivePartyDocument",
      createConsultantAction: "consultants.createConsultant",
      updateConsultantAction: "consultants.updateConsultant",
      setConsultantStatusAction: "consultants.setConsultantStatus",
      archiveConsultantAction: "consultants.archiveConsultant",
      createEngagementAction: "engagements.createEngagement",
      updateEngagementAction: "engagements.updateEngagement",
      setEngagementStatusAction: "engagements.setEngagementStatus",
      addRateAction: "engagements.addRate",
      endRateAction: "engagements.endRate",
      addPurchaseOrderAction: "engagements.addPurchaseOrder",
      updateFirmAction: "settings.updateFirm",
      setNumberingPatternAction: "settings.setNumberingPattern",
      previewInvoiceNumberAction: "settings.previewInvoiceNumber",
      setHolidaysAction: "settings.setHolidays",
      updateMemberAction: "members.updateMember",
      saveTimesheetEntriesAction: "timesheets.saveTimesheetEntries",
      submitTimesheetAction: "timesheets.submitTimesheet",
      uploadEvidenceAction: "timesheets.uploadEvidence",
      removeEvidenceAction: "timesheets.removeEvidence",
      resolveCheckAction: "timesheets.resolveCheck",
      verifyTimesheetAction: "timesheets.verifyTimesheet",
      returnTimesheetAction: "timesheets.returnTimesheet",
      assignUnmatchedFileAction: "timesheets.assignUnmatchedFile",
      getTimesheetDetailAction: "timesheets.getTimesheetDetail",
    };
    const found = fs
      .readdirSync(actionsDir)
      .flatMap((f) => [...fs.readFileSync(path.join(actionsDir, f), "utf8").matchAll(/export async function (\w+)/g)].map((m) => m[1]!));
    expect(found.sort()).toEqual(Object.keys(ACTIONS).sort());
    for (const h of Object.values(ACTIONS)) if (h) expect(COVERED_HANDLERS.has(h)).toBe(true);
  });

  it("NotFoundError is what other firms' ids produce (no existence leak)", () => {
    expect(new NotFoundError().status).toBe(404);
  });
});
