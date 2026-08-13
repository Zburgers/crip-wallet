export type LedgerErrorCode =
  | "INSUFFICIENT_BUDGET"
  | "IDEMPOTENCY_CONFLICT"
  | "RESERVATION_NOT_FOUND"
  | "INVALID_RESERVATION_TRANSITION"
  | "RESERVATION_NOT_EXPIRED"
  | "INVALID_ATOMIC_AMOUNT";

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
