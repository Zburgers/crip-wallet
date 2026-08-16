DROP TRIGGER broadcast_evidence_is_immutable ON reservation_broadcast_evidence;

ALTER TABLE reservation_broadcast_evidence
  ALTER COLUMN verified_at DROP DEFAULT;

UPDATE reservation_broadcast_evidence
SET verified_at = NULL, verified_by = NULL
WHERE verification_status = 'PENDING';

ALTER TABLE reservation_broadcast_evidence
  DROP CONSTRAINT reservation_broadcast_evidence_verified_fields;

ALTER TABLE reservation_broadcast_evidence
  ADD CONSTRAINT reservation_broadcast_evidence_verified_fields
    CHECK (
      (verification_status = 'PENDING' AND verified_at IS NULL AND verified_by IS NULL)
      OR (verification_status = 'VERIFIED' AND verified_at IS NOT NULL AND verified_by IS NOT NULL)
    );

CREATE TRIGGER broadcast_evidence_is_immutable
  BEFORE UPDATE OR DELETE ON reservation_broadcast_evidence
  FOR EACH ROW EXECUTE FUNCTION protect_broadcast_evidence();
