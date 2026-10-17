import { describe, expect, it } from "vitest";
import { withOwnerClient } from "./testing";
import { TENANT_TABLES } from "./schema";

describe("row-level security coverage (R3)", () => {
  it("every table with a firm_id column is listed as a tenant table", async () => {
    const rows = await withOwnerClient((c) =>
      c.query<{ table_name: string }>(
        `select table_name from information_schema.columns
         where table_schema = 'public' and column_name = 'firm_id' order by table_name`,
      ),
    );
    const withFirmId = rows.rows.map((r) => r.table_name);
    expect(withFirmId.sort()).toEqual(TENANT_TABLES.filter((t) => t !== "firm").sort());
  });

  it("RLS is enabled with at least one policy on every tenant and user-owned table", async () => {
    const tables = [...TENANT_TABLES, "app_user", "session", "mfa_recovery_code"];
    const rows = await withOwnerClient((c) =>
      c.query<{ relname: string; relrowsecurity: boolean; policies: number }>(
        `select c.relname, c.relrowsecurity,
                (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = any($1)`,
        [tables],
      ),
    );
    expect(rows.rows).toHaveLength(tables.length);
    for (const r of rows.rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.policies, r.relname).toBeGreaterThan(0);
    }
  });

  it("the runtime role can't bypass RLS and doesn't own any table", async () => {
    const rows = await withOwnerClient((c) =>
      c.query<{ rolbypassrls: boolean; owns: number }>(
        `select r.rolbypassrls,
                (select count(*)::int from pg_tables t where t.schemaname = 'public' and t.tableowner = r.rolname) as owns
         from pg_roles r where r.rolname = 'verilo_app'`,
      ),
    );
    expect(rows.rows[0]).toEqual({ rolbypassrls: false, owns: 0 });
  });

  it("audit_event is append-only for the runtime role (R5)", async () => {
    const rows = await withOwnerClient((c) =>
      c.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
         where grantee = 'verilo_app' and table_schema = 'public' and table_name = 'audit_event' order by privilege_type`,
      ),
    );
    expect(rows.rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
  });

  it("only the holiday calendar and auth housekeeping tables allow DELETE (no financial or master data)", async () => {
    const rows = await withOwnerClient((c) =>
      c.query<{ table_name: string }>(
        `select table_name from information_schema.role_table_grants
         where grantee = 'verilo_app' and table_schema = 'public' and privilege_type = 'DELETE' order by table_name`,
      ),
    );
    expect(rows.rows.map((r) => r.table_name)).toEqual(["firm_holiday", "rate_limit", "session", "verification_token"]);
  });
});
