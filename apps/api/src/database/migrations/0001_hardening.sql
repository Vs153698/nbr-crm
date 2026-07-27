-- ═══════════════════════════════════════════════════════════════════════════
--  0001_hardening — the guarantees Drizzle's schema DSL cannot express
--
--  Everything here enforces a promise made in the requirements at the database
--  level rather than the application level, so a bug in a service, a stray
--  psql session, or a compromised API process still cannot break it.
-- ═══════════════════════════════════════════════════════════════════════════

--------------------------------------------------------------------------------
-- 1. Business ID sequences (P1-08: NBRAP#### / NBRR####)
--------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS applicant_code_seq START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS record_code_seq START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS dsr_reference_seq START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS breach_reference_seq START WITH 1 INCREMENT BY 1;
--> statement-breakpoint

-- Certificate and invoice numbers are financial-year scoped, so they need one
-- counter per year. A table + row lock is used instead of a sequence per year
-- because sequences cannot be created transactionally on demand.
CREATE TABLE IF NOT EXISTS number_series (
  series      varchar(40)  NOT NULL,
  scope       varchar(20)  NOT NULL,
  next_value  integer      NOT NULL DEFAULT 1,
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (series, scope)
);
--> statement-breakpoint

COMMENT ON TABLE number_series IS 'Financial-year scoped counters for certificate and invoice numbers. Rows are locked FOR UPDATE while allocating so two concurrent issues can never take the same number.';
--> statement-breakpoint

CREATE OR REPLACE FUNCTION next_in_series(p_series varchar, p_scope varchar)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO number_series (series, scope, next_value)
  VALUES (p_series, p_scope, 1)
  ON CONFLICT (series, scope) DO NOTHING;

  UPDATE number_series
     SET next_value = next_value + 1,
         updated_at = now()
   WHERE series = p_series AND scope = p_scope
  RETURNING next_value - 1 INTO v_next;

  RETURN v_next;
END;
$$;
--> statement-breakpoint

--------------------------------------------------------------------------------
-- 2. Money correctness (§9)
--    "final amount computed and checked (amount + GST - discount)"
--    A CHECK constraint means no code path — not an import, not a migration,
--    not a manual UPDATE — can persist an invoice whose total is wrong.
--------------------------------------------------------------------------------
ALTER TABLE payments
  ADD CONSTRAINT payments_amounts_non_negative
    CHECK (amount >= 0 AND discount >= 0 AND gst_amount >= 0 AND final_amount >= 0),
  ADD CONSTRAINT payments_discount_within_amount
    CHECK (discount <= amount),
  ADD CONSTRAINT payments_taxable_value_correct
    CHECK (taxable_value = amount - discount),
  ADD CONSTRAINT payments_final_amount_correct
    CHECK (final_amount = taxable_value + gst_amount),
  ADD CONSTRAINT payments_paid_within_final
    CHECK (amount_paid <= final_amount);
--> statement-breakpoint

ALTER TABLE payment_transactions
  ADD CONSTRAINT payment_transactions_sign
    CHECK ((is_reversal = false AND amount > 0) OR (is_reversal = true AND amount < 0));
--> statement-breakpoint

ALTER TABLE invoices
  ADD CONSTRAINT invoices_final_amount_correct
    CHECK (final_amount = amount - discount + gst_amount);
--> statement-breakpoint

--------------------------------------------------------------------------------
-- 3. Workflow & lifecycle integrity
--------------------------------------------------------------------------------
ALTER TABLE achievements
  ADD CONSTRAINT achievements_participants_positive CHECK (participant_count >= 1),
  ADD CONSTRAINT achievements_group_has_participants
    CHECK (record_type <> 'group' OR participant_count > 1);
--> statement-breakpoint

ALTER TABLE blacklists
  ADD CONSTRAINT blacklists_temporary_has_end
    CHECK (kind <> 'temporary' OR effective_until IS NOT NULL),
  ADD CONSTRAINT blacklists_permanent_has_no_end
    CHECK (kind <> 'permanent' OR effective_until IS NULL);
--> statement-breakpoint

ALTER TABLE certificate_versions
  ADD CONSTRAINT certificate_versions_positive CHECK (version >= 1);
--> statement-breakpoint

ALTER TABLE dispatches
  ADD CONSTRAINT dispatches_delivered_after_dispatch
    CHECK (delivered_on IS NULL OR dispatched_on IS NULL OR delivered_on >= dispatched_on);
--> statement-breakpoint

--------------------------------------------------------------------------------
-- 4. DPDP Act, 2023 integrity
--------------------------------------------------------------------------------
ALTER TABLE data_principal_requests
  ADD CONSTRAINT dsr_due_after_received CHECK (due_at > received_at);
--> statement-breakpoint

-- §8(5): a breach cannot be closed without recording that the Board was
-- notified. Closing one that was never notified requires a written root cause
-- explaining why notification was not required.
ALTER TABLE breach_register
  ADD CONSTRAINT breach_notify_after_detected CHECK (notify_due_at > detected_at),
  ADD CONSTRAINT breach_closure_requires_notification
    CHECK (closed_at IS NULL OR board_notified_at IS NOT NULL OR root_cause IS NOT NULL);
--> statement-breakpoint

-- §9: a child's consent must name a guardian.
ALTER TABLE consent_records
  ADD CONSTRAINT consent_child_requires_guardian
    CHECK (is_child_consent = false OR guardian_name IS NOT NULL);
--> statement-breakpoint

ALTER TABLE retention_policies
  ADD CONSTRAINT retention_months_positive CHECK (retain_months > 0);
--> statement-breakpoint

--------------------------------------------------------------------------------
-- 5. Append-only enforcement (§13 timeline, §23 audit logs, §10 certificate
--    versions, §21 consent, and the DPDP evidence tables)
--
--    "Timeline must be read-only." / "Audit Logs cannot be edited or deleted."
--    A trigger is used rather than only a GRANT because the application
--    connects as the table owner in most deployments, and an owner bypasses
--    column privileges. This blocks the owner too.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted on this table', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Append a correcting row instead of modifying history.';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER timeline_events_append_only
  BEFORE UPDATE OR DELETE ON timeline_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- "Old certificates should never be deleted."
CREATE TRIGGER certificate_versions_append_only
  BEFORE UPDATE OR DELETE ON certificate_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- The edit history of a note cannot itself be edited.
CREATE TRIGGER note_revisions_append_only
  BEFORE UPDATE OR DELETE ON note_revisions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- DPDP evidence tables. These are what NBR would show the Data Protection
-- Board; a system that can rewrite them proves nothing.
CREATE TRIGGER consent_records_append_only
  BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

CREATE TRIGGER pii_access_log_append_only
  BEFORE UPDATE OR DELETE ON pii_access_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

CREATE TRIGGER erasure_log_append_only
  BEFORE UPDATE OR DELETE ON erasure_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- login_attempts feeds lockout decisions; rewriting it would hide an attack.
CREATE TRIGGER login_attempts_append_only
  BEFORE UPDATE OR DELETE ON login_attempts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION forbid_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

-- Notes are editable (a revision is written), but never deletable (§14).
CREATE TRIGGER notes_no_delete
  BEFORE DELETE ON notes
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint

-- Evidence vault: "Files should remain attached permanently. No overwriting."
CREATE TRIGGER evidence_files_no_delete
  BEFORE DELETE ON evidence_files
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
--> statement-breakpoint

--------------------------------------------------------------------------------
-- 6. updated_at maintenance
--    Set in the database so a service that forgets to touch it cannot produce a
--    stale value — and optimistic locking depends on this being truthful.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'roles', 'applicants', 'applicant_identifiers', 'blacklists',
    'records', 'achievements', 'categories', 'statuses', 'status_transitions',
    'certificates', 'publications', 'dispatches', 'packages', 'payments',
    'notes', 'tasks', 'templates', 'settings', 'couriers', 'saved_views',
    'data_principal_requests', 'breach_register', 'retention_policies',
    'integration_events'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
      t, t
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

--------------------------------------------------------------------------------
-- 7. Search indexes (§17 global search, §18 duplicate detection)
--
--    drizzle-kit cannot express `gin_trgm_ops`, so the trigram indexes that
--    make fuzzy search fast at 100k+ rows are declared here. Target from the
--    performance budget: global search p95 < 120 ms.
--------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS applicants_name_trgm_idx ON applicants USING gin (name_normalised gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS applicants_full_name_trgm_idx ON applicants USING gin (full_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS applicants_mobile_trgm_idx ON applicants USING gin (mobile gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS applicants_email_trgm_idx ON applicants USING gin (email gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS applicants_code_trgm_idx ON applicants USING gin (applicant_code gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS achievements_title_trgm_idx ON achievements USING gin (record_title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_code_trgm_idx ON records USING gin (record_code gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS certificates_number_trgm_idx ON certificates USING gin (certificate_number gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dispatches_tracking_trgm_idx ON dispatches USING gin (tracking_number gin_trgm_ops);
--> statement-breakpoint

-- Covering index for the applicant list's default ordering, so the hot path is
-- an index-only scan (§3 list, §7 p95 < 150 ms).
CREATE INDEX IF NOT EXISTS records_list_covering_idx
  ON records (updated_at DESC, id)
  INCLUDE (applicant_id, status, assigned_to_user_id, payment_status, delivery_status)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

--------------------------------------------------------------------------------
-- 8. Documentation left in the database itself
--------------------------------------------------------------------------------
COMMENT ON TABLE applicants IS 'Master person profile. One person = one row, forever (§4). A repeat applicant gets a new row in records, never a new row here.';
--> statement-breakpoint
COMMENT ON TABLE timeline_events IS 'Append-only activity log per record (§13). UPDATE and DELETE are blocked by trigger — correct history by appending, never by editing.';
--> statement-breakpoint
COMMENT ON TABLE audit_logs IS 'Append-only audit trail (§23). Immutable by trigger.';
--> statement-breakpoint
COMMENT ON TABLE consent_records IS 'DPDP §6 consent ledger. Append-only: granting, re-granting and withdrawing all insert rows, so the state of consent at any past date is recoverable.';
--> statement-breakpoint
COMMENT ON TABLE pii_access_log IS 'DPDP §8(4). Every decryption of a government identifier and every download of a sensitive file, with the justification the user gave.';
--> statement-breakpoint
COMMENT ON TABLE applicant_identifiers IS 'Aadhaar / passport / PAN, encrypted with AES-256-GCM before insert. Split from applicants so an accidental SELECT * in a report cannot leak them.';
