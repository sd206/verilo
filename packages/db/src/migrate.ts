import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export const APP_GROUP_ROLE = "verilo_app";

export interface MigrateOptions {
  /** Owner connection (MIGRATE_DATABASE_URL). Owns tables and SECURITY DEFINER functions. */
  ownerUrl: string;
  /** Runtime connection (DATABASE_URL). Its login role is created/updated and added to verilo_app. */
  appUrl: string;
  migrationsFolder: string;
  log?: (msg: string) => void;
}

/**
 * Ensures the runtime roles exist, then applies the SQL migrations.
 * Runs before every deploy (Cloud Run job `migrate`, section 24.3) and locally via `pnpm db:migrate`.
 */
export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const app = new URL(opts.appUrl);
  const appUser = decodeURIComponent(app.username);
  const appPassword = decodeURIComponent(app.password);
  if (!appUser || !appPassword) throw new Error("DATABASE_URL must include a user and password");

  const owner = new URL(opts.ownerUrl);
  if (decodeURIComponent(owner.username) === appUser) {
    throw new Error("DATABASE_URL and MIGRATE_DATABASE_URL must use different roles (RLS needs a non-owner role)");
  }

  const client = new pg.Client({ connectionString: opts.ownerUrl });
  await client.connect();
  try {
    const group = client.escapeIdentifier(APP_GROUP_ROLE);
    const login = client.escapeIdentifier(appUser);
    const password = client.escapeLiteral(appPassword);

    const g = await client.query("select 1 from pg_roles where rolname = $1", [APP_GROUP_ROLE]);
    if (g.rowCount === 0) {
      log(`creating group role ${APP_GROUP_ROLE}`);
      await client.query(`create role ${group} nologin nobypassrls`);
    }
    const l = await client.query("select 1 from pg_roles where rolname = $1", [appUser]);
    if (l.rowCount === 0) {
      log(`creating login role ${appUser}`);
      await client.query(`create role ${login} login nobypassrls password ${password}`);
    } else {
      await client.query(`alter role ${login} with login nobypassrls password ${password}`);
    }
    await client.query(`grant ${group} to ${login}`);

    log("applying migrations");
    await migrate(drizzle(client), { migrationsFolder: opts.migrationsFolder });
    log("migrations applied");
  } finally {
    await client.end();
  }
}
