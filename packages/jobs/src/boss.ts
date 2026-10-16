import { PgBoss } from "pg-boss";

export const PGBOSS_SCHEMA = "pgboss";

/** Runtime instance: never creates or migrates the schema (the migrate job does that as owner). */
export function createBoss(connectionString: string, opts: { supervise?: boolean; schedule?: boolean } = {}) {
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: "verilo-worker",
    migrate: false,
    createSchema: false,
    supervise: opts.supervise ?? false,
    schedule: opts.schedule ?? false,
  });
}
