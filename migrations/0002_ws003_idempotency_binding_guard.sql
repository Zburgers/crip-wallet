DROP TRIGGER idempotency_records_are_immutable ON idempotency_records;

CREATE OR REPLACE FUNCTION protect_idempotency_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immutable record: idempotency_records' USING ERRCODE = '55000';
  END IF;
  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.reservation_id IS NOT NULL AND NEW.reservation_id IS DISTINCT FROM OLD.reservation_id)
     OR (OLD.reservation_id IS NULL AND NEW.reservation_id IS NULL) THEN
    RAISE EXCEPTION 'immutable record: idempotency_records' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER idempotency_records_are_immutable
  BEFORE UPDATE OR DELETE ON idempotency_records
  FOR EACH ROW EXECUTE FUNCTION protect_idempotency_record();
