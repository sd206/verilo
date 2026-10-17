/**
 * M0 acceptance flows (section 19): sign up a firm; invite users of all four roles; MFA enforced
 * for Admin/Finance; uploading a file stores it and marks it CLEAN; audit events are written.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  generateTotp,
  MfaRequiredError,
  requireFirmContext,
  resolveSession,
  UnauthenticatedError,
} from "@verilo/auth";
import { withOwnerClient } from "@verilo/db/testing";
import * as authH from "./handlers/auth";
import * as membersH from "./handlers/members";
import * as filesH from "./handlers/files";
import { createConsultant } from "./handlers/consultants";
import { addMember, CapturingEmail, closeTestDb, createFirmWithAdmin, EICAR, linkToken, meta, PASSWORD, testDeps, uploadFile } from "./testing";

const d = testDeps();
afterAll(closeTestDb);

async function auditActions(firmId: string) {
  return withOwnerClient(async (c) =>
    (await c.query<{ entity_type: string; action: string }>(
      "select entity_type, action from audit_event where firm_id = $1 order by created_at, id",
      [firmId],
    )).rows.map((r) => `${r.entity_type}.${r.action}`),
  );
}

describe("sign up a firm", () => {
  it("creates the firm, an ACTIVE admin, the membership and audit events", async () => {
    const r = await authH.signUpFirm(d, meta(), {
      firmLegalName: "Delta Consulting LLC",
      firmDisplayName: "Delta Consulting",
      name: "Dana",
      email: "Dana@Example.com ",
      password: PASSWORD,
    });
    expect(r.next).toBe("/mfa/setup");
    const auth = await resolveSession(d.db, r.session.token);
    expect(auth).toMatchObject({ firmId: r.firmId, role: "ADMIN", state: "MFA_SETUP_REQUIRED" });
    expect(auth!.user.email).toBe("dana@example.com");
    expect((await auditActions(r.firmId)).sort()).toEqual(["firm.create", "membership.create", "user.create"]);

    const firm = await withOwnerClient(async (c) => (await c.query("select * from firm where id = $1", [r.firmId])).rows[0]);
    expect(firm.timezone).toBe("America/Chicago");
    expect(firm.invoice_number_pattern).toBe("{CLIENT}-{YYYY}{MM}-{SEQ:4}");
    expect(firm.timesheet_inbox_address).toMatch(/^ts-delta-consulting-[0-9a-f]{6}@inbound\.test$/);
    expect(firm.wrapped_data_key).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("rejects a duplicate email, a weak password and unknown fields", async () => {
    const base = { firmLegalName: "Echo Two LLC", firmDisplayName: "Echo Two", name: "E", password: PASSWORD };
    await authH.signUpFirm(d, meta(), { ...base, email: "dup@example.com" });
    await expect(authH.signUpFirm(d, meta(), { ...base, email: "dup@example.com" })).rejects.toMatchObject({ status: 409 });
    await expect(authH.signUpFirm(d, meta(), { ...base, email: "weak@example.com", password: "short" })).rejects.toMatchObject({ status: 400 });
    await expect(authH.signUpFirm(d, meta(), { ...base, email: "x@example.com", role: "ADMIN" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("MFA is enforced for Admin and Finance", () => {
  it("an Admin can't act until MFA is set up; then sign-in needs the TOTP step", async () => {
    const r = await authH.signUpFirm(d, meta(), {
      firmLegalName: "Echo LLC",
      firmDisplayName: "Echo",
      name: "Eve",
      email: "eve@example.com",
      password: PASSWORD,
    });
    let auth = await resolveSession(d.db, r.session.token);
    expect(() => requireFirmContext(auth)).toThrow(MfaRequiredError);

    const { secret } = await authH.beginMfaSetup(d, auth);
    // Reloading the setup page shows the same pending secret.
    expect((await authH.beginMfaSetup(d, auth)).secret).toBe(secret);
    await expect(authH.enableMfa(d, meta(), auth, { code: "000000" })).rejects.toMatchObject({ status: 400 });
    const { recoveryCodes } = await authH.enableMfa(d, meta(), auth, { code: generateTotp(secret) });
    expect(recoveryCodes).toHaveLength(10);
    auth = await resolveSession(d.db, r.session.token);
    expect(auth!.state).toBe("OK");

    // New sign-in: password alone is not enough.
    const s = await authH.signInWithPassword(d, meta(), { email: "eve@example.com", password: PASSWORD });
    expect(s.next).toBe("/mfa/verify");
    const pending = await resolveSession(d.db, s.session.token);
    expect(pending!.state).toBe("MFA_REQUIRED");
    expect(() => requireFirmContext(pending)).toThrow(MfaRequiredError);

    // A recovery code works once.
    await authH.verifyMfa(d, pending, { recoveryCode: recoveryCodes[0]! });
    expect((await resolveSession(d.db, s.session.token))!.state).toBe("OK");
    const s2 = await authH.signInWithPassword(d, meta(), { email: "eve@example.com", password: PASSWORD });
    const p2 = await resolveSession(d.db, s2.session.token);
    await expect(authH.verifyMfa(d, p2, { recoveryCode: recoveryCodes[0]! })).rejects.toMatchObject({ status: 400 });
    await authH.verifyMfa(d, p2, { code: generateTotp(secret) });
    expect((await resolveSession(d.db, s2.session.token))!.state).toBe("OK");
  });

  it("wrong password and unknown email give the same error", async () => {
    const e1 = await authH.signInWithPassword(d, meta(), { email: "eve@example.com", password: "nope-nope-nope" }).catch((e: unknown) => e);
    const e2 = await authH.signInWithPassword(d, meta(), { email: "nobody@example.com", password: "nope-nope-nope" }).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(UnauthenticatedError);
    expect((e1 as Error).message).toBe((e2 as Error).message);
  });
});

describe("invite users of all four roles", () => {
  it("each role joins; Admin and Finance must enrol in MFA, Manager and Consultant need not", async () => {
    const { firmId, admin } = await createFirmWithAdmin(d, "Foxtrot");
    for (const role of ["ADMIN", "MANAGER", "FINANCE", "CONSULTANT"] as const) {
      const email = `${role.toLowerCase()}@foxtrot.example.com`;
      const consultantId =
        role === "CONSULTANT"
          ? (await createConsultant(d, admin.ctx, { firstName: "Cam", lastName: "Consultant", employmentType: "W2", emails: [email] })).id
          : undefined;
      const inv = await membersH.inviteUser(d, admin.ctx, { email, role, ...(consultantId ? { consultantId } : {}) });
      expect(inv.emailed).toBe(true);
      const acc = await membersH.acceptInvite(d, meta(), { token: linkToken(d, inv), name: role, password: PASSWORD });
      const auth = await resolveSession(d.db, acc.session.token);
      expect(auth!.role).toBe(role);
      expect(auth!.firmId).toBe(firmId);
      if (role === "ADMIN" || role === "FINANCE") {
        expect(acc.next).toBe("/mfa/setup");
        expect(auth!.state).toBe("MFA_SETUP_REQUIRED");
      } else {
        expect(acc.next).toBe("/app");
        expect(auth!.state).toBe("OK");
      }
    }
    const { members } = await membersH.listMembers(d, admin.ctx);
    expect(members.map((m) => m.role).sort()).toEqual(["ADMIN", "ADMIN", "CONSULTANT", "FINANCE", "MANAGER"]);
    const actions = await auditActions(firmId);
    expect(actions.filter((a) => a === "invitation.create")).toHaveLength(4);
    expect(actions.filter((a) => a === "invitation.accept")).toHaveLength(4);
    expect(actions.filter((a) => a === "user.status_change")).toHaveLength(4);
  });

  it("only Admins can invite (R8)", async () => {
    const { admin } = await createFirmWithAdmin(d, "Golf");
    for (const role of ["MANAGER", "FINANCE", "CONSULTANT"] as const) {
      const u = await addMember(d, admin, role);
      await expect(membersH.inviteUser(d, u.ctx, { email: `x-${role}@g.example.com`, role: "ADMIN" })).rejects.toMatchObject({ status: 403 });
      await expect(membersH.listMembers(d, u.ctx)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("an invitation works once and can't be reused", async () => {
    const { admin } = await createFirmWithAdmin(d, "Hotel");
    const inv = await membersH.inviteUser(d, admin.ctx, { email: "once@hotel.example.com", role: "MANAGER" });
    const token = linkToken(d, inv);
    await membersH.acceptInvite(d, meta(), { token, password: PASSWORD });
    await expect(membersH.acceptInvite(d, meta(), { token, password: PASSWORD })).rejects.toMatchObject({ status: 404 });
  });

  it("an existing user of another firm joins with their current password and can switch firms", async () => {
    const one = await createFirmWithAdmin(d, "India");
    const two = await createFirmWithAdmin(d, "Juliet");
    const inv = await membersH.inviteUser(d, two.admin.ctx, { email: one.admin.email, role: "MANAGER" });
    const token = linkToken(d, inv);
    await expect(membersH.acceptInvite(d, meta(), { token, password: "wrong-password-123" })).rejects.toMatchObject({ status: 401 });
    const acc = await membersH.acceptInvite(d, meta(), { token, password: PASSWORD });
    expect(acc.next).toBe("/mfa/verify"); // user already has MFA
    const firms = await authH.listMyFirms(d, one.admin.auth);
    expect(firms.map((f) => f.firmId).sort()).toEqual([one.firmId, two.firmId].sort());
    const sw = await authH.switchFirm(d, one.admin.auth, { firmId: two.firmId });
    expect(sw.next).toBe("/app");
    const after = await resolveSession(d.db, one.admin.token);
    expect(after).toMatchObject({ firmId: two.firmId, role: "MANAGER", state: "OK" });
  });

  it("without outbound email, outside production the admin gets the link instead", async () => {
    const noEmail = testDeps({ email: new CapturingEmail(false) });
    const { admin } = await createFirmWithAdmin(noEmail, "Kilo");
    const inv = await membersH.inviteUser(noEmail, admin.ctx, { email: "k@kilo.example.com", role: "MANAGER" });
    expect(inv.emailed).toBe(false);
    expect(inv.link).toMatch(/^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}$/);
    const prod = testDeps({ email: new CapturingEmail(false), config: { ...noEmail.config, appEnv: "production" } });
    await expect(membersH.inviteUser(prod, admin.ctx, { email: "k2@kilo.example.com", role: "MANAGER" })).rejects.toThrow(/not configured/);
  });
});

describe("file upload with virus scan", () => {
  it("stores the file, marks it CLEAN, records sha256 and audits the scan", async () => {
    const { firmId, admin } = await createFirmWithAdmin(d, "Lima");
    const body = "%PDF-1.4 approved timesheet";
    const f = await uploadFile(d, admin, body);
    expect(f.scanStatus).toBe("CLEAN");
    const row = await withOwnerClient(async (c) => (await c.query("select * from file where id = $1", [f.id])).rows[0]);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.storage_key).toBe(`firms/${firmId}/files/${f.id}`);
    expect(await filesH.getDownloadUrl(d, admin.ctx, { fileId: f.id })).toMatch(/^https:\/\/storage\.test\//);
    const actions = await auditActions(firmId);
    expect(actions.slice(-2)).toEqual(["file.create", "file.status_change"]);
  });

  it("marks EICAR INFECTED and never hands out a download URL", async () => {
    const { admin } = await createFirmWithAdmin(d, "Mike");
    const f = await uploadFile(d, admin, EICAR, "evil.pdf");
    expect(f.scanStatus).toBe("INFECTED");
    await expect(filesH.getDownloadUrl(d, admin.ctx, { fileId: f.id })).rejects.toMatchObject({ status: 409 });
    // Completing again doesn't rescan or change the result.
    expect((await filesH.completeUpload(d, admin.ctx, { fileId: f.id })).scanStatus).toBe("INFECTED");
  });

  it("enforces type, size and declared-size limits (section 17)", async () => {
    const { admin } = await createFirmWithAdmin(d, "November");
    const r = (x: object) => filesH.requestUpload(d, admin.ctx, x);
    await expect(r({ filename: "a.exe", contentType: "application/x-msdownload", sizeBytes: 10 })).rejects.toMatchObject({ status: 400 });
    await expect(r({ filename: "a.pdf", contentType: "application/pdf", sizeBytes: 16 * 1024 * 1024 })).rejects.toMatchObject({ status: 400 });
    await expect(r({ filename: "a.png", contentType: "application/pdf", sizeBytes: 10 })).rejects.toMatchObject({ status: 400 });
    const ok = await r({ filename: "a.pdf", contentType: "application/pdf", sizeBytes: 5 });
    await d.storage.put(ok.upload.url.replace("memory://", ""), Buffer.from("123456789"), "application/pdf");
    await expect(filesH.completeUpload(d, admin.ctx, { fileId: ok.fileId })).rejects.toMatchObject({ status: 400 });
  });

  it("consultants see only their own files; others in the firm can't complete someone else's upload", async () => {
    const { admin } = await createFirmWithAdmin(d, "Oscar");
    const consultant = await addMember(d, admin, "CONSULTANT");
    const mine = await uploadFile(d, consultant, "%PDF consultant");
    const adminFile = await uploadFile(d, admin, "%PDF admin");
    const visible = (await filesH.listFiles(d, consultant.ctx)).map((f) => f.id);
    expect(visible).toEqual([mine.id]);
    await expect(filesH.getDownloadUrl(d, consultant.ctx, { fileId: adminFile.id })).rejects.toMatchObject({ status: 404 });
    expect((await filesH.listFiles(d, admin.ctx)).map((f) => f.id).sort()).toEqual([mine.id, adminFile.id].sort());
    const req = await filesH.requestUpload(d, consultant.ctx, { filename: "x.pdf", contentType: "application/pdf", sizeBytes: 3 });
    await expect(filesH.completeUpload(d, admin.ctx, { fileId: req.fileId })).rejects.toMatchObject({ status: 404 });
  });
});

describe("consultant invitations (M1)", () => {
  it("require a consultant record and link the membership to it", async () => {
    const { admin } = await createFirmWithAdmin(d, "Papa");
    await expect(membersH.inviteUser(d, admin.ctx, { email: "c1@papa.example.com", role: "CONSULTANT" })).rejects.toMatchObject({ status: 400 });
    const c = await createConsultant(d, admin.ctx, { firstName: "Cam", lastName: "C", employmentType: "W2" });
    const inv = await membersH.inviteUser(d, admin.ctx, { email: "c1@papa.example.com", role: "CONSULTANT", consultantId: c.id });
    const acc = await membersH.acceptInvite(d, meta(), { token: linkToken(d, inv), name: "Cam", password: PASSWORD });
    const auth = await resolveSession(d.db, acc.session.token);
    expect(auth).toMatchObject({ role: "CONSULTANT", consultantId: c.id, state: "OK" });
  });
});
