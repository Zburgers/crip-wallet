-- WS-005 P3-02: classify invalidations by signed and broadcast evidence,
-- quarantine signed work before STARTED, and preserve committed attempts.

ALTER TABLE audit_events DROP CONSTRAINT audit_events_type;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_type CHECK (event_type IN (
  'intent.created', 'intent.validated', 'policy.evaluated', 'policy.denied',
  'policy.indeterminate', 'budget.reservation.created', 'budget.reservation.authorized',
  'budget.reservation.broadcast', 'budget.reservation.evidence.verified',
  'budget.reservation.released', 'budget.reservation.expired', 'budget.reservation.finalized',
  'budget.reservation.disputed', 'operation.state.changed', 'authorization.invalidated',
  'approval.requested', 'approval.approved', 'approval.consumed', 'approval.rejected',
  'approval.expired', 'approval.revoked', 'signing.started', 'signing.failed',
  'transaction.signed', 'transaction.broadcast', 'transaction.confirmed',
  'transaction.reconciled', 'transaction.reverted', 'operation.disputed',
  'agent.revoked', 'owner.revoked', 'policy.revoked', 'system.paused',
  'system.resumed', 'adapter.error', 'execution.recovery.claimed',
  'execution.recovery.ambiguous', 'execution.recovery.resolved',
  'execution.recovery.conflict', 'transaction.constructed', 'transaction.decoded',
  'transaction.verified', 'transaction.simulated', 'transaction.signing.started',
  'transaction.broadcast.attempted', 'transaction.broadcast.accepted',
  'transaction.broadcast.rejected', 'transaction.broadcast.unknown',
  'transaction.confirmation.mismatch', 'transaction.reconciliation.effect'
));

CREATE OR REPLACE FUNCTION enforce_authorization_invalidation_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT e.operation_id, o.current_state, r.status AS reservation_status,
         r.reservation_id, o.agent_id AS operation_agent_id,
         ag.owner_id AS operation_owner_id, o.policy_id AS operation_policy_id,
         s.signed_transaction_id,
         (s.signed_transaction_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM broadcast_attempts a
           WHERE a.signed_transaction_id = s.signed_transaction_id
         )) AS has_attempt,
         ae.event_type, ae.data ->> 'scopeType' AS control_scope,
         ae.data ->> 'scopeId' AS control_scope_id
  INTO binding
  FROM authorization_evidence e
  JOIN operations o ON o.operation_id = e.operation_id
  JOIN budget_reservations r ON r.operation_id = e.operation_id
    AND r.reservation_id = e.reservation_id
  JOIN agents ag ON ag.agent_id = o.agent_id
  LEFT JOIN signed_transactions s ON s.operation_id = e.operation_id
    AND s.reservation_id = e.reservation_id
    AND s.authorization_id = e.authorization_id
  JOIN audit_events ae ON ae.event_id = NEW.control_event_id
  WHERE e.authorization_id = NEW.authorization_id;

  IF NOT FOUND
     OR binding.operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.event_type NOT IN ('agent.revoked', 'owner.revoked', 'policy.revoked', 'system.paused')
     OR binding.control_scope IS NULL
     OR binding.control_scope_id IS NULL
     OR NOT (
       (binding.event_type = 'system.paused' AND binding.control_scope = 'SYSTEM' AND binding.control_scope_id = 'system') OR
       (binding.event_type = 'agent.revoked' AND binding.control_scope = 'AGENT' AND binding.control_scope_id = binding.operation_agent_id) OR
       (binding.event_type = 'owner.revoked' AND binding.control_scope = 'OWNER' AND binding.control_scope_id = binding.operation_owner_id) OR
       (binding.event_type = 'policy.revoked' AND binding.control_scope = 'POLICY' AND binding.control_scope_id = binding.operation_policy_id)
     ) THEN
    RAISE EXCEPTION 'authorization invalidation binding is not authoritative: %', NEW.invalidation_id
      USING ERRCODE = '23514';
  END IF;

  IF binding.signed_transaction_id IS NULL THEN
    IF binding.current_state IS DISTINCT FROM (CASE binding.event_type
         WHEN 'system.paused' THEN 'REVALIDATION_REQUIRED'
         ELSE 'REVOKED'
       END)
       OR binding.reservation_status IS DISTINCT FROM 'RELEASED'
       OR EXISTS (
         SELECT 1 FROM signed_transactions s
         WHERE s.operation_id = NEW.operation_id
            OR s.reservation_id = binding.reservation_id
       ) THEN
      RAISE EXCEPTION 'unsigned authorization invalidation requires the existing release state: %', NEW.invalidation_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF binding.has_attempt THEN
    IF binding.reservation_status NOT IN ('AUTHORIZED', 'BROADCAST', 'DISPUTED')
       OR binding.current_state IN ('REVALIDATION_REQUIRED', 'REVOKED', 'RECONCILED') THEN
      RAISE EXCEPTION 'invalidation cannot obstruct an existing broadcast attempt: %', NEW.invalidation_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF binding.current_state IS DISTINCT FROM 'DISPUTED'
     OR binding.reservation_status IS DISTINCT FROM 'DISPUTED' THEN
    RAISE EXCEPTION 'signed work without an attempt must be quarantined as DISPUTED: %', NEW.invalidation_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fence_send_capable_attempt_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('HELD', 'AUTHORIZED', 'DISPUTED')
     AND NEW.status IN ('RELEASED', 'EXPIRED') THEN
    IF EXISTS (
      SELECT 1 FROM broadcast_attempts a
      WHERE a.reservation_id = OLD.reservation_id
        AND a.status IN ('STARTED', 'ACCEPTED', 'UNKNOWN', 'CONFLICT')
    ) THEN
      RAISE EXCEPTION 'send-capable broadcast attempt fences reservation release: %', OLD.reservation_id
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM signed_transactions s
      WHERE s.reservation_id = OLD.reservation_id
        AND (
          OLD.status = 'DISPUTED'
          OR NOT EXISTS (
            SELECT 1 FROM broadcast_attempts a
            WHERE a.signed_transaction_id = s.signed_transaction_id
          )
        )
    ) THEN
      RAISE EXCEPTION 'signed transaction requires authenticated proven-no-send recovery before release: %', OLD.reservation_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
