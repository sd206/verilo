/** Firm settings, invoice numbering and holidays (13.3 items 1 and 3; section 16 "Settings"). Admin only. */
import { z } from "zod";
import { NotFoundError, requirePermission, ValidationError, ConflictError, type FirmContext } from "@verilo/auth";
import {
  getFile,
  getFirm,
  getParty,
  listHolidays,
  listParties,
  replaceHolidays,
  updateFirm as updateFirmRepo,
  withTenant,
  writeAudit,
  type FirmRow,
} from "@verilo/db";
import { formatCents, isBillToKind, previewInvoiceNumber as preview, validateNumberPattern } from "@verilo/domain";
import type { Deps } from "../deps";
import { parse, uuid } from "./common";
import { firmCipher, maskTail } from "./firm-crypto";
import { dollars, isoDate, optionalInt, optionalText, text, todayIn } from "./fields";

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Audit-safe view of the firm row: no data key, no ciphertext. */
function auditView(f: FirmRow) {
  const { wrappedDataKey: _k, ein, ...rest } = f;
  return { ...rest, ein: ein ? "[encrypted]" : null };
}

export async function getFirmSettings(d: Deps, ctx: FirmContext) {
  requirePermission(ctx, "MANAGE_FIRM");
  return withTenant(d.db, ctx, async (tx) => {
    const f = await getFirm(tx, ctx.firmId);
    if (!f) throw new NotFoundError();
    const cipher = await firmCipher(d, tx, ctx.firmId);
    const parties = await listParties(tx, ctx.firmId);
    const billTo = parties.filter((p) => isBillToKind(p.kind) && p.code).map((p) => ({ id: p.id, name: p.displayName, code: p.code! }));
    return {
      firm: {
        legalName: f.legalName,
        displayName: f.displayName,
        einMasked: maskTail(cipher.decrypt(f.ein)),
        addressLine1: f.addressLine1,
        addressLine2: f.addressLine2,
        city: f.city,
        state: f.state,
        postalCode: f.postalCode,
        phone: f.phone,
        email: f.email,
        website: f.website,
        logoFileId: f.logoFileId,
        timezone: f.timezone,
        weekStart: f.weekStart,
        defaultPaymentTermsDays: f.defaultPaymentTermsDays,
        remitToText: f.remitToText,
        matchTolerance: formatCents(f.matchToleranceCents, { symbol: false }),
        deductionTolerance: formatCents(f.deductionToleranceCents, { symbol: false }),
        invoiceNumberPattern: f.invoiceNumberPattern,
        invoiceSeqReset: f.invoiceSeqReset,
        timesheetInboxAddress: f.timesheetInboxAddress,
        apInboxAddress: f.apInboxAddress,
      },
      holidays: (await listHolidays(tx, ctx.firmId)).map((h) => ({ date: h.holidayDate, name: h.name })),
      billToParties: billTo,
      today: todayIn(f.timezone),
    };
  });
}

const firmSchema = z.strictObject({
  legalName: text(200, 2),
  displayName: text(100, 2),
  /** Empty keeps the current value. */
  ein: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{2}-?\d{7}$/.test(v), "EIN must look like 12-3456789"),
  addressLine1: optionalText(),
  addressLine2: optionalText(),
  city: optionalText(100),
  state: optionalText(50),
  postalCode: optionalText(20),
  phone: optionalText(50),
  email: optionalText(254),
  website: optionalText(200),
  logoFileId: uuid.nullable().optional(),
  timezone: z.string().refine(isTimeZone, "Unknown time zone"),
  weekStart: z.enum(["MON", "SUN"]),
  defaultPaymentTermsDays: optionalInt(0, 365).transform((v) => v ?? 30),
  remitToText: optionalText(2000),
  matchTolerance: dollars,
  deductionTolerance: dollars,
});

export async function updateFirm(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "MANAGE_FIRM");
  const data = parse(firmSchema, input);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getFirm(tx, ctx.firmId);
    if (!before) throw new NotFoundError();
    if (data.logoFileId) {
      const logo = await getFile(tx, ctx.firmId, data.logoFileId);
      if (!logo) throw new NotFoundError("Logo file not found");
      if (logo.scanStatus !== "CLEAN" || !logo.mimeType.startsWith("image/")) {
        throw new ValidationError("The logo must be a clean image file");
      }
    }
    const cipher = await firmCipher(d, tx, ctx.firmId);
    const { ein, matchTolerance, deductionTolerance, ...rest } = data;
    const after = await updateFirmRepo(tx, ctx.firmId, {
      ...rest,
      logoFileId: data.logoFileId ?? null,
      matchToleranceCents: matchTolerance,
      deductionToleranceCents: deductionTolerance,
      ...(ein ? { ein: cipher.encrypt(ein.replace(/^(\d{2})(\d{7})$/, "$1-$2")) } : {}),
    });
    await writeAudit(tx, {
      firmId: ctx.firmId,
      actorUserId: ctx.userId,
      entityType: "firm",
      entityId: ctx.firmId,
      action: "update",
      before: auditView(before),
      after: auditView(after),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true as const };
  });
}

// --- invoice numbering (13.3 item 3; 7.4) --------------------------------------------------

const patternSchema = z.strictObject({
  pattern: z.string().max(100),
  seqReset: z.enum(["NEVER", "YEARLY", "MONTHLY"]),
});

export async function setNumberingPattern(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "MANAGE_FIRM");
  const data = parse(patternSchema, input);
  const check = validateNumberPattern(data.pattern);
  if (!check.ok) throw new ValidationError(check.message);
  return withTenant(d.db, ctx, async (tx) => {
    const before = await getFirm(tx, ctx.firmId);
    if (!before) throw new NotFoundError();
    await updateFirmRepo(tx, ctx.firmId, { invoiceNumberPattern: data.pattern, invoiceSeqReset: data.seqReset });
    await writeAudit(tx, {
      firmId: ctx.firmId,
      actorUserId: ctx.userId,
      entityType: "firm",
      entityId: ctx.firmId,
      action: "set_numbering_pattern",
      before: { pattern: before.invoiceNumberPattern, seqReset: before.invoiceSeqReset },
      after: data,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true as const };
  });
}

const previewSchema = z.strictObject({
  pattern: z.string().max(100),
  clientPartyId: uuid.nullable().optional(),
  invoiceDate: isoDate,
});

/** previewInvoiceNumber (section 16): live preview while editing the pattern. Read-only. */
export async function previewInvoiceNumber(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "MANAGE_FIRM");
  const data = parse(previewSchema, input);
  let code: string | null = "CLIENT";
  if (data.clientPartyId) {
    const p = await withTenant(d.db, ctx, (tx) => getParty(tx, ctx.firmId, data.clientPartyId!));
    if (!p) throw new NotFoundError();
    code = p.code;
  }
  const r = preview(data.pattern, code, data.invoiceDate);
  return r.ok ? { ok: true as const, number: r.number } : { ok: false as const, error: r.message };
}

// --- holiday calendar ------------------------------------------------------------------------

const holidaysSchema = z.strictObject({
  holidays: z.array(z.strictObject({ date: isoDate, name: text(100, 1) })).max(200),
});

export async function setHolidays(d: Deps, ctx: FirmContext, input: unknown) {
  requirePermission(ctx, "MANAGE_FIRM");
  const { holidays } = parse(holidaysSchema, input);
  const dates = holidays.map((h) => h.date);
  if (new Set(dates).size !== dates.length) throw new ConflictError("Each date can appear only once");
  return withTenant(d.db, ctx, async (tx) => {
    const before = (await listHolidays(tx, ctx.firmId)).map((h) => ({ date: h.holidayDate, name: h.name }));
    const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
    const rows = await replaceHolidays(
      tx,
      ctx.firmId,
      ctx.userId,
      sorted.map((h) => ({ holidayDate: h.date, name: h.name })),
    );
    await writeAudit(tx, {
      firmId: ctx.firmId,
      actorUserId: ctx.userId,
      entityType: "firm",
      entityId: ctx.firmId,
      action: "set_holidays",
      before,
      after: sorted,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return rows.map((h) => ({ date: h.holidayDate, name: h.name }));
  });
}
