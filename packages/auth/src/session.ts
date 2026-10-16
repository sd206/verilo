import { roleRequiresMfa, type Role, type UserStatus } from "@verilo/domain";
import {
  type Db,
  type Tx,
  deleteSession,
  findSessionByTokenHash,
  getMembership,
  getUser,
  insertSession,
  listFirmsForUser,
  updateSession,
  withAnonymous,
  withTenant,
  withUser,
} from "@verilo/db";
import { MfaRequiredError, UnauthenticatedError } from "./errors";
import { randomToken, sha256Hex } from "./tokens";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** `__Host-` binds the cookie to the exact origin over HTTPS (no Domain, Path=/). */
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-verilo_session" : "verilo_session";
}

export function sessionCookieOptions(secure: boolean, expires: Date) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", expires };
}

export type AuthState = "OK" | "DISABLED" | "MFA_REQUIRED" | "MFA_SETUP_REQUIRED" | "NO_FIRM";

/**
 * Where a signed-in user stands. MFA is required for ADMIN and FINANCE in the firm they are
 * acting in (section 17); a user who enabled MFA voluntarily must also pass it.
 */
export function authState(input: {
  userStatus: UserStatus;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  role: Role | null;
}): AuthState {
  if (input.userStatus !== "ACTIVE") return "DISABLED";
  if (input.mfaEnabled && !input.mfaVerified) return "MFA_REQUIRED";
  if (input.role && roleRequiresMfa(input.role) && !input.mfaEnabled) return "MFA_SETUP_REQUIRED";
  if (!input.role) return "NO_FIRM";
  return "OK";
}

export interface AuthContext {
  sessionId: string;
  expiresAt: Date;
  user: { id: string; email: string; name: string; status: UserStatus; mfaEnabled: boolean };
  firmId: string | null;
  role: Role | null;
  mfaVerified: boolean;
  state: AuthState;
}

/** What every firm-scoped handler receives. Built only from the session (R3). */
export interface FirmContext {
  sessionId: string;
  userId: string;
  firmId: string;
  role: Role;
  ip: string | null;
  userAgent: string | null;
}

export async function createSession(
  db: Db,
  input: { userId: string; activeFirmId?: string | null; mfaVerified: boolean; ip: string | null; userAgent: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await withUser(db, input.userId, async (tx) => {
    let activeFirmId = input.activeFirmId ?? null;
    if (activeFirmId === null) {
      const firms = await listFirmsForUser(tx, input.userId);
      activeFirmId = firms[0]?.firmId ?? null;
    }
    await insertSession(tx, {
      userId: input.userId,
      tokenHash: sha256Hex(token),
      activeFirmId,
      mfaVerifiedAt: input.mfaVerified ? new Date() : null,
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string | undefined | null): Promise<AuthContext | null> {
  if (!token) return null;
  const s = await withAnonymous(db, (tx) => findSessionByTokenHash(tx, sha256Hex(token)));
  if (!s) return null;

  const fetch = async (tx: Tx) => {
    const user = await getUser(tx, s.userId);
    const membership = s.activeFirmId ? await getMembership(tx, s.activeFirmId, s.userId) : null;
    return { user, membership };
  };
  const { user, membership } = s.activeFirmId
    ? await withTenant(db, { firmId: s.activeFirmId, userId: s.userId }, fetch)
    : await withUser(db, s.userId, fetch);
  if (!user) return null;
  const role = membership?.role ?? null;
  const mfaEnabled = user.mfaEnabledAt !== null;
  const mfaVerified = s.mfaVerifiedAt !== null;
  return {
    sessionId: s.id,
    expiresAt: s.expiresAt,
    user: { id: user.id, email: user.email, name: user.name, status: user.status, mfaEnabled },
    firmId: membership ? s.activeFirmId : null,
    role,
    mfaVerified,
    state: authState({ userStatus: user.status, mfaEnabled, mfaVerified, role }),
  };
}

/** Turns an AuthContext into a FirmContext, or throws if the user may not act yet. */
export function requireFirmContext(
  auth: AuthContext | null,
  meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null },
): FirmContext {
  if (!auth) throw new UnauthenticatedError();
  switch (auth.state) {
    case "OK":
      return {
        sessionId: auth.sessionId,
        userId: auth.user.id,
        firmId: auth.firmId!,
        role: auth.role!,
        ip: meta.ip,
        userAgent: meta.userAgent,
      };
    case "MFA_REQUIRED":
    case "MFA_SETUP_REQUIRED":
      throw new MfaRequiredError();
    default:
      throw new UnauthenticatedError();
  }
}

export async function setActiveFirm(db: Db, auth: { sessionId: string; userId: string }, firmId: string) {
  await withUser(db, auth.userId, (tx) => updateSession(tx, auth.userId, auth.sessionId, { activeFirmId: firmId }));
}

export async function markSessionMfaVerified(db: Db, auth: { sessionId: string; userId: string }) {
  await withUser(db, auth.userId, (tx) =>
    updateSession(tx, auth.userId, auth.sessionId, { mfaVerifiedAt: new Date() }),
  );
}

export async function revokeSession(db: Db, auth: { sessionId: string; userId: string }) {
  await withUser(db, auth.userId, (tx) => deleteSession(tx, auth.userId, auth.sessionId));
}
