-- WS-005 P3-01: make the pre-sign evidence identity and send lineage
-- unconditionally unique. Application-generated IDs remain deterministic;
-- these constraints are the database backstop.

CREATE UNIQUE INDEX signed_transactions_one_authorization
  ON signed_transactions (operation_id, authorization_id);

DROP INDEX IF EXISTS broadcast_attempts_one_started;
CREATE UNIQUE INDEX broadcast_attempts_one_per_signed_transaction
  ON broadcast_attempts (signed_transaction_id);

-- The existing canonical reservation guard remains the pre-sign authority
-- foundation. P3-02 will extend its state matrix for signed/no-attempt and
-- send-capable control races without weakening this gate.
