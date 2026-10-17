/** Consultants (5.3; 13.2 item 5; section 16 "Consultants"). */
import { z } from "zod";
import { can, ConflictError, NotFoundError, requirePermission, ValidationError, type FirmContext } from "@verilo/auth";
import {
  getConsultant,
  getParty,
  insertConsultant,
  listConsultants as listConsultantsRepo,
  listEngagements,
  updateConsultant as updateConsultantRepo,
  withTenant,
  writeAudit,
  type ConsultantRow,
  type Queryable,
} from "@verilo/db";
import { consultantStatusMachine, validateConsultant } from "@verilo/domain";
import type { Deps } from "../deps";
import { parse, uuid } from "./common";
import { emailList, optionalIsoDate, optionalText, text } from "./fields";

async function audit(tx: Queryable, ctx: FirmContext, id: string, action: string, before: unknown, after: unknown) {
  await writeAudit(tx, {
    firmId: ctx.firmId,
    actorUserId: ctx.userId,
    entityType: "consultant",
    entityId: id,
    action,
    before,
    after,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

function emailConflict(e: unknown): never {
  const msg = String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? "");
  const m = /consultant email (\S+) is already used/.exec(msg);
  if (m) throw new ConflictError(`${m[1]} is already used by another consultant`);
  throw e;
}

export async function listConsultants(d: Deps, ctx: FirmContext, input: unknown = {}) {
  requirePermission(ctx, "VIEW_MASTER_DATA");
  const { includeArchived } = parse(z.strictObject({ includeArchived: z.boolean().optional() }), input);
  const rows = await withTenant(d.db, ctx, (tx) => listConsultantsRepo(tx, ctx.firmId, { includeArchived }));
  return rows.map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`,
    firstName: c.firstName,
    lastName: c.lastName,
    emails: c.emails,
    employmentType: c.employmentType,
    subVendorName: c.subVendorName,
    status: c.status,
    workAuthExpiry: c.workAuthExpiry,
    activeEngagements: c.activeEngagements,
    archived: c.archivedAt !== null,
  }));
}

export async function getConsultantDetail(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "VIEW_MASTER_DATA");
  const { consultantId } = parse(z.strictObject({ consultantId: uuid }), input);
  return withTenant(d.db, ctx, async (tx) => {
    const c = await getConsultant(tx, ctx.firmId, consultantId);
    if (!c) throw new NotFoundError();
    const sub = c.subVendorPartyId ? await getParty(tx, ctx.firmId, c.subVendorPartyId) : null;
    return {
      consultant: c,
      subVendor: sub ? { id: sub.id, name: sub.displayName } : null,
      engagements: await listEngagements(tx, ctx.firmId, { consultantId }),
      canEdit: can(ctx.role, "EDIT_MASTER_DATA"),
    };
  });
}

const fields = {
  firstName: text(100).min(1),
  lastName: text(100).min(1),
  emails: emailList,
  phone: optionalText(50),
  employmentType: z.enum(["W2", "CONTRACTOR"]),
  subVendorPartyId: uuid.nullable().optional().transform((v) => v ?? null),
  workAuthType: optionalText(50),
  workAuthExpiry: optionalIsoDate,
};
const createSchema = z.strictObject(fields);
const updateSchema = z.strictObject({ consultantId: uuid, ...fields });

async function checkConsultant(tx: Queryable, ctx: FirmContext, data: z.infer<typeof createSchema>) {
  const sub = data.subVendorPartyId ? await getParty(tx, ctx.firmId, data.subVendorPartyId) : null;
  if (data.subVendorPartyId && !sub) throw new NotFoundError("Sub-vendor not found");
  const r = validateConsultant({ employmentType: data.employmentType, subVendor: sub, emails: data.emails });
  if (!r.ok) throw new ValidationError(r.message);
}

export async function createConsultant(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_MASTER_DATA");
  const data = parse(createSchema, input);
  return withTenant(d.db, ctx, async (tx) => {
    await checkConsultant(tx, ctx, data);
    const c = await insertConsultant(tx, ctx.firmId, ctx.userId, { ...data, status: consultantStatusMachine.initial }).catch(
      emailConflict,
    );
    await audit(tx, ctx, c.id, "create", null, c);
    return { id: c.id };
  });
}

export async function updateConsultant(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_MASTER_DATA");
  const { consultantId, ...data } = parse(updateSchema, input);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getConsultant(tx, ctx.firmId, consultantId);
    if (!before) throw new NotFoundError();
    await checkConsultant(tx, ctx, data);
    if (before.employmentType !== data.employmentType) {
      const hasEngagements = (await listEngagements(tx, ctx.firmId, { consultantId })).length > 0;
      if (hasEngagements) throw new ConflictError("Employment type can't change once the consultant has engagements");
    }
    const after = await updateConsultantRepo(tx, ctx.firmId, consultantId, data).catch(emailConflict);
    await audit(tx, ctx, consultantId, "update", before, after);
    return { id: consultantId };
  });
}

/** Status changes go through the domain state machine (R6). */
export async function setConsultantStatus(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_MASTER_DATA");
  const { consultantId, status } = parse(z.strictObject({ consultantId: uuid, status: z.enum(["ACTIVE", "INACTIVE"]) }), input);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getConsultant(tx, ctx.firmId, consultantId);
    if (!before) throw new NotFoundError();
    const next = consultantStatusMachine.transition(before.status, status);
    const after = await updateConsultantRepo(tx, ctx.firmId, consultantId, { status: next });
    await audit(tx, ctx, consultantId, "status_change", { status: before.status }, { status: after.status });
    return { id: consultantId, status: next };
  });
}

/** archiveConsultant (soft delete). Only when no engagement is DRAFT or ACTIVE. */
export async function archiveConsultant(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_MASTER_DATA");
  const { consultantId } = parse(z.strictObject({ consultantId: uuid }), input);
  return withTenant(d.db, ctx, async (tx) => {
    const before: ConsultantRow | null = await getConsultant(tx, ctx.firmId, consultantId);
    if (!before) throw new NotFoundError();
    const open = (await listEngagements(tx, ctx.firmId, { consultantId })).some((e) => e.status !== "ENDED");
    if (open) throw new ConflictError("End this consultant's engagements first");
    const after = await updateConsultantRepo(tx, ctx.firmId, consultantId, { archivedAt: new Date() });
    await audit(tx, ctx, consultantId, "archive", before, after);
    return { id: consultantId };
  });
}
