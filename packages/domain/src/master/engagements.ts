import { isIsoDate, type IsoDate } from "../dates";
import { biweeklyAnchorValid, invoiceCycleAllowed, type Cycle } from "./cycles";
import { isBillToKind, type PartyKind } from "./parties";

export interface EngagementRules {
  startDate: IsoDate;
  endDate: IsoDate | null;
  timesheetCycle: Cycle;
  invoiceCycle: Cycle;
  biweeklyAnchorDate: IsoDate | null;
  expectedWeeklyHours: string; // NUMERIC(5,2) as text
  maxWeeklyHoursWarning: string;
  deductionBpsOverride: number | null;
  billTo: { kind: PartyKind };
  endClient: { kind: PartyKind };
  prime: { kind: PartyKind } | null;
  implementationPartner: { kind: PartyKind } | null;
}

export type EngagementCheck = { ok: true } | { ok: false; field: string; message: string };

const HOURS_RE = /^\d{1,3}(\.\d{1,2})?$/;

export function validateEngagement(e: EngagementRules): EngagementCheck {
  if (!isIsoDate(e.startDate)) return { ok: false, field: "startDate", message: "Enter a start date" };
  if (e.endDate !== null && (!isIsoDate(e.endDate) || e.endDate < e.startDate)) {
    return { ok: false, field: "endDate", message: "End date must be on or after the start date" };
  }
  if (!invoiceCycleAllowed(e.timesheetCycle, e.invoiceCycle)) {
    return { ok: false, field: "invoiceCycle", message: "The invoice cycle can't be shorter than the timesheet cycle" };
  }
  if (!biweeklyAnchorValid(e.timesheetCycle, e.biweeklyAnchorDate) || !biweeklyAnchorValid(e.invoiceCycle, e.biweeklyAnchorDate)) {
    return { ok: false, field: "biweeklyAnchorDate", message: "Biweekly cycles need an anchor date" };
  }
  for (const [field, v] of [
    ["expectedWeeklyHours", e.expectedWeeklyHours],
    ["maxWeeklyHoursWarning", e.maxWeeklyHoursWarning],
  ] as const) {
    if (!HOURS_RE.test(v) || Number(v) > 168) return { ok: false, field, message: "Hours must be between 0 and 168" };
  }
  if (Number(e.maxWeeklyHoursWarning) < Number(e.expectedWeeklyHours)) {
    return { ok: false, field: "maxWeeklyHoursWarning", message: "The warning threshold can't be below expected hours" };
  }
  if (e.deductionBpsOverride !== null && (!Number.isInteger(e.deductionBpsOverride) || e.deductionBpsOverride < 0 || e.deductionBpsOverride > 10_000)) {
    return { ok: false, field: "deductionBpsOverride", message: "Deduction must be between 0% and 100%" };
  }
  if (!isBillToKind(e.billTo.kind)) return { ok: false, field: "billToPartyId", message: "The bill-to party must be a prime vendor, implementation partner or end client" };
  if (e.endClient.kind !== "END_CLIENT") return { ok: false, field: "endClientPartyId", message: "Choose an end client" };
  if (e.prime && e.prime.kind !== "PRIME_VENDOR") return { ok: false, field: "primePartyId", message: "Choose a prime vendor" };
  if (e.implementationPartner && e.implementationPartner.kind !== "IMPLEMENTATION_PARTNER") {
    return { ok: false, field: "implementationPartnerPartyId", message: "Choose an implementation partner" };
  }
  return { ok: true };
}

/** Effective deduction for a bill-to party (5.3 deduction_bps_override). */
export function effectiveDeductionBps(partyStandardBps: number | null, overrideBps: number | null): number {
  return overrideBps ?? partyStandardBps ?? 0;
}

export interface ChainNode {
  role: "END_CLIENT" | "PRIME_VENDOR" | "IMPLEMENTATION_PARTNER" | "FIRM" | "SUB_VENDOR" | "CONSULTANT";
  name: string;
  billTo?: boolean;
  id?: string;
}

/** Section 1's chain for one engagement, top (end client) to bottom (consultant). */
export function billingChain(input: {
  endClient: { id: string; name: string };
  prime: { id: string; name: string } | null;
  implementationPartner: { id: string; name: string } | null;
  billToPartyId: string;
  firmName: string;
  subVendor: { id: string; name: string } | null;
  consultantName: string;
}): ChainNode[] {
  const nodes: ChainNode[] = [{ role: "END_CLIENT", id: input.endClient.id, name: input.endClient.name }];
  if (input.prime) nodes.push({ role: "PRIME_VENDOR", id: input.prime.id, name: input.prime.name });
  if (input.implementationPartner) {
    nodes.push({ role: "IMPLEMENTATION_PARTNER", id: input.implementationPartner.id, name: input.implementationPartner.name });
  }
  for (const n of nodes) if (n.id === input.billToPartyId) n.billTo = true;
  nodes.push({ role: "FIRM", name: input.firmName });
  if (input.subVendor) nodes.push({ role: "SUB_VENDOR", id: input.subVendor.id, name: input.subVendor.name });
  nodes.push({ role: "CONSULTANT", name: input.consultantName });
  return nodes;
}
