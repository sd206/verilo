-- Master data (sections 5.2–5.3): integrity rules, tenant isolation and privileges.

-- ---------------------------------------------------------------------------
-- 1. Same-firm references. A plain FK would let a row point at another firm's party
--    (FK checks bypass RLS). Composite FKs on (firm_id, id) make that impossible.
-- ---------------------------------------------------------------------------
ALTER TABLE party ADD CONSTRAINT party_firm_id_id_key UNIQUE (firm_id, id);
ALTER TABLE consultant ADD CONSTRAINT consultant_firm_id_id_key UNIQUE (firm_id, id);
ALTER TABLE engagement ADD CONSTRAINT engagement_firm_id_id_key UNIQUE (firm_id, id);
ALTER TABLE file ADD CONSTRAINT file_firm_id_id_key UNIQUE (firm_id, id);

ALTER TABLE party_contact ADD CONSTRAINT party_contact_same_firm_fk FOREIGN KEY (firm_id, party_id) REFERENCES party (firm_id, id);
ALTER TABLE party_document ADD CONSTRAINT party_document_party_same_firm_fk FOREIGN KEY (firm_id, party_id) REFERENCES party (firm_id, id);
ALTER TABLE party_document ADD CONSTRAINT party_document_file_same_firm_fk FOREIGN KEY (firm_id, file_id) REFERENCES file (firm_id, id);
ALTER TABLE consultant ADD CONSTRAINT consultant_sub_vendor_same_firm_fk FOREIGN KEY (firm_id, sub_vendor_party_id) REFERENCES party (firm_id, id);
ALTER TABLE engagement ADD CONSTRAINT engagement_consultant_same_firm_fk FOREIGN KEY (firm_id, consultant_id) REFERENCES consultant (firm_id, id);
ALTER TABLE engagement ADD CONSTRAINT engagement_bill_to_same_firm_fk FOREIGN KEY (firm_id, bill_to_party_id) REFERENCES party (firm_id, id);
ALTER TABLE engagement ADD CONSTRAINT engagement_end_client_same_firm_fk FOREIGN KEY (firm_id, end_client_party_id) REFERENCES party (firm_id, id);
ALTER TABLE engagement ADD CONSTRAINT engagement_prime_same_firm_fk FOREIGN KEY (firm_id, prime_party_id) REFERENCES party (firm_id, id);
ALTER TABLE engagement ADD CONSTRAINT engagement_ip_same_firm_fk FOREIGN KEY (firm_id, implementation_partner_party_id) REFERENCES party (firm_id, id);
ALTER TABLE rate ADD CONSTRAINT rate_engagement_same_firm_fk FOREIGN KEY (firm_id, engagement_id) REFERENCES engagement (firm_id, id);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_engagement_same_firm_fk FOREIGN KEY (firm_id, engagement_id) REFERENCES engagement (firm_id, id);

-- membership/invitation → consultant (deferred from M0). Existing CONSULTANT memberships
-- created before M1 have no consultant yet, so the role check is NOT VALID (new rows only).
ALTER TABLE membership ADD CONSTRAINT membership_consultant_same_firm_fk FOREIGN KEY (firm_id, consultant_id) REFERENCES consultant (firm_id, id);
ALTER TABLE membership ADD CONSTRAINT membership_consultant_role_check
  CHECK (role <> 'CONSULTANT' OR consultant_id IS NOT NULL) NOT VALID;
ALTER TABLE invitation ADD CONSTRAINT invitation_consultant_same_firm_fk FOREIGN KEY (firm_id, consultant_id) REFERENCES consultant (firm_id, id);
ALTER TABLE invitation ADD CONSTRAINT invitation_consultant_role_check
  CHECK (role <> 'CONSULTANT' OR consultant_id IS NOT NULL) NOT VALID;

-- ---------------------------------------------------------------------------
-- 2. Value rules (R1 money as integer cents; dates inclusive).
-- ---------------------------------------------------------------------------
ALTER TABLE rate ADD CONSTRAINT rate_cents_positive CHECK (rate_cents > 0);
ALTER TABLE rate ADD CONSTRAINT rate_range_valid CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE engagement ADD CONSTRAINT engagement_range_valid CHECK (end_date IS NULL OR end_date >= start_date);
ALTER TABLE engagement ADD CONSTRAINT engagement_biweekly_anchor
  CHECK ((timesheet_cycle <> 'BIWEEKLY' AND invoice_cycle <> 'BIWEEKLY') OR biweekly_anchor_date IS NOT NULL);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_amount_nonneg CHECK (amount_cents IS NULL OR amount_cents >= 0);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_range_valid CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
ALTER TABLE party ADD CONSTRAINT party_deduction_range CHECK (standard_deduction_bps IS NULL OR standard_deduction_bps BETWEEN 0 AND 10000);
ALTER TABLE party ADD CONSTRAINT party_code_format CHECK (code IS NULL OR code ~ '^[A-Z0-9]{2,10}$');
ALTER TABLE consultant ADD CONSTRAINT consultant_contractor_sub_vendor
  CHECK ((employment_type = 'CONTRACTOR') = (sub_vendor_party_id IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 3. Rates never overlap per (engagement, side, rate_kind) — section 5.3. The domain checks
--    first (friendly message); this constraint is the guarantee.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE rate ADD CONSTRAINT rate_no_overlap EXCLUDE USING gist (
  engagement_id WITH =,
  side WITH =,
  rate_kind WITH =,
  daterange(effective_from, effective_to, '[]') WITH &&
);

-- ---------------------------------------------------------------------------
-- 4. A consultant email belongs to one consultant per firm (5.3 "unique per firm").
--    Array elements can't have a unique index, so a trigger checks under a per-firm lock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION consultant_emails_unique() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_dup text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('consultant_emails:' || NEW.firm_id::text, 0));
  SELECT e INTO v_dup
  FROM consultant c, unnest(c.emails) AS e
  WHERE c.firm_id = NEW.firm_id AND c.id <> NEW.id AND e = ANY (NEW.emails)
  LIMIT 1;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'consultant email % is already used by another consultant', v_dup
      USING ERRCODE = '23505', CONSTRAINT = 'consultant_emails_unique';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER consultant_emails_unique
  BEFORE INSERT OR UPDATE OF emails ON consultant
  FOR EACH ROW EXECUTE FUNCTION consultant_emails_unique();

-- ---------------------------------------------------------------------------
-- 5. Privileges and RLS. Master data is never hard-deleted (archived_at); the holiday
--    calendar is replaced as a set, so it allows DELETE.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON party, party_contact, party_document, consultant, engagement, rate, purchase_order TO verilo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON firm_holiday TO verilo_app;

ALTER TABLE party ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_holiday ENABLE ROW LEVEL SECURITY;

CREATE POLICY party_tenant ON party FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY party_contact_tenant ON party_contact FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY party_document_tenant ON party_document FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY consultant_tenant ON consultant FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY engagement_tenant ON engagement FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY rate_tenant ON rate FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY purchase_order_tenant ON purchase_order FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY firm_holiday_tenant ON firm_holiday FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());

-- The invitation lookup now also returns the consultant link.
DROP FUNCTION IF EXISTS app_invitation_by_token(text);
CREATE FUNCTION app_invitation_by_token(p_token_hash text)
RETURNS TABLE (id uuid, firm_id uuid, email text, role role, consultant_id uuid, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.firm_id, i.email, i.role, i.consultant_id, i.expires_at, i.accepted_at, i.revoked_at
  FROM invitation i WHERE i.token_hash = p_token_hash
$$;
REVOKE ALL ON FUNCTION app_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_invitation_by_token(text) TO verilo_app;
