/**
 * Entry point for the Cloud Run job `migrate` (runs before every deploy, section 24.7) and for
 * `pnpm db:migrate` locally. Migrations must be backward-compatible (expand, then contract).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@verilo/db/migrate";
import { createLogger } from "../logger";
import { setupJobSchema } from "../setup";

const log = createLogger({ service: "migrate" });
const ownerUrl = process.env.MIGRATE_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;

async function main() {
  if (!ownerUrl || !appUrl) throw new Error("MIGRATE_DATABASE_URL and DATABASE_URL are required");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(here, "../../../db/migrations");
  await runMigrations({ ownerUrl, appUrl, migrationsFolder, log: (m) => log.info(m) });
  await setupJobSchema(ownerUrl, (m) => log.info(m));
  log.info("migrate complete");
}

main().catch((err: unknown) => {
  log.error({ err }, "migrate failed");
  process.exit(1);
});
