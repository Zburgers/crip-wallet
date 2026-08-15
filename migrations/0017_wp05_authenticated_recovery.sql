CREATE TABLE trusted_component_credentials (
  credential_id text PRIMARY KEY,
  component_id text NOT NULL,
  component_role text NOT NULL,
  public_key text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT trusted_component_credential_id_format CHECK (
    credential_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'
  ),
  CONSTRAINT trusted_component_id_format CHECK (
    component_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'
  ),
  CONSTRAINT trusted_component_role CHECK (component_role IN ('ADAPTER', 'RECONCILER')),
  CONSTRAINT trusted_component_public_key CHECK (public_key ~ '^[A-Za-z0-9_-]{59}$'),
  CONSTRAINT trusted_component_status CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL) OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL)
  ),
  UNIQUE (component_id, component_role)
);

CREATE TRIGGER trusted_component_credentials_are_immutable
  BEFORE UPDATE OF credential_id, component_id, component_role, public_key, created_at
  ON trusted_component_credentials
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record();

ALTER TABLE reservation_broadcast_evidence
  ADD COLUMN adapter_credential_id text REFERENCES trusted_component_credentials (credential_id),
  ADD COLUMN adapter_component_id text,
  ADD COLUMN adapter_component_role text,
  ADD COLUMN adapter_auth_signature text,
  ADD COLUMN adapter_auth_payload_hash text,
  ADD COLUMN verification_credential_id text REFERENCES trusted_component_credentials (credential_id),
  ADD COLUMN verification_component_id text,
  ADD COLUMN verification_component_role text,
  ADD COLUMN verification_auth_signature text,
  ADD COLUMN verification_auth_payload_hash text;

ALTER TABLE reservation_broadcast_evidence
  ADD CONSTRAINT reservation_evidence_adapter_role CHECK (adapter_component_role = 'ADAPTER'),
  ADD CONSTRAINT reservation_evidence_verification_role CHECK (
    verification_component_role IS NULL OR verification_component_role = 'RECONCILER'
  ),
  ADD CONSTRAINT reservation_evidence_adapter_signature CHECK (
    adapter_auth_signature IS NULL OR adapter_auth_signature ~ '^[A-Za-z0-9_-]+$'
  ),
  ADD CONSTRAINT reservation_evidence_verification_signature CHECK (
    verification_auth_signature IS NULL OR verification_auth_signature ~ '^[A-Za-z0-9_-]+$'
  ),
  ADD CONSTRAINT reservation_evidence_adapter_auth_hash CHECK (
    adapter_auth_payload_hash IS NULL OR adapter_auth_payload_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT reservation_evidence_verification_auth_hash CHECK (
    verification_auth_payload_hash IS NULL OR verification_auth_payload_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT reservation_evidence_auth_snapshot CHECK (
    (adapter_credential_id IS NOT NULL AND adapter_component_id IS NOT NULL
      AND adapter_component_role IS NOT NULL AND adapter_auth_signature IS NOT NULL
      AND adapter_auth_payload_hash IS NOT NULL)
    AND
    ((verification_status = 'PENDING' AND verification_credential_id IS NULL
      AND verification_component_id IS NULL AND verification_component_role IS NULL
      AND verification_auth_signature IS NULL AND verification_auth_payload_hash IS NULL)
      OR (verification_status = 'VERIFIED' AND verification_credential_id IS NOT NULL
        AND verification_component_id IS NOT NULL AND verification_component_role IS NOT NULL
        AND verification_auth_signature IS NOT NULL AND verification_auth_payload_hash IS NOT NULL))
  );

CREATE OR REPLACE FUNCTION protect_broadcast_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immutable record: reservation_broadcast_evidence' USING ERRCODE = '55000';
  END IF;
  IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash
     OR NEW.nonce IS DISTINCT FROM OLD.nonce
     OR NEW.receipt_reference IS DISTINCT FROM OLD.receipt_reference
     OR NEW.verification_source IS DISTINCT FROM OLD.verification_source
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.adapter_credential_id IS DISTINCT FROM OLD.adapter_credential_id
     OR NEW.adapter_component_id IS DISTINCT FROM OLD.adapter_component_id
     OR NEW.adapter_component_role IS DISTINCT FROM OLD.adapter_component_role
     OR NEW.adapter_auth_signature IS DISTINCT FROM OLD.adapter_auth_signature
     OR NEW.adapter_auth_payload_hash IS DISTINCT FROM OLD.adapter_auth_payload_hash THEN
    RAISE EXCEPTION 'immutable record: reservation_broadcast_evidence' USING ERRCODE = '55000';
  END IF;
  IF OLD.verification_status = 'VERIFIED'
     OR NEW.verification_status IS DISTINCT FROM 'VERIFIED'
     OR NEW.verified_at IS NULL
     OR NEW.verified_by IS NULL
     OR NEW.verification_credential_id IS NULL
     OR NEW.verification_component_id IS NULL
     OR NEW.verification_component_role IS DISTINCT FROM 'RECONCILER'
     OR NEW.verification_auth_signature IS NULL
     OR NEW.verification_auth_payload_hash IS NULL THEN
    RAISE EXCEPTION 'invalid broadcast evidence verification transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE operation_recovery_leases (
  operation_id text PRIMARY KEY REFERENCES operations (operation_id),
  reservation_id text NOT NULL UNIQUE REFERENCES budget_reservations (reservation_id),
  credential_id text NOT NULL REFERENCES trusted_component_credentials (credential_id),
  lease_version bigint NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  lease_state text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_lease_version CHECK (lease_version > 0 AND lease_version <= 9007199254740991),
  CONSTRAINT recovery_lease_state CHECK (lease_state IN ('ACTIVE', 'RESOLVED'))
);

CREATE TABLE recovery_attempts (
  attempt_id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES operations (operation_id),
  reservation_id text NOT NULL REFERENCES budget_reservations (reservation_id),
  lease_version bigint NOT NULL,
  credential_id text NOT NULL REFERENCES trusted_component_credentials (credential_id),
  outcome text NOT NULL,
  resolution_hash text NOT NULL,
  reason text NOT NULL,
  actual_spend_atomic numeric(78, 0),
  proof_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_attempt_id_format CHECK (attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'),
  CONSTRAINT recovery_attempt_lease_version CHECK (lease_version > 0 AND lease_version <= 9007199254740991),
  CONSTRAINT recovery_attempt_outcome CHECK (outcome IN ('CONFIRMED', 'FAILED', 'AMBIGUOUS', 'CONFLICT')),
  CONSTRAINT recovery_attempt_hash CHECK (resolution_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT recovery_attempt_reason CHECK (length(trim(reason)) > 0),
  CONSTRAINT recovery_attempt_spend CHECK (actual_spend_atomic IS NULL OR actual_spend_atomic >= 0),
  UNIQUE (operation_id, attempt_id)
);

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
    'policy.revoked', 'system.paused', 'system.resumed', 'adapter.error',
    'execution.recovery.claimed', 'execution.recovery.ambiguous',
    'execution.recovery.resolved', 'execution.recovery.conflict'
  ));
