import { TENANT_TABLES } from "./schema";
import pg from "pg";

/** Owner-role client for test assertions that must see every firm's rows. */
export async function withOwnerClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.TEST_MIGRATE_DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Snapshot of all rows of a firm across tenant tables, for "changes nothing" assertions (T12). */
export async function snapshotFirm(firmId: string): Promise<Record<string, unknown[]>> {
  return withOwnerClient(async (c) => {
    const out: Record<string, unknown[]> = {};
    out.firm = (await c.query("select * from firm where id = $1", [firmId])).rows;
    for (const t of TENANT_TABLES.filter((t) => t !== "firm")) {
      out[t] = (await c.query(`select * from ${t} where firm_id = $1 order by id`, [firmId])).rows;
    }
    out.app_user = (
      await c.query(
        "select u.* from app_user u join membership m on m.user_id = u.id where m.firm_id = $1 order by u.id",
        [firmId],
      )
    ).rows;
    return out;
  });
}
