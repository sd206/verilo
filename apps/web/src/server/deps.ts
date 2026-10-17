import { createDb, type Db } from "@verilo/db";
import { keyWrapperFromEnv, type KeyWrapper } from "@verilo/auth";
import { emailSenderFromEnv, type EmailSender } from "@verilo/email";
import { createLogger } from "@verilo/jobs/logger";
import { createBoss, PgBossQueue, type JobQueue } from "@verilo/jobs";
import { extractorFromEnv, type Extractor } from "@verilo/ai";
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
  /** Background jobs (section 14). */
  jobs: JobQueue;
  /** AI extraction provider (8.1); used by the worker's extraction job. */
  extractor: Extractor;
  config: {
    appEnv: "local" | "test" | "staging" | "production";
    baseUrl: string;
    inboundDomain: string;
    magicLinkEnabled: boolean;
    /** Basic-auth password for the inbound email webhook (section 9); unset means the webhook refuses. */
    inboundWebhookSecret: string | undefined;
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
    log: createLogger({ service: process.env.APP_ROLE === "worker" ? "worker" : "web" }),
    jobs: new PgBossQueue(createBoss(e.DATABASE_URL)),
    extractor: extractorFromEnv(),
    config: {
      appEnv: e.APP_ENV,
      baseUrl: e.APP_BASE_URL.replace(/\/$/, ""),
      inboundDomain: e.INBOUND_EMAIL_DOMAIN,
      magicLinkEnabled: e.MAGIC_LINK_ENABLED === "1" && email.enabled,
      inboundWebhookSecret: e.POSTMARK_INBOUND_WEBHOOK_SECRET,
    },
  };
  globalForDeps.verilo = d;
  return d;
}
