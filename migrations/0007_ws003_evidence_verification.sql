ALTER TABLE reservation_broadcast_evidence
  ALTER COLUMN verified_at DROP NOT NULL,
  ADD COLUMN verification_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN verified_by text;

ALTER TABLE reservation_broadcast_evidence
  ADD CONSTRAINT reservation_broadcast_evidence_status
    CHECK (verification_status IN ('PENDING', 'VERIFIED')),
  ADD CONSTRAINT reservation_broadcast_evidence_verified_fields
    CHECK (
      (verification_status = 'PENDING' AND verified_at IS NULL AND verified_by IS NULL)
      OR (verification_status = 'VERIFIED' AND verified_at IS NOT NULL AND verified_by IS NOT NULL)
    ),
  ADD CONSTRAINT reservation_broadcast_evidence_verified_by
    CHECK (verified_by IS NULL OR verified_by ~ '^reconciler:[A-Za-z0-9][A-Za-z0-9._:-]*$');

ALTER TABLE audit_events DROP CONSTRAINT audit_events_type;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_type CHECK (event_type IN (
    'intent.created', 'intent.validated', 'policy.evaluated', 'policy.denied',
    'policy.indeterminate', 'budget.reservation.created', 'budget.reservation.authorized',
    'budget.reservation.broadcast', 'budget.reservation.evidence.verified',
    'budget.reservation.released', 'budget.reservation.expired',
    'budget.reservation.finalized', 'budget.reservation.disputed',
    'operation.state.changed', 'approval.requested', 'approval.approved',
    'approval.rejected', 'approval.expired', 'approval.revoked', 'signing.started',
    'signing.failed', 'transaction.signed', 'transaction.broadcast',
    'transaction.confirmed', 'transaction.reconciled', 'transaction.reverted',
    'operation.disputed', 'agent.revoked', 'system.paused', 'system.resumed',
    'adapter.error'
  ));

CREATE OR REPLACE FUNCTION require_reservation_broadcast_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  evidence_receipt text;
  evidence_status text;
BEGIN
  IF NEW.status IN ('BROADCAST', 'FINALIZED') THEN
    SELECT receipt_reference, verification_status
      INTO evidence_receipt, evidence_status
    FROM reservation_broadcast_evidence
    WHERE reservation_id = NEW.reservation_id;
    IF evidence_receipt IS NULL THEN
      RAISE EXCEPTION 'broadcast evidence required for reservation: %', NEW.reservation_id
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'FINALIZED' AND evidence_status <> 'VERIFIED' THEN
      RAISE EXCEPTION 'verified broadcast evidence required for finalization: %', NEW.reservation_id
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
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'immutable record: reservation_broadcast_evidence' USING ERRCODE = '55000';
  END IF;
  IF OLD.verification_status = 'VERIFIED'
     OR NEW.verification_status IS DISTINCT FROM 'VERIFIED'
     OR NEW.verified_at IS NULL
     OR NEW.verified_by IS NULL THEN
    RAISE EXCEPTION 'invalid broadcast evidence verification transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER broadcast_evidence_is_immutable
  BEFORE UPDATE OR DELETE ON reservation_broadcast_evidence
  FOR EACH ROW EXECUTE FUNCTION protect_broadcast_evidence();
