CREATE TABLE control_fences (
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  fence_version bigint NOT NULL DEFAULT 1,
  state text NOT NULL,
  last_control_event_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_id),
  CONSTRAINT control_fences_scope_type CHECK (scope_type IN ('SYSTEM', 'OWNER', 'AGENT', 'POLICY')),
  CONSTRAINT control_fences_scope_id CHECK (scope_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'),
  CONSTRAINT control_fences_version CHECK (fence_version > 0 AND fence_version <= 9007199254740991),
  CONSTRAINT control_fences_event_id CHECK (
    last_control_event_id IS NULL OR last_control_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'
  ),
  CONSTRAINT control_fences_state CHECK (
    (scope_type = 'SYSTEM' AND state IN ('ACTIVE', 'PAUSED')) OR
    (scope_type IN ('OWNER', 'AGENT', 'POLICY') AND state IN ('ACTIVE', 'REVOKED'))
  )
);

INSERT INTO control_fences (scope_type, scope_id, state)
VALUES ('SYSTEM', 'system', 'ACTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO control_fences (scope_type, scope_id, state)
SELECT 'OWNER', owner_id, 'ACTIVE' FROM owners
ON CONFLICT DO NOTHING;
INSERT INTO control_fences (scope_type, scope_id, state)
SELECT 'AGENT', agent_id, 'ACTIVE' FROM agents
ON CONFLICT DO NOTHING;
INSERT INTO control_fences (scope_type, scope_id, state)
SELECT 'POLICY', policy_id, CASE WHEN status = 'revoked' THEN 'REVOKED' ELSE 'ACTIVE' END
FROM policies
ON CONFLICT DO NOTHING;

ALTER TABLE audit_events
  ALTER COLUMN owner_id DROP NOT NULL,
  ALTER COLUMN agent_id DROP NOT NULL,
  ALTER COLUMN wallet_id DROP NOT NULL,
  ALTER COLUMN intent_id DROP NOT NULL,
  ALTER COLUMN operation_id DROP NOT NULL,
  ALTER COLUMN policy_id DROP NOT NULL,
  ALTER COLUMN policy_version DROP NOT NULL;

ALTER TABLE audit_events DROP CONSTRAINT audit_events_type;
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_type CHECK (event_type IN (
    'intent.created', 'intent.validated', 'policy.evaluated', 'policy.denied',
    'policy.indeterminate', 'budget.reservation.created', 'budget.reservation.authorized',
    'budget.reservation.broadcast', 'budget.reservation.evidence.verified',
    'budget.reservation.released', 'budget.reservation.expired', 'budget.reservation.finalized',
    'budget.reservation.disputed', 'operation.state.changed', 'approval.requested',
    'approval.approved', 'approval.consumed', 'approval.rejected', 'approval.expired',
    'approval.revoked', 'signing.started', 'signing.failed', 'transaction.signed',
    'transaction.broadcast', 'transaction.confirmed', 'transaction.reconciled',
    'transaction.reverted', 'operation.disputed', 'agent.revoked', 'owner.revoked',
    'policy.revoked', 'system.paused', 'system.resumed', 'adapter.error'
  ));

CREATE OR REPLACE FUNCTION enforce_control_audit_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fence record;
  expected_scope text;
  expected_state text;
BEGIN
  IF NEW.event_type NOT IN (
    'agent.revoked', 'owner.revoked', 'policy.revoked',
    'system.paused', 'system.resumed'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT scope_type, scope_id, fence_version, state, last_control_event_id
  INTO fence
  FROM control_fences
  WHERE scope_type = NEW.data ->> 'scopeType'
    AND scope_id = NEW.data ->> 'scopeId';

  expected_scope := CASE
    WHEN NEW.event_type IN ('system.paused', 'system.resumed') THEN 'SYSTEM'
    WHEN NEW.event_type = 'agent.revoked' THEN 'AGENT'
    WHEN NEW.event_type = 'owner.revoked' THEN 'OWNER'
    ELSE 'POLICY'
  END;
  expected_state := CASE
    WHEN NEW.event_type = 'system.paused' THEN 'PAUSED'
    WHEN NEW.event_type = 'system.resumed' THEN 'ACTIVE'
    ELSE 'REVOKED'
  END;

  IF NOT FOUND
     OR fence.scope_type IS DISTINCT FROM expected_scope
     OR NEW.data ->> 'fenceVersion' IS DISTINCT FROM fence.fence_version::text
     OR NEW.data ->> 'controlState' IS DISTINCT FROM expected_state
     OR fence.state IS DISTINCT FROM expected_state
     OR NEW.event_id IS DISTINCT FROM fence.last_control_event_id THEN
    RAISE EXCEPTION 'control audit event does not match authoritative fence: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_control_fence_guard
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION enforce_control_audit_binding();

CREATE OR REPLACE FUNCTION enforce_operation_reservation_correlation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation_id IS NOT NULL
     AND NEW.reservation_id IS NULL
     AND NEW.event_type NOT IN (
       'agent.revoked', 'owner.revoked', 'policy.revoked',
       'system.paused', 'system.resumed'
     ) THEN
    RAISE EXCEPTION 'operation audit event requires reservation correlation: %', NEW.event_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_operation_reservation_guard
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION enforce_operation_reservation_correlation();

ALTER TABLE approval_requests
  ADD COLUMN system_fence_version bigint,
  ADD COLUMN system_state text,
  ADD COLUMN owner_fence_version bigint,
  ADD COLUMN owner_state text,
  ADD COLUMN agent_fence_version bigint,
  ADD COLUMN agent_state text,
  ADD COLUMN policy_fence_version bigint,
  ADD COLUMN policy_state text;

UPDATE approval_requests a
SET system_fence_version = system.fence_version,
    system_state = system.state,
    owner_fence_version = owner.fence_version,
    owner_state = owner.state,
    agent_fence_version = agent.fence_version,
    agent_state = agent.state,
    policy_fence_version = policy.fence_version,
    policy_state = policy.state
FROM operations o
JOIN agents ag ON ag.agent_id = o.agent_id
JOIN control_fences owner ON owner.scope_type = 'OWNER' AND owner.scope_id = ag.owner_id
JOIN control_fences agent ON agent.scope_type = 'AGENT' AND agent.scope_id = o.agent_id
JOIN control_fences policy ON policy.scope_type = 'POLICY' AND policy.scope_id = o.policy_id
JOIN control_fences system ON system.scope_type = 'SYSTEM' AND system.scope_id = 'system'
WHERE o.operation_id = a.operation_id;

-- The WP-03 approval consistency trigger is deferred. Set it immediate before
-- altering the same relation so PostgreSQL has no pending trigger events.
SET CONSTRAINTS approval_requests_state_consistency IMMEDIATE;

ALTER TABLE approval_requests
  ALTER COLUMN system_fence_version SET NOT NULL,
  ALTER COLUMN system_state SET NOT NULL,
  ALTER COLUMN owner_fence_version SET NOT NULL,
  ALTER COLUMN owner_state SET NOT NULL,
  ALTER COLUMN agent_fence_version SET NOT NULL,
  ALTER COLUMN agent_state SET NOT NULL,
  ALTER COLUMN policy_fence_version SET NOT NULL,
  ALTER COLUMN policy_state SET NOT NULL,
  ADD CONSTRAINT approval_requests_fence_versions CHECK (
    system_fence_version > 0 AND owner_fence_version > 0 AND
    agent_fence_version > 0 AND policy_fence_version > 0
  ),
  ADD CONSTRAINT approval_requests_fence_states CHECK (
    system_state IN ('ACTIVE', 'PAUSED') AND owner_state IN ('ACTIVE', 'REVOKED') AND
    agent_state IN ('ACTIVE', 'REVOKED') AND policy_state IN ('ACTIVE', 'REVOKED')
  );

ALTER TABLE approval_decisions
  ADD COLUMN system_fence_version bigint,
  ADD COLUMN system_state text,
  ADD COLUMN owner_fence_version bigint,
  ADD COLUMN owner_state text,
  ADD COLUMN agent_fence_version bigint,
  ADD COLUMN agent_state text,
  ADD COLUMN policy_fence_version bigint,
  ADD COLUMN policy_state text;

ALTER TABLE approval_decisions DISABLE TRIGGER approval_decisions_are_immutable;
UPDATE approval_decisions d
SET system_fence_version = a.system_fence_version,
    system_state = a.system_state,
    owner_fence_version = a.owner_fence_version,
    owner_state = a.owner_state,
    agent_fence_version = a.agent_fence_version,
    agent_state = a.agent_state,
    policy_fence_version = a.policy_fence_version,
    policy_state = a.policy_state
FROM approval_requests a
WHERE a.approval_id = d.approval_id;
ALTER TABLE approval_decisions ENABLE TRIGGER approval_decisions_are_immutable;

ALTER TABLE approval_decisions
  ALTER COLUMN system_fence_version SET NOT NULL,
  ALTER COLUMN system_state SET NOT NULL,
  ALTER COLUMN owner_fence_version SET NOT NULL,
  ALTER COLUMN owner_state SET NOT NULL,
  ALTER COLUMN agent_fence_version SET NOT NULL,
  ALTER COLUMN agent_state SET NOT NULL,
  ALTER COLUMN policy_fence_version SET NOT NULL,
  ALTER COLUMN policy_state SET NOT NULL,
  ADD CONSTRAINT approval_decisions_fence_versions CHECK (
    system_fence_version > 0 AND owner_fence_version > 0 AND
    agent_fence_version > 0 AND policy_fence_version > 0
  ),
  ADD CONSTRAINT approval_decisions_fence_states CHECK (
    system_state IN ('ACTIVE', 'PAUSED') AND owner_state IN ('ACTIVE', 'REVOKED') AND
    agent_state IN ('ACTIVE', 'REVOKED') AND policy_state IN ('ACTIVE', 'REVOKED')
  );

ALTER TABLE authorization_evidence
  ADD COLUMN system_fence_version bigint,
  ADD COLUMN system_state text,
  ADD COLUMN owner_fence_version bigint,
  ADD COLUMN owner_state text,
  ADD COLUMN agent_fence_version bigint,
  ADD COLUMN agent_state text,
  ADD COLUMN policy_fence_version bigint,
  ADD COLUMN policy_state text;

ALTER TABLE authorization_evidence DISABLE TRIGGER authorization_evidence_is_immutable;
UPDATE authorization_evidence e
SET system_fence_version = a.system_fence_version,
    system_state = a.system_state,
    owner_fence_version = a.owner_fence_version,
    owner_state = a.owner_state,
    agent_fence_version = a.agent_fence_version,
    agent_state = a.agent_state,
    policy_fence_version = a.policy_fence_version,
    policy_state = a.policy_state
FROM approval_requests a
WHERE a.approval_id = e.approval_id;
ALTER TABLE authorization_evidence ENABLE TRIGGER authorization_evidence_is_immutable;

ALTER TABLE authorization_evidence
  ALTER COLUMN system_fence_version SET NOT NULL,
  ALTER COLUMN system_state SET NOT NULL,
  ALTER COLUMN owner_fence_version SET NOT NULL,
  ALTER COLUMN owner_state SET NOT NULL,
  ALTER COLUMN agent_fence_version SET NOT NULL,
  ALTER COLUMN agent_state SET NOT NULL,
  ALTER COLUMN policy_fence_version SET NOT NULL,
  ALTER COLUMN policy_state SET NOT NULL,
  ADD CONSTRAINT authorization_evidence_fence_versions CHECK (
    system_fence_version > 0 AND owner_fence_version > 0 AND
    agent_fence_version > 0 AND policy_fence_version > 0
  ),
  ADD CONSTRAINT authorization_evidence_fence_states CHECK (
    system_state IN ('ACTIVE', 'PAUSED') AND owner_state IN ('ACTIVE', 'REVOKED') AND
    agent_state IN ('ACTIVE', 'REVOKED') AND policy_state IN ('ACTIVE', 'REVOKED')
  );

CREATE OR REPLACE FUNCTION enforce_approval_fence_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected record;
BEGIN
  SELECT
    system.fence_version AS system_fence_version, system.state AS system_state,
    owner.fence_version AS owner_fence_version, owner.state AS owner_state,
    agent.fence_version AS agent_fence_version, agent.state AS agent_state,
    policy.fence_version AS policy_fence_version, policy.state AS policy_state
  INTO expected
  FROM operations o
  JOIN agents ag ON ag.agent_id = o.agent_id
  JOIN control_fences owner ON owner.scope_type = 'OWNER' AND owner.scope_id = ag.owner_id
  JOIN control_fences agent ON agent.scope_type = 'AGENT' AND agent.scope_id = o.agent_id
  JOIN control_fences policy ON policy.scope_type = 'POLICY' AND policy.scope_id = o.policy_id
  JOIN control_fences system ON system.scope_type = 'SYSTEM' AND system.scope_id = 'system'
  WHERE o.operation_id = NEW.operation_id;

  IF NOT FOUND
     OR NEW.system_fence_version IS DISTINCT FROM expected.system_fence_version
     OR NEW.system_state IS DISTINCT FROM expected.system_state
     OR NEW.owner_fence_version IS DISTINCT FROM expected.owner_fence_version
     OR NEW.owner_state IS DISTINCT FROM expected.owner_state
     OR NEW.agent_fence_version IS DISTINCT FROM expected.agent_fence_version
     OR NEW.agent_state IS DISTINCT FROM expected.agent_state
     OR NEW.policy_fence_version IS DISTINCT FROM expected.policy_fence_version
     OR NEW.policy_state IS DISTINCT FROM expected.policy_state THEN
    RAISE EXCEPTION 'approval fence snapshot does not match authoritative control state: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_requests_fence_snapshot_guard
  BEFORE INSERT ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_fence_snapshot();

CREATE OR REPLACE FUNCTION enforce_approval_fence_columns_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.system_fence_version IS DISTINCT FROM OLD.system_fence_version OR
    NEW.system_state IS DISTINCT FROM OLD.system_state OR
    NEW.owner_fence_version IS DISTINCT FROM OLD.owner_fence_version OR
    NEW.owner_state IS DISTINCT FROM OLD.owner_state OR
    NEW.agent_fence_version IS DISTINCT FROM OLD.agent_fence_version OR
    NEW.agent_state IS DISTINCT FROM OLD.agent_state OR
    NEW.policy_fence_version IS DISTINCT FROM OLD.policy_fence_version OR
    NEW.policy_state IS DISTINCT FROM OLD.policy_state
  ) THEN
    RAISE EXCEPTION 'approval fence snapshot is immutable: %', NEW.approval_id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_requests_fence_columns_guard
  BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_fence_columns_immutable();

CREATE OR REPLACE FUNCTION enforce_approval_fence_evidence_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT system_fence_version, system_state, owner_fence_version, owner_state,
         agent_fence_version, agent_state, policy_fence_version, policy_state
  INTO binding
  FROM approval_requests WHERE approval_id = NEW.approval_id;
  IF NOT FOUND
     OR NEW.system_fence_version IS DISTINCT FROM binding.system_fence_version
     OR NEW.system_state IS DISTINCT FROM binding.system_state
     OR NEW.owner_fence_version IS DISTINCT FROM binding.owner_fence_version
     OR NEW.owner_state IS DISTINCT FROM binding.owner_state
     OR NEW.agent_fence_version IS DISTINCT FROM binding.agent_fence_version
     OR NEW.agent_state IS DISTINCT FROM binding.agent_state
     OR NEW.policy_fence_version IS DISTINCT FROM binding.policy_fence_version
     OR NEW.policy_state IS DISTINCT FROM binding.policy_state THEN
    RAISE EXCEPTION 'approval fence evidence binding mismatch: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_decisions_fence_binding_guard
  BEFORE INSERT ON approval_decisions
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_fence_evidence_binding();
CREATE TRIGGER authorization_evidence_fence_binding_guard
  BEFORE INSERT ON authorization_evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_approval_fence_evidence_binding();

CREATE TABLE authorization_invalidations (
  invalidation_id text PRIMARY KEY,
  authorization_id text NOT NULL UNIQUE REFERENCES authorization_evidence (authorization_id),
  operation_id text NOT NULL UNIQUE REFERENCES operations (operation_id),
  control_event_id text NOT NULL REFERENCES audit_events (event_id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT authorization_invalidations_id_format CHECK (
    invalidation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'
  ),
  CONSTRAINT authorization_invalidations_reason CHECK (length(trim(reason)) > 0)
);

CREATE OR REPLACE FUNCTION enforce_authorization_invalidation_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT e.operation_id, o.current_state, r.status AS reservation_status,
         o.agent_id AS operation_agent_id, ag.owner_id AS operation_owner_id,
         o.policy_id AS operation_policy_id,
         ae.event_type, ae.data ->> 'scopeType' AS control_scope,
         ae.data ->> 'scopeId' AS control_scope_id
  INTO binding
     FROM authorization_evidence e
     JOIN operations o ON o.operation_id = e.operation_id
     JOIN budget_reservations r ON r.operation_id = e.operation_id
     JOIN agents ag ON ag.agent_id = o.agent_id
  JOIN audit_events ae ON ae.event_id = NEW.control_event_id
  WHERE e.authorization_id = NEW.authorization_id;

  IF NOT FOUND
     OR binding.operation_id IS DISTINCT FROM NEW.operation_id
     OR (
       (binding.event_type = 'system.paused' AND binding.current_state IS DISTINCT FROM 'REVALIDATION_REQUIRED') OR
       (binding.event_type IN ('agent.revoked', 'owner.revoked', 'policy.revoked') AND binding.current_state IS DISTINCT FROM 'REVOKED')
     )
     OR binding.reservation_status IS DISTINCT FROM 'RELEASED'
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER authorization_invalidations_binding_guard
  BEFORE INSERT ON authorization_invalidations
  FOR EACH ROW EXECUTE FUNCTION enforce_authorization_invalidation_binding();

CREATE TRIGGER authorization_invalidations_are_immutable
  BEFORE UPDATE OR DELETE ON authorization_invalidations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();

-- A consumed approval remains immutable historical evidence after a control
-- fence invalidates its still-unexecuted authorization. REVOKED therefore has
-- the same evidence-count rule as REVALIDATION_REQUIRED, while its reservation
-- must still be RELEASED.
CREATE OR REPLACE FUNCTION assert_approval_operation_consistency(target_operation_id text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  operation_state text;
  reservation_status text;
  active_count integer;
  consumed_count integer;
  evidence_count integer;
  approval_row record;
  audit_count integer;
BEGIN
  SELECT current_state INTO operation_state
  FROM operations WHERE operation_id = target_operation_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT status INTO reservation_status
  FROM budget_reservations WHERE operation_id = target_operation_id;

  SELECT
    count(*) FILTER (WHERE status IN ('PENDING', 'APPROVED'))::integer,
    count(*) FILTER (WHERE status = 'CONSUMED')::integer
  INTO active_count, consumed_count
  FROM approval_requests
  WHERE operation_id = target_operation_id;

  SELECT count(*)::integer INTO evidence_count
  FROM authorization_evidence
  WHERE operation_id = target_operation_id;

  IF evidence_count <> consumed_count THEN
    RAISE EXCEPTION 'authorization evidence count does not match consumed approvals: %', target_operation_id
      USING ERRCODE = '23514';
  END IF;

  FOR approval_row IN
    SELECT approval_id, reservation_id, status, envelope_id, envelope_revision,
           envelope_hash, policy_decision_id, policy_decision_hash,
           policy_version, issued_at, expires_at
    FROM approval_requests
    WHERE operation_id = target_operation_id
  LOOP
    SELECT count(*)::integer INTO audit_count
    FROM audit_events
    WHERE operation_id = target_operation_id
      AND data ->> 'approvalId' = approval_row.approval_id
      AND data ->> 'reservationId' = approval_row.reservation_id
      AND data ->> 'envelopeId' = approval_row.envelope_id
      AND data ->> 'envelopeRevision' = approval_row.envelope_revision::text
      AND data ->> 'envelopeHash' = approval_row.envelope_hash
      AND data ->> 'policyDecisionId' = approval_row.policy_decision_id
      AND data ->> 'policyDecisionHash' = approval_row.policy_decision_hash
      AND data ->> 'policyVersion' = approval_row.policy_version::text
      AND data ->> 'issuedAt' = to_char(approval_row.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      AND data ->> 'expiresAt' = to_char(approval_row.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      AND event_type = CASE approval_row.status
        WHEN 'PENDING' THEN 'approval.requested'
        WHEN 'APPROVED' THEN 'approval.approved'
        WHEN 'REJECTED' THEN 'approval.rejected'
        WHEN 'EXPIRED' THEN 'approval.expired'
        WHEN 'REVOKED' THEN 'approval.revoked'
        WHEN 'CONSUMED' THEN 'approval.consumed'
      END;
    IF audit_count <> 1 THEN
      RAISE EXCEPTION 'approval state lacks exactly one matching audit event: %', approval_row.approval_id
        USING ERRCODE = '23514';
    END IF;
    IF approval_row.status = 'CONSUMED' AND NOT EXISTS (
      SELECT 1
      FROM audit_events ae
      JOIN authorization_evidence evidence ON evidence.approval_id = approval_row.approval_id
      WHERE ae.operation_id = target_operation_id
        AND ae.event_type = 'approval.consumed'
        AND ae.data ->> 'approvalId' = approval_row.approval_id
        AND ae.data ->> 'authorizationId' = evidence.authorization_id
        AND ae.data ->> 'consumerId' = evidence.consumer_id
        AND ae.data ->> 'consumptionNonce' = evidence.consumption_nonce
        AND ae.data ->> 'approverId' = evidence.approver_id
        AND ae.data ->> 'authorizedAt' = to_char(evidence.authorized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        AND ae.data ->> 'consumedAt' = to_char(evidence.consumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ) THEN
      RAISE EXCEPTION 'consumed approval lacks complete authorization audit evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    END IF;
    IF approval_row.status = 'APPROVED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions WHERE approval_id = approval_row.approval_id AND decision_type = 'APPROVE'
    ) THEN
      RAISE EXCEPTION 'approved approval lacks decision evidence: %', approval_row.approval_id USING ERRCODE = '23514';
    ELSIF approval_row.status = 'REJECTED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions WHERE approval_id = approval_row.approval_id AND decision_type = 'REJECT'
    ) THEN
      RAISE EXCEPTION 'rejected approval lacks decision evidence: %', approval_row.approval_id USING ERRCODE = '23514';
    ELSIF approval_row.status = 'EXPIRED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions WHERE approval_id = approval_row.approval_id AND decision_type = 'EXPIRE'
    ) THEN
      RAISE EXCEPTION 'expired approval lacks decision evidence: %', approval_row.approval_id USING ERRCODE = '23514';
    ELSIF approval_row.status = 'REVOKED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions WHERE approval_id = approval_row.approval_id AND decision_type = 'REVOKE'
    ) THEN
      RAISE EXCEPTION 'revoked approval lacks decision evidence: %', approval_row.approval_id USING ERRCODE = '23514';
    ELSIF approval_row.status = 'CONSUMED' AND (
      NOT EXISTS (SELECT 1 FROM approval_decisions WHERE approval_id = approval_row.approval_id AND decision_type = 'APPROVE')
      OR NOT EXISTS (SELECT 1 FROM approval_decisions WHERE approval_id = approval_row.approval_id AND decision_type = 'CONSUME')
    ) THEN
      RAISE EXCEPTION 'consumed approval lacks decision evidence: %', approval_row.approval_id USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF operation_state = 'AWAITING_APPROVAL' THEN
    IF active_count <> 1 OR reservation_status IS DISTINCT FROM 'HELD' THEN
      RAISE EXCEPTION 'approval state requires one active approval and held reservation: %', target_operation_id USING ERRCODE = '23514';
    END IF;
  ELSIF operation_state = 'AUTHORIZED' THEN
    IF active_count <> 0 OR consumed_count <> 1 OR evidence_count <> 1 OR reservation_status IS DISTINCT FROM 'AUTHORIZED' THEN
      RAISE EXCEPTION 'authorized operation lacks coherent consumed approval and reservation: %', target_operation_id USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM audit_events WHERE operation_id = target_operation_id AND event_type = 'budget.reservation.authorized') THEN
      RAISE EXCEPTION 'authorized operation lacks reservation audit evidence: %', target_operation_id USING ERRCODE = '23514';
    END IF;
  ELSIF operation_state = 'ENVELOPE_FINALIZED' THEN
    IF active_count <> 0 OR consumed_count <> 0 OR evidence_count <> 0 OR reservation_status IS DISTINCT FROM 'HELD' THEN
      RAISE EXCEPTION 'envelope-finalized operation lacks a held reservation or retains approval state: %', target_operation_id USING ERRCODE = '23514';
    END IF;
  ELSIF operation_state IN ('REVALIDATION_REQUIRED', 'REJECTED', 'EXPIRED', 'REVOKED') THEN
    IF active_count <> 0
       OR (operation_state IN ('REVALIDATION_REQUIRED', 'REVOKED') AND consumed_count <> evidence_count)
       OR (operation_state IN ('REJECTED', 'EXPIRED') AND (consumed_count <> 0 OR evidence_count <> 0))
       OR reservation_status IS DISTINCT FROM (CASE operation_state WHEN 'EXPIRED' THEN 'EXPIRED' ELSE 'RELEASED' END) THEN
      RAISE EXCEPTION 'terminal or revalidation operation has incoherent authorization or reservation state: %', target_operation_id USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;
