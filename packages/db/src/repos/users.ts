import { eq, sql } from "drizzle-orm";
import { userStatusMachine, type UserStatus } from "@verilo/domain";
import { appUser } from "../schema";
import type { Queryable } from "../client";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SigninUser {
  id: string;
  name: string;
  passwordHash: string | null;
  mfaSecret: string | null;
  mfaEnabledAt: Date | null;
  status: UserStatus;
}

/** Pre-session lookup through the SECURITY DEFINER function. */
export async function findUserForSignin(tx: Queryable, email: string): Promise<SigninUser | null> {
  const res = await tx.execute<{
    id: string;
    name: string;
    password_hash: string | null;
    mfa_secret: string | null;
    mfa_enabled_at: string | Date | null;
    status: UserStatus;
  }>(sql`select * from app_user_for_signin(${normalizeEmail(email)})`);
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    passwordHash: r.password_hash,
    mfaSecret: r.mfa_secret,
    mfaEnabledAt: r.mfa_enabled_at ? new Date(r.mfa_enabled_at) : null,
    status: r.status,
  };
}

/** Requires app.user_id = id (self policy) or a firm the user belongs to. */
export async function getUser(tx: Queryable, id: string) {
  const [row] = await tx.select().from(appUser).where(eq(appUser.id, id));
  return row ?? null;
}

/** Sign-up: the caller has set app.user_id = id beforehand. */
export async function insertUser(
  tx: Queryable,
  u: { id: string; email: string; name: string; passwordHash: string; status: UserStatus },
) {
  const [row] = await tx
    .insert(appUser)
    .values({ ...u, email: normalizeEmail(u.email), createdBy: u.id })
    .returning();
  return row!;
}

/** Inviting: returns the id of an existing user or creates an INVITED one. Needs a firm context. */
export async function findOrCreateInvitedUser(
  tx: Queryable,
  email: string,
  name: string,
  createdBy: string,
): Promise<string> {
  const res = await tx.execute<{ id: string }>(
    sql`select app_find_or_create_invited_user(${normalizeEmail(email)}, ${name}, ${createdBy}::uuid) as id`,
  );
  return res.rows[0]!.id;
}

/** Status changes go through the domain state machine (R6). */
export async function changeUserStatus(tx: Queryable, id: string, from: UserStatus, to: UserStatus) {
  const next = userStatusMachine.transition(from, to);
  const [row] = await tx
    .update(appUser)
    .set({ status: next })
    .where(sql`${appUser.id} = ${id} and ${appUser.status} = ${from}`)
    .returning();
  if (!row) throw new Error("user status changed concurrently");
  return row;
}

export async function updateUserProfile(
  tx: Queryable,
  id: string,
  patch: { name?: string; passwordHash?: string },
) {
  const [row] = await tx.update(appUser).set(patch).where(eq(appUser.id, id)).returning();
  return row ?? null;
}

export async function setPendingMfaSecret(tx: Queryable, id: string, encryptedSecret: string) {
  await tx.update(appUser).set({ mfaSecret: encryptedSecret, mfaEnabledAt: null }).where(eq(appUser.id, id));
}

export async function markMfaEnabled(tx: Queryable, id: string) {
  await tx.update(appUser).set({ mfaEnabledAt: new Date() }).where(eq(appUser.id, id));
}
