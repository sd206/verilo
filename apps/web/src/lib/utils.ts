import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  FINANCE: "Finance",
  CONSULTANT: "Consultant",
};

export const PARTY_KIND_LABELS: Record<string, string> = {
  PRIME_VENDOR: "Prime vendor",
  IMPLEMENTATION_PARTNER: "Implementation partner",
  END_CLIENT: "End client",
  SUB_VENDOR: "Sub-vendor",
  FACTOR: "Factor",
};

export const CYCLE_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  SEMIMONTHLY: "Semi-monthly",
  MONTHLY: "Monthly",
};

export const DOC_TYPE_LABELS: Record<string, string> = { W9: "W-9", COI: "COI", MSA: "MSA", WORK_ORDER: "Work order", OTHER: "Other" };

/** "2026-09-01" → "Sep 1, 2026" without time-zone shifts (dates are calendar dates, R12). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

export const W9_LABELS: Record<string, string> = {
  UNKNOWN: "Unknown",
  INDIVIDUAL_SOLE_PROP_SMLLC: "Individual / sole proprietor / single-member LLC",
  C_CORP: "C corporation",
  S_CORP: "S corporation",
  PARTNERSHIP: "Partnership",
  TRUST_ESTATE: "Trust / estate",
  LLC_C: "LLC taxed as C corp",
  LLC_S: "LLC taxed as S corp",
  LLC_P: "LLC taxed as partnership",
  OTHER: "Other",
};
