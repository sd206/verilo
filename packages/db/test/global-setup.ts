import path from "node:path";
import pg from "pg";
import { runMigrations } from "../src/migrate";
import { setupJobSchema } from "../../jobs/src/setup";
import "./setup-env";

// vite-node provides __dirname in test modules.
const HERE = __dirname;

/** Recreates the test database schema and applies all migrations once per test run. */
export default async function setup() {
  const ownerUrl = process.env.TEST_MIGRATE_DATABASE_URL!;
  const appUrl = process.env.TEST_DATABASE_URL!;
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query("drop schema if exists public cascade");
    await client.query("drop schema if exists drizzle cascade");
    await client.query("drop schema if exists pgboss cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }
  await runMigrations({ ownerUrl, appUrl, migrationsFolder: path.resolve(HERE, "../migrations") });
  await setupJobSchema(ownerUrl);
}
