export const PARTY_KINDS = ["PRIME_VENDOR", "IMPLEMENTATION_PARTNER", "END_CLIENT", "SUB_VENDOR", "FACTOR"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

/** Kinds that can be an engagement's bill-to party (5.3: "usually PRIME_VENDOR"). */
export const BILL_TO_KINDS: readonly PartyKind[] = ["PRIME_VENDOR", "IMPLEMENTATION_PARTNER", "END_CLIENT"];

export function isBillToKind(kind: PartyKind): boolean {
  return BILL_TO_KINDS.includes(kind);
}

/** party.code: short, used in invoice numbers ({CLIENT}); unique per firm. */
export const PARTY_CODE_RE = /^[A-Z0-9]{2,10}$/;

export interface PartyRules {
  kind: PartyKind;
  code: string | null;
  vendorPayTerms: "NET" | "PAY_WHEN_PAID" | null;
  vendorNetDays: number | null;
  standardDeductionBps: number | null;
  paymentTermsDays: number | null;
}

export type PartyCheck = { ok: true } | { ok: false; field: string; message: string };

/** Field rules by kind (section 5.2). Bill-to-only and sub-vendor-only fields are checked here. */
export function validateParty(p: PartyRules): PartyCheck {
  if (p.code !== null && !PARTY_CODE_RE.test(p.code)) {
    return { ok: false, field: "code", message: "Code must be 2–10 capital letters or digits" };
  }
  if (isBillToKind(p.kind) && p.kind !== "END_CLIENT" && !p.code) {
    return { ok: false, field: "code", message: "Bill-to parties need a code for invoice numbers" };
  }
  if (p.kind === "SUB_VENDOR") {
    if (!p.vendorPayTerms) return { ok: false, field: "vendorPayTerms", message: "Choose NET or pay-when-paid" };
    if (p.vendorPayTerms === "NET" && (p.vendorNetDays === null || p.vendorNetDays < 0)) {
      return { ok: false, field: "vendorNetDays", message: "Enter net days" };
    }
  } else if (p.vendorPayTerms !== null || p.vendorNetDays !== null) {
    return { ok: false, field: "vendorPayTerms", message: "Vendor pay terms apply only to sub-vendors" };
  }
  if (p.standardDeductionBps !== null) {
    if (!isBillToKind(p.kind)) return { ok: false, field: "standardDeductionBps", message: "Deductions apply only to bill-to parties" };
    if (!Number.isInteger(p.standardDeductionBps) || p.standardDeductionBps < 0 || p.standardDeductionBps > 10_000) {
      return { ok: false, field: "standardDeductionBps", message: "Deduction must be between 0% and 100%" };
    }
  }
  if (p.paymentTermsDays !== null && (!Number.isInteger(p.paymentTermsDays) || p.paymentTermsDays < 0 || p.paymentTermsDays > 365)) {
    return { ok: false, field: "paymentTermsDays", message: "Payment terms must be 0–365 days" };
  }
  return { ok: true };
}

export const DOC_EXPIRY_WARNING_DAYS = 30;
export type DocumentStatus = "VALID" | "EXPIRING" | "EXPIRED" | "NO_EXPIRY";

/** Party documents (W-9, COI…) with expiry, for the party detail page. */
export function documentStatus(expiryDate: string | null, today: string): DocumentStatus {
  if (!expiryDate) return "NO_EXPIRY";
  if (expiryDate < today) return "EXPIRED";
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const warn = new Date(Date.UTC(y, m - 1, d + DOC_EXPIRY_WARNING_DAYS)).toISOString().slice(0, 10);
  return expiryDate <= warn ? "EXPIRING" : "VALID";
}
