import { and, eq, isNull, sql } from "drizzle-orm";
import { mfaRecoveryCode, rateLimit, session, verificationToken } from "../schema";
import type { Queryable } from "../client";

export interface SessionLookup {
  id: string;
  userId: string;
  activeFirmId: string | null;
  mfaVerifiedAt: Date | null;
  expiresAt: Date;
}

/** The caller has set app.user_id = s.userId. */
export async function insertSession(
  tx: Queryable,
  s: {
    userId: string;
    tokenHash: string;
    activeFirmId: string | null;
    mfaVerifiedAt: Date | null;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  },
) {
  const [row] = await tx
    .insert(session)
    .values({ ...s, createdBy: s.userId })
    .returning();
  return row!;
}

/** Pre-session lookup through the SECURITY DEFINER function; returns only unexpired sessions. */
export async function findSessionByTokenHash(tx: Queryable, tokenHash: string): Promise<SessionLookup | null> {
  const res = await tx.execute<{
    id: string;
    user_id: string;
    active_firm_id: string | null;
    mfa_verified_at: string | Date | null;
    expires_at: string | Date;
  }>(sql`select * from app_session_by_token(${tokenHash})`);
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    activeFirmId: r.active_firm_id,
    mfaVerifiedAt: r.mfa_verified_at ? new Date(r.mfa_verified_at) : null,
    expiresAt: new Date(r.expires_at),
  };
}

export async function updateSession(
  tx: Queryable,
  userId: string,
  id: string,
  patch: { activeFirmId?: string | null; mfaVerifiedAt?: Date | null; expiresAt?: Date },
) {
  await tx
    .update(session)
    .set(patch)
    .where(and(eq(session.id, id), eq(session.userId, userId)));
}

export async function deleteSession(tx: Queryable, userId: string, id: string) {
  await tx.delete(session).where(and(eq(session.id, id), eq(session.userId, userId)));
}

// --- MFA recovery codes -----------------------------------------------------

export async function replaceRecoveryCodes(tx: Queryable, userId: string, codeHashes: string[]) {
  await tx
    .update(mfaRecoveryCode)
    .set({ usedAt: new Date() })
    .where(and(eq(mfaRecoveryCode.userId, userId), isNull(mfaRecoveryCode.usedAt)));
  if (codeHashes.length) {
    await tx
      .insert(mfaRecoveryCode)
      .values(codeHashes.map((codeHash) => ({ userId, codeHash, createdBy: userId })));
  }
}

/** Marks a recovery code used; returns false if it does not exist or was already used. */
export async function consumeRecoveryCode(tx: Queryable, userId: string, codeHash: string): Promise<boolean> {
  const rows = await tx
    .update(mfaRecoveryCode)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(mfaRecoveryCode.userId, userId),
        eq(mfaRecoveryCode.codeHash, codeHash),
        isNull(mfaRecoveryCode.usedAt),
      ),
    )
    .returning({ id: mfaRecoveryCode.id });
  return rows.length > 0;
}

// --- magic-link verification tokens -----------------------------------------

export async function insertVerificationToken(
  tx: Queryable,
  t: { identifier: string; tokenHash: string; expiresAt: Date },
) {
  await tx.insert(verificationToken).values(t);
}

/** Deletes and returns the token (single use). */
export async function useVerificationToken(tx: Queryable, identifier: string, tokenHash: string) {
  const [row] = await tx
    .delete(verificationToken)
    .where(and(eq(verificationToken.identifier, identifier), eq(verificationToken.tokenHash, tokenHash)))
    .returning();
  return row ?? null;
}

// --- rate limiting ------------------------------------------------------------

/** Fixed-window counter. Returns the count for the current window after incrementing. */
export async function hitRateLimit(tx: Queryable, key: string, windowSeconds: number): Promise<number> {
  const res = await tx.execute<{ count: number }>(sql`
    insert into ${rateLimit} (key, window_start, count, updated_at)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1, now())
    on conflict (key, window_start) do update set count = ${rateLimit.count} + 1, updated_at = now()
    returning count`);
  return Number(res.rows[0]!.count);
}
