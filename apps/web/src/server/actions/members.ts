"use server";

import { requireFirmContext } from "@verilo/auth";
import { deps } from "../deps";
import { getAuth, requestMeta } from "../context";
import { run, type ActionResult } from "../action-result";
import { setSessionCookie } from "../session-cookie";
import * as h from "../handlers/members";

export async function inviteUserAction(
  input: unknown,
): Promise<ActionResult<{ invitationId: string; emailed: boolean; link: string | null }>> {
  return run(async () => h.inviteUser(deps(), requireFirmContext(await getAuth(), await requestMeta()), input));
}

export async function acceptInviteAction(input: unknown): Promise<ActionResult<{ next: string }>> {
  return run(async () => {
    const r = await h.acceptInvite(deps(), await requestMeta(), input);
    await setSessionCookie(r.session);
    return { next: r.next };
  });
}
