DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM audit_events WHERE canonical_payload IS NULL) THEN
    RAISE EXCEPTION
      'legacy audit rows require an explicit compatibility backfill before the v1 hash guard can be enabled'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE audit_events ALTER COLUMN canonical_payload SET NOT NULL;
