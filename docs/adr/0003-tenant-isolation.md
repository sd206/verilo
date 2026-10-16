# ADR 0003 — Tenant isolation: session-derived firm, firm-scoped queries, RLS

Status: accepted

1. `FirmContext` is built only from the session (`requireFirmContext`). Handler input schemas are
   `z.strictObject`, so a client-sent `firmId` is a 400.
2. Repository functions take `firmId` and filter on it explicitly.
3. RLS is the second safeguard. Roles:
   - `verilo_owner` (migrations; owns tables and `SECURITY DEFINER` functions),
   - `verilo_app` (NOLOGIN group; table privileges), and the runtime login role (member of
     `verilo_app`, `NOBYPASSRLS`, owns nothing).
   Each request runs in a transaction with `set_config('app.firm_id' | 'app.user_id', …, true)`.
   Policies: tenant tables `firm_id = app_current_firm_id()`; `app_user`, `session`,
   `mfa_recovery_code` scoped to the user; users can read their own memberships and firms across
   firms (firm switcher). Pre-session lookups use four narrow definer functions.
4. `audit_event` is append-only for the runtime role (no UPDATE/DELETE grants). Financial and
   tenant tables have no DELETE grant.
5. Other firms' ids return 404, never 403, so existence isn't revealed.

T12 runs every handler, action and route as Firm B against Firm A's data, checks raw-SQL RLS,
and snapshots Firm A's rows before/after. A coverage guard fails when new handlers or routes
lack a case.
