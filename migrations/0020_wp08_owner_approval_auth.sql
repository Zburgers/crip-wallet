-- WP-08: ADR-0008 local-owner approval authentication.
--
-- Private owner key material intentionally does not live in this schema. Local
-- bootstrap persists only the public verification key; the signed decision
-- artifact is bound to the immutable approval inputs and is consumed in the
-- same transaction that creates authorization_evidence.

CREATE TABLE local_owner_approval_keys (
  key_id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES owners (owner_id),
  algorithm text NOT NULL DEFAULT 'ED25519',
  public_key text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (owner_id, key_id),
  CONSTRAINT local_owner_approval_keys_algorithm CHECK (algorithm = 'ED25519'),
  CONSTRAINT local_owner_approval_keys_status CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT local_owner_approval_keys_id_format CHECK (
    key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'
  ),
  CONSTRAINT local_owner_approval_keys_revocation CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE owner_approval_authentications (
  authentication_id text PRIMARY KEY,
  approval_id text NOT NULL UNIQUE REFERENCES approval_requests (approval_id),
  owner_id text NOT NULL REFERENCES owners (owner_id),
  approver_id text NOT NULL,
  key_id text NOT NULL,
  envelope_hash text NOT NULL,
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  nonce text NOT NULL UNIQUE,
  signature text NOT NULL,
  authenticated_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_id, key_id)
    REFERENCES local_owner_approval_keys (owner_id, key_id),
  CONSTRAINT owner_approval_authentication_hash CHECK (
    envelope_hash ~ '^0x[0-9a-f]{64}$'
  ),
  CONSTRAINT owner_approval_authentication_policy_version CHECK (policy_version > 0),
  CONSTRAINT owner_approval_authentication_signature CHECK (
    signature ~ '^[A-Za-z0-9_-]{86}$'
  ),
  CONSTRAINT owner_approval_authentication_id_format CHECK (
    authentication_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$' AND
    approver_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$' AND
    key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$' AND
    policy_id ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$' AND
    nonce ~ '^[A-Za-z0-9][A-Za-z0-9._:_-]*$'
  ),
  CONSTRAINT owner_approval_authentication_lifetime CHECK (
    authenticated_at < expires_at
    AND (consumed_at IS NULL OR (consumed_at >= authenticated_at AND consumed_at < expires_at))
  )
);

ALTER TABLE authorization_evidence
  ADD COLUMN owner_authentication_id text
    REFERENCES owner_approval_authentications (authentication_id);

CREATE OR REPLACE FUNCTION enforce_owner_approval_authentication_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'owner approval authentication evidence is immutable: %', OLD.authentication_id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.authentication_id IS DISTINCT FROM OLD.authentication_id
     OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.approver_id IS DISTINCT FROM OLD.approver_id
     OR NEW.key_id IS DISTINCT FROM OLD.key_id
     OR NEW.envelope_hash IS DISTINCT FROM OLD.envelope_hash
     OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.nonce IS DISTINCT FROM OLD.nonce
     OR NEW.signature IS DISTINCT FROM OLD.signature
     OR NEW.authenticated_at IS DISTINCT FROM OLD.authenticated_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'owner approval authentication binding is immutable: %', NEW.authentication_id
      USING ERRCODE = '55000';
  END IF;

  IF OLD.consumed_at IS NOT NULL
     OR NEW.consumed_at IS NULL
     OR NEW.consumed_at < NEW.authenticated_at
     OR NEW.consumed_at >= NEW.expires_at THEN
    RAISE EXCEPTION 'invalid owner approval authentication consumption: %', NEW.authentication_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER owner_approval_authentications_immutable
  BEFORE UPDATE OR DELETE ON owner_approval_authentications
  FOR EACH ROW EXECUTE FUNCTION enforce_owner_approval_authentication_immutability();

CREATE OR REPLACE FUNCTION enforce_authenticated_owner_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  authentication record;
  expected_owner_id text;
BEGIN
  IF TG_OP <> 'UPDATE'
     OR OLD.status IS NOT DISTINCT FROM NEW.status
     OR OLD.status <> 'PENDING'
     OR NEW.status <> 'APPROVED' THEN
    RETURN NEW;
  END IF;

  SELECT agent.owner_id
  INTO expected_owner_id
  FROM operations operation
  JOIN agents agent ON agent.agent_id = operation.agent_id
  WHERE operation.operation_id = NEW.operation_id;

  SELECT evidence.*, owner_key.status AS key_status
  INTO authentication
  FROM owner_approval_authentications evidence
  JOIN local_owner_approval_keys owner_key
    ON owner_key.owner_id = evidence.owner_id
   AND owner_key.key_id = evidence.key_id
  WHERE evidence.approval_id = NEW.approval_id;

  IF expected_owner_id IS NULL
     OR NOT FOUND
     OR authentication.key_status <> 'ACTIVE'
     OR authentication.consumed_at IS NOT NULL
     OR authentication.owner_id IS DISTINCT FROM expected_owner_id
     OR authentication.approver_id IS DISTINCT FROM NEW.approver_id
     OR authentication.envelope_hash IS DISTINCT FROM NEW.envelope_hash
     OR authentication.policy_id IS DISTINCT FROM NEW.policy_id
     OR authentication.policy_version IS DISTINCT FROM NEW.policy_version
     OR authentication.expires_at IS DISTINCT FROM NEW.expires_at
     OR authentication.nonce IS DISTINCT FROM NEW.nonce
     OR NEW.approved_at IS NULL
     OR NEW.approved_at < authentication.authenticated_at
     OR NEW.approved_at >= authentication.expires_at THEN
    RAISE EXCEPTION 'approved owner decision lacks valid ADR-0008 authentication evidence: %', NEW.approval_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_requests_owner_authentication_guard
  BEFORE UPDATE OF status, approver_id, approved_at ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_authenticated_owner_approval();

CREATE OR REPLACE FUNCTION consume_owner_approval_authentication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  authentication record;
  changed integer;
BEGIN
  SELECT evidence.authentication_id, evidence.owner_id, evidence.approver_id,
         evidence.envelope_hash, evidence.policy_id, evidence.policy_version,
         evidence.expires_at, evidence.nonce, evidence.consumed_at,
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

CREATE TRIGGER authorization_evidence_owner_authentication_guard
  BEFORE INSERT ON authorization_evidence
  FOR EACH ROW EXECUTE FUNCTION consume_owner_approval_authentication();
