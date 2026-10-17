/**
 * Test fixtures for integration tests (real Postgres with the runtime role and RLS;
 * in-memory storage and a fake scanner unless a test opts into the real services).
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import pino from "pino";
import { createDb } from "@verilo/db";
import {
  generateTotp,
  LocalKeyWrapper,
  resolveSession,
  requireFirmContext,
  type AuthContext,
  type FirmContext,
} from "@verilo/auth";
import type { EmailSender, OutboundEmail } from "@verilo/email";
import type { ObjectInfo, ObjectStorage, ScanResult, SignedUpload, VirusScanner } from "@verilo/storage";
import type { Role } from "@verilo/domain";
import { MemoryQueue } from "@verilo/jobs";
import { ModelExtractor, ScriptedClient } from "@verilo/ai";
import type { Deps } from "./deps";
import * as authH from "./handlers/auth";
import * as membersH from "./handlers/members";

export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async createSignedUpload(i: { key: string; contentType: string; sizeBytes: number }): Promise<SignedUpload> {
    return { url: `memory://${i.key}`, method: "PUT", headers: { "Content-Type": i.contentType }, expiresAt: new Date(Date.now() + 600_000) };
  }
  async createSignedDownload(i: { key: string }): Promise<string> {
    return `https://storage.test/${i.key}?signed=1`;
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.body.length, contentType: o.contentType } : null;
  }
  async getStream(key: string): Promise<Readable> {
    const o = this.objects.get(key);
    if (!o) throw new Error("not found");
    return Readable.from([o.body]);
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }
}

export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** Flags the EICAR test string, like ClamAV does. */
export class FakeScanner implements VirusScanner {
  async scan(stream: Readable): Promise<ScanResult> {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
    const body = Buffer.concat(chunks);
    const infected = body.toString("latin1").includes(EICAR);
    return {
      status: infected ? "INFECTED" : "CLEAN",
      signature: infected ? "Eicar-Test-Signature" : null,
      sha256: createHash("sha256").update(body).digest("hex"),
      sizeBytes: body.length,
    };
  }
}

export class CapturingEmail implements EmailSender {
  readonly enabled: boolean;
  readonly sent: OutboundEmail[] = [];
  constructor(enabled = true) {
    this.enabled = enabled;
  }
  async send(m: OutboundEmail) {
    this.sent.push(m);
  }
}

let shared: ReturnType<typeof createDb> | null = null;

export function testDeps(over: Partial<Deps> = {}): Deps & { storage: ObjectStorage; email: EmailSender } {
  shared ??= createDb(process.env.TEST_DATABASE_URL!, { max: 5 });
  return {
    db: shared.db,
    storage: new MemoryStorage(),
    scanner: new FakeScanner(),
    email: new CapturingEmail(),
    keys: new LocalKeyWrapper(process.env.APP_ENCRYPTION_KEY!),
    log: pino({ level: "silent" }),
    jobs: new MemoryQueue(),
    extractor: new ModelExtractor(new ScriptedClient(), { providerRetryDelayMs: 0 }),
    config: {
      appEnv: "test",
      baseUrl: "http://localhost:3000",
      inboundDomain: "inbound.test",
      magicLinkEnabled: true,
      inboundWebhookSecret: "test-inbound-webhook-secret",
    },
    ...over,
  };
}

export async function closeTestDb() {
  await shared?.close();
  shared = null;
}

export const PASSWORD = "correct horse battery staple";

/** A unique IP per call so rate limits never interfere between tests. */
export function meta() {
  return { ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, userAgent: "vitest" };
}

export interface Actor {
  userId: string;
  email: string;
  token: string;
  auth: AuthContext;
  ctx: FirmContext;
  totpSecret: string | null;
}

async function actorFromToken(d: Deps, token: string, email: string, totpSecret: string | null): Promise<Actor> {
  const auth = (await resolveSession(d.db, token))!;
  return { userId: auth.user.id, email, token, auth, ctx: requireFirmContext(auth, meta()), totpSecret };
}

/** Signs a firm up and completes the Admin's MFA enrolment. */
export async function createFirmWithAdmin(d: Deps, label: string): Promise<{ firmId: string; admin: Actor }> {
  const email = `admin-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const r = await authH.signUpFirm(d, meta(), {
    firmLegalName: `${label} Consulting LLC`,
    firmDisplayName: `${label} Consulting`,
    name: `${label} Admin`,
    email,
    password: PASSWORD,
  });
  const auth = (await resolveSession(d.db, r.session.token))!;
  const { secret } = await authH.beginMfaSetup(d, auth);
  await authH.enableMfa(d, meta(), auth, { code: generateTotp(secret) });
  return { firmId: r.firmId, admin: await actorFromToken(d, r.session.token, email, secret) };
}

/** Invites a user with `role` and accepts; completes MFA when the role requires it. */
export async function addMember(d: Deps, admin: Actor, role: Role, label = role.toLowerCase()): Promise<Actor> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.com`;
  let consultantId: string | undefined;
  if (role === "CONSULTANT") {
    const { createConsultant } = await import("./handlers/consultants");
    consultantId = (
      await createConsultant(d, admin.ctx, { firstName: label, lastName: "Consultant", employmentType: "W2", emails: [email] })
    ).id;
  }
  const inv = await membersH.inviteUser(d, admin.ctx, { email, role, name: `${label} user`, ...(consultantId ? { consultantId } : {}) });
  const token = linkToken(d, inv);
  const acc = await membersH.acceptInvite(d, meta(), { token, name: `${label} user`, password: PASSWORD });
  let secret: string | null = null;
  if (role === "ADMIN" || role === "FINANCE") {
    const auth = (await resolveSession(d.db, acc.session.token))!;
    secret = (await authH.beginMfaSetup(d, auth)).secret;
    await authH.enableMfa(d, meta(), auth, { code: generateTotp(secret) });
  }
  return actorFromToken(d, acc.session.token, email, secret);
}

/** Pulls the invite token from the captured email (or the returned link when email is off). */
export function linkToken(d: Deps, inv: { link: string | null }): string {
  const link = inv.link ?? (d.email as CapturingEmail).sent.at(-1)!.text.match(/https?:\/\/\S+\/invite\/(\S+)/)![0];
  return link.split("/invite/")[1]!;
}

/** Uploads bytes through requestUpload → storage.put → completeUpload. */
export async function uploadFile(d: Deps, actor: Actor, body: Buffer | string, filename = "timesheet.pdf", contentType = "application/pdf") {
  const { requestUpload, completeUpload } = await import("./handlers/files");
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const req = await requestUpload(d, actor.ctx, { filename, contentType, sizeBytes: buf.length });
  const key = req.upload.url.replace("memory://", "");
  await d.storage.put(key, buf, contentType);
  return completeUpload(d, actor.ctx, { fileId: req.fileId });
}

/**
 * A firm's worth of master data shaped like seed 18.1: prime, end client, sub-vendor, a
 * contractor with an engagement, bill and pay rates, a PO, a contact, a document and a holiday.
 */
export async function createMasterData(d: Deps, admin: Actor, label = "X") {
  const parties = await import("./handlers/parties");
  const consultants = await import("./handlers/consultants");
  const engagements = await import("./handlers/engagements");
  const settings = await import("./handlers/settings");
  const code = (label.replace(/[^A-Z0-9]/gi, "").toUpperCase() + "GLBX").slice(0, 6);
  const prime = await parties.createParty(d, admin.ctx, {
    kind: "PRIME_VENDOR",
    legalName: `${label} Globex Solutions`,
    displayName: `${label} Globex`,
    code,
    paymentTermsDays: 45,
    paysWhenPaidUpstream: true,
    standardDeduction: "2",
    deductionLabel: "MSP fee",
    backupRequired: true,
  });
  const endClient = await parties.createParty(d, admin.ctx, { kind: "END_CLIENT", legalName: `${label} Initech Corp`, displayName: `${label} Initech` });
  const sub = await parties.createParty(d, admin.ctx, {
    kind: "SUB_VENDOR",
    legalName: `${label} Apex Talent Inc`,
    displayName: `${label} Apex`,
    vendorPayTerms: "PAY_WHEN_PAID",
    vendorNetDays: 0,
    remitDetails: "Bank 123 / acct 456789",
    tin: "12-3456789",
    tinType: "EIN",
  });
  const contact = await parties.addContact(d, admin.ctx, { partyId: prime.id, name: "Pat Prime", email: "ap@globex.example.com" });
  const file = await uploadFile(d, admin, "%PDF-1.4 W-9", "w9.pdf");
  const doc = await parties.attachPartyDocument(d, admin.ctx, {
    partyId: sub.id,
    fileId: file.id,
    docType: "W9",
    effectiveDate: "2026-01-01",
    expiryDate: "2027-12-31",
  });
  const consultant = await consultants.createConsultant(d, admin.ctx, {
    firstName: "Ravi",
    lastName: `Kumar ${label}`,
    emails: [`ravi-${label.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`],
    employmentType: "CONTRACTOR",
    subVendorPartyId: sub.id,
  });
  const engagement = await engagements.createEngagement(d, admin.ctx, {
    consultantId: consultant.id,
    billToPartyId: prime.id,
    endClientPartyId: endClient.id,
    primePartyId: prime.id,
    roleTitle: "SAP Analyst",
    startDate: "2026-09-01",
    timesheetCycle: "MONTHLY",
    invoiceCycle: "MONTHLY",
    evidenceRequired: true,
  });
  const bill = await engagements.addRate(d, admin.ctx, { engagementId: engagement.id, side: "BILL", rate: "95.00", effectiveFrom: "2026-09-01" });
  const pay = await engagements.addRate(d, admin.ctx, { engagementId: engagement.id, side: "PAY", rate: "75.00", effectiveFrom: "2026-09-01" });
  const po = await engagements.addPurchaseOrder(d, admin.ctx, { engagementId: engagement.id, poNumber: "GLX-WO-7781", amount: "60000.00" });
  await engagements.setEngagementStatus(d, admin.ctx, { engagementId: engagement.id, status: "ACTIVE" });
  await settings.setHolidays(d, admin.ctx, { holidays: [{ date: "2026-11-26", name: "Thanksgiving" }] });
  return {
    primeId: prime.id,
    endClientId: endClient.id,
    subVendorId: sub.id,
    contactId: contact.id,
    fileId: file.id,
    documentId: doc.id,
    consultantId: consultant.id,
    engagementId: engagement.id,
    billRateId: bill.id,
    payRateId: pay.id,
    poId: po.id,
    code,
  };
}

/** Signs up a CONSULTANT user linked to an existing consultant record. */
export async function addConsultantUser(d: Deps, admin: Actor, consultantId: string, email: string): Promise<Actor> {
  const inv = await membersH.inviteUser(d, admin.ctx, { email, role: "CONSULTANT", name: `${email} user`, consultantId });
  const acc = await membersH.acceptInvite(d, meta(), { token: linkToken(d, inv), name: email.split("@")[0]!, password: PASSWORD });
  return actorFromToken(d, acc.session.token, email, null);
}

/** A screenshot-sized PNG (noise, so it's well over the 20 KB logo filter); `seed` changes the bytes. */
export async function screenshotPng(seed = 1, width = 640, height = 480): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  let x = seed * 2654435761;
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < px.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    px[i] = (x >> 16) & 0xff;
  }
  return sharp(px, { raw: { width, height, channels: 3 } }).png().toBuffer();
}
