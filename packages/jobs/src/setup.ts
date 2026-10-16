import pg from "pg";
import { PgBoss } from "pg-boss";
import { APP_GROUP_ROLE } from "@verilo/db/migrate";
import { PGBOSS_SCHEMA } from "./boss";
import { QUEUES } from "./queues";

/** Installs or upgrades the pg-boss schema as the owner role and grants the runtime role access. */
export async function setupJobSchema(ownerUrl: string, log: (m: string) => void = () => {}): Promise<void> {
  const boss = new PgBoss({
    connectionString: ownerUrl,
    schema: PGBOSS_SCHEMA,
    application_name: "verilo-migrate",
    supervise: false,
    schedule: false,
  });
  boss.on("error", (e) => log(`pg-boss error: ${String(e)}`));
  await boss.start();
  for (const name of QUEUES) {
    await boss.createQueue(name);
  }
  await boss.stop({ graceful: false, close: true });

  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const schema = client.escapeIdentifier(PGBOSS_SCHEMA);
    const role = client.escapeIdentifier(APP_GROUP_ROLE);
    await client.query(`grant usage on schema ${schema} to ${role}`);
    await client.query(`grant select, insert, update, delete on all tables in schema ${schema} to ${role}`);
    await client.query(`grant usage, select on all sequences in schema ${schema} to ${role}`);
    await client.query(`grant execute on all functions in schema ${schema} to ${role}`);
    log("pg-boss schema ready");
  } finally {
    await client.end();
  }
}
