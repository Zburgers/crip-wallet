-- P3-04: permit signed/no-attempt release only through authenticated recovery
-- under the exact live lease, with operation and ledger changes in one transaction.

ALTER TABLE recovery_attempts
  ADD CONSTRAINT recovery_attempt_controlled_no_send_shape CHECK (
    reason <> 'SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT'
    OR (
      outcome = 'FAILED'
      AND actual_spend_atomic IS NULL
      AND proof_reference IS NULL
    )
  );

CREATE UNIQUE INDEX recovery_attempts_one_controlled_no_send
  ON recovery_attempts (operation_id)
  WHERE reason = 'SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT';

CREATE OR REPLACE FUNCTION fence_send_capable_attempt_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('HELD', 'AUTHORIZED', 'DISPUTED')
     AND NEW.status IN ('RELEASED', 'EXPIRED') THEN
    IF EXISTS (
      SELECT 1 FROM broadcast_attempts a
      WHERE a.reservation_id = OLD.reservation_id
        AND a.status IN ('STARTED', 'ACCEPTED', 'UNKNOWN', 'CONFLICT')
    ) THEN
      RAISE EXCEPTION 'send-capable broadcast attempt fences reservation release: %', OLD.reservation_id
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM signed_transactions s
      WHERE s.operation_id = OLD.operation_id
        AND s.reservation_id = OLD.reservation_id
    ) AND NOT (
      OLD.status = 'DISPUTED'
      AND NEW.status = 'RELEASED'
      AND EXISTS (
        SELECT 1
        FROM signed_transactions s
        JOIN authorization_evidence ae
          ON ae.authorization_id = s.authorization_id
         AND ae.operation_id = s.operation_id
         AND ae.reservation_id = s.reservation_id
         AND ae.envelope_id = s.envelope_id
         AND ae.envelope_revision = s.envelope_revision
         AND ae.envelope_hash = s.envelope_hash
        JOIN execution_envelopes e
          ON e.operation_id = s.operation_id
         AND e.envelope_id = s.envelope_id
         AND e.revision = s.envelope_revision
         AND e.envelope_hash = s.envelope_hash
        JOIN authorization_invalidations ai
          ON ai.authorization_id = ae.authorization_id
         AND ai.operation_id = ae.operation_id
        JOIN audit_events control_event
          ON control_event.event_id = ai.control_event_id
        JOIN recovery_attempts ra
          ON ra.operation_id = s.operation_id
         AND ra.reservation_id = s.reservation_id
         AND ra.outcome = 'FAILED'
         AND ra.reason = 'SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT'
        JOIN operation_recovery_leases lease
          ON lease.operation_id = s.operation_id
         AND lease.reservation_id = s.reservation_id
         AND lease.credential_id = ra.credential_id
         AND lease.lease_version = ra.lease_version
         AND lease.lease_state = 'ACTIVE'
         AND lease.lease_expires_at > clock_timestamp()
        JOIN operations o ON o.operation_id = s.operation_id
        WHERE s.operation_id = OLD.operation_id
          AND s.reservation_id = OLD.reservation_id
          AND o.current_state = 'RECONCILED'
          AND control_event.event_type IN (
            'agent.revoked', 'owner.revoked', 'policy.revoked', 'system.paused'
          )
          AND (SELECT count(*) FROM signed_transactions all_signed
               WHERE all_signed.operation_id = s.operation_id
                 AND all_signed.reservation_id = s.reservation_id) = 1
          AND NOT EXISTS (
            SELECT 1 FROM broadcast_attempts a
            WHERE a.operation_id = s.operation_id
               OR a.reservation_id = s.reservation_id
               OR a.signed_transaction_id = s.signed_transaction_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM execution_economic_effects effect
            WHERE effect.operation_id = s.operation_id
               OR effect.reservation_id = s.reservation_id
          )
      )
    ) THEN
      RAISE EXCEPTION 'signed transaction requires authenticated proven-no-send recovery before release: %', OLD.reservation_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
