import pg from "pg";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run a query: the root db or a transaction. */
export type Queryable = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/** Context derived from the authenticated session — never from client input (R3). */
export interface TenantContext {
  firmId: string;
  userId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) throw new Error(`${label} is not a UUID`);
}

/**
 * Runs `fn` in a transaction scoped to one firm. Sets `app.firm_id` and `app.user_id`
 * for the transaction only, so the RLS policies in 0001_rls.sql apply.
 */
export async function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(ctx.firmId, "firmId");
  assertUuid(ctx.userId, "userId");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.firm_id', ${ctx.firmId}, true), set_config('app.user_id', ${ctx.userId}, true)`,
    );
    return fn(tx);
  });
}

/** Runs `fn` in a transaction with only a user context (no firm), e.g. listing a user's firms. */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(userId, "userId");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` with no user or firm context. Only the SECURITY DEFINER lookups and the
 * non-tenant tables (verification_token, rate_limit) are reachable this way.
 */
export async function withAnonymous<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** Switches the firm/user context inside an open transaction (sign-up and invite acceptance). */
export async function setContext(tx: Tx, ctx: Partial<TenantContext>): Promise<void> {
  if (ctx.firmId !== undefined) {
    assertUuid(ctx.firmId, "firmId");
    await tx.execute(sql`select set_config('app.firm_id', ${ctx.firmId}, true)`);
  }
  if (ctx.userId !== undefined) {
    assertUuid(ctx.userId, "userId");
    await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
  }
}
