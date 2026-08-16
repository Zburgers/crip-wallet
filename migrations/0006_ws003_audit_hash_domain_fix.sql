CREATE OR REPLACE FUNCTION verify_audit_event_hash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.canonical_payload IS NULL THEN
    RAISE EXCEPTION 'canonical audit payload is required: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.event_hash <> '0x' || encode(
    digest(
      convert_to('crip/audit-event/v1', 'UTF8') || decode('00', 'hex') ||
      convert_to(NEW.canonical_payload, 'UTF8'),
      'sha256'
    ),
    'hex'
  ) THEN
    RAISE EXCEPTION 'audit event hash does not match canonical payload: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
