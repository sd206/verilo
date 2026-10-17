/** Shared Zod field types for master data. Money and percentages are parsed with the domain helpers (R1). */
import { z } from "zod";
import { isIsoDate, parseDollars, parsePercentToBps } from "@verilo/domain";

export const isoDate = z.string().refine(isIsoDate, "Enter a valid date (YYYY-MM-DD)");
export const optionalIsoDate = z
  .union([isoDate, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const text = (max = 200) => z.string().trim().max(max);
export const optionalText = (max = 200) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v == null ? null : v.trim().slice(0, max) || null));

/** "95.00" → 9500 cents. Never goes through floating point. */
export const dollars = z.string().transform((v, ctx) => {
  const cents = parseDollars(v);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: "Enter an amount like 95.00" });
    return z.NEVER;
  }
  return cents;
});
export const optionalDollars = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v == null || v.trim() === "") return null;
    const cents = parseDollars(v);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 60000.00" });
      return z.NEVER;
    }
    return cents;
  });

/** "2" or "2.5%" → basis points. */
export const optionalPercent = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v == null || v.trim() === "") return null;
    const bps = parsePercentToBps(v);
    if (bps === null || bps > 10_000) {
      ctx.addIssue({ code: "custom", message: "Enter a percentage like 2 or 2.5" });
      return z.NEVER;
    }
    return bps;
  });

export const optionalInt = (min: number, max: number) =>
  z
    .union([z.number().int().min(min).max(max), z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `Enter a whole number from ${min} to ${max}` });
        return z.NEVER;
      }
      return n;
    });

const EMAIL = z.email();
/** Comma/newline separated list or array → normalized, de-duplicated emails. */
export const emailList = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v, ctx) => {
    const raw = v == null ? [] : Array.isArray(v) ? v : v.split(/[\s,;]+/);
    const out = [...new Set(raw.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    for (const e of out) {
      if (!EMAIL.safeParse(e).success) {
        ctx.addIssue({ code: "custom", message: `${e} isn't a valid email` });
        return z.NEVER;
      }
    }
    return out;
  });

export const bool = z
  .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

/** Today's date in the firm's time zone (R12). */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
