import { and, asc, eq } from "drizzle-orm";
import { firm, membership } from "../schema";
import type { Queryable } from "../client";

export type FirmRow = typeof firm.$inferSelect;
export type NewFirm = typeof firm.$inferInsert;

/** The caller has set app.firm_id = f.id (firm_insert policy). */
export async function insertFirm(tx: Queryable, f: NewFirm & { id: string }): Promise<FirmRow> {
  const [row] = await tx.insert(firm).values(f).returning();
  return row!;
}

export async function getFirm(tx: Queryable, firmId: string): Promise<FirmRow | null> {
  const [row] = await tx.select().from(firm).where(eq(firm.id, firmId));
  return row ?? null;
}

/** Firms the user belongs to, for the firm switcher. */
export async function listFirmsForUser(tx: Queryable, userId: string) {
  return tx
    .select({ firmId: firm.id, displayName: firm.displayName, role: membership.role })
    .from(membership)
    .innerJoin(firm, eq(firm.id, membership.firmId))
    .where(and(eq(membership.userId, userId)))
    .orderBy(asc(firm.displayName));
}
