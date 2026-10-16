import { z } from "zod";
import { ValidationError, type AuthContext, type FirmContext } from "@verilo/auth";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface NewSession {
  token: string;
  expiresAt: Date;
}

/** Validates input with a strict Zod schema: unknown keys (e.g. a client-sent firmId) are rejected. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new ValidationError(first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input");
  }
  return r.data;
}

export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const uuid = z.uuid();

/** Next page for a signed-in user, from their auth state. */
export function nextPathFor(state: AuthContext["state"]): string {
  switch (state) {
    case "MFA_REQUIRED":
      return "/mfa/verify";
    case "MFA_SETUP_REQUIRED":
      return "/mfa/setup";
    case "NO_FIRM":
      return "/no-firm";
    case "DISABLED":
      return "/sign-in?error=disabled";
    default:
      return "/app";
  }
}

export type { AuthContext, FirmContext };
