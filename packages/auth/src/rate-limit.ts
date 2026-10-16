import { type Db, hitRateLimit, withAnonymous } from "@verilo/db";
import { RateLimitedError } from "./errors";

/** Section 17: rate limiting on auth and upload endpoints. Limits per fixed window. */
export const RATE_LIMITS = {
  signIn: { limit: 10, windowSeconds: 15 * 60 },
  signUp: { limit: 5, windowSeconds: 60 * 60 },
  mfa: { limit: 10, windowSeconds: 15 * 60 },
  magicLink: { limit: 5, windowSeconds: 15 * 60 },
  invite: { limit: 50, windowSeconds: 60 * 60 },
  acceptInvite: { limit: 10, windowSeconds: 15 * 60 },
  upload: { limit: 120, windowSeconds: 60 * 60 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

export async function enforceRateLimit(db: Db, name: RateLimitName, subject: string): Promise<void> {
  if (process.env.RATE_LIMIT_DISABLED === "1" && process.env.APP_ENV !== "production") return;
  const { limit, windowSeconds } = RATE_LIMITS[name];
  const count = await withAnonymous(db, (tx) => hitRateLimit(tx, `${name}:${subject}`, windowSeconds));
  if (count > limit) throw new RateLimitedError();
}
