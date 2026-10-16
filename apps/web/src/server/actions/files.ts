"use server";

import { requireFirmContext } from "@verilo/auth";
import type { SignedUpload } from "@verilo/storage";
import { deps } from "../deps";
import { getAuth, requestMeta } from "../context";
import { run, type ActionResult } from "../action-result";
import * as h from "../handlers/files";

export async function requestUploadAction(input: unknown): Promise<ActionResult<{ fileId: string; upload: SignedUpload }>> {
  return run(async () => h.requestUpload(deps(), requireFirmContext(await getAuth(), await requestMeta()), input));
}

export async function completeUploadAction(input: unknown): Promise<ActionResult<h.FileView>> {
  return run(async () => h.completeUpload(deps(), requireFirmContext(await getAuth(), await requestMeta()), input));
}
