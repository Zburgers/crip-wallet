-- A durable send-capable attempt is an execution fence. Phase-1 release paths
-- must not return its reservation to available funds while execution may have
-- crossed the RPC boundary.

ALTER TABLE broadcast_attempts
  DROP CONSTRAINT broadcast_attempt_status;
ALTER TABLE broadcast_attempts
  ADD CONSTRAINT broadcast_attempt_status
  CHECK (status IN ('STARTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN', 'CONFLICT'));

CREATE OR REPLACE FUNCTION enforce_broadcast_attempt_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT s.operation_id, s.reservation_id, s.envelope_id, s.envelope_revision,
         s.envelope_hash, s.authorization_id, s.fixture_instance_id,
         s.expected_transaction_hash
  INTO binding
  FROM signed_transactions s
  WHERE s.signed_transaction_id = NEW.signed_transaction_id;

  IF NOT FOUND
     OR binding.operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.reservation_id IS DISTINCT FROM NEW.reservation_id
     OR binding.envelope_id IS DISTINCT FROM NEW.envelope_id
     OR binding.envelope_revision IS DISTINCT FROM NEW.envelope_revision
     OR binding.envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR binding.authorization_id IS DISTINCT FROM NEW.authorization_id
     OR binding.fixture_instance_id IS DISTINCT FROM NEW.fixture_instance_id
     OR binding.expected_transaction_hash IS DISTINCT FROM NEW.expected_transaction_hash THEN
    RAISE EXCEPTION 'broadcast attempt binding mismatch: %', NEW.attempt_id
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'STARTED' THEN
      RAISE EXCEPTION 'broadcast attempts must start in STARTED: %', NEW.attempt_id
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
       OR NEW.signed_transaction_id IS DISTINCT FROM OLD.signed_transaction_id
       OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
       OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
       OR NEW.envelope_id IS DISTINCT FROM OLD.envelope_id
       OR NEW.envelope_revision IS DISTINCT FROM OLD.envelope_revision
       OR NEW.envelope_hash IS DISTINCT FROM OLD.envelope_hash
       OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
       OR NEW.fixture_instance_id IS DISTINCT FROM OLD.fixture_instance_id
       OR NEW.expected_transaction_hash IS DISTINCT FROM OLD.expected_transaction_hash
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'broadcast attempt identity is immutable: %', NEW.attempt_id
        USING ERRCODE = '55000';
    END IF;
    IF OLD.status <> 'STARTED'
       OR NEW.status NOT IN ('ACCEPTED', 'REJECTED', 'UNKNOWN', 'CONFLICT') THEN
      RAISE EXCEPTION 'invalid broadcast attempt transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'ACCEPTED'
     AND NEW.response_transaction_hash IS DISTINCT FROM NEW.expected_transaction_hash THEN
    RAISE EXCEPTION 'accepted broadcast hash must match expected hash: %', NEW.attempt_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'CONFLICT'
     AND (NEW.response_transaction_hash IS NULL
          OR NEW.response_transaction_hash = NEW.expected_transaction_hash) THEN
    RAISE EXCEPTION 'conflicting broadcast hash must differ from expected hash: %', NEW.attempt_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'STARTED' AND NEW.response_transaction_hash IS NOT NULL THEN
    RAISE EXCEPTION 'started broadcast cannot carry a response hash: %', NEW.attempt_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fence_send_capable_attempt_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('HELD', 'AUTHORIZED')
     AND NEW.status IN ('RELEASED', 'EXPIRED')
     AND EXISTS (
       SELECT 1 FROM broadcast_attempts a
       WHERE a.reservation_id = OLD.reservation_id
         AND a.status IN ('STARTED', 'ACCEPTED', 'UNKNOWN', 'CONFLICT')
     ) THEN
    RAISE EXCEPTION 'send-capable broadcast attempt fences reservation release: %', OLD.reservation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Phase 2 advances the operation through signing before the reservation can
-- become BROADCAST/FINALIZED. Preserve the exact canonical evidence checks
-- while allowing only those downstream lifecycle states.
CREATE OR REPLACE FUNCTION enforce_reservation_canonical_authorization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('AUTHORIZED', 'BROADCAST', 'FINALIZED') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM authorization_evidence ae
    JOIN operations o ON o.operation_id = ae.operation_id
    JOIN agents ag ON ag.agent_id = o.agent_id
    JOIN policies p ON p.policy_id = o.policy_id
    JOIN execution_envelopes e
      ON e.operation_id = ae.operation_id
     AND e.envelope_id = ae.envelope_id
     AND e.revision = ae.envelope_revision
     AND e.envelope_hash = ae.envelope_hash
    JOIN policy_decisions pd
      ON pd.operation_id = ae.operation_id
     AND pd.decision_id = ae.policy_decision_id
     AND pd.decision_hash = ae.policy_decision_hash
     AND pd.policy_id = ae.policy_id
     AND pd.policy_version = ae.policy_version
    JOIN control_fences system_fence
      ON system_fence.scope_type = 'SYSTEM' AND system_fence.scope_id = 'system'
    JOIN control_fences owner_fence
      ON owner_fence.scope_type = 'OWNER' AND owner_fence.scope_id = ag.owner_id
    JOIN control_fences agent_fence
      ON agent_fence.scope_type = 'AGENT' AND agent_fence.scope_id = o.agent_id
    JOIN control_fences policy_fence
      ON policy_fence.scope_type = 'POLICY' AND policy_fence.scope_id = o.policy_id
    LEFT JOIN authorization_invalidations ai ON ai.authorization_id = ae.authorization_id
    WHERE ae.reservation_id = NEW.reservation_id
      AND ae.operation_id = NEW.operation_id
      AND (
        (NEW.status = 'AUTHORIZED' AND o.current_state = 'AUTHORIZED')
        OR
        (NEW.status IN ('BROADCAST', 'FINALIZED') AND o.current_state IN
          ('AUTHORIZED', 'SIGNING', 'SIGNED', 'BROADCAST', 'PENDING_CONFIRMATION',
           'CONFIRMED', 'RECONCILED'))
      )
      AND ai.authorization_id IS NULL
      AND p.status = 'active'
      AND ae.system_state = 'ACTIVE' AND ae.owner_state = 'ACTIVE'
      AND ae.agent_state = 'ACTIVE' AND ae.policy_state = 'ACTIVE'
      AND system_fence.state = 'ACTIVE' AND owner_fence.state = 'ACTIVE'
      AND agent_fence.state = 'ACTIVE' AND policy_fence.state = 'ACTIVE'
      AND system_fence.fence_version = ae.system_fence_version
      AND owner_fence.fence_version = ae.owner_fence_version
      AND agent_fence.fence_version = ae.agent_fence_version
      AND policy_fence.fence_version = ae.policy_fence_version
      AND NOT EXISTS (
        SELECT 1 FROM execution_envelopes latest
        WHERE latest.operation_id = ae.operation_id
          AND latest.revision > ae.envelope_revision
      )
  ) THEN
    RAISE EXCEPTION 'reservation authorization requires current canonical authorization evidence: %', NEW.reservation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_reservation_send_attempt_release_fence
  BEFORE UPDATE ON budget_reservations
  FOR EACH ROW EXECUTE FUNCTION fence_send_capable_attempt_release();

CREATE OR REPLACE FUNCTION bind_legacy_evidence_to_exact_attempt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT a.attempt_id, a.expected_transaction_hash,
         e.payload ->> 'nonce' AS envelope_nonce
  INTO binding
  FROM broadcast_attempts a
  JOIN execution_envelopes e
    ON e.operation_id = a.operation_id AND e.envelope_id = a.envelope_id
  WHERE a.reservation_id = NEW.reservation_id
  ORDER BY a.created_at ASC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF NEW.transaction_hash IS DISTINCT FROM binding.expected_transaction_hash
     OR NEW.nonce::text IS DISTINCT FROM binding.envelope_nonce
     OR NEW.receipt_reference IS DISTINCT FROM ('receipt:' || binding.attempt_id) THEN
    RAISE EXCEPTION 'legacy broadcast evidence does not match exact durable attempt: %', NEW.reservation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservation_broadcast_exact_attempt_guard
  BEFORE INSERT ON reservation_broadcast_evidence
  FOR EACH ROW EXECUTE FUNCTION bind_legacy_evidence_to_exact_attempt();
