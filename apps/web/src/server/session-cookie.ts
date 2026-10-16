import { cookies } from "next/headers";
import { sessionCookieName, sessionCookieOptions } from "@verilo/auth";
import { isSecure } from "./env";
import type { NewSession } from "./handlers/common";

export async function setSessionCookie(s: NewSession) {
  (await cookies()).set(sessionCookieName(isSecure()), s.token, sessionCookieOptions(isSecure(), s.expiresAt));
}

export async function clearSessionCookie() {
  (await cookies()).delete(sessionCookieName(isSecure()));
}
