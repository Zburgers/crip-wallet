-- P3-04: persist authenticated recovery lease renewals in the append-only audit.

ALTER TABLE audit_events DROP CONSTRAINT audit_events_type;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_type CHECK (event_type IN (
  'intent.created', 'intent.validated', 'policy.evaluated', 'policy.denied',
  'policy.indeterminate', 'budget.reservation.created', 'budget.reservation.authorized',
  'budget.reservation.broadcast', 'budget.reservation.evidence.verified',
  'budget.reservation.released', 'budget.reservation.expired', 'budget.reservation.finalized',
  'budget.reservation.disputed', 'operation.state.changed', 'authorization.invalidated',
  'approval.requested', 'approval.approved', 'approval.consumed', 'approval.rejected',
  'approval.expired', 'approval.revoked', 'signing.started', 'signing.failed',
  'transaction.signed', 'transaction.broadcast', 'transaction.confirmed',
  'transaction.reconciled', 'transaction.reverted', 'operation.disputed',
  'agent.revoked', 'owner.revoked', 'policy.revoked', 'system.paused',
  'system.resumed', 'adapter.error', 'execution.recovery.claimed',
  'execution.recovery.lease_renewed', 'execution.recovery.ambiguous',
  'execution.recovery.resolved', 'execution.recovery.conflict',
  'transaction.constructed', 'transaction.decoded', 'transaction.verified',
  'transaction.simulated', 'transaction.signing.started', 'transaction.broadcast.attempted',
  'transaction.broadcast.accepted', 'transaction.broadcast.rejected',
  'transaction.broadcast.unknown', 'transaction.confirmation.mismatch',
  'transaction.reconciliation.effect'
));
