# ADR 0002 — One session table shared by Auth.js and the app

Status: accepted

Auth.js's credentials provider only supports JWT sessions, which can't be revoked server-side
and make the TOTP step and firm switching awkward. We use:

- **Auth.js** only for magic links (token issue/verify, callback route, CSRF on its routes), with
  a custom adapter over our tables. `createUser` throws: accounts come only from firm sign-up or
  invitations. Links are emailed only to existing ACTIVE users; the response is identical either way.
- **Our session layer** (`packages/auth/src/session.ts`) for password sign-in, MFA, firm switching,
  sign-out and every request. Both paths write the same `session` table and cookie
  (`__Host-verilo_session`, HTTP-only, Secure, SameSite=Lax). The cookie value is never stored —
  only its SHA-256.
- A session carries `active_firm_id` and `mfa_verified_at`. `authState()` decides what the user
  may do: MFA setup is forced for ADMIN and FINANCE (section 17); a user who enabled MFA must
  pass it on every sign-in, including after a magic link.

CSRF: mutations are Next.js server actions (Origin is checked against Host); the only other
mutating routes are Auth.js's, which carry its CSRF token.

`next-auth@5` is still published as a beta (pinned to `5.0.0-beta.32`). If it stalls, the
magic-link piece is small enough to replace without touching sessions.
