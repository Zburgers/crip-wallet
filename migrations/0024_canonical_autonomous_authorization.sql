-- P2-05D-PRE-A: keep one canonical authorization root while separating
-- human approval evidence from persisted autonomous policy authority.

ALTER TABLE authorization_evidence
  ADD COLUMN authorization_kind text NOT NULL DEFAULT 'OWNER_APPROVAL';

ALTER TABLE authorization_evidence
  ALTER COLUMN approval_id DROP NOT NULL,
  ALTER COLUMN approver_id DROP NOT NULL;

ALTER TABLE authorization_evidence
  ADD CONSTRAINT authorization_evidence_kind CHECK (
    authorization_kind IN ('OWNER_APPROVAL', 'AUTONOMOUS_POLICY')
  ),
  ADD CONSTRAINT authorization_evidence_exclusive_shape CHECK (
    (authorization_kind = 'OWNER_APPROVAL'
      AND approval_id IS NOT NULL
      AND approver_id IS NOT NULL)
    OR
    (authorization_kind = 'AUTONOMOUS_POLICY'
      AND approval_id IS NULL
      AND approver_id IS NULL
      AND owner_authentication_id IS NULL)
  );

CREATE OR REPLACE FUNCTION enforce_authorization_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  IF NEW.authorization_kind = 'OWNER_APPROVAL' THEN
    SELECT
      a.operation_id,
      a.reservation_id,
      a.envelope_id,
      a.envelope_revision,
      a.envelope_hash,
      a.policy_decision_id,
      a.policy_decision_hash,
      a.policy_id,
      a.policy_version,
      a.approver_id,
      a.issued_at,
      a.expires_at,
      a.status
    INTO binding
    FROM approval_requests a
    WHERE a.approval_id = NEW.approval_id;

    IF NOT FOUND
       OR binding.status NOT IN ('APPROVED', 'CONSUMED')
       OR binding.operation_id IS DISTINCT FROM NEW.operation_id
       OR binding.reservation_id IS DISTINCT FROM NEW.reservation_id
       OR binding.envelope_id IS DISTINCT FROM NEW.envelope_id
       OR binding.envelope_revision IS DISTINCT FROM NEW.envelope_revision
       OR binding.envelope_hash IS DISTINCT FROM NEW.envelope_hash
       OR binding.policy_decision_id IS DISTINCT FROM NEW.policy_decision_id
       OR binding.policy_decision_hash IS DISTINCT FROM NEW.policy_decision_hash
       OR binding.policy_id IS DISTINCT FROM NEW.policy_id
       OR binding.policy_version IS DISTINCT FROM NEW.policy_version
       OR binding.approver_id IS DISTINCT FROM NEW.approver_id
       OR binding.issued_at IS DISTINCT FROM NEW.issued_at
       OR binding.expires_at IS DISTINCT FROM NEW.expires_at
       OR binding.expires_at <= CURRENT_TIMESTAMP
       OR NEW.authorized_at < binding.issued_at
       OR NEW.authorized_at >= binding.expires_at
       OR NEW.consumed_at < NEW.authorized_at
       OR NEW.consumed_at >= binding.expires_at THEN
      RAISE EXCEPTION 'authorization evidence binding mismatch: %', NEW.authorization_id
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.authorization_kind <> 'AUTONOMOUS_POLICY'
     OR NEW.approval_id IS NOT NULL
     OR NEW.approver_id IS NOT NULL
     OR NEW.owner_authentication_id IS NOT NULL THEN
    RAISE EXCEPTION 'authorization evidence has an invalid evidence shape: %', NEW.authorization_id
      USING ERRCODE = '23514';
  END IF;

  SELECT
    o.operation_id,
    o.current_state,
    o.policy_id AS operation_policy_id,
    o.policy_version AS operation_policy_version,
    r.operation_id AS reservation_operation_id,
    r.status AS reservation_status,
    r.expires_at AS reservation_expires_at,
    e.operation_id AS envelope_operation_id,
    e.envelope_hash AS persisted_envelope_hash,
    e.revision AS persisted_envelope_revision,
    e.payload ->> 'policyDecisionHash' AS envelope_decision_hash,
    e.payload ->> 'createdAt' AS envelope_created_at,
    e.payload ->> 'expiresAt' AS envelope_expires_at,
    e.payload ->> 'approvalRequirement' AS envelope_approval_requirement,
    e.payload ->> 'riskDecision' AS envelope_risk_decision,
    d.decision,
    d.decision_hash,
    d.policy_id AS decision_policy_id,
    d.policy_version AS decision_policy_version,
    p.status AS policy_status,
    system_fence.fence_version AS system_current_version,
    system_fence.state AS system_current_state,
    owner_fence.fence_version AS owner_current_version,
    owner_fence.state AS owner_current_state,
    agent_fence.fence_version AS agent_current_version,
    agent_fence.state AS agent_current_state,
    policy_fence.fence_version AS policy_current_version,
    policy_fence.state AS policy_current_state
  INTO binding
  FROM operations o
  JOIN agents ag ON ag.agent_id = o.agent_id
  JOIN policies p ON p.policy_id = o.policy_id
  JOIN budget_reservations r
    ON r.operation_id = o.operation_id
   AND r.reservation_id = NEW.reservation_id
  JOIN execution_envelopes e
    ON e.operation_id = o.operation_id
   AND e.envelope_id = NEW.envelope_id
  JOIN policy_decisions d
    ON d.operation_id = o.operation_id
   AND d.decision_id = NEW.policy_decision_id
  JOIN control_fences system_fence
    ON system_fence.scope_type = 'SYSTEM'
   AND system_fence.scope_id = 'system'
  JOIN control_fences owner_fence
    ON owner_fence.scope_type = 'OWNER'
   AND owner_fence.scope_id = ag.owner_id
  JOIN control_fences agent_fence
    ON agent_fence.scope_type = 'AGENT'
   AND agent_fence.scope_id = o.agent_id
  JOIN control_fences policy_fence
    ON policy_fence.scope_type = 'POLICY'
   AND policy_fence.scope_id = o.policy_id
  WHERE o.operation_id = NEW.operation_id;

  IF NOT FOUND
     OR binding.current_state <> 'AUTHORIZED'
     OR binding.reservation_status <> 'AUTHORIZED'
     OR binding.reservation_operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.envelope_operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.persisted_envelope_revision IS DISTINCT FROM NEW.envelope_revision
     OR binding.persisted_envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR binding.decision_hash IS DISTINCT FROM NEW.policy_decision_hash
     OR binding.envelope_decision_hash IS DISTINCT FROM NEW.policy_decision_hash
     OR binding.operation_policy_id IS DISTINCT FROM NEW.policy_id
     OR binding.operation_policy_version IS DISTINCT FROM NEW.policy_version
     OR binding.decision_policy_id IS DISTINCT FROM NEW.policy_id
     OR binding.decision_policy_version IS DISTINCT FROM NEW.policy_version
     OR binding.decision <> 'ALLOW_AUTONOMOUS'
     OR binding.policy_status <> 'active'
     OR binding.envelope_approval_requirement <> 'none'
     OR binding.envelope_risk_decision <> 'ALLOW'
     OR NEW.issued_at IS DISTINCT FROM binding.envelope_created_at::timestamptz
     OR NEW.expires_at IS DISTINCT FROM binding.envelope_expires_at::timestamptz
     OR NEW.authorized_at < NEW.issued_at
     OR NEW.authorized_at >= NEW.expires_at
     OR NEW.consumed_at < NEW.authorized_at
     OR NEW.consumed_at >= NEW.expires_at
     OR binding.system_current_state <> 'ACTIVE'
     OR binding.owner_current_state <> 'ACTIVE'
     OR binding.agent_current_state <> 'ACTIVE'
     OR binding.policy_current_state <> 'ACTIVE'
     OR binding.system_current_version IS DISTINCT FROM NEW.system_fence_version
     OR binding.owner_current_version IS DISTINCT FROM NEW.owner_fence_version
     OR binding.agent_current_version IS DISTINCT FROM NEW.agent_fence_version
     OR binding.policy_current_version IS DISTINCT FROM NEW.policy_fence_version
     OR NEW.system_state <> 'ACTIVE'
     OR NEW.owner_state <> 'ACTIVE'
     OR NEW.agent_state <> 'ACTIVE'
     OR NEW.policy_state <> 'ACTIVE'
     OR EXISTS (
       SELECT 1
       FROM execution_envelopes newer
       WHERE newer.operation_id = NEW.operation_id
         AND newer.revision > NEW.envelope_revision
     ) THEN
    RAISE EXCEPTION 'autonomous authorization evidence binding mismatch: %', NEW.authorization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- The owner-authentication trigger remains installed for OWNER_APPROVAL rows,
-- but autonomous evidence must never be made to look owner-authenticated.
CREATE OR REPLACE FUNCTION consume_owner_approval_authentication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  authentication record;
  changed integer;
BEGIN
  IF NEW.authorization_kind = 'AUTONOMOUS_POLICY' THEN
    RETURN NEW;
  END IF;

  SELECT evidence.authentication_id, evidence.owner_id, evidence.approver_id,
         evidence.envelope_hash, evidence.policy_id, evidence.policy_version,
         evidence.expires_at, evidence.authenticated_at, evidence.nonce,
         evidence.consumed_at,
         approval.nonce AS approval_nonce, approval.status AS approval_status,
         owner_key.status AS key_status
  INTO authentication
  FROM owner_approval_authentications evidence
  JOIN approval_requests approval ON approval.approval_id = evidence.approval_id
  JOIN local_owner_approval_keys owner_key
    ON owner_key.owner_id = evidence.owner_id
   AND owner_key.key_id = evidence.key_id
  WHERE evidence.approval_id = NEW.approval_id
  FOR UPDATE OF evidence;

  IF NOT FOUND
     OR authentication.key_status <> 'ACTIVE'
     OR authentication.approval_status <> 'APPROVED'
     OR authentication.consumed_at IS NOT NULL
     OR authentication.approver_id IS DISTINCT FROM NEW.approver_id
     OR authentication.envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR authentication.policy_id IS DISTINCT FROM NEW.policy_id
     OR authentication.policy_version IS DISTINCT FROM NEW.policy_version
     OR authentication.expires_at IS DISTINCT FROM NEW.expires_at
     OR authentication.nonce IS DISTINCT FROM authentication.approval_nonce
     OR NEW.authorized_at < authentication.authenticated_at
     OR NEW.consumed_at < authentication.authenticated_at
     OR NEW.authorized_at >= authentication.expires_at
     OR NEW.consumed_at >= authentication.expires_at THEN
    RAISE EXCEPTION 'authorization lacks unconsumed ADR-0008 owner authentication: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;

  UPDATE owner_approval_authentications
  SET consumed_at = NEW.consumed_at
  WHERE authentication_id = authentication.authentication_id
    AND consumed_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'owner approval authentication replay detected: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;

  NEW.owner_authentication_id := authentication.authentication_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assert_approval_operation_consistency(target_operation_id text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  operation_state text;
  reservation_status text;
  active_count integer;
  consumed_count integer;
  autonomous_count integer;
  evidence_count integer;
  approval_row record;
  autonomous_row record;
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

  SELECT count(*) FILTER (WHERE authorization_kind = 'AUTONOMOUS_POLICY')::integer,
         count(*)::integer
  INTO autonomous_count, evidence_count
  FROM authorization_evidence
  WHERE operation_id = target_operation_id;

  IF evidence_count <> consumed_count + autonomous_count THEN
    RAISE EXCEPTION 'authorization evidence count does not match consumed approvals and autonomous authorizations: %', target_operation_id
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
      JOIN authorization_evidence evidence
        ON evidence.approval_id = approval_row.approval_id
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
      SELECT 1 FROM approval_decisions
      WHERE approval_id = approval_row.approval_id AND decision_type = 'APPROVE'
    ) THEN
      RAISE EXCEPTION 'approved approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    ELSIF approval_row.status = 'REJECTED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions
      WHERE approval_id = approval_row.approval_id AND decision_type = 'REJECT'
    ) THEN
      RAISE EXCEPTION 'rejected approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    ELSIF approval_row.status = 'EXPIRED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions
      WHERE approval_id = approval_row.approval_id AND decision_type = 'EXPIRE'
    ) THEN
      RAISE EXCEPTION 'expired approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    ELSIF approval_row.status = 'REVOKED' AND NOT EXISTS (
      SELECT 1 FROM approval_decisions
      WHERE approval_id = approval_row.approval_id AND decision_type = 'REVOKE'
    ) THEN
      RAISE EXCEPTION 'revoked approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    ELSIF approval_row.status = 'CONSUMED' AND (
      NOT EXISTS (
        SELECT 1 FROM approval_decisions
        WHERE approval_id = approval_row.approval_id AND decision_type = 'APPROVE'
      ) OR NOT EXISTS (
        SELECT 1 FROM approval_decisions
        WHERE approval_id = approval_row.approval_id AND decision_type = 'CONSUME'
      )
    ) THEN
      RAISE EXCEPTION 'consumed approval lacks decision evidence: %', approval_row.approval_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  FOR autonomous_row IN
    SELECT authorization_id, reservation_id, envelope_id, envelope_revision,
           envelope_hash, policy_decision_id, policy_decision_hash,
           policy_version, authorized_at, consumed_at
    FROM authorization_evidence
    WHERE operation_id = target_operation_id
      AND authorization_kind = 'AUTONOMOUS_POLICY'
  LOOP
    SELECT count(*)::integer INTO audit_count
    FROM audit_events
    WHERE operation_id = target_operation_id
      AND event_type = 'budget.reservation.authorized'
      AND data ->> 'authorizationId' = autonomous_row.authorization_id
      AND data ->> 'reservationId' = autonomous_row.reservation_id
      AND data ->> 'envelopeId' = autonomous_row.envelope_id
      AND data ->> 'envelopeRevision' = autonomous_row.envelope_revision::text
      AND data ->> 'envelopeHash' = autonomous_row.envelope_hash
      AND data ->> 'policyDecisionId' = autonomous_row.policy_decision_id
      AND data ->> 'policyDecisionHash' = autonomous_row.policy_decision_hash
      AND data ->> 'policyVersion' = autonomous_row.policy_version::text
      AND data ->> 'authorizedAt' = to_char(autonomous_row.authorized_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      AND data ->> 'consumedAt' = to_char(autonomous_row.consumed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    IF audit_count <> 1 THEN
      RAISE EXCEPTION 'autonomous authorization lacks exactly one matching audit event: %', autonomous_row.authorization_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF operation_state = 'AWAITING_APPROVAL' THEN
    IF active_count <> 1 OR consumed_count <> 0 OR autonomous_count <> 0
       OR reservation_status IS DISTINCT FROM 'HELD' THEN
      RAISE EXCEPTION 'approval state requires one active approval and held reservation: %', target_operation_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF operation_state = 'AUTHORIZED' THEN
    IF active_count <> 0
       OR consumed_count + autonomous_count <> 1
       OR evidence_count <> 1
       OR reservation_status IS DISTINCT FROM 'AUTHORIZED' THEN
      IF autonomous_count > 0 THEN
        RAISE EXCEPTION 'authorized operation lacks coherent canonical authorization and reservation: %', target_operation_id
          USING ERRCODE = '23514';
      ELSE
        RAISE EXCEPTION 'authorized operation lacks coherent consumed approval and reservation: %', target_operation_id
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM audit_events
      WHERE operation_id = target_operation_id
        AND event_type = 'budget.reservation.authorized'
    ) THEN
      RAISE EXCEPTION 'authorized operation lacks reservation audit evidence: %', target_operation_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF operation_state = 'ENVELOPE_FINALIZED' THEN
    IF active_count <> 0 OR consumed_count <> 0 OR autonomous_count <> 0
       OR evidence_count <> 0 OR reservation_status IS DISTINCT FROM 'HELD' THEN
      RAISE EXCEPTION 'envelope-finalized operation lacks a held reservation or retains authorization state: %', target_operation_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF operation_state IN ('REVALIDATION_REQUIRED', 'REJECTED', 'EXPIRED', 'REVOKED') THEN
    IF active_count <> 0
       OR (operation_state = 'REVALIDATION_REQUIRED' AND consumed_count + autonomous_count <> evidence_count)
       OR (operation_state IN ('REJECTED', 'EXPIRED') AND (consumed_count <> 0 OR autonomous_count <> 0 OR evidence_count <> 0))
       OR reservation_status IS DISTINCT FROM (CASE operation_state
         WHEN 'EXPIRED' THEN 'EXPIRED'
         ELSE 'RELEASED'
       END) THEN
      RAISE EXCEPTION 'terminal or revalidation operation has incoherent authorization or reservation state: %', target_operation_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

-- The Phase-1 fence-binding trigger also guarded authorization_evidence, but
-- its approval_id lookup is intentionally invalid for autonomous evidence.
-- Keep approval_decisions on the original trigger and give the canonical root
-- an operation-based guard for the autonomous kind.
DROP TRIGGER authorization_evidence_fence_binding_guard ON authorization_evidence;

CREATE OR REPLACE FUNCTION enforce_autonomous_authorization_fence_binding() RETURNS trigger
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
    RAISE EXCEPTION 'autonomous authorization fence snapshot does not match authoritative control state: %', NEW.authorization_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER authorization_evidence_fence_binding_guard
  BEFORE INSERT ON authorization_evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_autonomous_authorization_fence_binding();
