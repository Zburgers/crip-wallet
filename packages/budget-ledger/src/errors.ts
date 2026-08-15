export type LedgerErrorCode =
  | "INSUFFICIENT_BUDGET"
  | "IDEMPOTENCY_CONFLICT"
  | "RESERVATION_NOT_FOUND"
  | "INVALID_RESERVATION_TRANSITION"
  | "RESERVATION_NOT_EXPIRED"
  | "INVALID_PROOF_REFERENCE"
  | "INVALID_BROADCAST_EVIDENCE"
  | "BUDGET_BINDING_MISMATCH"
  | "AUDIT_CORRELATION_MISMATCH"
  | "CONTROL_FENCE_INACTIVE"
  | "INVALID_ATOMIC_AMOUNT"
  | "COMPONENT_NOT_TRUSTED"
  | "COMPONENT_AUTHENTICATION_FAILED"
  | "RECOVERY_LEASE_HELD"
  | "RECOVERY_LEASE_STALE"
  | "RECOVERY_CONFLICT";

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

export class IdempotencyConflictError extends LedgerError {
  constructor(readonly idempotencyKey: string) {
    super(
      "IDEMPOTENCY_CONFLICT",
      `idempotency key conflicts with a different payload: ${idempotencyKey}`,
    );
  }
}

export class InsufficientBudgetError extends LedgerError {
  constructor(
    readonly budgetId: string,
    readonly requested: string,
    readonly available: string,
  ) {
    super(
      "INSUFFICIENT_BUDGET",
      `budget ${budgetId} has ${available} available; requested ${requested}`,
    );
  }
}
