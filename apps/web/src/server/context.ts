import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireFirmContext, resolveSession, sessionCookieName, type AuthContext, type FirmContext } from "@verilo/auth";
import { deps } from "./deps";
import { isSecure } from "./env";
import { nextPathFor, type RequestMeta } from "./handlers/common";
import { metaFromHeaders } from "./context-headers";

export { metaFromHeaders };

export async function requestMeta(): Promise<RequestMeta> {
  return metaFromHeaders(await headers());
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(sessionCookieName(isSecure()))?.value;
}

export async function getAuth(): Promise<AuthContext | null> {
  return resolveSession(deps().db, await sessionToken());
}

/** For pages: returns the firm context or redirects to the right sign-in step. */
export async function requireFirmPage(): Promise<{ auth: AuthContext; ctx: FirmContext }> {
  const auth = await getAuth();
  if (!auth) redirect("/sign-in");
  if (auth.state !== "OK") redirect(nextPathFor(auth.state));
  return { auth, ctx: requireFirmContext(auth, await requestMeta()) };
}
