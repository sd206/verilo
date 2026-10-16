import type { Role } from "@verilo/domain";
import { ForbiddenError } from "./errors";

/**
 * Section 12 permission matrix, enforced on the server for every action (R8).
 * One capability per row of the table; "view" cells are separate VIEW_* capabilities.
 */
export const CAPABILITIES = {
  MANAGE_FIRM: ["ADMIN"], // users and roles; firm settings; numbering; templates; QBO connect and mapping
  EDIT_MASTER_DATA: ["ADMIN", "MANAGER"], // parties, consultants, engagements, POs
  VIEW_MASTER_DATA: ["ADMIN", "MANAGER", "FINANCE"],
  EDIT_RATES: ["ADMIN", "MANAGER"],
  VIEW_RATES: ["ADMIN", "MANAGER", "FINANCE"],
  VIEW_OWN_ENGAGEMENTS: ["CONSULTANT"], // without rates
  SUBMIT_OWN_TIMESHEETS: ["CONSULTANT"],
  ENTER_ANY_TIMESHEETS: ["ADMIN", "MANAGER", "FINANCE"], // includes bulk upload
  REVIEW_TIMESHEETS: ["ADMIN", "MANAGER", "FINANCE"], // resolve checks, verify, return
  CREATE_INVOICES: ["ADMIN", "MANAGER", "FINANCE"], // invoice runs and drafts
  APPROVE_INVOICES: ["ADMIN", "MANAGER"], // includes credit memos
  SEND_INVOICES: ["ADMIN", "MANAGER", "FINANCE"], // includes marking portal upload done
  RECORD_RECEIPTS: ["ADMIN", "FINANCE"], // record, apply, shortfalls
  ATTACH_VENDOR_INVOICES: ["ADMIN", "MANAGER", "FINANCE"], // includes resolving match exceptions
  APPROVE_VENDOR_BILLS: ["ADMIN", "MANAGER"], // includes payment runs
  RECORD_VENDOR_PAYMENTS: ["ADMIN", "FINANCE"], // includes sending remittances
  COMPLIANCE_OVERRIDE: ["ADMIN"], // includes period unlock
  VIEW_REPORTS: ["ADMIN", "MANAGER", "FINANCE"],
  VIEW_OWN_HOURS_REPORT: ["CONSULTANT"],
  VIEW_SYNC_LOG: ["ADMIN", "FINANCE"], // includes retry
  MANAGE_BILLING: ["ADMIN"], // section 22
  VIEW_BILLING: ["ADMIN", "FINANCE"],
  MANAGE_CPA_PACKAGE: ["ADMIN", "FINANCE"], // generate, send to CPA, revoke links (section 23)
  DOWNLOAD_CPA_PACKAGE: ["ADMIN", "MANAGER", "FINANCE"],
  // M0 file uploads: consultants upload their own evidence; other roles upload for anyone.
  UPLOAD_FILES: ["ADMIN", "MANAGER", "FINANCE", "CONSULTANT"],
  VIEW_ALL_FILES: ["ADMIN", "MANAGER", "FINANCE"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

/** Capabilities a Manager gains when the firm sets "Managers also act as Finance" (open decision 2). */
const FINANCE_CAPABILITIES = (Object.keys(CAPABILITIES) as Capability[]).filter((c) =>
  (CAPABILITIES[c] as readonly Role[]).includes("FINANCE"),
);

export interface PermissionOptions {
  managersActAsFinance?: boolean;
}

export function can(role: Role, capability: Capability, opts: PermissionOptions = {}): boolean {
  if ((CAPABILITIES[capability] as readonly Role[]).includes(role)) return true;
  return role === "MANAGER" && opts.managersActAsFinance === true && FINANCE_CAPABILITIES.includes(capability);
}

export function requirePermission(
  ctx: { role: Role },
  capability: Capability,
  opts: PermissionOptions = {},
): void {
  if (!can(ctx.role, capability, opts)) throw new ForbiddenError();
}
