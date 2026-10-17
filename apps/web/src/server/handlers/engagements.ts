/** Engagements, rates and POs (5.3; 13.2 item 6; section 16 "Engagements"). */
import { z } from "zod";
import { can, ConflictError, NotFoundError, requirePermission, ValidationError, type FirmContext } from "@verilo/auth";
import {
  getConsultant,
  getEngagement,
  getFirm,
  getPartiesByIds,
  getRate,
  insertEngagement,
  insertPurchaseOrder,
  insertRate,
  listConsultants,
  listParties,
  listPurchaseOrders,
  listRates,
  listTimesheets,
  lockEngagement,
  setRateEnd,
  updateEngagement as updateEngagementRepo,
  withTenant,
  writeAudit,
  type EngagementRow,
  type Queryable,
  type RateRow,
} from "@verilo/db";
import {
  billingChain,
  effectiveDeductionBps,
  engagementStatusMachine,
  formatBps,
  formatCents,
  marginPreview,
  parsePercentToBps,
  periodLabel,
  resolveRate,
  validateEngagement,
  validateNewRate,
  validateRateEnd,
  CYCLES,
  RATE_KINDS,
  type Rate,
} from "@verilo/domain";
import type { Deps } from "../deps";
import { ensureTimesheets } from "../timesheets/service";
import { parse, uuid } from "./common";
import { bool, dollars, isoDate, optionalDollars, optionalIsoDate, optionalPercent, optionalText, text, todayIn } from "./fields";

async function audit(tx: Queryable, ctx: FirmContext, entityType: string, id: string, action: string, before: unknown, after: unknown) {
  await writeAudit(tx, {
    firmId: ctx.firmId,
    actorUserId: ctx.userId,
    entityType,
    entityId: id,
    action,
    before,
    after,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

const toDomainRate = (r: RateRow): Rate => ({
  id: r.id,
  side: r.side,
  rateKind: r.rateKind,
  rateCents: r.rateCents,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
});

// --- detail (13.2 item 6) ------------------------------------------------------------------------

export async function getEngagementDetail(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "VIEW_MASTER_DATA");
  const { engagementId } = parse(z.strictObject({ engagementId: uuid }), input);
  return withTenant(d.db, ctx, async (tx) => {
    const e = await getEngagement(tx, ctx.firmId, engagementId);
    if (!e) throw new NotFoundError();
    const firm = (await getFirm(tx, ctx.firmId))!;
    const c = (await getConsultant(tx, ctx.firmId, e.consultantId))!;
    const ids = [e.billToPartyId, e.endClientPartyId, e.primePartyId, e.implementationPartnerPartyId, c.subVendorPartyId].filter(
      (x): x is string => Boolean(x),
    );
    const parties = new Map((await getPartiesByIds(tx, ctx.firmId, ids)).map((p) => [p.id, p]));
    const nameOf = (id: string | null) => (id ? { id, name: parties.get(id)?.displayName ?? "" } : null);
    const showRates = can(ctx.role, "VIEW_RATES");
    const rates = showRates ? await listRates(tx, ctx.firmId, engagementId) : [];
    const today = todayIn(firm.timezone);
    // Margin preview at today's rates, or at the start date for engagements that haven't started.
    const asOf = today < e.startDate ? e.startDate : today;
    const domainRates = rates.map(toDomainRate);
    const bill = resolveRate(domainRates, "BILL", "REGULAR", asOf);
    const pay = resolveRate(domainRates, "PAY", "REGULAR", asOf);
    const margin = bill.ok ? marginPreview(bill.rateCents, pay.ok ? pay.rateCents : null) : null;
    const billTo = parties.get(e.billToPartyId)!;
    return {
      engagement: e,
      consultant: { id: c.id, name: `${c.firstName} ${c.lastName}`, employmentType: c.employmentType },
      chain: billingChain({
        endClient: nameOf(e.endClientPartyId)!,
        prime: nameOf(e.primePartyId),
        implementationPartner: nameOf(e.implementationPartnerPartyId),
        billToPartyId: e.billToPartyId,
        firmName: firm.displayName,
        subVendor: nameOf(c.subVendorPartyId),
        consultantName: `${c.firstName} ${c.lastName}`,
      }),
      rates: rates.map((r) => ({ ...toDomainRate(r), rate: formatCents(r.rateCents) })),
      purchaseOrders: (await listPurchaseOrders(tx, ctx.firmId, engagementId)).map((p) => ({
        ...p,
        amount: p.amountCents === null ? null : formatCents(p.amountCents),
        // Burn is invoiced amount ÷ PO amount; invoices arrive in M3, so nothing is burned yet.
        burnedCents: 0,
        thresholds: p.alertThresholdsBps.map(formatBps),
      })),
      margin: margin && {
        asOf,
        bill: formatCents(bill.ok ? bill.rateCents : 0),
        pay: pay.ok ? formatCents(pay.rateCents) : null,
        perHour: formatCents(margin.perHourCents),
        percent: formatBps(margin.marginBps),
      },
      billOnly: bill.ok && !pay.ok ? { asOf, bill: formatCents(bill.rateCents) } : null,
      deduction: formatBps(effectiveDeductionBps(billTo.standardDeductionBps, e.deductionBpsOverride)),
      timesheets: (await listTimesheets(tx, ctx.firmId, { engagementId })).map((t) => ({
        id: t.id,
        period: periodLabel({ start: t.periodStart, end: t.periodEnd }),
        status: t.status,
        totalHours: t.totalHours,
      })),
      today,
      canEdit: can(ctx.role, "EDIT_MASTER_DATA"),
      canEditRates: can(ctx.role, "EDIT_RATES"),
      showRates,
    };
  });
}

// --- create / update ------------------------------------------------------------------------------

const engagementFields = {
  billToPartyId: uuid,
  endClientPartyId: uuid,
  primePartyId: uuid.nullable().optional().transform((v) => v ?? null),
  implementationPartnerPartyId: uuid.nullable().optional().transform((v) => v ?? null),
  projectName: optionalText(200),
  roleTitle: optionalText(200),
  startDate: isoDate,
  endDate: optionalIsoDate,
  timesheetCycle: z.enum(CYCLES),
  biweeklyAnchorDate: optionalIsoDate,
  invoiceCycle: z.enum(CYCLES),
  evidenceRequired: bool,
  expectedWeeklyHours: z.preprocess((v) => v ?? "40", z.string().trim()),
  maxWeeklyHoursWarning: z.preprocess((v) => v ?? "50", z.string().trim()),
  deductionOverride: optionalPercent,
  factored: bool,
  primeWorkOrderNo: optionalText(100),
  primeConsultantRef: optionalText(100),
  endClientWorkerRef: optionalText(100),
};
const createSchema = z.strictObject({ consultantId: uuid, ...engagementFields });
const updateSchema = z.strictObject({ engagementId: uuid, ...engagementFields });
type Fields = z.infer<z.ZodObject<typeof engagementFields>>;

async function checkEngagement(tx: Queryable, ctx: FirmContext, data: Fields) {
  const ids = [data.billToPartyId, data.endClientPartyId, data.primePartyId, data.implementationPartnerPartyId].filter(
    (x): x is string => Boolean(x),
  );
  const parties = new Map((await getPartiesByIds(tx, ctx.firmId, ids)).map((p) => [p.id, p]));
  for (const id of ids) if (!parties.get(id) || parties.get(id)!.archivedAt) throw new NotFoundError("Party not found");
  const r = validateEngagement({
    ...data,
    deductionBpsOverride: data.deductionOverride,
    billTo: parties.get(data.billToPartyId)!,
    endClient: parties.get(data.endClientPartyId)!,
    prime: data.primePartyId ? parties.get(data.primePartyId)! : null,
    implementationPartner: data.implementationPartnerPartyId ? parties.get(data.implementationPartnerPartyId)! : null,
  });
  if (!r.ok) throw new ValidationError(r.message);
}

function toRow(data: Fields) {
  const { deductionOverride, ...rest } = data;
  return { ...rest, deductionBpsOverride: deductionOverride };
}

export async function createEngagement(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_MASTER_DATA");
  const { consultantId, ...data } = parse(createSchema, input);
  return withTenant(d.db, ctx, async (tx) => {
    const c = await getConsultant(tx, ctx.firmId, consultantId);
    if (!c || c.archivedAt) throw new NotFoundError("Consultant not found");
    await checkEngagement(tx, ctx, data);
    const e = await insertEngagement(tx, ctx.firmId, ctx.userId, {
      consultantId,
      ...toRow(data),
      status: engagementStatusMachine.initial,
    });
    await audit(tx, ctx, "engagement", e.id, "create", null, e);
    return { id: e.id };
  });
}

export async function updateEngagement(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_MASTER_DATA");
  const { engagementId, ...data } = parse(updateSchema, input);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getEngagement(tx, ctx.firmId, engagementId);
    if (!before) throw new NotFoundError();
    if (before.status === "ENDED") throw new ConflictError("Ended engagements can't be edited");
    await checkEngagement(tx, ctx, data);
    const after = await updateEngagementRepo(tx, ctx.firmId, engagementId, toRow(data));
    await audit(tx, ctx, "engagement", engagementId, "update", before, after);
    return { id: engagementId };
  });
}

/** Activate (DRAFT → ACTIVE) or end (ACTIVE → ENDED, section 16 endEngagement). R6. */
export async function setEngagementStatus(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_MASTER_DATA");
  const data = parse(
    z.strictObject({ engagementId: uuid, status: z.enum(["ACTIVE", "ENDED"]), endDate: optionalIsoDate }),
    input,
  );
  return withTenant(d.db, ctx, async (tx) => {
    const before: EngagementRow | null = await getEngagement(tx, ctx.firmId, data.engagementId);
    if (!before) throw new NotFoundError();
    const next = engagementStatusMachine.transition(before.status, data.status);
    const patch: Partial<EngagementRow> = { status: next };
    if (next === "ACTIVE") {
      // An active engagement must be billable from its start date (7.2 NO_RATE would block invoicing).
      const rates = (await listRates(tx, ctx.firmId, before.id)).map(toDomainRate);
      if (!resolveRate(rates, "BILL", "REGULAR", before.startDate).ok) {
        throw new ValidationError("Add a regular bill rate that covers the start date before activating");
      }
    }
    if (next === "ENDED") {
      const endDate = data.endDate ?? before.endDate;
      if (!endDate) throw new ValidationError("Enter the engagement's end date");
      if (endDate < before.startDate) throw new ValidationError("End date must be on or after the start date");
      patch.endDate = endDate;
    }
    const after = await updateEngagementRepo(tx, ctx.firmId, before.id, patch);
    await audit(tx, ctx, "engagement", before.id, "status_change", { status: before.status, endDate: before.endDate }, { status: after.status, endDate: after.endDate });
    // Timesheets for periods that have already started appear straight away (7.1), not overnight.
    if (next === "ACTIVE") {
      await ensureTimesheets(tx, { firmId: ctx.firmId, userId: ctx.userId, role: ctx.role, ip: ctx.ip, userAgent: ctx.userAgent }, (await getFirm(tx, ctx.firmId))!, [after]);
    }
    return { id: before.id, status: next };
  });
}

// --- rates (addRate, endRate) ---------------------------------------------------------------------

const addRateSchema = z.strictObject({
  engagementId: uuid,
  side: z.enum(["BILL", "PAY"]),
  rateKind: z.enum(RATE_KINDS).default("REGULAR"),
  rate: dollars,
  effectiveFrom: isoDate,
  effectiveTo: optionalIsoDate,
});

function overlapConflict(e: unknown): never {
  const msg = String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? "");
  if (msg.includes("rate_no_overlap")) throw new ConflictError("This rate overlaps an existing rate for the same side and kind");
  throw e;
}

export async function addRate(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_RATES");
  const data = parse(addRateSchema, input);
  return withTenant(d.db, ctx, async (tx) => {
    const e = await getEngagement(tx, ctx.firmId, data.engagementId);
    if (!e) throw new NotFoundError();
    if (e.status === "ENDED") throw new ConflictError("Ended engagements can't get new rates");
    await lockEngagement(tx, ctx.firmId, e.id);
    const c = (await getConsultant(tx, ctx.firmId, e.consultantId))!;
    const existing = (await listRates(tx, ctx.firmId, e.id)).map(toDomainRate);
    const candidate: Rate = {
      id: "new",
      side: data.side,
      rateKind: data.rateKind,
      rateCents: data.rate,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo,
    };
    const check = validateNewRate(existing, candidate, { employmentType: c.employmentType });
    if (!check.ok) {
      if (check.code === "OVERLAP") throw new ConflictError(check.message);
      throw new ValidationError(check.message);
    }
    const r = await insertRate(tx, ctx.firmId, ctx.userId, {
      engagementId: e.id,
      side: data.side,
      rateKind: data.rateKind,
      rateCents: data.rate,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo,
    }).catch(overlapConflict);
    await audit(tx, ctx, "rate", r.id, "create", null, r);
    return { id: r.id };
  });
}

export async function endRate(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_RATES");
  const data = parse(z.strictObject({ rateId: uuid, effectiveTo: isoDate }), input);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getRate(tx, ctx.firmId, data.rateId);
    if (!before) throw new NotFoundError();
    await lockEngagement(tx, ctx.firmId, before.engagementId);
    const check = validateRateEnd(toDomainRate(before), data.effectiveTo);
    if (!check.ok) throw new ValidationError(check.message);
    const after = await setRateEnd(tx, ctx.firmId, before.id, data.effectiveTo);
    await audit(tx, ctx, "rate", before.id, "end", before, after);
    return { id: before.id };
  });
}

// --- purchase orders (addPurchaseOrder) -------------------------------------------------------------

const poSchema = z.strictObject({
  engagementId: uuid,
  poNumber: text(100, 1),
  amount: optionalDollars,
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
  /** Percentages, e.g. "75, 90, 100". */
  alertThresholds: z.string().optional(),
});

export async function addPurchaseOrder(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "EDIT_MASTER_DATA");
  const data = parse(poSchema, input);
  let thresholds = [7500, 9000, 10000];
  if (data.alertThresholds && data.alertThresholds.trim()) {
    const parsed = data.alertThresholds.split(/[\s,;]+/).filter(Boolean).map(parsePercentToBps);
    if (parsed.some((b) => b === null || b <= 0 || b > 20_000)) throw new ValidationError("Thresholds must be percentages like 75, 90, 100");
    thresholds = [...new Set(parsed as number[])].sort((a, b) => a - b);
  }
  if (data.startDate && data.endDate && data.endDate < data.startDate) throw new ValidationError("End date must be on or after the start date");
  return withTenant(d.db, ctx, async (tx) => {
    const e = await getEngagement(tx, ctx.firmId, data.engagementId);
    if (!e) throw new NotFoundError();
    const po = await insertPurchaseOrder(tx, ctx.firmId, ctx.userId, {
      engagementId: e.id,
      poNumber: data.poNumber,
      amountCents: data.amount,
      startDate: data.startDate,
      endDate: data.endDate,
      alertThresholdsBps: thresholds,
    });
    await audit(tx, ctx, "purchase_order", po.id, "create", null, po);
    return { id: po.id };
  });
}

/** Choices for the engagement form: parties by role and the consultant list. */
export async function getEngagementFormOptions(d: Deps, ctx: FirmContext) {
  requirePermission(ctx, "VIEW_MASTER_DATA");
  return withTenant(d.db, ctx, async (tx) => {
    const parties = await listParties(tx, ctx.firmId);
    const pick = (kinds: string[]) => parties.filter((p) => kinds.includes(p.kind)).map((p) => ({ id: p.id, name: p.displayName, kind: p.kind }));
    return {
      billTo: pick(["PRIME_VENDOR", "IMPLEMENTATION_PARTNER", "END_CLIENT"]),
      endClients: pick(["END_CLIENT"]),
      primes: pick(["PRIME_VENDOR"]),
      implementationPartners: pick(["IMPLEMENTATION_PARTNER"]),
      subVendors: pick(["SUB_VENDOR"]),
      consultants: (await listConsultants(tx, ctx.firmId)).map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` })),
    };
  });
}
