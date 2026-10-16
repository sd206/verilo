/**
 * Auth.js (section 3) handles the magic-link flow: issuing and verifying single-use email
 * tokens and setting the session cookie. Password sign-in, TOTP, firm switching and session
 * lookup are ours (packages/auth); both paths share the same `session` table and cookie, so
 * there is one session model. See docs/adr/0002-auth-sessions.md.
 */
import NextAuth from "next-auth";
import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import type { EmailConfig } from "next-auth/providers/email";
import { sessionCookieName, SESSION_TTL_MS, sha256Hex } from "@verilo/auth";
import {
  deleteSession,
  findSessionByTokenHash,
  findUserForSignin,
  getUser,
  insertSession,
  insertVerificationToken,
  listFirmsForUser,
  normalizeEmail,
  useVerificationToken,
  withAnonymous,
  withUser,
} from "@verilo/db";
import { magicLinkEmail } from "@verilo/email";
import { deps } from "@/server/deps";
import { isSecure } from "@/server/env";

function toAdapterUser(u: { id: string; email: string; name: string }): AdapterUser {
  return { id: u.id, email: u.email, name: u.name, emailVerified: null };
}

const adapter: Adapter = {
  async createVerificationToken(t) {
    // Auth.js passes the token already hashed with AUTH_SECRET.
    await withAnonymous(deps().db, (tx) =>
      insertVerificationToken(tx, { identifier: normalizeEmail(t.identifier), tokenHash: t.token, expiresAt: t.expires }),
    );
    return t;
  },
  async useVerificationToken({ identifier, token }) {
    const row = await withAnonymous(deps().db, (tx) => useVerificationToken(tx, normalizeEmail(identifier), token));
    return row ? { identifier: row.identifier, token: row.tokenHash, expires: row.expiresAt } : null;
  },
  async getUserByEmail(email) {
    const u = await withAnonymous(deps().db, (tx) => findUserForSignin(tx, email));
    return u && u.status === "ACTIVE" ? toAdapterUser({ id: u.id, email: normalizeEmail(email), name: u.name }) : null;
  },
  async getUser(id) {
    const u = await withUser(deps().db, id, (tx) => getUser(tx, id));
    return u && u.status === "ACTIVE" ? toAdapterUser(u) : null;
  },
  async createUser() {
    // Accounts are created only by firm sign-up or invitation.
    throw new Error("Sign-up through email links is not allowed");
  },
  async updateUser(user) {
    const u = await withUser(deps().db, user.id, (tx) => getUser(tx, user.id));
    if (!u) throw new Error("user not found");
    return toAdapterUser(u);
  },
  async getUserByAccount() {
    return null;
  },
  async linkAccount() {
    throw new Error("Account linking is not supported");
  },
  async createSession({ sessionToken, userId, expires }) {
    const capped = new Date(Math.min(expires.getTime(), Date.now() + SESSION_TTL_MS));
    await withUser(deps().db, userId, async (tx) => {
      const firms = await listFirmsForUser(tx, userId);
      await insertSession(tx, {
        userId,
        tokenHash: sha256Hex(sessionToken),
        activeFirmId: firms[0]?.firmId ?? null,
        mfaVerifiedAt: null, // the magic link replaces the password, not the TOTP step
        expiresAt: capped,
        ip: null,
        userAgent: null,
      });
    });
    return { sessionToken, userId, expires: capped };
  },
  async getSessionAndUser(sessionToken) {
    const d = deps();
    const s = await withAnonymous(d.db, (tx) => findSessionByTokenHash(tx, sha256Hex(sessionToken)));
    if (!s) return null;
    const u = await withUser(d.db, s.userId, (tx) => getUser(tx, s.userId));
    if (!u) return null;
    const session: AdapterSession = { sessionToken, userId: s.userId, expires: s.expiresAt };
    return { session, user: toAdapterUser(u) };
  },
  async updateSession() {
    // Sessions have a fixed lifetime; nothing to extend.
    return null;
  },
  async deleteSession(sessionToken) {
    const d = deps();
    const s = await withAnonymous(d.db, (tx) => findSessionByTokenHash(tx, sha256Hex(sessionToken)));
    if (s) await withUser(d.db, s.userId, (tx) => deleteSession(tx, s.userId, s.id));
  },
};

const emailProvider: EmailConfig = {
  id: "email",
  type: "email",
  name: "Email",
  maxAge: 10 * 60,
  async sendVerificationRequest({ identifier, url }) {
    const d = deps();
    // Only existing ACTIVE users get a link; the caller sees the same response either way.
    const u = await withAnonymous(d.db, (tx) => findUserForSignin(tx, identifier));
    if (!u || u.status !== "ACTIVE") return;
    await d.email.send(magicLinkEmail({ to: identifier, link: url }));
  },
};

export const { handlers, signIn } = NextAuth(() => {
  const secure = isSecure();
  return {
    adapter,
    providers: [emailProvider],
    session: { strategy: "database", maxAge: SESSION_TTL_MS / 1000 },
    trustHost: true,
    secret: process.env.AUTH_SECRET,
    pages: { signIn: "/sign-in", error: "/sign-in", verifyRequest: "/sign-in?sent=1" },
    cookies: {
      sessionToken: {
        name: sessionCookieName(secure),
        options: { httpOnly: true, sameSite: "lax", path: "/", secure },
      },
    },
    callbacks: {
      redirect({ url, baseUrl }) {
        // Only same-origin redirects.
        if (url.startsWith("/")) return `${baseUrl}${url}`;
        return new URL(url).origin === baseUrl ? url : baseUrl;
      },
    },
  };
});
