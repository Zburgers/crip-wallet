CREATE OR REPLACE FUNCTION protect_broadcast_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immutable record: reservation_broadcast_evidence' USING ERRCODE = '55000';
  END IF;
  IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash
     OR NEW.nonce IS DISTINCT FROM OLD.nonce
     OR NEW.receipt_reference IS DISTINCT FROM OLD.receipt_reference
     OR NEW.verification_source IS DISTINCT FROM OLD.verification_source THEN
    RAISE EXCEPTION 'immutable record: reservation_broadcast_evidence' USING ERRCODE = '55000';
  END IF;
  IF OLD.verification_status = 'VERIFIED'
     OR NEW.verification_status IS DISTINCT FROM 'VERIFIED'
     OR NEW.verified_at IS NULL
     OR NEW.verified_by IS NULL THEN
    RAISE EXCEPTION 'invalid broadcast evidence verification transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
