CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE audit_events ADD COLUMN canonical_payload text;

CREATE OR REPLACE FUNCTION verify_audit_event_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.canonical_payload IS NULL THEN
    RAISE EXCEPTION 'canonical audit payload is required: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.event_hash <> '0x' || encode(
    digest('crip/audit-event/v1' || chr(0) || NEW.canonical_payload, 'sha256'),
    'hex'
  ) THEN
    RAISE EXCEPTION 'audit event hash does not match canonical payload: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_hash_guard
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION verify_audit_event_hash();
