/**
 * Seed data (section 18.1). Runs through the same handlers as the UI, so it is validated,
 * encrypted and audited like real data, and its documents go through the virus scan.
 * Local and test only: refused in staging and production.
 */
import { generateTotp, resolveSession, type FirmContext } from "@verilo/auth";
import { findUserForSignin, withAnonymous } from "@verilo/db";
import type { Deps } from "./deps";
import * as authH from "./handlers/auth";
import * as membersH from "./handlers/members";
import * as partiesH from "./handlers/parties";
import * as consultantsH from "./handlers/consultants";
import * as engagementsH from "./handlers/engagements";
import * as settingsH from "./handlers/settings";
import * as filesH from "./handlers/files";

export const SEED_ADMIN_EMAIL = "admin@lonestar.test";

export interface SeedResult {
  status: "seeded" | "already-seeded";
  password: string;
  totpSecrets: Record<string, string>;
  firmId?: string;
  ids?: Record<string, string>;
}

const META = { ip: "127.0.0.1", userAgent: "seed" };

async function ctxFor(d: Deps, token: string): Promise<FirmContext> {
  const auth = (await resolveSession(d.db, token))!;
  return {
    sessionId: auth.sessionId,
    userId: auth.user.id,
    firmId: auth.firmId!,
    role: auth.role!,
    consultantId: auth.consultantId,
    ip: META.ip,
    userAgent: META.userAgent,
  };
}

async function enrolMfa(d: Deps, token: string): Promise<string> {
  const auth = await resolveSession(d.db, token);
  const { secret } = await authH.beginMfaSetup(d, auth);
  await authH.enableMfa(d, META, auth, { code: generateTotp(secret) });
  return secret;
}

async function uploadPdf(d: Deps, ctx: FirmContext, filename: string, body: string): Promise<string> {
  const buf = Buffer.from(`%PDF-1.4\n% ${body}\n`);
  const req = await filesH.requestUpload(d, ctx, { filename, contentType: "application/pdf", sizeBytes: buf.length });
  await d.storage.put(`firms/${ctx.firmId}/files/${req.fileId}`, buf, "application/pdf");
  const done = await filesH.completeUpload(d, ctx, { fileId: req.fileId });
  if (done.scanStatus !== "CLEAN") throw new Error(`${filename} did not scan clean`);
  return req.fileId;
}

export async function runSeed(d: Deps, password: string): Promise<SeedResult> {
  if (d.config.appEnv === "staging" || d.config.appEnv === "production") {
    throw new Error("The seed runs only locally and in tests");
  }
  if (await withAnonymous(d.db, (tx) => findUserForSignin(tx, SEED_ADMIN_EMAIL))) {
    return { status: "already-seeded", password, totpSecrets: {} };
  }

  // --- Firm and Admin ---------------------------------------------------------------------
  const signup = await authH.signUpFirm(d, META, {
    firmLegalName: "Lonestar Data Consulting LLC",
    firmDisplayName: "Lonestar Data Consulting",
    name: "Lonestar Admin",
    email: SEED_ADMIN_EMAIL,
    password,
  });
  const totpSecrets: Record<string, string> = { [SEED_ADMIN_EMAIL]: await enrolMfa(d, signup.session.token) };
  const admin = await ctxFor(d, signup.session.token);

  await settingsH.updateFirm(d, admin, {
    legalName: "Lonestar Data Consulting LLC",
    displayName: "Lonestar Data Consulting",
    city: "Dallas",
    state: "TX",
    timezone: "America/Chicago",
    weekStart: "MON",
    defaultPaymentTermsDays: 30,
    matchTolerance: "1.00",
    deductionTolerance: "1.00",
  });
  await settingsH.setNumberingPattern(d, admin, { pattern: "{CLIENT}-{YYYY}{MM}-{SEQ:4}", seqReset: "YEARLY" });

  // --- Parties -----------------------------------------------------------------------------
  const globex = await partiesH.createParty(d, admin, {
    kind: "PRIME_VENDOR",
    legalName: "Globex Solutions",
    displayName: "Globex Solutions",
    code: "GLBX",
    paymentTermsDays: 45,
    paysWhenPaidUpstream: true,
    upstreamBufferDays: 15,
    standardDeduction: "2",
    deductionLabel: "MSP fee",
    invoiceLayout: "PER_CONSULTANT",
    backupRequired: true,
    apEmails: ["ap@globex.test"],
  });
  const initech = await partiesH.createParty(d, admin, { kind: "END_CLIENT", legalName: "Initech Corp", displayName: "Initech Corp" });
  const apex = await partiesH.createParty(d, admin, {
    kind: "SUB_VENDOR",
    legalName: "Apex Talent Inc",
    displayName: "Apex Talent Inc",
    vendorPayTerms: "PAY_WHEN_PAID",
    vendorNetDays: 0,
    arEmails: ["billing@apex.test"],
    w9TaxClassification: "C_CORP",
  });
  // Section 18.1: Apex's W-9 and COI are valid.
  for (const [docType, name] of [
    ["W9", "apex-w9.pdf"],
    ["COI", "apex-coi.pdf"],
  ] as const) {
    const fileId = await uploadPdf(d, admin, name, `Apex Talent Inc ${docType}`);
    await partiesH.attachPartyDocument(d, admin, {
      partyId: apex.id,
      fileId,
      docType,
      effectiveDate: "2026-01-01",
      expiryDate: "2027-12-31",
      requiredForPayment: true,
    });
  }
  // The factoring profile (advance 9000 bps, fee 300 bps) is added with factoring in M5.
  const summit = await partiesH.createParty(d, admin, { kind: "FACTOR", legalName: "Summit Factoring", displayName: "Summit Factoring" });

  // --- Consultants ---------------------------------------------------------------------------
  const ravi = await consultantsH.createConsultant(d, admin, {
    firstName: "Ravi",
    lastName: "Kumar",
    emails: ["ravi@lonestar.test"],
    employmentType: "CONTRACTOR",
    subVendorPartyId: apex.id,
  });
  const meera = await consultantsH.createConsultant(d, admin, {
    firstName: "Meera",
    lastName: "Shah",
    emails: ["meera@lonestar.test"],
    employmentType: "W2",
  });

  // --- Engagements ---------------------------------------------------------------------------
  const chain = {
    billToPartyId: globex.id,
    endClientPartyId: initech.id,
    primePartyId: globex.id,
    startDate: "2026-09-01",
    timesheetCycle: "MONTHLY",
    invoiceCycle: "MONTHLY",
    evidenceRequired: true,
  };
  const e1 = await engagementsH.createEngagement(d, admin, { consultantId: ravi.id, ...chain, roleTitle: "SAP Analyst" });
  await engagementsH.addRate(d, admin, { engagementId: e1.id, side: "BILL", rate: "95.00", effectiveFrom: "2026-09-01" });
  await engagementsH.addRate(d, admin, { engagementId: e1.id, side: "PAY", rate: "75.00", effectiveFrom: "2026-09-01" });
  await engagementsH.addPurchaseOrder(d, admin, { engagementId: e1.id, poNumber: "GLX-WO-7781", amount: "60000.00" });
  await engagementsH.setEngagementStatus(d, admin, { engagementId: e1.id, status: "ACTIVE" });

  const e2 = await engagementsH.createEngagement(d, admin, { consultantId: meera.id, ...chain, roleTitle: "Data Engineer" });
  await engagementsH.addRate(d, admin, { engagementId: e2.id, side: "BILL", rate: "110.00", effectiveFrom: "2026-09-01" });
  await engagementsH.setEngagementStatus(d, admin, { engagementId: e2.id, status: "ACTIVE" });

  // --- Users ------------------------------------------------------------------------------------
  const users = [
    { email: "manager@lonestar.test", role: "MANAGER", name: "Lonestar Manager" },
    { email: "finance@lonestar.test", role: "FINANCE", name: "Lonestar Finance" },
    { email: "ravi@lonestar.test", role: "CONSULTANT", name: "Ravi Kumar", consultantId: ravi.id },
    { email: "meera@lonestar.test", role: "CONSULTANT", name: "Meera Shah", consultantId: meera.id },
  ] as const;
  for (const u of users) {
    const inv = await membersH.inviteUser(d, admin, {
      email: u.email,
      role: u.role,
      name: u.name,
      ...("consultantId" in u ? { consultantId: u.consultantId } : {}),
    });
    const token = inv.link?.split("/invite/")[1];
    if (!token) throw new Error("seed needs outbound email disabled so invite links are returned");
    const acc = await membersH.acceptInvite(d, META, { token, name: u.name, password });
    if (u.role === "FINANCE") totpSecrets[u.email] = await enrolMfa(d, acc.session.token);
  }

  return {
    status: "seeded",
    password,
    totpSecrets,
    firmId: admin.firmId,
    ids: { globex: globex.id, initech: initech.id, apex: apex.id, summit: summit.id, ravi: ravi.id, meera: meera.id, e1: e1.id, e2: e2.id },
  };
}
