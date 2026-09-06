-- WS-004 P2-04A: additive local EVM execution evidence.
--
-- This migration deliberately keeps the Phase-1 envelope validator and hash
-- domain intact.  The dispatcher below adds only the accepted Phase-2 v2
-- contract and the local fake-chain evidence tables.

ALTER FUNCTION approval_is_execution_envelope(jsonb)
  RENAME TO execution_envelope_v1_is_valid;

CREATE OR REPLACE FUNCTION execution_envelope_v2_is_valid(input_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  key text;
  item jsonb;
  required_keys constant text[] := ARRAY[
    'schemaVersion', 'envelopeId', 'revision', 'intentId', 'intentHash',
    'agentId', 'walletId', 'adapterId', 'adapterVersion', 'chainId', 'from',
    'to', 'value', 'calldata', 'decodedFunction', 'decodedArguments',
    'expectedAssetDeltas', 'simulationBlockNumber', 'simulationBlockHash',
    'simulationResultHash', 'nonceStrategy', 'nonce', 'transactionType',
    'gasLimit', 'maxPriorityFeePerGas', 'accessList',
    'maximumFeeConstraints', 'policyId', 'policyVersion', 'policyDecisionHash',
    'budgetReservationId', 'createdAt', 'expiresAt', 'riskDecision',
    'approvalRequirement', 'envelopeHash'
  ];
  allowed_keys constant text[] := required_keys || ARRAY['supersedesEnvelopeId'];
  identifier_keys constant text[] := ARRAY[
    'envelopeId', 'intentId', 'agentId', 'walletId', 'adapterId', 'policyId',
    'budgetReservationId'
  ];
  hash_keys constant text[] := ARRAY[
    'envelopeHash', 'simulationBlockHash', 'simulationResultHash',
    'policyDecisionHash'
  ];
  address_keys constant text[] := ARRAY['from', 'to'];
  atomic_keys constant text[] := ARRAY[
    'value', 'simulationBlockNumber', 'nonce', 'gasLimit',
    'maxPriorityFeePerGas'
  ];
  max_uint256 constant text :=
    '115792089237316195423570985008687907853269984665640564039457584007913129639935';
BEGIN
  IF jsonb_typeof(input_value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;

  FOREACH key IN ARRAY required_keys LOOP
    IF NOT input_value ? key THEN RETURN false; END IF;
  END LOOP;
  FOR key IN SELECT jsonb_object_keys(input_value) LOOP
    IF NOT key = ANY(allowed_keys) THEN RETURN false; END IF;
  END LOOP;

  IF input_value ->> 'schemaVersion' <> '2.0'
     OR jsonb_typeof(input_value -> 'revision') IS DISTINCT FROM 'number'
     OR input_value ->> 'revision' !~ '^[1-9][0-9]*$'
     OR jsonb_typeof(input_value -> 'policyVersion') IS DISTINCT FROM 'number'
     OR input_value ->> 'policyVersion' !~ '^[1-9][0-9]*$'
     OR input_value ->> 'adapterVersion' !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
     OR input_value ->> 'chainId' <> 'eip155:31337'
     OR input_value ->> 'calldata' !~ '^0x(?:[0-9a-f]{2})*$'
     OR input_value ->> 'decodedFunction' <> 'erc20.transfer'
     OR input_value ->> 'nonceStrategy' NOT IN ('pending', 'latest', 'explicit')
     OR input_value ->> 'transactionType' <> 'eip1559'
     OR input_value ->> 'riskDecision' NOT IN ('ALLOW', 'REVIEW', 'DENY')
     OR input_value ->> 'approvalRequirement' NOT IN ('none', 'owner')
     OR input_value ->> 'intentHash' !~ '^(0x[0-9a-f]{64}|sha256:[0-9a-f]{64})$' THEN
    RETURN false;
  END IF;

  FOREACH key IN ARRAY identifier_keys LOOP
    IF jsonb_typeof(input_value -> key) IS DISTINCT FROM 'string'
       OR length(input_value ->> key) NOT BETWEEN 1 AND 128
       OR input_value ->> key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$' THEN
      RETURN false;
    END IF;
  END LOOP;

  IF input_value ? 'supersedesEnvelopeId' AND (
    jsonb_typeof(input_value -> 'supersedesEnvelopeId') IS DISTINCT FROM 'string'
    OR length(input_value ->> 'supersedesEnvelopeId') NOT BETWEEN 1 AND 128
    OR input_value ->> 'supersedesEnvelopeId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ) THEN
    RETURN false;
  END IF;

  FOREACH key IN ARRAY hash_keys LOOP
    IF jsonb_typeof(input_value -> key) IS DISTINCT FROM 'string'
       OR input_value ->> key !~ '^0x[0-9a-f]{64}$' THEN RETURN false; END IF;
  END LOOP;
  FOREACH key IN ARRAY address_keys LOOP
    IF jsonb_typeof(input_value -> key) IS DISTINCT FROM 'string'
       OR input_value ->> key !~ '^0x[0-9a-f]{40}$' THEN RETURN false; END IF;
  END LOOP;
  FOREACH key IN ARRAY atomic_keys LOOP
    IF jsonb_typeof(input_value -> key) IS DISTINCT FROM 'string'
       OR input_value ->> key !~ '^(0|[1-9][0-9]*)$'
       OR length(input_value ->> key) > 78
       OR (length(input_value ->> key) = 78 AND input_value ->> key > max_uint256) THEN
      RETURN false;
    END IF;
  END LOOP;

  IF input_value ->> 'createdAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
     OR input_value ->> 'expiresAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
     OR (input_value ->> 'expiresAt')::timestamptz <= (input_value ->> 'createdAt')::timestamptz THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(input_value -> 'accessList') IS DISTINCT FROM 'array'
     OR jsonb_array_length(input_value -> 'accessList') <> 0 THEN
    RETURN false;
  END IF;
  IF (input_value ->> 'maxPriorityFeePerGas')::numeric
       > (input_value -> 'maximumFeeConstraints' ->> 'maxFeePerGas')::numeric THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(input_value -> 'decodedArguments') IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(input_value -> 'decodedArguments')) <> 3
     OR NOT (input_value -> 'decodedArguments' ?& ARRAY['assetAddress', 'recipient', 'amountAtomic'])
     OR (input_value -> 'decodedArguments') - 'assetAddress' - 'recipient' - 'amountAtomic' <> '{}'::jsonb
     OR jsonb_typeof(input_value -> 'decodedArguments' -> 'assetAddress') IS DISTINCT FROM 'string'
     OR jsonb_typeof(input_value -> 'decodedArguments' -> 'recipient') IS DISTINCT FROM 'string'
     OR jsonb_typeof(input_value -> 'decodedArguments' -> 'amountAtomic') IS DISTINCT FROM 'string'
     OR (input_value -> 'decodedArguments' ->> 'assetAddress') !~ '^0x[0-9a-f]{40}$'
     OR (input_value -> 'decodedArguments' ->> 'recipient') !~ '^0x[0-9a-f]{40}$'
     OR (input_value -> 'decodedArguments' ->> 'amountAtomic') !~ '^(0|[1-9][0-9]*)$'
     OR length(input_value -> 'decodedArguments' ->> 'amountAtomic') > 78
     OR (length(input_value -> 'decodedArguments' ->> 'amountAtomic') = 78
       AND input_value -> 'decodedArguments' ->> 'amountAtomic' > max_uint256) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(input_value -> 'maximumFeeConstraints') IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(input_value -> 'maximumFeeConstraints')) <> 3
     OR NOT (input_value -> 'maximumFeeConstraints' ?& ARRAY['asset', 'maxFeePerGas', 'maximumNetworkFeeAtomic'])
     OR (input_value -> 'maximumFeeConstraints') - 'asset' - 'maxFeePerGas' - 'maximumNetworkFeeAtomic' <> '{}'::jsonb
     OR jsonb_typeof(input_value -> 'maximumFeeConstraints' -> 'asset') IS DISTINCT FROM 'string'
     OR jsonb_typeof(input_value -> 'maximumFeeConstraints' -> 'maxFeePerGas') IS DISTINCT FROM 'string'
     OR jsonb_typeof(input_value -> 'maximumFeeConstraints' -> 'maximumNetworkFeeAtomic') IS DISTINCT FROM 'string'
     OR input_value -> 'maximumFeeConstraints' ->> 'asset' <> 'native'
     OR input_value -> 'maximumFeeConstraints' ->> 'maxFeePerGas' !~ '^(0|[1-9][0-9]*)$'
     OR input_value -> 'maximumFeeConstraints' ->> 'maximumNetworkFeeAtomic' !~ '^(0|[1-9][0-9]*)$'
     OR length(input_value -> 'maximumFeeConstraints' ->> 'maxFeePerGas') > 78
     OR length(input_value -> 'maximumFeeConstraints' ->> 'maximumNetworkFeeAtomic') > 78
     OR (length(input_value -> 'maximumFeeConstraints' ->> 'maxFeePerGas') = 78
       AND input_value -> 'maximumFeeConstraints' ->> 'maxFeePerGas' > max_uint256)
     OR (length(input_value -> 'maximumFeeConstraints' ->> 'maximumNetworkFeeAtomic') = 78
       AND input_value -> 'maximumFeeConstraints' ->> 'maximumNetworkFeeAtomic' > max_uint256) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(input_value -> 'expectedAssetDeltas') IS DISTINCT FROM 'array'
     OR jsonb_array_length(input_value -> 'expectedAssetDeltas') < 1 THEN
    RETURN false;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(input_value -> 'expectedAssetDeltas') AS elements(value) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 4
       OR NOT (item ?& ARRAY['assetAddress', 'from', 'to', 'amountAtomic'])
       OR item - 'assetAddress' - 'from' - 'to' - 'amountAtomic' <> '{}'::jsonb
       OR jsonb_typeof(item -> 'assetAddress') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item -> 'from') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item -> 'to') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item -> 'amountAtomic') IS DISTINCT FROM 'string'
       OR item ->> 'assetAddress' !~ '^0x[0-9a-f]{40}$'
       OR item ->> 'from' !~ '^0x[0-9a-f]{40}$'
       OR item ->> 'to' !~ '^0x[0-9a-f]{40}$'
       OR item ->> 'amountAtomic' !~ '^(0|[1-9][0-9]*)$'
       OR length(item ->> 'amountAtomic') > 78
       OR (length(item ->> 'amountAtomic') = 78 AND item ->> 'amountAtomic' > max_uint256) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION approval_is_execution_envelope(input_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF jsonb_typeof(input_value) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF input_value ->> 'schemaVersion' = '1.0' THEN
    RETURN execution_envelope_v1_is_valid(input_value);
  ELSIF input_value ->> 'schemaVersion' = '2.0' THEN
    RETURN execution_envelope_v2_is_valid(input_value);
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_execution_envelope_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  operation_row record;
  previous_envelope_id text;
  hash_prefix text;
BEGIN
  SELECT intent_id, agent_id, wallet_id, policy_id, policy_version
  INTO operation_row
  FROM operations
  WHERE operation_id = NEW.operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution envelope operation is missing: %', NEW.operation_id
      USING ERRCODE = '23503';
  END IF;

  IF NOT approval_is_execution_envelope(NEW.payload) THEN
    RAISE EXCEPTION 'execution envelope payload does not match the canonical schema: %', NEW.envelope_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.payload ->> 'envelopeId' IS DISTINCT FROM NEW.envelope_id
     OR NEW.payload ->> 'revision' IS DISTINCT FROM NEW.revision::text
     OR NEW.payload ->> 'envelopeHash' IS DISTINCT FROM NEW.envelope_hash
     OR NEW.payload ->> 'intentId' IS DISTINCT FROM operation_row.intent_id
     OR NEW.payload ->> 'agentId' IS DISTINCT FROM operation_row.agent_id
     OR NEW.payload ->> 'walletId' IS DISTINCT FROM operation_row.wallet_id
     OR NEW.payload ->> 'policyId' IS DISTINCT FROM operation_row.policy_id
     OR NEW.payload ->> 'policyVersion' IS DISTINCT FROM operation_row.policy_version::text THEN
    RAISE EXCEPTION 'execution envelope payload does not match operation binding: %', NEW.envelope_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM budget_reservations
    WHERE reservation_id = NEW.payload ->> 'budgetReservationId'
      AND operation_id = NEW.operation_id
  ) THEN
    RAISE EXCEPTION 'execution envelope reservation binding is missing: %', NEW.envelope_id
      USING ERRCODE = '23514';
  END IF;

  hash_prefix := CASE WHEN NEW.payload ->> 'schemaVersion' = '1.0'
    THEN 'crip/execution-envelopev1' ELSE 'crip/execution-envelopev2' END;
  IF NEW.envelope_hash IS DISTINCT FROM '0x' || approval_keccak256(
    convert_to(hash_prefix, 'UTF8')
      || decode('00', 'hex')
      || convert_to(canonicalize_approval_jsonb(NEW.payload - 'envelopeHash'), 'UTF8')
  ) THEN
    RAISE EXCEPTION 'execution envelope hash is not the canonical hash of its payload: %', NEW.envelope_id
      USING ERRCODE = '23514';
  END IF;

  IF (
    EXISTS (
      SELECT 1 FROM approval_requests
      WHERE operation_id = NEW.operation_id AND status IN ('PENDING', 'APPROVED')
    ) OR EXISTS (
      SELECT 1 FROM authorization_evidence WHERE operation_id = NEW.operation_id
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM operations
    WHERE operation_id = NEW.operation_id AND current_state = 'REVALIDATION_REQUIRED'
  ) THEN
    RAISE EXCEPTION 'execution envelope replacement is blocked while authorization exists: %', NEW.operation_id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.revision > 1 THEN
    SELECT envelope_id INTO previous_envelope_id
    FROM execution_envelopes
    WHERE operation_id = NEW.operation_id AND revision = NEW.revision - 1;
    IF previous_envelope_id IS NULL
       OR NEW.payload ->> 'supersedesEnvelopeId' IS DISTINCT FROM previous_envelope_id THEN
      RAISE EXCEPTION 'execution envelope revision lineage is invalid: %', NEW.envelope_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM execution_envelopes
    WHERE NOT execution_envelope_v1_is_valid(payload)
  ) THEN
    RAISE EXCEPTION 'existing execution envelope is not valid frozen v1 evidence'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE audit_events DROP CONSTRAINT audit_events_type;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_type CHECK (event_type IN (
  'intent.created', 'intent.validated', 'policy.evaluated', 'policy.denied',
  'policy.indeterminate', 'budget.reservation.created', 'budget.reservation.authorized',
  'budget.reservation.broadcast', 'budget.reservation.evidence.verified',
  'budget.reservation.released', 'budget.reservation.expired', 'budget.reservation.finalized',
  'budget.reservation.disputed', 'operation.state.changed', 'approval.requested',
  'approval.approved', 'approval.consumed', 'approval.rejected', 'approval.expired',
  'approval.revoked', 'signing.started', 'signing.failed', 'transaction.signed',
  'transaction.broadcast', 'transaction.confirmed', 'transaction.reconciled',
  'transaction.reverted', 'operation.disputed', 'agent.revoked', 'owner.revoked',
  'policy.revoked', 'system.paused', 'system.resumed', 'adapter.error',
  'execution.recovery.claimed', 'execution.recovery.ambiguous',
  'execution.recovery.resolved', 'execution.recovery.conflict',
  'transaction.constructed', 'transaction.decoded', 'transaction.verified',
  'transaction.simulated', 'transaction.signing.started', 'transaction.broadcast.attempted',
  'transaction.broadcast.accepted', 'transaction.broadcast.rejected',
  'transaction.broadcast.unknown', 'transaction.confirmation.mismatch',
  'transaction.reconciliation.effect'
));

CREATE TABLE local_chain_fixtures (
  fixture_instance_id text PRIMARY KEY,
  is_current boolean NOT NULL DEFAULT true,
  checkout_sha text NOT NULL,
  chain_id text NOT NULL DEFAULT 'eip155:31337',
  genesis_block_hash text NOT NULL,
  token_address text NOT NULL,
  token_code_hash text NOT NULL,
  deployment_transaction_hash text NOT NULL,
  deployment_block_number numeric(78, 0) NOT NULL,
  deployment_block_hash text NOT NULL,
  toolchain jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_fixture_id_format CHECK (fixture_instance_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT local_fixture_checkout_sha CHECK (checkout_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT local_fixture_chain CHECK (chain_id = 'eip155:31337'),
  CONSTRAINT local_fixture_genesis_hash CHECK (genesis_block_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT local_fixture_token_address CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT local_fixture_code_hash CHECK (token_code_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT local_fixture_deployment_hash CHECK (deployment_transaction_hash ~ '^0x[0-9a-f]{64}$' AND deployment_block_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT local_fixture_block_number CHECK (deployment_block_number >= 0),
  CONSTRAINT local_fixture_toolchain CHECK (jsonb_typeof(toolchain) = 'object')
);
CREATE UNIQUE INDEX local_chain_fixtures_one_current
  ON local_chain_fixtures (is_current) WHERE is_current;

CREATE OR REPLACE FUNCTION protect_local_fixture_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fixture_instance_id IS DISTINCT FROM OLD.fixture_instance_id
     OR NEW.checkout_sha IS DISTINCT FROM OLD.checkout_sha
     OR NEW.chain_id IS DISTINCT FROM OLD.chain_id
     OR NEW.genesis_block_hash IS DISTINCT FROM OLD.genesis_block_hash
     OR NEW.token_address IS DISTINCT FROM OLD.token_address
     OR NEW.token_code_hash IS DISTINCT FROM OLD.token_code_hash
     OR NEW.deployment_transaction_hash IS DISTINCT FROM OLD.deployment_transaction_hash
     OR NEW.deployment_block_number IS DISTINCT FROM OLD.deployment_block_number
     OR NEW.deployment_block_hash IS DISTINCT FROM OLD.deployment_block_hash
     OR NEW.toolchain IS DISTINCT FROM OLD.toolchain
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'local fixture identity is immutable: %', OLD.fixture_instance_id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER local_chain_fixture_identity_is_immutable
  BEFORE UPDATE OR DELETE ON local_chain_fixtures
  FOR EACH ROW EXECUTE FUNCTION protect_local_fixture_identity();

CREATE TABLE transaction_simulations (
  simulation_id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES operations (operation_id),
  transfer_core_candidate_hash text NOT NULL,
  fixture_instance_id text NOT NULL REFERENCES local_chain_fixtures (fixture_instance_id),
  chain_id text NOT NULL,
  block_number numeric(78, 0) NOT NULL,
  block_hash text NOT NULL,
  sender_address text NOT NULL,
  sender_nonce numeric(78, 0) NOT NULL,
  token_balance_atomic numeric(78, 0) NOT NULL,
  native_balance_wei numeric(78, 0) NOT NULL,
  gas_estimate numeric(78, 0) NOT NULL,
  gas_limit numeric(78, 0) NOT NULL,
  base_fee_per_gas numeric(78, 0) NOT NULL,
  max_priority_fee_per_gas numeric(78, 0) NOT NULL,
  max_fee_per_gas numeric(78, 0) NOT NULL,
  access_list jsonb NOT NULL,
  outcome text NOT NULL,
  revert_evidence jsonb,
  expected_asset_deltas jsonb NOT NULL,
  maximum_native_fee_atomic numeric(78, 0) NOT NULL,
  simulator_version text NOT NULL,
  evidence_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, evidence_hash),
  CONSTRAINT simulation_id_format CHECK (simulation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT simulation_candidate_hash CHECK (transfer_core_candidate_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT simulation_chain CHECK (chain_id = 'eip155:31337'),
  CONSTRAINT simulation_block_number CHECK (block_number >= 0),
  CONSTRAINT simulation_block_hash CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT simulation_sender CHECK (sender_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT simulation_nonnegative CHECK (
    sender_nonce >= 0 AND token_balance_atomic >= 0 AND native_balance_wei >= 0
    AND gas_estimate >= 0 AND gas_limit >= 0 AND base_fee_per_gas >= 0
    AND max_priority_fee_per_gas >= 0 AND max_fee_per_gas >= 0
    AND maximum_native_fee_atomic >= 0
  ),
  CONSTRAINT simulation_fee_order CHECK (max_priority_fee_per_gas <= max_fee_per_gas),
  CONSTRAINT simulation_access_list CHECK (access_list = '[]'::jsonb),
  CONSTRAINT simulation_outcome CHECK (outcome IN ('SUCCESS', 'REVERT')),
  CONSTRAINT simulation_deltas_array CHECK (jsonb_typeof(expected_asset_deltas) = 'array' AND jsonb_array_length(expected_asset_deltas) >= 1),
  CONSTRAINT simulation_version CHECK (simulator_version ~ '^[A-Za-z0-9._@-]+$'),
  CONSTRAINT simulation_evidence_hash CHECK (evidence_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION require_current_local_fixture() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM local_chain_fixtures
    WHERE fixture_instance_id = NEW.fixture_instance_id AND is_current
  ) THEN
    RAISE EXCEPTION 'execution evidence requires current local fixture: %', NEW.fixture_instance_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transaction_simulations_require_current_fixture
  BEFORE INSERT ON transaction_simulations
  FOR EACH ROW EXECUTE FUNCTION require_current_local_fixture();
CREATE TRIGGER transaction_simulations_are_immutable
  BEFORE UPDATE OR DELETE ON transaction_simulations
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();

CREATE TABLE signed_transactions (
  signed_transaction_id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES operations (operation_id),
  reservation_id text NOT NULL,
  envelope_id text NOT NULL,
  envelope_revision integer NOT NULL,
  envelope_hash text NOT NULL,
  authorization_id text NOT NULL REFERENCES authorization_evidence (authorization_id),
  simulation_id text NOT NULL REFERENCES transaction_simulations (simulation_id),
  fixture_instance_id text NOT NULL REFERENCES local_chain_fixtures (fixture_instance_id),
  expected_transaction_hash text NOT NULL UNIQUE,
  signer_credential_id text NOT NULL REFERENCES trusted_component_credentials (credential_id),
  signer_component_id text NOT NULL,
  signed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, reservation_id) REFERENCES budget_reservations (operation_id, reservation_id),
  FOREIGN KEY (operation_id, envelope_id) REFERENCES execution_envelopes (operation_id, envelope_id),
  CONSTRAINT signed_transaction_id_format CHECK (signed_transaction_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT signed_transaction_revision CHECK (envelope_revision > 0),
  CONSTRAINT signed_transaction_hashes CHECK (envelope_hash ~ '^0x[0-9a-f]{64}$' AND expected_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT signed_transaction_component CHECK (signer_component_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);

CREATE OR REPLACE FUNCTION enforce_signed_transaction_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT o.current_state, e.payload, e.envelope_hash AS persisted_envelope_hash,
         e.revision AS persisted_revision, ae.operation_id AS auth_operation_id,
         ae.reservation_id AS auth_reservation_id, ae.envelope_id AS auth_envelope_id,
         ae.envelope_revision AS auth_revision, ae.envelope_hash AS auth_hash,
         s.operation_id AS simulation_operation_id, s.fixture_instance_id AS simulation_fixture_id,
         s.evidence_hash AS simulation_evidence_hash, c.component_id, c.component_role,
         c.status AS credential_status, f.is_current
  INTO binding
  FROM operations o
  JOIN execution_envelopes e ON e.operation_id = o.operation_id AND e.envelope_id = NEW.envelope_id
  JOIN authorization_evidence ae ON ae.authorization_id = NEW.authorization_id
  JOIN transaction_simulations s ON s.simulation_id = NEW.simulation_id
  JOIN trusted_component_credentials c ON c.credential_id = NEW.signer_credential_id
  JOIN local_chain_fixtures f ON f.fixture_instance_id = NEW.fixture_instance_id
  WHERE o.operation_id = NEW.operation_id;

  IF NOT FOUND
     OR binding.current_state NOT IN ('AUTHORIZED', 'SIGNING', 'SIGNED')
     OR binding.persisted_envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR binding.persisted_revision IS DISTINCT FROM NEW.envelope_revision
     OR binding.auth_operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.auth_reservation_id IS DISTINCT FROM NEW.reservation_id
     OR binding.auth_envelope_id IS DISTINCT FROM NEW.envelope_id
     OR binding.auth_revision IS DISTINCT FROM NEW.envelope_revision
     OR binding.auth_hash IS DISTINCT FROM NEW.envelope_hash
     OR binding.simulation_operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.simulation_fixture_id IS DISTINCT FROM NEW.fixture_instance_id
     OR binding.simulation_evidence_hash IS DISTINCT FROM binding.payload ->> 'simulationResultHash'
     OR binding.payload ->> 'schemaVersion' IS DISTINCT FROM '2.0'
     OR EXISTS (
       SELECT 1 FROM execution_envelopes newer
       WHERE newer.operation_id = NEW.operation_id
         AND newer.revision > NEW.envelope_revision
     )
     OR binding.component_id IS DISTINCT FROM NEW.signer_component_id
     OR binding.component_role IS DISTINCT FROM 'ADAPTER'
     OR binding.credential_status IS DISTINCT FROM 'ACTIVE'
     OR binding.is_current IS DISTINCT FROM true
     OR EXISTS (SELECT 1 FROM authorization_invalidations WHERE authorization_id = NEW.authorization_id) THEN
    RAISE EXCEPTION 'signed transaction is not bound to current canonical authorization: %', NEW.signed_transaction_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER signed_transactions_binding_guard
  BEFORE INSERT ON signed_transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_signed_transaction_binding();
CREATE TRIGGER signed_transactions_are_immutable
  BEFORE UPDATE OR DELETE ON signed_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();

CREATE TABLE broadcast_attempts (
  attempt_id text PRIMARY KEY,
  signed_transaction_id text NOT NULL REFERENCES signed_transactions (signed_transaction_id),
  operation_id text NOT NULL REFERENCES operations (operation_id),
  reservation_id text NOT NULL,
  envelope_id text NOT NULL,
  envelope_revision integer NOT NULL,
  envelope_hash text NOT NULL,
  authorization_id text NOT NULL REFERENCES authorization_evidence (authorization_id),
  fixture_instance_id text NOT NULL REFERENCES local_chain_fixtures (fixture_instance_id),
  expected_transaction_hash text NOT NULL,
  status text NOT NULL DEFAULT 'STARTED',
  response_transaction_hash text,
  classification_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, reservation_id) REFERENCES budget_reservations (operation_id, reservation_id),
  FOREIGN KEY (operation_id, envelope_id) REFERENCES execution_envelopes (operation_id, envelope_id),
  CONSTRAINT broadcast_attempt_id_format CHECK (attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT broadcast_attempt_revision CHECK (envelope_revision > 0),
  CONSTRAINT broadcast_attempt_hash CHECK (expected_transaction_hash ~ '^0x[0-9a-f]{64}$' AND envelope_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT broadcast_attempt_response_hash CHECK (response_transaction_hash IS NULL OR response_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT broadcast_attempt_status CHECK (status IN ('STARTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN')),
  CONSTRAINT broadcast_attempt_reason CHECK (status = 'STARTED' OR length(trim(classification_reason)) > 0),
  CONSTRAINT broadcast_attempt_completion CHECK ((status = 'STARTED' AND completed_at IS NULL) OR (status <> 'STARTED' AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX broadcast_attempts_one_started
  ON broadcast_attempts (signed_transaction_id) WHERE status = 'STARTED';

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
       OR NEW.status NOT IN ('ACCEPTED', 'REJECTED', 'UNKNOWN') THEN
      RAISE EXCEPTION 'invalid broadcast attempt transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'ACCEPTED'
     AND NEW.response_transaction_hash IS DISTINCT FROM NEW.expected_transaction_hash THEN
    RAISE EXCEPTION 'accepted broadcast hash must match expected hash: %', NEW.attempt_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'STARTED' AND NEW.response_transaction_hash IS NOT NULL THEN
    RAISE EXCEPTION 'started broadcast cannot carry a response hash: %', NEW.attempt_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER broadcast_attempt_transition_guard
  BEFORE INSERT OR UPDATE ON broadcast_attempts
  FOR EACH ROW EXECUTE FUNCTION enforce_broadcast_attempt_transition();
CREATE TRIGGER broadcast_attempt_require_current_fixture
  BEFORE INSERT ON broadcast_attempts
  FOR EACH ROW EXECUTE FUNCTION require_current_local_fixture();

CREATE TABLE chain_transaction_evidence (
  transaction_evidence_id text PRIMARY KEY,
  broadcast_attempt_id text NOT NULL REFERENCES broadcast_attempts (attempt_id),
  signed_transaction_id text NOT NULL REFERENCES signed_transactions (signed_transaction_id),
  operation_id text NOT NULL REFERENCES operations (operation_id),
  reservation_id text NOT NULL,
  envelope_id text NOT NULL,
  envelope_revision integer NOT NULL,
  envelope_hash text NOT NULL,
  authorization_id text NOT NULL REFERENCES authorization_evidence (authorization_id),
  fixture_instance_id text NOT NULL REFERENCES local_chain_fixtures (fixture_instance_id),
  chain_id text NOT NULL,
  transaction_hash text NOT NULL UNIQUE,
  block_number numeric(78, 0) NOT NULL,
  block_hash text NOT NULL,
  transaction_index integer NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  value_atomic numeric(78, 0) NOT NULL,
  calldata text NOT NULL,
  nonce numeric(78, 0) NOT NULL,
  transaction_type text NOT NULL,
  gas_limit numeric(78, 0) NOT NULL,
  max_priority_fee_per_gas numeric(78, 0) NOT NULL,
  max_fee_per_gas numeric(78, 0) NOT NULL,
  access_list jsonb NOT NULL,
  evidence_hash text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, transaction_hash),
  FOREIGN KEY (operation_id, reservation_id) REFERENCES budget_reservations (operation_id, reservation_id),
  FOREIGN KEY (operation_id, envelope_id) REFERENCES execution_envelopes (operation_id, envelope_id),
  CONSTRAINT chain_tx_id_format CHECK (transaction_evidence_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT chain_tx_binding_hash CHECK (envelope_hash ~ '^0x[0-9a-f]{64}$' AND transaction_hash ~ '^0x[0-9a-f]{64}$' AND evidence_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT chain_tx_chain CHECK (chain_id = 'eip155:31337'),
  CONSTRAINT chain_tx_block CHECK (block_number >= 0 AND block_hash ~ '^0x[0-9a-f]{64}$' AND transaction_index >= 0),
  CONSTRAINT chain_tx_addresses CHECK (from_address ~ '^0x[0-9a-f]{40}$' AND to_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chain_tx_calldata CHECK (calldata ~ '^0x(?:[0-9a-f]{2})*$'),
  CONSTRAINT chain_tx_nonnegative CHECK (value_atomic >= 0 AND nonce >= 0 AND gas_limit >= 0 AND max_priority_fee_per_gas >= 0 AND max_fee_per_gas >= 0),
  CONSTRAINT chain_tx_type CHECK (transaction_type = 'eip1559'),
  CONSTRAINT chain_tx_fee_order CHECK (max_priority_fee_per_gas <= max_fee_per_gas),
  CONSTRAINT chain_tx_access_list CHECK (access_list = '[]'::jsonb)
);

CREATE OR REPLACE FUNCTION enforce_chain_transaction_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT a.operation_id, a.reservation_id, a.envelope_id, a.envelope_revision,
         a.envelope_hash, a.authorization_id, a.fixture_instance_id,
         a.expected_transaction_hash, s.expected_transaction_hash AS signed_hash,
         s.operation_id AS signed_operation_id, e.payload
  INTO binding
  FROM broadcast_attempts a
  JOIN signed_transactions s ON s.signed_transaction_id = a.signed_transaction_id
  JOIN execution_envelopes e ON e.operation_id = s.operation_id AND e.envelope_id = s.envelope_id
  WHERE a.attempt_id = NEW.broadcast_attempt_id;

  IF NOT FOUND
     OR NEW.signed_transaction_id IS DISTINCT FROM (SELECT signed_transaction_id FROM broadcast_attempts WHERE attempt_id = NEW.broadcast_attempt_id)
     OR binding.operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.reservation_id IS DISTINCT FROM NEW.reservation_id
     OR binding.envelope_id IS DISTINCT FROM NEW.envelope_id
     OR binding.envelope_revision IS DISTINCT FROM NEW.envelope_revision
     OR binding.envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR binding.authorization_id IS DISTINCT FROM NEW.authorization_id
     OR binding.fixture_instance_id IS DISTINCT FROM NEW.fixture_instance_id
     OR binding.expected_transaction_hash IS DISTINCT FROM NEW.transaction_hash
     OR binding.signed_hash IS DISTINCT FROM NEW.transaction_hash
     OR binding.payload ->> 'schemaVersion' IS DISTINCT FROM '2.0'
     OR binding.payload ->> 'chainId' IS DISTINCT FROM NEW.chain_id
     OR binding.payload ->> 'from' IS DISTINCT FROM NEW.from_address
     OR binding.payload ->> 'to' IS DISTINCT FROM NEW.to_address
     OR binding.payload ->> 'value' IS DISTINCT FROM NEW.value_atomic::text
     OR binding.payload ->> 'calldata' IS DISTINCT FROM NEW.calldata
     OR binding.payload ->> 'nonce' IS DISTINCT FROM NEW.nonce::text
     OR binding.payload ->> 'transactionType' IS DISTINCT FROM NEW.transaction_type
     OR binding.payload ->> 'gasLimit' IS DISTINCT FROM NEW.gas_limit::text
     OR binding.payload ->> 'maxPriorityFeePerGas' IS DISTINCT FROM NEW.max_priority_fee_per_gas::text
     OR binding.payload -> 'maximumFeeConstraints' ->> 'maxFeePerGas' IS DISTINCT FROM NEW.max_fee_per_gas::text THEN
    RAISE EXCEPTION 'chain transaction evidence binding mismatch: %', NEW.transaction_evidence_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER chain_transaction_binding_guard
  BEFORE INSERT ON chain_transaction_evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_chain_transaction_binding();
CREATE TRIGGER chain_transaction_evidence_is_immutable
  BEFORE UPDATE OR DELETE ON chain_transaction_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();
CREATE TRIGGER chain_transaction_require_current_fixture
  BEFORE INSERT ON chain_transaction_evidence
  FOR EACH ROW EXECUTE FUNCTION require_current_local_fixture();

CREATE TABLE chain_receipt_evidence (
  receipt_evidence_id text PRIMARY KEY,
  transaction_evidence_id text NOT NULL UNIQUE REFERENCES chain_transaction_evidence (transaction_evidence_id),
  operation_id text NOT NULL REFERENCES operations (operation_id),
  reservation_id text NOT NULL,
  envelope_id text NOT NULL,
  envelope_revision integer NOT NULL,
  envelope_hash text NOT NULL,
  authorization_id text NOT NULL REFERENCES authorization_evidence (authorization_id),
  fixture_instance_id text NOT NULL REFERENCES local_chain_fixtures (fixture_instance_id),
  transaction_hash text NOT NULL UNIQUE,
  chain_id text NOT NULL,
  block_number numeric(78, 0) NOT NULL,
  block_hash text NOT NULL,
  receipt_status text NOT NULL,
  gas_used numeric(78, 0) NOT NULL,
  effective_gas_price numeric(78, 0) NOT NULL,
  log_count integer NOT NULL DEFAULT 0,
  evidence_hash text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, reservation_id) REFERENCES budget_reservations (operation_id, reservation_id),
  FOREIGN KEY (operation_id, envelope_id) REFERENCES execution_envelopes (operation_id, envelope_id),
  CONSTRAINT chain_receipt_id_format CHECK (receipt_evidence_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT chain_receipt_hashes CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$' AND envelope_hash ~ '^0x[0-9a-f]{64}$' AND evidence_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT chain_receipt_chain CHECK (chain_id = 'eip155:31337'),
  CONSTRAINT chain_receipt_block CHECK (block_number >= 0 AND block_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT chain_receipt_status CHECK (receipt_status IN ('SUCCESS', 'REVERT')),
  CONSTRAINT chain_receipt_gas CHECK (gas_used >= 0 AND effective_gas_price >= 0 AND log_count >= 0),
  CONSTRAINT chain_receipt_success_logs CHECK ((receipt_status = 'SUCCESS' AND log_count = 1) OR (receipt_status = 'REVERT' AND log_count = 0))
);
CREATE TRIGGER chain_receipt_evidence_is_immutable
  BEFORE UPDATE OR DELETE ON chain_receipt_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();
CREATE TRIGGER chain_receipt_require_current_fixture
  BEFORE INSERT ON chain_receipt_evidence
  FOR EACH ROW EXECUTE FUNCTION require_current_local_fixture();

CREATE OR REPLACE FUNCTION enforce_chain_receipt_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  transaction_row record;
BEGIN
  SELECT transaction_evidence_id, operation_id, reservation_id, envelope_id,
         envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
         transaction_hash, chain_id, block_number, block_hash
  INTO transaction_row
  FROM chain_transaction_evidence
  WHERE transaction_evidence_id = NEW.transaction_evidence_id;
  IF NOT FOUND
     OR transaction_row.operation_id IS DISTINCT FROM NEW.operation_id
     OR transaction_row.reservation_id IS DISTINCT FROM NEW.reservation_id
     OR transaction_row.envelope_id IS DISTINCT FROM NEW.envelope_id
     OR transaction_row.envelope_revision IS DISTINCT FROM NEW.envelope_revision
     OR transaction_row.envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR transaction_row.authorization_id IS DISTINCT FROM NEW.authorization_id
     OR transaction_row.fixture_instance_id IS DISTINCT FROM NEW.fixture_instance_id
     OR transaction_row.transaction_hash IS DISTINCT FROM NEW.transaction_hash
     OR transaction_row.chain_id IS DISTINCT FROM NEW.chain_id
     OR transaction_row.block_number IS DISTINCT FROM NEW.block_number
     OR transaction_row.block_hash IS DISTINCT FROM NEW.block_hash THEN
    RAISE EXCEPTION 'chain receipt evidence binding mismatch: %', NEW.receipt_evidence_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER chain_receipt_binding_guard
  BEFORE INSERT ON chain_receipt_evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_chain_receipt_binding();

CREATE TABLE chain_transfer_logs (
  log_evidence_id text PRIMARY KEY,
  receipt_evidence_id text NOT NULL UNIQUE REFERENCES chain_receipt_evidence (receipt_evidence_id),
  log_index integer NOT NULL,
  event_signature text NOT NULL DEFAULT '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df523b3ef',
  token_address text NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  amount_atomic numeric(78, 0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chain_log_id_format CHECK (log_evidence_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT chain_log_index CHECK (log_index >= 0),
  CONSTRAINT chain_log_signature CHECK (event_signature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df523b3ef'),
  CONSTRAINT chain_log_addresses CHECK (token_address ~ '^0x[0-9a-f]{40}$' AND from_address ~ '^0x[0-9a-f]{40}$' AND to_address ~ '^0x[0-9a-f]{40}$' AND amount_atomic >= 0)
);
CREATE OR REPLACE FUNCTION enforce_chain_transfer_log_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  receipt record;
BEGIN
  SELECT r.receipt_status, r.transaction_evidence_id, r.operation_id,
         r.fixture_instance_id, r.transaction_hash, t.to_address,
         t.from_address AS sender_address, f.token_address,
         e.payload -> 'decodedArguments' ->> 'recipient' AS expected_recipient,
         e.payload -> 'decodedArguments' ->> 'amountAtomic' AS expected_amount
  INTO receipt
  FROM chain_receipt_evidence r
  JOIN chain_transaction_evidence t ON t.transaction_evidence_id = r.transaction_evidence_id
  JOIN local_chain_fixtures f ON f.fixture_instance_id = r.fixture_instance_id
  JOIN execution_envelopes e ON e.operation_id = t.operation_id AND e.envelope_id = t.envelope_id
  WHERE r.receipt_evidence_id = NEW.receipt_evidence_id;
  IF NOT FOUND OR receipt.receipt_status <> 'SUCCESS'
     OR NEW.token_address IS DISTINCT FROM receipt.token_address
     OR NEW.from_address IS DISTINCT FROM receipt.sender_address
     OR NEW.to_address IS DISTINCT FROM receipt.expected_recipient
     OR NEW.amount_atomic::text IS DISTINCT FROM receipt.expected_amount THEN
    RAISE EXCEPTION 'chain transfer log is not bound to a successful expected receipt: %', NEW.log_evidence_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER chain_transfer_log_binding_guard
  BEFORE INSERT ON chain_transfer_logs
  FOR EACH ROW EXECUTE FUNCTION enforce_chain_transfer_log_binding();
CREATE TRIGGER chain_transfer_logs_are_immutable
  BEFORE UPDATE OR DELETE ON chain_transfer_logs
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();

CREATE TABLE execution_economic_effects (
  effect_id text PRIMARY KEY,
  operation_id text NOT NULL UNIQUE REFERENCES operations (operation_id),
  reservation_id text NOT NULL,
  envelope_id text NOT NULL,
  envelope_revision integer NOT NULL,
  envelope_hash text NOT NULL,
  authorization_id text NOT NULL REFERENCES authorization_evidence (authorization_id),
  receipt_evidence_id text NOT NULL UNIQUE REFERENCES chain_receipt_evidence (receipt_evidence_id),
  transaction_hash text NOT NULL UNIQUE,
  asset_address text NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  amount_atomic numeric(78, 0) NOT NULL,
  reconciler_credential_id text NOT NULL REFERENCES trusted_component_credentials (credential_id),
  reconciler_component_id text NOT NULL,
  reconciler_auth_signature text NOT NULL,
  reconciler_auth_payload_hash text NOT NULL,
  effect_hash text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, reservation_id) REFERENCES budget_reservations (operation_id, reservation_id),
  FOREIGN KEY (operation_id, envelope_id) REFERENCES execution_envelopes (operation_id, envelope_id),
  CONSTRAINT economic_effect_id_format CHECK (effect_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT economic_effect_revision CHECK (envelope_revision > 0),
  CONSTRAINT economic_effect_hashes CHECK (envelope_hash ~ '^0x[0-9a-f]{64}$' AND transaction_hash ~ '^0x[0-9a-f]{64}$' AND effect_hash ~ '^0x[0-9a-f]{64}$' AND reconciler_auth_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT economic_effect_addresses CHECK (asset_address ~ '^0x[0-9a-f]{40}$' AND from_address ~ '^0x[0-9a-f]{40}$' AND to_address ~ '^0x[0-9a-f]{40}$' AND amount_atomic >= 0),
  CONSTRAINT economic_effect_component CHECK (reconciler_component_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' AND reconciler_auth_signature ~ '^[A-Za-z0-9_-]+$')
);

CREATE OR REPLACE FUNCTION enforce_economic_effect_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding record;
BEGIN
  SELECT r.operation_id, r.reservation_id, r.envelope_id, r.envelope_revision,
         r.envelope_hash, r.authorization_id, r.transaction_hash,
         t.fixture_instance_id, t.to_address, t.from_address,
         l.token_address, l.from_address AS log_from, l.to_address AS log_to,
         l.amount_atomic, c.component_id, c.component_role, c.status,
         f.is_current
  INTO binding
  FROM chain_receipt_evidence r
  JOIN chain_transaction_evidence t ON t.transaction_evidence_id = r.transaction_evidence_id
  JOIN chain_transfer_logs l ON l.receipt_evidence_id = r.receipt_evidence_id
  JOIN trusted_component_credentials c ON c.credential_id = NEW.reconciler_credential_id
  JOIN local_chain_fixtures f ON f.fixture_instance_id = t.fixture_instance_id
  WHERE r.receipt_evidence_id = NEW.receipt_evidence_id;
  IF NOT FOUND
     OR binding.operation_id IS DISTINCT FROM NEW.operation_id
     OR binding.reservation_id IS DISTINCT FROM NEW.reservation_id
     OR binding.envelope_id IS DISTINCT FROM NEW.envelope_id
     OR binding.envelope_revision IS DISTINCT FROM NEW.envelope_revision
     OR binding.envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR binding.authorization_id IS DISTINCT FROM NEW.authorization_id
     OR binding.transaction_hash IS DISTINCT FROM NEW.transaction_hash
     OR binding.token_address IS DISTINCT FROM NEW.asset_address
     OR binding.log_from IS DISTINCT FROM NEW.from_address
     OR binding.log_to IS DISTINCT FROM NEW.to_address
     OR binding.amount_atomic IS DISTINCT FROM NEW.amount_atomic
     OR binding.component_id IS DISTINCT FROM NEW.reconciler_component_id
     OR binding.component_role IS DISTINCT FROM 'RECONCILER'
     OR binding.status IS DISTINCT FROM 'ACTIVE'
     OR binding.is_current IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'economic effect is not bound to authenticated normalized chain evidence: %', NEW.effect_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER economic_effect_binding_guard
  BEFORE INSERT ON execution_economic_effects
  FOR EACH ROW EXECUTE FUNCTION enforce_economic_effect_binding();
CREATE TRIGGER economic_effects_are_immutable
  BEFORE UPDATE OR DELETE ON execution_economic_effects
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();

-- Keep the exact append-only migration model: there is no down migration and
-- no generic transaction-candidate authority.
