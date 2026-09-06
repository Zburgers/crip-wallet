-- Permit the pre-reservation transaction pipeline to append operation-bound
-- semantic evidence. Reservation-bound lifecycle events remain fenced.
CREATE OR REPLACE FUNCTION enforce_operation_reservation_correlation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation_id IS NOT NULL
     AND NEW.reservation_id IS NULL
     AND NEW.event_type NOT IN (
       'agent.revoked', 'owner.revoked', 'policy.revoked',
       'system.paused', 'system.resumed',
       'transaction.constructed', 'transaction.decoded',
       'transaction.verified', 'transaction.simulated',
       'policy.evaluated'
     ) THEN
    RAISE EXCEPTION 'operation audit event requires reservation correlation: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
