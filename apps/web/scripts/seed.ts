/**
 * `pnpm db:seed` — loads section 18.1 into the local database. Needs docker compose running
 * (MinIO and ClamAV: the seed's W-9 and COI go through the normal upload and virus scan).
 */
import pino from "pino";
import { createDb } from "@verilo/db";
import { keyWrapperFromEnv } from "@verilo/auth";
import { DisabledSender } from "@verilo/email";
import { scannerFromEnv, storageFromEnv } from "@verilo/storage";
import { runSeed } from "../src/server/seed";

const appEnv = (process.env.APP_ENV ?? "local") as "local" | "test" | "staging" | "production";
if (appEnv === "staging" || appEnv === "production") {
  console.error("Refusing to seed: APP_ENV is " + appEnv);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const password = process.env.SEED_PASSWORD ?? "lonestar-dev-password";

const handle = createDb(url, { max: 2 });
try {
  const r = await runSeed(
    {
      db: handle.db,
      storage: storageFromEnv(),
      scanner: scannerFromEnv(),
      // Outbound email off, so invite links come back to the seed instead of being emailed.
      email: new DisabledSender(),
      keys: keyWrapperFromEnv(),
      log: pino({ level: "warn" }),
      config: {
        appEnv,
        baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
        inboundDomain: process.env.INBOUND_EMAIL_DOMAIN ?? "inbound.localhost",
        magicLinkEnabled: false,
      },
    },
    password,
  );
  if (r.status === "already-seeded") {
    console.log("Already seeded (admin@lonestar.test exists). Reset the database to seed again.");
  } else {
    console.log("Seeded Lonestar Data Consulting (section 18.1).\n");
    console.log(`Password for every seed user: ${r.password}`);
    console.log("Users: admin@, manager@, finance@, ravi@, meera@lonestar.test");
    console.log("\nAuthenticator keys (add to your authenticator app):");
    for (const [email, secret] of Object.entries(r.totpSecrets)) console.log(`  ${email}: ${secret}`);
  }
} finally {
  await handle.close();
}
