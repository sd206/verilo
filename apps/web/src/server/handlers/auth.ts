import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { roleRequiresMfa } from "@verilo/domain";
import {
  authState,
  ConflictError,
  createSession,
  decryptSecret,
  dummyPasswordHash,
  enforceRateLimit,
  encryptSecret,
  generateRecoveryCodes,
  hashPassword,
  hashRecoveryCode,
  markSessionMfaVerified,
  newFirmDataKey,
  newTotpSecret,
  NotFoundError,
  passwordPolicyError,
  resolveSession,
  setActiveFirm,
  totpQrDataUrl,
  totpUri,
  UnauthenticatedError,
  ValidationError,
  verifyPassword,
  verifyTotp,
  type AuthContext,
} from "@verilo/auth";
import {
  consumeRecoveryCode,
  findUserForSignin,
  getUser,
  insertFirm,
  insertMembership,
  insertUser,
  listFirmsForUser,
  markMfaEnabled,
  replaceRecoveryCodes,
  setContext,
  setPendingMfaSecret,
  withAnonymous,
  withTenant,
  withUser,
  writeAudit,
} from "@verilo/db";
import type { Deps } from "../deps";
import { email, nextPathFor, parse, uuid, type NewSession, type RequestMeta } from "./common";

// ---------------------------------------------------------------------------
// signUpFirm — creates the firm, its first ADMIN user and membership (section 16: Auth)
// ---------------------------------------------------------------------------

const signUpSchema = z.strictObject({
  firmLegalName: z.string().trim().min(2).max(200),
  firmDisplayName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(1).max(200),
  email,
  password: z.string(),
});

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  const suffix = randomBytes(3).toString("hex");
  return `${base || "firm"}-${suffix}`;
}

export async function signUpFirm(
  d: Deps,
  meta: RequestMeta,
  input: unknown,
): Promise<{ firmId: string; userId: string; session: NewSession; next: string }> {
  const data = parse(signUpSchema, input);
  await enforceRateLimit(d.db, "signUp", meta.ip ?? "unknown");
  const pwError = passwordPolicyError(data.password);
  if (pwError) throw new ValidationError(pwError);

  const existing = await withAnonymous(d.db, (tx) => findUserForSignin(tx, data.email));
  if (existing) throw new ConflictError("An account with this email already exists. Sign in instead.");

  const passwordHash = await hashPassword(data.password);
  const { wrapped } = await newFirmDataKey(d.keys);
  const firmId = randomUUID();
  const userId = randomUUID();
  const slug = slugify(data.firmDisplayName);

  await withAnonymous(d.db, async (tx) => {
    await setContext(tx, { firmId, userId });
    const user = await insertUser(tx, {
      id: userId,
      email: data.email,
      name: data.name,
      passwordHash,
      status: "ACTIVE",
    });
    const f = await insertFirm(tx, {
      id: firmId,
      createdBy: userId,
      legalName: data.firmLegalName,
      displayName: data.firmDisplayName,
      timesheetInboxAddress: `ts-${slug}@${d.config.inboundDomain}`,
      apInboxAddress: `ap-${slug}@${d.config.inboundDomain}`,
      wrappedDataKey: wrapped,
    });
    const m = await insertMembership(tx, { firmId, userId, role: "ADMIN", createdBy: userId });
    const audit = { firmId, actorUserId: userId, ip: meta.ip, userAgent: meta.userAgent };
    const { wrappedDataKey: _k, ...firmAfter } = f;
    await writeAudit(tx, { ...audit, entityType: "firm", entityId: firmId, action: "create", after: firmAfter });
    await writeAudit(tx, {
      ...audit,
      entityType: "user",
      entityId: userId,
      action: "create",
      after: { id: user.id, email: user.email, name: user.name, status: user.status },
    });
    await writeAudit(tx, { ...audit, entityType: "membership", entityId: m.id, action: "create", after: m });
  });

  const session = await createSession(d.db, {
    userId,
    activeFirmId: firmId,
    mfaVerified: false,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  // A new ADMIN must enrol in MFA before doing anything else (section 17).
  return { firmId, userId, session, next: "/mfa/setup" };
}

// ---------------------------------------------------------------------------
// signIn (password)
// ---------------------------------------------------------------------------

const signInSchema = z.strictObject({ email, password: z.string().min(1).max(256) });

export async function signInWithPassword(
  d: Deps,
  meta: RequestMeta,
  input: unknown,
): Promise<{ session: NewSession; next: string }> {
  const data = parse(signInSchema, input);
  await enforceRateLimit(d.db, "signIn", `ip:${meta.ip ?? "unknown"}`);
  await enforceRateLimit(d.db, "signIn", `email:${data.email}`);

  const user = await withAnonymous(d.db, (tx) => findUserForSignin(tx, data.email));
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), data.password);
  if (!user || !user.passwordHash || !ok || user.status !== "ACTIVE") {
    throw new UnauthenticatedError("Email or password is incorrect");
  }
  const session = await createSession(d.db, {
    userId: user.id,
    mfaVerified: false,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  const auth = await resolveSession(d.db, session.token);
  return { session, next: nextPathFor(auth!.state) };
}

// ---------------------------------------------------------------------------
// MFA (enableMfa in section 16)
// ---------------------------------------------------------------------------

function requireSignedIn(auth: AuthContext | null): AuthContext {
  if (!auth || auth.state === "DISABLED") throw new UnauthenticatedError();
  return auth;
}

/** Returns the pending TOTP secret for enrolment, creating one if needed. */
export async function beginMfaSetup(
  d: Deps,
  auth: AuthContext | null,
): Promise<{ secret: string; uri: string; qrDataUrl: string }> {
  const a = requireSignedIn(auth);
  if (a.user.mfaEnabled) throw new ConflictError("MFA is already enabled");
  const secret = await withUser(d.db, a.user.id, async (tx) => {
    const u = await getUser(tx, a.user.id);
    if (u?.mfaSecret) return decryptSecret(d.keys, u.mfaSecret);
    const fresh = newTotpSecret();
    await setPendingMfaSecret(tx, a.user.id, await encryptSecret(d.keys, fresh));
    return fresh;
  });
  const uri = totpUri(a.user.email, secret);
  return { secret, uri, qrDataUrl: await totpQrDataUrl(uri) };
}

const codeSchema = z.strictObject({ code: z.string().trim().min(6).max(12) });

export async function enableMfa(
  d: Deps,
  meta: RequestMeta,
  auth: AuthContext | null,
  input: unknown,
): Promise<{ recoveryCodes: string[]; next: string }> {
  const a = requireSignedIn(auth);
  const { code } = parse(codeSchema, input);
  await enforceRateLimit(d.db, "mfa", a.user.id);
  if (a.user.mfaEnabled) throw new ConflictError("MFA is already enabled");

  const recoveryCodes = generateRecoveryCodes();
  await withUser(d.db, a.user.id, async (tx) => {
    const u = await getUser(tx, a.user.id);
    if (!u?.mfaSecret) throw new ValidationError("Start MFA setup first");
    const secret = await decryptSecret(d.keys, u.mfaSecret);
    if (!verifyTotp(secret, code)) throw new ValidationError("That code didn't match. Try the current code.");
    await markMfaEnabled(tx, a.user.id);
    await replaceRecoveryCodes(tx, a.user.id, recoveryCodes.map(hashRecoveryCode));
  });
  await markSessionMfaVerified(d.db, { sessionId: a.sessionId, userId: a.user.id });
  if (a.firmId) {
    await withTenant(d.db, { firmId: a.firmId, userId: a.user.id }, (tx) =>
      writeAudit(tx, {
        firmId: a.firmId!,
        actorUserId: a.user.id,
        entityType: "user",
        entityId: a.user.id,
        action: "mfa_enabled",
        before: { mfaEnabled: false },
        after: { mfaEnabled: true },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
  return { recoveryCodes, next: a.firmId ? "/app" : "/no-firm" };
}

const verifySchema = z.union([
  z.strictObject({ code: z.string().trim().min(6).max(8) }),
  z.strictObject({ recoveryCode: z.string().trim().min(8).max(20) }),
]);

export async function verifyMfa(
  d: Deps,
  auth: AuthContext | null,
  input: unknown,
): Promise<{ next: string }> {
  const a = requireSignedIn(auth);
  const data = parse(verifySchema, input);
  await enforceRateLimit(d.db, "mfa", a.user.id);
  const ok = await withUser(d.db, a.user.id, async (tx) => {
    const u = await getUser(tx, a.user.id);
    if (!u?.mfaSecret || !u.mfaEnabledAt) return false;
    if ("code" in data) return verifyTotp(await decryptSecret(d.keys, u.mfaSecret), data.code);
    return consumeRecoveryCode(tx, a.user.id, hashRecoveryCode(data.recoveryCode));
  });
  if (!ok) throw new ValidationError("That code didn't work");
  await markSessionMfaVerified(d.db, { sessionId: a.sessionId, userId: a.user.id });
  const state = authState({ userStatus: a.user.status, mfaEnabled: a.user.mfaEnabled, mfaVerified: true, role: a.role });
  return { next: nextPathFor(state) };
}

// ---------------------------------------------------------------------------
// switchFirm / listMyFirms
// ---------------------------------------------------------------------------

const switchSchema = z.strictObject({ firmId: uuid });

export async function switchFirm(d: Deps, auth: AuthContext | null, input: unknown): Promise<{ next: string }> {
  const a = requireSignedIn(auth);
  if (a.state === "MFA_REQUIRED") throw new UnauthenticatedError("Finish signing in first");
  const { firmId } = parse(switchSchema, input);
  const firms = await withUser(d.db, a.user.id, (tx) => listFirmsForUser(tx, a.user.id));
  const target = firms.find((f) => f.firmId === firmId);
  // Not a member: same answer as a firm that doesn't exist (T12).
  if (!target) throw new NotFoundError();
  await setActiveFirm(d.db, { sessionId: a.sessionId, userId: a.user.id }, firmId);
  const needsMfa = roleRequiresMfa(target.role) && !a.user.mfaEnabled;
  return { next: needsMfa ? "/mfa/setup" : "/app" };
}

export async function listMyFirms(d: Deps, auth: AuthContext | null) {
  const a = requireSignedIn(auth);
  return withUser(d.db, a.user.id, (tx) => listFirmsForUser(tx, a.user.id));
}
