CREATE TABLE owners (
  owner_id text PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owners_id_format CHECK (owner_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$')
);

CREATE TABLE agents (
  agent_id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owners (owner_id),
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agents_id_format CHECK (agent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$')
);

CREATE TABLE wallets (
  wallet_id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owners (owner_id),
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_id_format CHECK (wallet_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$')
);

CREATE TABLE policies (
  policy_id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owners (owner_id),
  agent_id text NOT NULL REFERENCES agents (agent_id),
  wallet_id text NOT NULL REFERENCES wallets (wallet_id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policies_status CHECK (status IN ('draft', 'active', 'superseded', 'revoked')),
  CONSTRAINT policies_id_format CHECK (policy_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$')
);

CREATE TABLE policy_versions (
  policy_id text NOT NULL,
  version integer NOT NULL,
  document jsonb NOT NULL,
  document_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, version),
  FOREIGN KEY (policy_id) REFERENCES policies (policy_id),
  CONSTRAINT policy_versions_version CHECK (version > 0),
  CONSTRAINT policy_versions_hash CHECK (document_hash ~ '^(?:0x[0-9a-f]{64}|sha256:[0-9a-f]{64})$')
);

CREATE TABLE intents (
  intent_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  agent_id text NOT NULL REFERENCES agents (agent_id),
  wallet_id text NOT NULL REFERENCES wallets (wallet_id),
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (policy_id, policy_version) REFERENCES policy_versions (policy_id, version),
  CONSTRAINT intents_status CHECK (status IN ('DRAFT', 'VALIDATED', 'EXPIRED', 'REJECTED')),
  CONSTRAINT intents_hash CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT intents_id_format CHECK (intent_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$')
);

CREATE TABLE operations (
  operation_id text PRIMARY KEY,
  intent_id text NOT NULL UNIQUE REFERENCES intents (intent_id),
  agent_id text NOT NULL REFERENCES agents (agent_id),
  wallet_id text NOT NULL REFERENCES wallets (wallet_id),
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  current_state text NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (policy_id, policy_version) REFERENCES policy_versions (policy_id, version),
  CONSTRAINT operations_state CHECK (current_state IN (
    'DRAFT', 'VALIDATED', 'POLICY_PRECHECKED', 'CONSTRUCTED', 'DECODED', 'VERIFIED',
    'SIMULATED', 'POLICY_FINALIZED', 'BUDGET_RESERVED', 'ENVELOPE_FINALIZED',
    'AWAITING_APPROVAL', 'AUTHORIZED', 'SIGNING', 'SIGNED', 'BROADCAST',
    'PENDING_CONFIRMATION', 'CONFIRMED', 'RECONCILED', 'REJECTED', 'DENIED',
    'EXPIRED', 'SIMULATION_FAILED', 'SIGNING_FAILED', 'BROADCAST_FAILED',
    'REVERTED', 'CANCELLED', 'DISPUTED', 'REVOKED', 'REVALIDATION_REQUIRED'
  )),
  CONSTRAINT operations_id_format CHECK (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$')
);

CREATE TABLE execution_envelopes (
  envelope_id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES operations (operation_id),
  revision integer NOT NULL,
  envelope_hash text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, revision),
  CONSTRAINT execution_envelopes_revision CHECK (revision > 0),
  CONSTRAINT execution_envelopes_hash CHECK (envelope_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE TABLE policy_decisions (
  decision_id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES operations (operation_id),
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  decision text NOT NULL,
  decision_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (policy_id, policy_version) REFERENCES policy_versions (policy_id, version),
  CONSTRAINT policy_decisions_decision CHECK (decision IN ('ALLOW_READ', 'ALLOW_AUTONOMOUS', 'REQUIRE_APPROVAL', 'DENY', 'INDETERMINATE')),
  CONSTRAINT policy_decisions_hash CHECK (decision_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE TABLE budget_accounts (
  budget_id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents (agent_id),
  wallet_id text NOT NULL REFERENCES wallets (wallet_id),
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  asset_address text NOT NULL,
  allocated numeric(78, 0) NOT NULL,
  available numeric(78, 0) NOT NULL,
  reserved numeric(78, 0) NOT NULL,
  finalized_spend numeric(78, 0) NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (policy_id, policy_version) REFERENCES policy_versions (policy_id, version),
  UNIQUE (agent_id, wallet_id, policy_id, policy_version, asset_address),
  CONSTRAINT budget_accounts_asset CHECK (asset_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT budget_accounts_nonnegative CHECK (allocated >= 0 AND available >= 0 AND reserved >= 0 AND finalized_spend >= 0),
  CONSTRAINT budget_accounts_invariant CHECK (allocated = available + reserved + finalized_spend)
);

CREATE TABLE budget_reservations (
  reservation_id text PRIMARY KEY,
  budget_id text NOT NULL REFERENCES budget_accounts (budget_id),
  operation_id text NOT NULL UNIQUE REFERENCES operations (operation_id),
  idempotency_key text NOT NULL UNIQUE,
  amount_atomic numeric(78, 0) NOT NULL,
  finalized_spend_atomic numeric(78, 0) NOT NULL DEFAULT 0,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  proof_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_reservations_amount CHECK (amount_atomic > 0),
  CONSTRAINT budget_reservations_finalized CHECK (finalized_spend_atomic >= 0 AND finalized_spend_atomic <= amount_atomic),
  CONSTRAINT budget_reservations_status CHECK (status IN ('HELD', 'AUTHORIZED', 'BROADCAST', 'FINALIZED', 'RELEASED', 'EXPIRED', 'DISPUTED')),
  CONSTRAINT budget_reservations_terminal_spend CHECK (
    status NOT IN ('RELEASED', 'EXPIRED', 'DISPUTED') OR finalized_spend_atomic = 0
  )
);

CREATE TABLE idempotency_records (
  idempotency_key text PRIMARY KEY,
  payload_hash text NOT NULL,
  intent_id text NOT NULL REFERENCES intents (intent_id),
  operation_id text NOT NULL REFERENCES operations (operation_id),
  reservation_id text UNIQUE REFERENCES budget_reservations (reservation_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_records_hash CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$')
);

CREATE TABLE audit_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  sequence_no bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  owner_id text NOT NULL REFERENCES owners (owner_id),
  agent_id text NOT NULL REFERENCES agents (agent_id),
  wallet_id text NOT NULL REFERENCES wallets (wallet_id),
  intent_id text NOT NULL REFERENCES intents (intent_id),
  operation_id text NOT NULL REFERENCES operations (operation_id),
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  trace_id text NOT NULL,
  data jsonb NOT NULL,
  previous_event_hash text,
  event_hash text NOT NULL UNIQUE,
  FOREIGN KEY (policy_id, policy_version) REFERENCES policy_versions (policy_id, version),
  UNIQUE (operation_id, sequence_no),
  CONSTRAINT audit_events_type CHECK (event_type IN (
    'intent.created', 'intent.validated', 'policy.evaluated', 'policy.denied',
    'policy.indeterminate', 'budget.reservation.created', 'budget.reservation.authorized',
    'budget.reservation.released', 'budget.reservation.expired', 'budget.reservation.finalized',
    'budget.reservation.disputed', 'operation.state.changed', 'approval.requested',
    'approval.approved', 'approval.rejected', 'approval.expired', 'approval.revoked',
    'signing.started', 'signing.failed', 'transaction.signed', 'transaction.broadcast',
    'transaction.confirmed', 'transaction.reconciled', 'transaction.reverted',
    'operation.disputed', 'agent.revoked', 'system.paused', 'system.resumed', 'adapter.error'
  )),
  CONSTRAINT audit_events_actor_type CHECK (actor_type IN ('owner', 'agent', 'service', 'system', 'worker', 'adapter')),
  CONSTRAINT audit_events_trace CHECK (trace_id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT audit_events_hash CHECK (event_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT audit_events_previous_hash CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION reject_immutable_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable record: %', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER policy_versions_are_immutable
  BEFORE UPDATE OR DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();
CREATE TRIGGER intents_are_immutable
  BEFORE UPDATE OR DELETE ON intents
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();
CREATE TRIGGER execution_envelopes_are_immutable
  BEFORE UPDATE OR DELETE ON execution_envelopes
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();
CREATE TRIGGER policy_decisions_are_immutable
  BEFORE UPDATE OR DELETE ON policy_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();
CREATE TRIGGER idempotency_records_are_immutable
  BEFORE UPDATE OR DELETE ON idempotency_records
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();
CREATE TRIGGER audit_events_are_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();
