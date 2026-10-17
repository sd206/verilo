"use server";

import { requireFirmContext } from "@verilo/auth";
import { deps } from "../deps";
import { getAuth, requestMeta } from "../context";
import { run, type ActionResult } from "../action-result";
import * as parties from "../handlers/parties";
import * as consultants from "../handlers/consultants";
import * as engagements from "../handlers/engagements";
import * as settings from "../handlers/settings";
import * as members from "../handlers/members";

async function ctx() {
  return requireFirmContext(await getAuth(), await requestMeta());
}

type Out<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;

// Parties
export async function createPartyAction(input: unknown): Promise<ActionResult<Out<typeof parties.createParty>>> {
  return run(async () => parties.createParty(deps(), await ctx(), input));
}
export async function updatePartyAction(input: unknown): Promise<ActionResult<Out<typeof parties.updateParty>>> {
  return run(async () => parties.updateParty(deps(), await ctx(), input));
}
export async function archivePartyAction(input: unknown): Promise<ActionResult<Out<typeof parties.archiveParty>>> {
  return run(async () => parties.archiveParty(deps(), await ctx(), input));
}
export async function addContactAction(input: unknown): Promise<ActionResult<Out<typeof parties.addContact>>> {
  return run(async () => parties.addContact(deps(), await ctx(), input));
}
export async function archiveContactAction(input: unknown): Promise<ActionResult<Out<typeof parties.archiveContact>>> {
  return run(async () => parties.archiveContact(deps(), await ctx(), input));
}
export async function attachPartyDocumentAction(input: unknown): Promise<ActionResult<Out<typeof parties.attachPartyDocument>>> {
  return run(async () => parties.attachPartyDocument(deps(), await ctx(), input));
}
export async function archivePartyDocumentAction(input: unknown): Promise<ActionResult<Out<typeof parties.archivePartyDocument>>> {
  return run(async () => parties.archivePartyDocument(deps(), await ctx(), input));
}

// Consultants
export async function createConsultantAction(input: unknown): Promise<ActionResult<Out<typeof consultants.createConsultant>>> {
  return run(async () => consultants.createConsultant(deps(), await ctx(), input));
}
export async function updateConsultantAction(input: unknown): Promise<ActionResult<Out<typeof consultants.updateConsultant>>> {
  return run(async () => consultants.updateConsultant(deps(), await ctx(), input));
}
export async function setConsultantStatusAction(input: unknown): Promise<ActionResult<Out<typeof consultants.setConsultantStatus>>> {
  return run(async () => consultants.setConsultantStatus(deps(), await ctx(), input));
}
export async function archiveConsultantAction(input: unknown): Promise<ActionResult<Out<typeof consultants.archiveConsultant>>> {
  return run(async () => consultants.archiveConsultant(deps(), await ctx(), input));
}

// Engagements, rates, POs
export async function createEngagementAction(input: unknown): Promise<ActionResult<Out<typeof engagements.createEngagement>>> {
  return run(async () => engagements.createEngagement(deps(), await ctx(), input));
}
export async function updateEngagementAction(input: unknown): Promise<ActionResult<Out<typeof engagements.updateEngagement>>> {
  return run(async () => engagements.updateEngagement(deps(), await ctx(), input));
}
export async function setEngagementStatusAction(input: unknown): Promise<ActionResult<Out<typeof engagements.setEngagementStatus>>> {
  return run(async () => engagements.setEngagementStatus(deps(), await ctx(), input));
}
export async function addRateAction(input: unknown): Promise<ActionResult<Out<typeof engagements.addRate>>> {
  return run(async () => engagements.addRate(deps(), await ctx(), input));
}
export async function endRateAction(input: unknown): Promise<ActionResult<Out<typeof engagements.endRate>>> {
  return run(async () => engagements.endRate(deps(), await ctx(), input));
}
export async function addPurchaseOrderAction(input: unknown): Promise<ActionResult<Out<typeof engagements.addPurchaseOrder>>> {
  return run(async () => engagements.addPurchaseOrder(deps(), await ctx(), input));
}

// Settings (Admin)
export async function updateFirmAction(input: unknown): Promise<ActionResult<Out<typeof settings.updateFirm>>> {
  return run(async () => settings.updateFirm(deps(), await ctx(), input));
}
export async function setNumberingPatternAction(input: unknown): Promise<ActionResult<Out<typeof settings.setNumberingPattern>>> {
  return run(async () => settings.setNumberingPattern(deps(), await ctx(), input));
}
export async function previewInvoiceNumberAction(input: unknown): Promise<ActionResult<Out<typeof settings.previewInvoiceNumber>>> {
  return run(async () => settings.previewInvoiceNumber(deps(), await ctx(), input));
}
export async function setHolidaysAction(input: unknown): Promise<ActionResult<Out<typeof settings.setHolidays>>> {
  return run(async () => settings.setHolidays(deps(), await ctx(), input));
}
export async function updateMemberAction(input: unknown): Promise<ActionResult<Out<typeof members.updateMember>>> {
  return run(async () => members.updateMember(deps(), await ctx(), input));
}
