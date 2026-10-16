"use server";

import { redirect } from "next/navigation";
import { enforceRateLimit, revokeSession, ValidationError } from "@verilo/auth";
import { signIn as authJsSignIn } from "@/auth";
import { deps } from "../deps";
import { getAuth, requestMeta } from "../context";
import { run, type ActionResult } from "../action-result";
import { clearSessionCookie, setSessionCookie } from "../session-cookie";
import * as h from "../handlers/auth";
import { email as emailSchema } from "../handlers/common";

export async function signUpFirmAction(input: unknown): Promise<ActionResult<{ next: string }>> {
  return run(async () => {
    const r = await h.signUpFirm(deps(), await requestMeta(), input);
    await setSessionCookie(r.session);
    return { next: r.next };
  });
}

export async function signInAction(input: unknown): Promise<ActionResult<{ next: string }>> {
  return run(async () => {
    const r = await h.signInWithPassword(deps(), await requestMeta(), input);
    await setSessionCookie(r.session);
    return { next: r.next };
  });
}

export async function requestMagicLinkAction(input: unknown): Promise<ActionResult<{ sent: true }>> {
  return run(async () => {
    const d = deps();
    if (!d.config.magicLinkEnabled) throw new ValidationError("Email sign-in links are not available");
    const parsed = emailSchema.safeParse((input as { email?: unknown })?.email);
    if (!parsed.success) throw new ValidationError("Enter a valid email");
    const meta = await requestMeta();
    await enforceRateLimit(d.db, "magicLink", `ip:${meta.ip ?? "unknown"}`);
    await enforceRateLimit(d.db, "magicLink", `email:${parsed.data}`);
    // Auth.js sends the link only for existing ACTIVE users (see auth.ts signIn callback);
    // the response is the same either way.
    await authJsSignIn("email", { email: parsed.data, redirect: false, redirectTo: "/after-sign-in" });
    return { sent: true as const };
  });
}

export async function enableMfaAction(input: unknown): Promise<ActionResult<{ recoveryCodes: string[]; next: string }>> {
  return run(async () => h.enableMfa(deps(), await requestMeta(), await getAuth(), input));
}

export async function verifyMfaAction(input: unknown): Promise<ActionResult<{ next: string }>> {
  return run(async () => h.verifyMfa(deps(), await getAuth(), input));
}

export async function switchFirmAction(input: unknown): Promise<ActionResult<{ next: string }>> {
  return run(async () => h.switchFirm(deps(), await getAuth(), input));
}

export async function signOutAction(): Promise<void> {
  const auth = await getAuth();
  if (auth) await revokeSession(deps().db, { sessionId: auth.sessionId, userId: auth.user.id });
  await clearSessionCookie();
  redirect("/sign-in");
}
