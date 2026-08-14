ALTER TABLE audit_events
  ADD COLUMN reservation_id text;

DROP TRIGGER audit_events_are_append_only ON audit_events;

UPDATE audit_events
SET reservation_id = data ->> 'reservationId'
WHERE reservation_id IS NULL;

CREATE TRIGGER audit_events_are_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM audit_events
    WHERE reservation_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'audit reservation correlation is required for every persisted event'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE audit_events
  ALTER COLUMN reservation_id SET NOT NULL,
  ADD CONSTRAINT audit_events_reservation_fk
    FOREIGN KEY (reservation_id) REFERENCES budget_reservations (reservation_id);

CREATE OR REPLACE FUNCTION enforce_audit_event_correlation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT
    o.intent_id AS operation_intent_id,
    o.agent_id AS operation_agent_id,
    o.wallet_id AS operation_wallet_id,
    o.policy_id AS operation_policy_id,
    o.policy_version AS operation_policy_version,
    i.intent_id AS intent_row_id,
    i.agent_id AS intent_agent_id,
    i.wallet_id AS intent_wallet_id,
    i.policy_id AS intent_policy_id,
    i.policy_version AS intent_policy_version,
    a.owner_id AS owner_id,
    w.owner_id AS wallet_owner_id,
    p.owner_id AS policy_owner_id,
    r.operation_id AS reservation_operation_id,
    b.agent_id AS budget_agent_id,
    b.wallet_id AS budget_wallet_id,
    b.policy_id AS budget_policy_id,
    b.policy_version AS budget_policy_version
  INTO binding
  FROM budget_reservations r
  JOIN budget_accounts b ON b.budget_id = r.budget_id
  JOIN operations o ON o.operation_id = r.operation_id
  JOIN intents i ON i.intent_id = o.intent_id
  JOIN agents a ON a.agent_id = o.agent_id
  JOIN wallets w ON w.wallet_id = o.wallet_id
  JOIN policies p ON p.policy_id = o.policy_id
  WHERE r.reservation_id = NEW.reservation_id
    AND o.operation_id = NEW.operation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit reservation/operation correlation mismatch: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.data ->> 'reservationId' IS DISTINCT FROM NEW.reservation_id THEN
    RAISE EXCEPTION 'audit payload/reservation correlation mismatch: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;

  IF binding.operation_intent_id IS DISTINCT FROM binding.intent_row_id
     OR binding.operation_agent_id IS DISTINCT FROM binding.intent_agent_id
     OR binding.operation_wallet_id IS DISTINCT FROM binding.intent_wallet_id
     OR binding.operation_policy_id IS DISTINCT FROM binding.intent_policy_id
     OR binding.operation_policy_version IS DISTINCT FROM binding.intent_policy_version
     OR binding.operation_agent_id IS DISTINCT FROM binding.budget_agent_id
     OR binding.operation_wallet_id IS DISTINCT FROM binding.budget_wallet_id
     OR binding.operation_policy_id IS DISTINCT FROM binding.budget_policy_id
     OR binding.operation_policy_version IS DISTINCT FROM binding.budget_policy_version
     OR binding.owner_id IS DISTINCT FROM binding.wallet_owner_id
     OR binding.owner_id IS DISTINCT FROM binding.policy_owner_id
     OR binding.reservation_operation_id IS DISTINCT FROM NEW.operation_id
     OR NEW.intent_id IS DISTINCT FROM binding.intent_row_id
     OR NEW.agent_id IS DISTINCT FROM binding.operation_agent_id
     OR NEW.wallet_id IS DISTINCT FROM binding.operation_wallet_id
     OR NEW.policy_id IS DISTINCT FROM binding.operation_policy_id
     OR NEW.policy_version IS DISTINCT FROM binding.operation_policy_version
     OR NEW.owner_id IS DISTINCT FROM binding.owner_id THEN
    RAISE EXCEPTION 'audit persisted correlation does not match authoritative binding: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_correlation_guard
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION enforce_audit_event_correlation();
