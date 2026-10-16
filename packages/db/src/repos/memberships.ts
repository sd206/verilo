import { and, asc, eq } from "drizzle-orm";
import type { Role } from "@verilo/domain";
import { appUser, membership } from "../schema";
import type { Queryable } from "../client";

export type MembershipRow = typeof membership.$inferSelect;

export async function insertMembership(
  tx: Queryable,
  m: { firmId: string; userId: string; role: Role; createdBy: string },
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
      mfaEnabled: appUser.mfaEnabledAt,
    })
    .from(membership)
    .innerJoin(appUser, eq(appUser.id, membership.userId))
    .where(eq(membership.firmId, firmId))
    .orderBy(asc(appUser.name));
}
