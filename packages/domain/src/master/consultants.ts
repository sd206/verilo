import type { EmploymentType } from "../rates/rates";
import type { PartyKind } from "./parties";

export type ConsultantCheck = { ok: true } | { ok: false; field: string; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmails(emails: readonly string[]): string[] {
  return [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/** Section 5.3: sub_vendor_party_id required when CONTRACTOR (and must be a sub-vendor). */
export function validateConsultant(c: {
  employmentType: EmploymentType;
  subVendor: { kind: PartyKind } | null;
  emails: readonly string[];
}): ConsultantCheck {
  if (c.employmentType === "CONTRACTOR" && !c.subVendor) {
    return { ok: false, field: "subVendorPartyId", message: "Contractors need a sub-vendor" };
  }
  if (c.employmentType === "W2" && c.subVendor) {
    return { ok: false, field: "subVendorPartyId", message: "W-2 employees don't have a sub-vendor" };
  }
  if (c.subVendor && c.subVendor.kind !== "SUB_VENDOR") {
    return { ok: false, field: "subVendorPartyId", message: "Choose a sub-vendor" };
  }
  for (const e of c.emails) if (!EMAIL_RE.test(e)) return { ok: false, field: "emails", message: `${e} isn't a valid email` };
  return { ok: true };
}
