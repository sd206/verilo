import type { FirmContext } from "@verilo/auth";
import { getFirm, withTenant } from "@verilo/db";
import { NotFoundError } from "@verilo/auth";
import type { Deps } from "../deps";

/** The app shell's firm summary (any role). */
export async function getFirmSummary(d: Deps, ctx: FirmContext) {
  const firm = await withTenant(d.db, ctx, (tx) => getFirm(tx, ctx.firmId));
  if (!firm) throw new NotFoundError();
  return {
    id: firm.id,
    displayName: firm.displayName,
    legalName: firm.legalName,
    timezone: firm.timezone,
    timesheetInboxAddress: firm.timesheetInboxAddress,
    apInboxAddress: firm.apInboxAddress,
    role: ctx.role,
  };
}
