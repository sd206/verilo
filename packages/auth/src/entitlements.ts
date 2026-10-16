/**
 * Section 22.3 feature entitlements. `requireFeature` is checked in every gated server
 * action, route and job. Until M9 it returns true for every feature.
 */
export const FEATURES = [
  "TIMESHEETS",
  "INVOICING",
  "RECEIPTS",
  "VENDOR_BILLS_NET",
  "STANDARD_REPORTS",
  "CSV_EXPORTS",
  "CPA_PACKAGE",
  "QBO_SYNC",
  "THREE_WAY_MATCH",
  "PAY_WHEN_PAID",
  "CASH_GAP_FORECAST",
  "FACTORING",
  "MONTH_END_ACCRUALS",
] as const;
export type Feature = (typeof FEATURES)[number];

export async function requireFeature(_firmId: string, _feature: Feature): Promise<true> {
  return true;
}
