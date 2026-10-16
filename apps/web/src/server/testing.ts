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
    config: { appEnv: "test", baseUrl: "http://localhost:3000", inboundDomain: "inbound.test", magicLinkEnabled: true },
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
  const inv = await membersH.inviteUser(d, admin.ctx, { email, role, name: `${label} user` });
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
