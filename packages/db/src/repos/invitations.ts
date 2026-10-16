import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Role } from "@verilo/domain";
import { invitation } from "../schema";
import type { Queryable } from "../client";

export type InvitationRow = typeof invitation.$inferSelect;

export async function insertInvitation(
  tx: Queryable,
  i: { firmId: string; email: string; role: Role; tokenHash: string; expiresAt: Date; createdBy: string },
): Promise<InvitationRow> {
  const [row] = await tx.insert(invitation).values(i).returning();
  return row!;
}

export interface InvitationLookup {
  id: string;
  firmId: string;
  email: string;
  role: Role;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/** Pre-session lookup through the SECURITY DEFINER function. */
export async function findInvitationByTokenHash(tx: Queryable, tokenHash: string): Promise<InvitationLookup | null> {
  const res = await tx.execute<{
    id: string;
    firm_id: string;
    email: string;
    role: Role;
    expires_at: string | Date;
    accepted_at: string | Date | null;
    revoked_at: string | Date | null;
  }>(sql`select * from app_invitation_by_token(${tokenHash})`);
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    firmId: r.firm_id,
    email: r.email,
    role: r.role,
    expiresAt: new Date(r.expires_at),
    acceptedAt: r.accepted_at ? new Date(r.accepted_at) : null,
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
  };
}

export async function markInvitationAccepted(tx: Queryable, firmId: string, id: string, userId: string) {
  const [row] = await tx
    .update(invitation)
    .set({ acceptedAt: new Date(), acceptedByUserId: userId })
    .where(and(eq(invitation.firmId, firmId), eq(invitation.id, id), isNull(invitation.acceptedAt)))
    .returning();
  return row ?? null;
}

export async function listPendingInvitations(tx: Queryable, firmId: string) {
  return tx
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .where(and(eq(invitation.firmId, firmId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
    .orderBy(desc(invitation.createdAt));
}
