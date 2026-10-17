import { isIsoDate, type IsoDate } from "../dates";

export const CYCLES = ["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"] as const;
export type Cycle = (typeof CYCLES)[number];

/** Section 5.3: invoice_cycle must be ≥ timesheet_cycle (ordered shortest to longest). */
export function invoiceCycleAllowed(timesheetCycle: Cycle, invoiceCycle: Cycle): boolean {
  return CYCLES.indexOf(invoiceCycle) >= CYCLES.indexOf(timesheetCycle);
}

export function biweeklyAnchorValid(cycle: Cycle, anchor: IsoDate | null): boolean {
  return cycle !== "BIWEEKLY" || (anchor !== null && isIsoDate(anchor));
}
