-- P3-02: once STARTED exists, control changes cannot block exact-attempt recovery.
CREATE OR REPLACE FUNCTION enforce_reservation_canonical_authorization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('AUTHORIZED', 'BROADCAST', 'FINALIZED') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('BROADCAST', 'FINALIZED') AND EXISTS (
    SELECT 1
    FROM authorization_evidence ae
    JOIN operations o ON o.operation_id = ae.operation_id
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
    WHERE ae.operation_id = NEW.operation_id
      AND ae.reservation_id = NEW.reservation_id
      AND o.current_state IN ('AUTHORIZED', 'SIGNING', 'SIGNED', 'BROADCAST',
                              'PENDING_CONFIRMATION', 'CONFIRMED', 'RECONCILED')
      AND a.status IN ('STARTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN', 'CONFLICT')
  ) THEN
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
