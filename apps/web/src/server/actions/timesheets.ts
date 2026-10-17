"use server";

import { requireFirmContext } from "@verilo/auth";
import { deps } from "../deps";
import { getAuth, requestMeta } from "../context";
import { run, type ActionResult } from "../action-result";
import * as ts from "../handlers/timesheets";

async function ctx() {
  return requireFirmContext(await getAuth(), await requestMeta());
}

type Out<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;

export async function saveTimesheetEntriesAction(input: unknown): Promise<ActionResult<Out<typeof ts.saveTimesheetEntries>>> {
  return run(async () => ts.saveTimesheetEntries(deps(), await ctx(), input));
}
export async function submitTimesheetAction(input: unknown): Promise<ActionResult<Out<typeof ts.submitTimesheet>>> {
  return run(async () => ts.submitTimesheet(deps(), await ctx(), input));
}
export async function uploadEvidenceAction(input: unknown): Promise<ActionResult<Out<typeof ts.uploadEvidence>>> {
  return run(async () => ts.uploadEvidence(deps(), await ctx(), input));
}
export async function removeEvidenceAction(input: unknown): Promise<ActionResult<Out<typeof ts.removeEvidence>>> {
  return run(async () => ts.removeEvidence(deps(), await ctx(), input));
}
export async function resolveCheckAction(input: unknown): Promise<ActionResult<Out<typeof ts.resolveCheck>>> {
  return run(async () => ts.resolveCheck(deps(), await ctx(), input));
}
export async function verifyTimesheetAction(input: unknown): Promise<ActionResult<Out<typeof ts.verifyTimesheet>>> {
  return run(async () => ts.verifyTimesheet(deps(), await ctx(), input));
}
export async function returnTimesheetAction(input: unknown): Promise<ActionResult<Out<typeof ts.returnTimesheet>>> {
  return run(async () => ts.returnTimesheet(deps(), await ctx(), input));
}
export async function assignUnmatchedFileAction(input: unknown): Promise<ActionResult<Out<typeof ts.assignUnmatchedFile>>> {
  return run(async () => ts.assignUnmatchedFile(deps(), await ctx(), input));
}
/** Polled by the editor while a screenshot is being read. */
export async function getTimesheetDetailAction(input: unknown): Promise<ActionResult<Out<typeof ts.getTimesheetDetail>>> {
  return run(async () => ts.getTimesheetDetail(deps(), await ctx(), input));
}
