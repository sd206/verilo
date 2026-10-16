import { createDb, type Db } from "@verilo/db";
import { keyWrapperFromEnv, type KeyWrapper } from "@verilo/auth";
import { emailSenderFromEnv, type EmailSender } from "@verilo/email";
import { createLogger } from "@verilo/jobs/logger";
import { scannerFromEnv, storageFromEnv, type ObjectStorage, type VirusScanner } from "@verilo/storage";
import type { Logger } from "pino";
import { env } from "./env";

/** Everything a handler needs from the outside world. Tests build their own. */
export interface Deps {
  db: Db;
  storage: ObjectStorage;
  scanner: VirusScanner;
  email: EmailSender;
  keys: KeyWrapper;
  log: Logger;
  config: {
    appEnv: "local" | "test" | "staging" | "production";
    baseUrl: string;
    inboundDomain: string;
    magicLinkEnabled: boolean;
  };
}

const globalForDeps = globalThis as unknown as { verilo?: Deps };

export function deps(): Deps {
  if (globalForDeps.verilo) return globalForDeps.verilo;
  const e = env();
  const email = emailSenderFromEnv();
  const d: Deps = {
    db: createDb(e.DATABASE_URL).db,
    storage: storageFromEnv(),
    scanner: scannerFromEnv(),
    email,
    keys: keyWrapperFromEnv(),
    log: createLogger({ service: "web" }),
    config: {
      appEnv: e.APP_ENV,
      baseUrl: e.APP_BASE_URL.replace(/\/$/, ""),
      inboundDomain: e.INBOUND_EMAIL_DOMAIN,
      magicLinkEnabled: e.MAGIC_LINK_ENABLED === "1" && email.enabled,
    },
  };
  globalForDeps.verilo = d;
  return d;
}
