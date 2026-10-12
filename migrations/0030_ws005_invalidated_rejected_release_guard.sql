-- An invalidated REJECTED attempt is not authority to free signed value.
CREATE OR REPLACE FUNCTION reject_invalidated_rejected_attempt_recovery()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('BROADCAST', 'FINALIZED', 'RELEASED', 'EXPIRED') AND EXISTS (
    SELECT 1
    FROM authorization_evidence ae
    JOIN signed_transactions s
      ON s.operation_id = ae.operation_id
     AND s.reservation_id = ae.reservation_id
     AND s.authorization_id = ae.authorization_id
    JOIN broadcast_attempts a
      ON a.signed_transaction_id = s.signed_transaction_id
     AND a.operation_id = s.operation_id
     AND a.reservation_id = s.reservation_id
     AND a.envelope_id = s.envelope_id
     AND a.envelope_revision = s.envelope_revision
     AND a.envelope_hash = s.envelope_hash
     AND a.authorization_id = s.authorization_id
     AND a.fixture_instance_id = s.fixture_instance_id
     AND a.expected_transaction_hash = s.expected_transaction_hash
    JOIN authorization_invalidations ai
      ON ai.authorization_id = ae.authorization_id
    WHERE ae.operation_id = NEW.operation_id
      AND ae.reservation_id = NEW.reservation_id
      AND a.status = 'REJECTED'
  ) THEN
    RAISE EXCEPTION 'invalidated rejected broadcast attempt cannot be advanced or released: %',
      NEW.reservation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
