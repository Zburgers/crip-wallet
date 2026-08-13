ALTER TABLE audit_events DROP CONSTRAINT audit_events_type;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_type CHECK (event_type IN (
    'intent.created', 'intent.validated', 'policy.evaluated', 'policy.denied',
    'policy.indeterminate', 'budget.reservation.created', 'budget.reservation.authorized',
    'budget.reservation.broadcast', 'budget.reservation.released',
    'budget.reservation.expired', 'budget.reservation.finalized',
    'budget.reservation.disputed', 'operation.state.changed', 'approval.requested',
    'approval.approved', 'approval.rejected', 'approval.expired', 'approval.revoked',
    'signing.started', 'signing.failed', 'transaction.signed', 'transaction.broadcast',
    'transaction.confirmed', 'transaction.reconciled', 'transaction.reverted',
    'operation.disputed', 'agent.revoked', 'system.paused', 'system.resumed',
    'adapter.error'
  ));
