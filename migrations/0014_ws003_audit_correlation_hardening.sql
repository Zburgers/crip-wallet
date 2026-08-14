DO $$
DECLARE
  bad_event_id text;
BEGIN
  SELECT e.event_id
  INTO bad_event_id
  FROM audit_events e
  WHERE e.reservation_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM budget_reservations r
       JOIN budget_accounts b ON b.budget_id = r.budget_id
       JOIN operations o ON o.operation_id = r.operation_id
       JOIN intents i ON i.intent_id = o.intent_id
       JOIN agents a ON a.agent_id = o.agent_id
       JOIN wallets w ON w.wallet_id = o.wallet_id
       JOIN policies p ON p.policy_id = o.policy_id
       WHERE r.reservation_id = e.reservation_id
         AND r.operation_id = e.operation_id
         AND e.data ->> 'reservationId' = e.reservation_id
         AND o.intent_id = i.intent_id
         AND o.agent_id = i.agent_id
         AND o.wallet_id = i.wallet_id
         AND o.policy_id = i.policy_id
         AND o.policy_version = i.policy_version
         AND o.agent_id = b.agent_id
         AND o.wallet_id = b.wallet_id
         AND o.policy_id = b.policy_id
         AND o.policy_version = b.policy_version
         AND o.agent_id = p.agent_id
         AND o.wallet_id = p.wallet_id
         AND a.owner_id = w.owner_id
         AND a.owner_id = p.owner_id
         AND e.intent_id = i.intent_id
         AND e.agent_id = o.agent_id
         AND e.wallet_id = o.wallet_id
         AND e.policy_id = o.policy_id
         AND e.policy_version = o.policy_version
         AND e.owner_id = a.owner_id
     )
  LIMIT 1;

  IF bad_event_id IS NOT NULL THEN
    RAISE EXCEPTION
      'legacy audit correlation does not match authoritative binding: %',
      bad_event_id
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE audit_events
  ALTER COLUMN reservation_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION enforce_audit_event_correlation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  IF NEW.event_type IN (
    'budget.reservation.created',
    'budget.reservation.authorized',
    'budget.reservation.broadcast',
    'budget.reservation.evidence.verified',
    'budget.reservation.released',
    'budget.reservation.expired',
    'budget.reservation.finalized',
    'budget.reservation.disputed'
  ) AND NEW.reservation_id IS NULL THEN
    RAISE EXCEPTION 'reservation correlation required for audit event: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reservation_id IS NULL THEN
    RETURN NEW;
  END IF;

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
    p.agent_id AS policy_agent_id,
    p.wallet_id AS policy_wallet_id,
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
     OR binding.operation_agent_id IS DISTINCT FROM binding.policy_agent_id
     OR binding.operation_wallet_id IS DISTINCT FROM binding.policy_wallet_id
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
