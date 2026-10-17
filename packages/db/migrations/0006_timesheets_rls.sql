-- Timesheets, evidence and extraction (section 5.4, M2): integrity rules, R4 lock, tenant isolation.

-- ---------------------------------------------------------------------------
-- 1. Same-firm references (composite FKs; FK checks bypass RLS).
-- ---------------------------------------------------------------------------
ALTER TABLE timesheet ADD CONSTRAINT timesheet_firm_id_id_key UNIQUE (firm_id, id);
ALTER TABLE extraction ADD CONSTRAINT extraction_firm_id_id_key UNIQUE (firm_id, id);
ALTER TABLE inbound_email ADD CONSTRAINT inbound_email_firm_id_id_key UNIQUE (firm_id, id);

ALTER TABLE timesheet ADD CONSTRAINT timesheet_engagement_same_firm_fk FOREIGN KEY (firm_id, engagement_id) REFERENCES engagement (firm_id, id);
ALTER TABLE timesheet_entry ADD CONSTRAINT timesheet_entry_timesheet_same_firm_fk FOREIGN KEY (firm_id, timesheet_id) REFERENCES timesheet (firm_id, id);
ALTER TABLE extraction ADD CONSTRAINT extraction_file_same_firm_fk FOREIGN KEY (firm_id, file_id) REFERENCES file (firm_id, id);
ALTER TABLE evidence ADD CONSTRAINT evidence_timesheet_same_firm_fk FOREIGN KEY (firm_id, timesheet_id) REFERENCES timesheet (firm_id, id);
ALTER TABLE evidence ADD CONSTRAINT evidence_file_same_firm_fk FOREIGN KEY (firm_id, file_id) REFERENCES file (firm_id, id);
ALTER TABLE evidence ADD CONSTRAINT evidence_extraction_same_firm_fk FOREIGN KEY (firm_id, extraction_id) REFERENCES extraction (firm_id, id);
ALTER TABLE evidence ADD CONSTRAINT evidence_inbound_email_same_firm_fk FOREIGN KEY (firm_id, inbound_email_id) REFERENCES inbound_email (firm_id, id);
ALTER TABLE evidence ADD CONSTRAINT evidence_consultant_same_firm_fk FOREIGN KEY (firm_id, consultant_id) REFERENCES consultant (firm_id, id);
ALTER TABLE timesheet_check ADD CONSTRAINT timesheet_check_timesheet_same_firm_fk FOREIGN KEY (firm_id, timesheet_id) REFERENCES timesheet (firm_id, id);
ALTER TABLE inbound_email ADD CONSTRAINT inbound_email_consultant_same_firm_fk FOREIGN KEY (firm_id, matched_consultant_id) REFERENCES consultant (firm_id, id);
ALTER TABLE inbound_email ADD CONSTRAINT inbound_email_party_same_firm_fk FOREIGN KEY (firm_id, matched_party_id) REFERENCES party (firm_id, id);
ALTER TABLE ai_usage_event ADD CONSTRAINT ai_usage_event_extraction_same_firm_fk FOREIGN KEY (firm_id, extraction_id) REFERENCES extraction (firm_id, id);
ALTER TABLE ai_usage_event ADD CONSTRAINT ai_usage_event_file_same_firm_fk FOREIGN KEY (firm_id, file_id) REFERENCES file (firm_id, id);

-- ---------------------------------------------------------------------------
-- 2. Value rules (R1 hours as NUMERIC; 5.4 daily hours 0–24).
-- ---------------------------------------------------------------------------
ALTER TABLE timesheet ADD CONSTRAINT timesheet_period_valid CHECK (period_end >= period_start);
ALTER TABLE timesheet ADD CONSTRAINT timesheet_total_nonneg CHECK (total_hours >= 0);
ALTER TABLE timesheet_entry ADD CONSTRAINT timesheet_entry_hours_range CHECK (hours >= 0 AND hours <= 24);
ALTER TABLE timesheet_check ADD CONSTRAINT timesheet_check_resolution_complete CHECK (
  (resolved_at IS NULL AND resolved_by IS NULL AND resolution_reason IS NULL)
  OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND length(btrim(resolution_reason)) > 0)
);
ALTER TABLE extraction ADD CONSTRAINT extraction_confidence_range CHECK (overall_confidence IS NULL OR overall_confidence BETWEEN 0 AND 1);
ALTER TABLE ai_usage_event ADD CONSTRAINT ai_usage_event_reason CHECK (billable = (non_billable_reason IS NULL));
ALTER TABLE ai_usage_event ADD CONSTRAINT ai_usage_event_pages_nonneg CHECK (pages >= 0);
ALTER TABLE ai_usage_event ADD CONSTRAINT ai_usage_event_month CHECK (extract(day FROM usage_month) = 1);

-- ---------------------------------------------------------------------------
-- 3. R4: an INVOICED timesheet, its entries and its evidence can't change. The handlers refuse
--    first (domain/state/timesheet.ts); this trigger is the guarantee.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION timesheet_locked_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'timesheet' THEN
    IF OLD.status = 'INVOICED' AND (
      NEW.status IS DISTINCT FROM OLD.status OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
      OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end
      OR NEW.total_hours IS DISTINCT FROM OLD.total_hours OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
      OR NEW.firm_id IS DISTINCT FROM OLD.firm_id
    ) THEN
      RAISE EXCEPTION 'timesheet % is invoiced and locked', OLD.id USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  -- timesheet_entry / evidence: look at the parent timesheet of the old and new row.
  IF EXISTS (
    SELECT 1 FROM timesheet t
    WHERE t.status = 'INVOICED'
      AND t.id IN (
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.timesheet_id END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.timesheet_id END
      )
  ) THEN
    RAISE EXCEPTION 'timesheet is invoiced and locked' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER timesheet_locked_guard BEFORE UPDATE ON timesheet
  FOR EACH ROW EXECUTE FUNCTION timesheet_locked_guard();
CREATE TRIGGER timesheet_entry_locked_guard BEFORE INSERT OR UPDATE OR DELETE ON timesheet_entry
  FOR EACH ROW EXECUTE FUNCTION timesheet_locked_guard();
CREATE TRIGGER evidence_locked_guard BEFORE INSERT OR UPDATE OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION timesheet_locked_guard();

-- ---------------------------------------------------------------------------
-- 4. Privileges and RLS. Entries are replaced as a set, evidence can be removed while the
--    timesheet is editable, and checks that no longer apply are removed on re-run (all audited).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON timesheet, extraction, inbound_email, ai_usage_event, notification TO verilo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON timesheet_entry, evidence, timesheet_check TO verilo_app;

ALTER TABLE timesheet ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_email ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;

CREATE POLICY timesheet_tenant ON timesheet FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY timesheet_entry_tenant ON timesheet_entry FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY extraction_tenant ON extraction FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY inbound_email_tenant ON inbound_email FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY evidence_tenant ON evidence FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY timesheet_check_tenant ON timesheet_check FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY ai_usage_event_tenant ON ai_usage_event FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());
CREATE POLICY notification_tenant ON notification FOR ALL TO verilo_app
  USING (firm_id = app_current_firm_id()) WITH CHECK (firm_id = app_current_firm_id());

-- ---------------------------------------------------------------------------
-- 5. System lookups (SECURITY DEFINER, minimal columns).
-- ---------------------------------------------------------------------------
-- Inbound webhook: which firm and inbox an address belongs to. Addresses are compared lower-cased.
CREATE FUNCTION app_inbox_lookup(p_addresses text[])
RETURNS TABLE (firm_id uuid, inbox inbox, address text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, 'TIMESHEET'::inbox, lower(f.timesheet_inbox_address) FROM firm f
  WHERE lower(f.timesheet_inbox_address) = ANY (SELECT lower(a) FROM unnest(p_addresses) a)
  UNION ALL
  SELECT f.id, 'AP'::inbox, lower(f.ap_inbox_address) FROM firm f
  WHERE lower(f.ap_inbox_address) = ANY (SELECT lower(a) FROM unnest(p_addresses) a)
$$;
REVOKE ALL ON FUNCTION app_inbox_lookup(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_inbox_lookup(text[]) TO verilo_app;

-- Scheduled jobs: every firm and its time zone (the job then works inside each firm's RLS scope).
CREATE FUNCTION app_firms_for_jobs()
RETURNS TABLE (firm_id uuid, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.timezone FROM firm f ORDER BY f.id
$$;
REVOKE ALL ON FUNCTION app_firms_for_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_firms_for_jobs() TO verilo_app;
