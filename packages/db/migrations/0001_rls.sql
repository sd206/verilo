-- Row-level security (R3 second safeguard) and privileges for the runtime role.
--
-- The application connects as a login role that is a member of `verilo_app` (created by
-- the migrate script before migrations run). `verilo_app` does not own any table, so RLS
-- applies to it. Migrations run as the owner role, which owns the tables and the
-- SECURITY DEFINER functions below.
--
-- Each request runs in a transaction that sets:
--   app.firm_id  the firm from the authenticated session (never from client input)
--   app.user_id  the authenticated user

CREATE OR REPLACE FUNCTION app_current_firm_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.firm_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO verilo_app;

GRANT SELECT, INSERT, UPDATE ON firm, app_user, membership, invitation, file TO verilo_app;
-- audit_event is append-only for the application.
GRANT SELECT, INSERT ON audit_event TO verilo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON session, verification_token, rate_limit TO verilo_app;
GRANT SELECT, INSERT, UPDATE ON mfa_recovery_code TO verilo_app;
GRANT EXECUTE ON FUNCTION app_current_firm_id(), app_current_user_id() TO verilo_app;

-- ---------------------------------------------------------------------------
-- tenant tables
-- ---------------------------------------------------------------------------
ALTER TABLE firm ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE file ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation ENABLE ROW LEVEL SECURITY;

-- firm: the active firm, plus firms the user belongs to (read-only, for the firm switcher).
CREATE POLICY firm_select ON firm FOR SELECT TO verilo_app
  USING (
    id = app_current_firm_id()
    OR id IN (SELECT m.firm_id FROM membership m WHERE m.user_id = app_current_user_id())
  );
CREATE POLICY firm_insert ON firm FOR INSERT TO verilo_app
  WITH CHECK (id = app_current_firm_id());
CREATE POLICY firm_update ON firm FOR UPDATE TO verilo_app
  USING (id = app_current_firm_id())
  WITH CHECK (id = app_current_firm_id());

-- membership: rows of the active firm; a user can also read their own memberships in other firms.
CREATE POLICY membership_tenant ON membership FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id())
  WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY membership_own_select ON membership FOR SELECT TO verilo_app
  USING (user_id = app_current_user_id());

CREATE POLICY audit_event_tenant ON audit_event FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id())
  WITH CHECK (firm_id = app_current_firm_id());

CREATE POLICY file_tenant ON file FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id())
  WITH CHECK (firm_id = app_current_firm_id());

CREATE POLICY invitation_tenant ON invitation FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id())
  WITH CHECK (firm_id = app_current_firm_id());

-- ---------------------------------------------------------------------------
-- user-owned tables
-- ---------------------------------------------------------------------------
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_code ENABLE ROW LEVEL SECURITY;

-- app_user: yourself, plus members of the active firm (read-only).
CREATE POLICY app_user_self ON app_user FOR ALL TO verilo_app
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());
CREATE POLICY app_user_firm_select ON app_user FOR SELECT TO verilo_app
  USING (id IN (SELECT m.user_id FROM membership m WHERE m.firm_id = app_current_firm_id()));

CREATE POLICY session_self ON session FOR ALL TO verilo_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

CREATE POLICY mfa_recovery_code_self ON mfa_recovery_code FOR ALL TO verilo_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- verification_token and rate_limit hold no tenant or user data (hashed tokens, counters)
-- and are reached only before a user is known, so they have no RLS.

-- ---------------------------------------------------------------------------
-- narrow SECURITY DEFINER entry points for the steps that happen before a session
-- or firm context exists. Each returns the minimum needed.
-- ---------------------------------------------------------------------------

-- Sign-in (password or magic link): look a user up by email.
CREATE OR REPLACE FUNCTION app_user_for_signin(p_email text)
RETURNS TABLE (id uuid, name text, password_hash text, mfa_secret text, mfa_enabled_at timestamptz, status user_status)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.name, u.password_hash, u.mfa_secret, u.mfa_enabled_at, u.status
  FROM app_user u WHERE u.email = lower(trim(p_email))
$$;

-- Session cookie lookup: returns the session only if it has not expired.
CREATE OR REPLACE FUNCTION app_session_by_token(p_token_hash text)
RETURNS TABLE (id uuid, user_id uuid, active_firm_id uuid, mfa_verified_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.user_id, s.active_firm_id, s.mfa_verified_at, s.expires_at
  FROM session s WHERE s.token_hash = p_token_hash AND s.expires_at > now()
$$;

-- Invitation link lookup: returns the invitation and its firm id so the caller can then
-- open a transaction scoped to that firm.
CREATE OR REPLACE FUNCTION app_invitation_by_token(p_token_hash text)
RETURNS TABLE (id uuid, firm_id uuid, email text, role role, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.firm_id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at
  FROM invitation i WHERE i.token_hash = p_token_hash
$$;

-- Inviting someone who may already be a user of another firm: returns the user id,
-- creating an INVITED user if the email is new. Requires a firm context and only
-- returns an id, never another firm's data.
CREATE OR REPLACE FUNCTION app_find_or_create_invited_user(p_email text, p_name text, p_created_by uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_email text := lower(trim(p_email));
BEGIN
  IF app_current_firm_id() IS NULL THEN
    RAISE EXCEPTION 'firm context required' USING ERRCODE = '42501';
  END IF;
  SELECT u.id INTO v_id FROM app_user u WHERE u.email = v_email;
  IF v_id IS NULL THEN
    INSERT INTO app_user (email, name, status, created_by)
    VALUES (v_email, p_name, 'INVITED', p_created_by)
    RETURNING app_user.id INTO v_id;
  END IF;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION app_user_for_signin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_session_by_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_invitation_by_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_find_or_create_invited_user(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_for_signin(text) TO verilo_app;
GRANT EXECUTE ON FUNCTION app_session_by_token(text) TO verilo_app;
GRANT EXECUTE ON FUNCTION app_invitation_by_token(text) TO verilo_app;
GRANT EXECUTE ON FUNCTION app_find_or_create_invited_user(text, text, uuid) TO verilo_app;
