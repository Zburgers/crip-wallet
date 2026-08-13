CREATE TABLE reservation_broadcast_evidence (
  reservation_id text PRIMARY KEY REFERENCES budget_reservations (reservation_id),
  transaction_hash text NOT NULL,
  nonce numeric(78, 0) NOT NULL,
  receipt_reference text NOT NULL,
  verification_source text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_broadcast_evidence_hash CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT reservation_broadcast_evidence_nonce CHECK (nonce >= 0),
  CONSTRAINT reservation_broadcast_evidence_receipt CHECK (receipt_reference ~ '^receipt:[A-Za-z0-9._:/-]+$'),
  CONSTRAINT reservation_broadcast_evidence_source CHECK (verification_source ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
);

CREATE OR REPLACE FUNCTION require_reservation_broadcast_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  evidence_receipt text;
BEGIN
  IF NEW.status IN ('BROADCAST', 'FINALIZED') THEN
    SELECT receipt_reference INTO evidence_receipt
    FROM reservation_broadcast_evidence
    WHERE reservation_id = NEW.reservation_id;
    IF evidence_receipt IS NULL THEN
      RAISE EXCEPTION 'broadcast evidence required for reservation: %', NEW.reservation_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'FINALIZED' AND NEW.proof_reference IS DISTINCT FROM evidence_receipt THEN
    RAISE EXCEPTION 'finalization proof must match verified receipt: %', NEW.reservation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservation_broadcast_requires_evidence
  BEFORE INSERT OR UPDATE ON budget_reservations
  FOR EACH ROW EXECUTE FUNCTION require_reservation_broadcast_evidence();

CREATE OR REPLACE FUNCTION enforce_reservation_budget_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  binding_matches boolean;
BEGIN
  SELECT (o.agent_id, o.wallet_id, o.policy_id, o.policy_version) =
         (b.agent_id, b.wallet_id, b.policy_id, b.policy_version)
  INTO binding_matches
  FROM operations o
  JOIN budget_accounts b ON b.budget_id = NEW.budget_id
  WHERE o.operation_id = NEW.operation_id;
  IF binding_matches IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'reservation operation/budget binding mismatch: %', NEW.reservation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservation_budget_binding_guard
  BEFORE INSERT OR UPDATE ON budget_reservations
  FOR EACH ROW EXECUTE FUNCTION enforce_reservation_budget_binding();
