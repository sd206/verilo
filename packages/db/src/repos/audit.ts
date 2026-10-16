import { and, desc, eq } from "drizzle-orm";
import { auditEvent } from "../schema";
import type { Queryable } from "../client";

export interface AuditInput {
  firmId: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** R5: every create, update, status change and override writes one row. Append-only. */
export async function writeAudit(tx: Queryable, e: AuditInput): Promise<void> {
  await tx.insert(auditEvent).values({
    firmId: e.firmId,
    actorUserId: e.actorUserId,
    createdBy: e.actorUserId,
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    before: e.before ?? null,
    after: e.after ?? null,
    reason: e.reason ?? null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
  });
}

export async function listAuditForEntity(tx: Queryable, firmId: string, entityType: string, entityId: string) {
  return tx
    .select()
    .from(auditEvent)
    .where(
      and(eq(auditEvent.firmId, firmId), eq(auditEvent.entityType, entityType), eq(auditEvent.entityId, entityId)),
    )
    .orderBy(desc(auditEvent.createdAt));
}
