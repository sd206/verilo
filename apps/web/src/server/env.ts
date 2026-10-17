import { z } from "zod";

/** Runtime configuration (section 24.5). Secrets come from Secret Manager as env vars. */
const schema = z.object({
  APP_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
  APP_BASE_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  INBOUND_EMAIL_DOMAIN: z.string().default("inbound.localhost"),
  MAGIC_LINK_ENABLED: z.enum(["0", "1"]).default("1"),
  POSTMARK_INBOUND_WEBHOOK_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

export function isSecure(): boolean {
  return env().APP_BASE_URL.startsWith("https://");
}
