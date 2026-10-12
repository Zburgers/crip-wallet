-- P3-03: STARTED is valid only for the exact live authority, serialized with controls.
CREATE OR REPLACE FUNCTION enforce_broadcast_attempt_current_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  identity record;
BEGIN
  SELECT o.agent_id, o.policy_id, w.owner_id
  INTO identity
  FROM signed_transactions s
  JOIN operations o ON o.operation_id = s.operation_id
  JOIN wallets w ON w.wallet_id = o.wallet_id
  WHERE s.signed_transaction_id = NEW.signed_transaction_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'broadcast attempt signed authority is missing: %', NEW.attempt_id
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM control_fences
   WHERE scope_type = 'SYSTEM' AND scope_id = 'system' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'system control fence is missing'; END IF;
  PERFORM 1 FROM control_fences
   WHERE scope_type = 'OWNER' AND scope_id = identity.owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owner control fence is missing'; END IF;
  PERFORM 1 FROM control_fences
   WHERE scope_type = 'AGENT' AND scope_id = identity.agent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent control fence is missing'; END IF;
  PERFORM 1 FROM control_fences
   WHERE scope_type = 'POLICY' AND scope_id = identity.policy_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy control fence is missing'; END IF;

  PERFORM 1
  FROM authorization_evidence ae
  JOIN policy_decisions pd
    ON pd.operation_id = ae.operation_id
   AND pd.decision_id = ae.policy_decision_id
  JOIN signed_transactions s
    ON s.operation_id = ae.operation_id
   AND s.authorization_id = ae.authorization_id
  WHERE ae.operation_id = s.operation_id
    AND ae.authorization_id = s.authorization_id
    AND ae.reservation_id = s.reservation_id
    AND ae.envelope_id = s.envelope_id
    AND ae.envelope_revision = s.envelope_revision
    AND ae.envelope_hash = s.envelope_hash
    AND s.signed_transaction_id = NEW.signed_transaction_id
  FOR UPDATE OF ae, pd;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'broadcast attempt authorization evidence is missing: %', NEW.attempt_id
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM operations
   WHERE operation_id = NEW.operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'broadcast attempt operation is missing'; END IF;
  PERFORM 1 FROM budget_reservations
   WHERE operation_id = NEW.operation_id
     AND reservation_id = NEW.reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'broadcast attempt reservation is missing'; END IF;
  PERFORM 1 FROM execution_envelopes
   WHERE operation_id = NEW.operation_id
     AND envelope_id = NEW.envelope_id
     AND revision = NEW.envelope_revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'broadcast attempt envelope is missing'; END IF;
  PERFORM 1
  FROM transaction_simulations sim
  JOIN signed_transactions s
    ON s.operation_id = sim.operation_id
   AND s.simulation_id = sim.simulation_id
  WHERE s.signed_transaction_id = NEW.signed_transaction_id
  FOR UPDATE OF sim;
  IF NOT FOUND THEN RAISE EXCEPTION 'broadcast attempt simulation is missing'; END IF;
  PERFORM 1 FROM signed_transactions
   WHERE signed_transaction_id = NEW.signed_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'broadcast attempt signed evidence is missing'; END IF;
  PERFORM 1
  FROM trusted_component_credentials c
  JOIN signed_transactions s ON s.signer_credential_id = c.credential_id
  WHERE s.signed_transaction_id = NEW.signed_transaction_id
  FOR SHARE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'broadcast attempt signer credential is missing'; END IF;

  IF NEW.status <> 'STARTED' OR NOT EXISTS (
    SELECT 1
    FROM signed_transactions s
    JOIN operations o ON o.operation_id = s.operation_id
    JOIN wallets w ON w.wallet_id = o.wallet_id
    JOIN authorization_evidence ae
      ON ae.operation_id = s.operation_id
     AND ae.authorization_id = s.authorization_id
    JOIN budget_reservations r
      ON r.operation_id = s.operation_id
     AND r.reservation_id = s.reservation_id
    JOIN execution_envelopes e
      ON e.operation_id = s.operation_id
     AND e.envelope_id = s.envelope_id
     AND e.revision = s.envelope_revision
     AND e.envelope_hash = s.envelope_hash
    JOIN transaction_simulations sim
      ON sim.operation_id = s.operation_id
     AND sim.simulation_id = s.simulation_id
     AND sim.fixture_instance_id = s.fixture_instance_id
     AND sim.evidence_hash = e.payload ->> 'simulationResultHash'
    JOIN local_chain_fixtures f
      ON f.fixture_instance_id = s.fixture_instance_id
    JOIN trusted_component_credentials c
      ON c.credential_id = s.signer_credential_id
    JOIN policies p ON p.policy_id = o.policy_id
    JOIN policy_decisions pd
      ON pd.operation_id = ae.operation_id
     AND pd.decision_id = ae.policy_decision_id
    JOIN control_fences sf
      ON sf.scope_type = 'SYSTEM' AND sf.scope_id = 'system'
    JOIN control_fences ofence
      ON ofence.scope_type = 'OWNER' AND ofence.scope_id = w.owner_id
    JOIN control_fences agf
      ON agf.scope_type = 'AGENT' AND agf.scope_id = o.agent_id
    JOIN control_fences pf
      ON pf.scope_type = 'POLICY' AND pf.scope_id = o.policy_id
    LEFT JOIN authorization_invalidations ai
      ON ai.authorization_id = ae.authorization_id
    LEFT JOIN approval_requests approval
      ON approval.approval_id = ae.approval_id
    WHERE s.signed_transaction_id = NEW.signed_transaction_id
      AND s.operation_id = NEW.operation_id
      AND s.reservation_id = NEW.reservation_id
      AND s.envelope_id = NEW.envelope_id
      AND s.envelope_revision = NEW.envelope_revision
      AND s.envelope_hash = NEW.envelope_hash
      AND s.authorization_id = NEW.authorization_id
      AND s.fixture_instance_id = NEW.fixture_instance_id
      AND s.expected_transaction_hash = NEW.expected_transaction_hash
      AND ae.reservation_id = s.reservation_id
      AND ae.envelope_id = s.envelope_id
      AND ae.envelope_revision = s.envelope_revision
      AND ae.envelope_hash = s.envelope_hash
      AND o.current_state = 'SIGNED'
      AND r.status = 'AUTHORIZED'
      AND r.expires_at > clock_timestamp()
      AND ae.expires_at > clock_timestamp()
      AND (e.payload ->> 'expiresAt')::timestamptz > clock_timestamp()
      AND ai.authorization_id IS NULL
      AND p.status = 'active'
      AND pd.decision_hash = ae.policy_decision_hash
      AND pd.policy_id = ae.policy_id
      AND pd.policy_version = ae.policy_version
      AND o.policy_id = ae.policy_id
      AND o.policy_version = ae.policy_version
      AND f.is_current
      AND c.component_id = s.signer_component_id
      AND c.component_role = 'ADAPTER'
      AND c.status = 'ACTIVE'
      AND sf.state = 'ACTIVE'
      AND ofence.state = 'ACTIVE'
      AND agf.state = 'ACTIVE'
      AND pf.state = 'ACTIVE'
      AND sf.fence_version = ae.system_fence_version
      AND ofence.fence_version = ae.owner_fence_version
      AND agf.fence_version = ae.agent_fence_version
      AND pf.fence_version = ae.policy_fence_version
      AND ae.system_state = 'ACTIVE'
      AND ae.owner_state = 'ACTIVE'
      AND ae.agent_state = 'ACTIVE'
      AND ae.policy_state = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM execution_envelopes newer
        WHERE newer.operation_id = ae.operation_id
          AND newer.revision > ae.envelope_revision
      )
      AND (
        (ae.authorization_kind = 'OWNER_APPROVAL'
          AND pd.decision = 'REQUIRE_APPROVAL'
          AND ae.approval_id IS NOT NULL
          AND ae.owner_authentication_id IS NOT NULL
          AND approval.status = 'CONSUMED'
          AND approval.approver_id IS NOT NULL
          AND approval.consumed_at IS NOT NULL)
        OR
        (ae.authorization_kind = 'AUTONOMOUS_POLICY'
          AND pd.decision = 'ALLOW_AUTONOMOUS'
          AND ae.approval_id IS NULL
          AND ae.owner_authentication_id IS NULL
          AND approval.approval_id IS NULL)
      )
  ) THEN
    RAISE EXCEPTION 'broadcast attempt requires current canonical authority: %', NEW.attempt_id
      USING ERRCODE = '23514';
  END IF;

  UPDATE budget_reservations
     SET updated_at = clock_timestamp()
   WHERE operation_id = NEW.operation_id
     AND reservation_id = NEW.reservation_id
     AND status = 'AUTHORIZED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'broadcast attempt reservation is not AUTHORIZED: %', NEW.reservation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER broadcast_attempt_current_authority_guard
  BEFORE INSERT ON broadcast_attempts
  FOR EACH ROW EXECUTE FUNCTION enforce_broadcast_attempt_current_authority();
