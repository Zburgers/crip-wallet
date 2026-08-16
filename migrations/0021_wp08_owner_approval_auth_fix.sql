-- WP-08 corrective migration: populate the authenticated-at field used by the
-- owner approval consumption trigger. Migration 0020 is already checksum-locked.

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
