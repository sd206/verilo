import { and, asc, eq, isNull } from "drizzle-orm";
import type { Role } from "@verilo/domain";
import { appUser, membership } from "../schema";
import type { Queryable } from "../client";

export type MembershipRow = typeof membership.$inferSelect;

export async function insertMembership(
  tx: Queryable,
  m: { firmId: string; userId: string; role: Role; consultantId?: string | null; createdBy: string },
): Promise<MembershipRow> {
  const [row] = await tx.insert(membership).values(m).returning();
  return row!;
}

export async function getMembership(tx: Queryable, firmId: string, userId: string): Promise<MembershipRow | null> {
  const [row] = await tx
    .select()
    .from(membership)
    .where(and(eq(membership.firmId, firmId), eq(membership.userId, userId)));
  return row ?? null;
}

export async function listMembers(tx: Queryable, firmId: string) {
  return tx
    .select({
      membershipId: membership.id,
      userId: appUser.id,
      email: appUser.email,
      name: appUser.name,
      status: appUser.status,
      role: membership.role,
      consultantId: membership.consultantId,
      disabledAt: membership.disabledAt,
      mfaRequired: membership.mfaRequired,
      mfaEnabled: appUser.mfaEnabledAt,
    })
    .from(membership)
    .innerJoin(appUser, eq(appUser.id, membership.userId))
    .where(eq(membership.firmId, firmId))
    .orderBy(asc(appUser.name));
}

export async function getMembershipById(tx: Queryable, firmId: string, id: string): Promise<MembershipRow | null> {
  const [row] = await tx
    .select()
    .from(membership)
    .where(and(eq(membership.firmId, firmId), eq(membership.id, id)));
  return row ?? null;
}

export async function updateMembership(
  tx: Queryable,
  firmId: string,
  id: string,
  patch: { role?: Role; consultantId?: string | null; disabledAt?: Date | null; mfaRequired?: boolean },
): Promise<MembershipRow> {
  const [row] = await tx
    .update(membership)
    .set(patch)
    .where(and(eq(membership.firmId, firmId), eq(membership.id, id)))
    .returning();
  return row!;
}

/** Active (not disabled) ADMIN memberships — a firm must always keep at least one. */
export async function countActiveAdmins(tx: Queryable, firmId: string): Promise<number> {
  const rows = await tx
    .select({ id: membership.id })
    .from(membership)
    .where(and(eq(membership.firmId, firmId), eq(membership.role, "ADMIN"), isNull(membership.disabledAt)));
  return rows.length;
}
