import {
  appendAuditEvent,
  type AuditContext,
  type AuditEventType,
} from "@crip/audit";
import {
  atomicUnitSchema,
  hashIdempotencyPayload,
  positiveAtomicUnitSchema,
} from "@crip/schemas";
import type { Pool, PoolClient } from "pg";

import {
  IdempotencyConflictError,
  InsufficientBudgetError,
  LedgerError,
} from "./errors.js";
import { withSerializableTransaction } from "./transaction.js";

export type ReservationStatus =
  | "HELD"
  | "AUTHORIZED"
  | "BROADCAST"
  | "FINALIZED"
  | "RELEASED"
  | "EXPIRED"
  | "DISPUTED";
export interface BudgetSnapshot {
  budgetId: string;
  allocated: string;
  available: string;
  reserved: string;
  finalizedSpend: string;
  version: string;
}

export interface BudgetResult {
  snapshot: BudgetSnapshot;
}

export interface ReservationSnapshot {
  reservationId: string;
  budgetId: string;
  operationId: string;
  idempotencyKey: string;
  amountAtomic: string;
  finalizedSpendAtomic: string;
  status: ReservationStatus;
  expiresAt: string;
  proofReference: string | null;
}

export interface ReserveRequest {
  reservationId: string;
  budgetId: string;
  operationId: string;
  idempotencyKey: string;
  idempotencyPayload: Parameters<typeof hashIdempotencyPayload>[0];
  amountAtomic: string;
  expiresAt: string | Date;
  audit: AuditContext;
}

const reservationColumns = [
  "reservation_id",
  "budget_id",
  "operation_id",
  "idempotency_key",
  "amount_atomic",
  "finalized_spend_atomic",
  "status",
  "expires_at",
  "proof_reference",
].join(", ");

type ReservationRow = {
  reservation_id: string;
  budget_id: string;
  operation_id: string;
  idempotency_key: string;
  amount_atomic: string;
  finalized_spend_atomic: string;
  status: ReservationStatus;
  expires_at: Date | string;
  proof_reference: string | null;
};

type BudgetRow = {
  budget_id: string;
  allocated: string;
  available: string;
  reserved: string;
  finalized_spend: string;
  version: string;
};

const validDate = (value: string | Date): Date => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf()))
    throw new TypeError("timestamp must be valid");
  return date;
};

const parseAtomic = (value: string, positive = false): string => {
  const parsed = (
    positive ? positiveAtomicUnitSchema : atomicUnitSchema
  ).safeParse(value);
  if (!parsed.success)
    throw new LedgerError(
      "INVALID_ATOMIC_AMOUNT",
      "amount must be a canonical uint256 decimal string",
    );
  return parsed.data;
};

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

const mapReservation = (row: ReservationRow): ReservationSnapshot => ({
  reservationId: row.reservation_id,
  budgetId: row.budget_id,
  operationId: row.operation_id,
  idempotencyKey: row.idempotency_key,
  amountAtomic: String(row.amount_atomic),
  finalizedSpendAtomic: String(row.finalized_spend_atomic),
  status: row.status,
  expiresAt: toIso(row.expires_at),
  proofReference: row.proof_reference,
});

const mapBudget = (row: BudgetRow): BudgetResult => ({
  snapshot: {
    budgetId: row.budget_id,
    allocated: String(row.allocated),
    available: String(row.available),
    reserved: String(row.reserved),
    finalizedSpend: String(row.finalized_spend),
    version: String(row.version),
  },
});

const transitionEventId = (
  audit: AuditContext,
  eventType: AuditEventType,
): string => `${audit.eventId}:${eventType.replaceAll(".", ":")}`;

const eventData = (
  reservation: ReservationSnapshot,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  reservationId: reservation.reservationId,
  amountAtomic: reservation.amountAtomic,
  ...extra,
});

const getReservationForUpdate = async (
  client: PoolClient,
  reservationId: string,
): Promise<ReservationSnapshot> => {
  const result = await client.query<ReservationRow>(
    `SELECT ${reservationColumns} FROM budget_reservations WHERE reservation_id = $1 FOR UPDATE`,
    [reservationId],
  );
  const row = result.rows[0];
  if (!row)
    throw new LedgerError(
      "RESERVATION_NOT_FOUND",
      `reservation not found: ${reservationId}`,
    );
  return mapReservation(row);
};

const getReservation = async (
  client: PoolClient,
  reservationId: string,
): Promise<ReservationSnapshot> => {
  const result = await client.query<ReservationRow>(
    `SELECT ${reservationColumns} FROM budget_reservations WHERE reservation_id = $1`,
    [reservationId],
  );
  const row = result.rows[0];
  if (!row)
    throw new LedgerError(
      "RESERVATION_NOT_FOUND",
      `reservation not found: ${reservationId}`,
    );
  return mapReservation(row);
};

export const getBudget = async (
  pool: Pool,
  budgetId: string,
): Promise<BudgetResult> => {
  const result = await pool.query<BudgetRow>(
    "SELECT budget_id, allocated, available, reserved, finalized_spend, version FROM budget_accounts WHERE budget_id = $1",
    [budgetId],
  );
  const row = result.rows[0];
  if (!row)
    throw new LedgerError(
      "RESERVATION_NOT_FOUND",
      `budget not found: ${budgetId}`,
    );
  return mapBudget(row);
};

/** Atomically check available funds, reserve them, persist idempotency, and append audit. */
export const reserveBudget = async (
  pool: Pool,
  request: ReserveRequest,
): Promise<ReservationSnapshot> => {
  const amount = parseAtomic(request.amountAtomic, true);
  const expiresAt = validDate(request.expiresAt);
  const payloadHash = hashIdempotencyPayload(request.idempotencyPayload);
  return withSerializableTransaction(pool, async (client) => {
    const operation = await client.query<{ intent_id: string }>(
      "SELECT intent_id FROM operations WHERE operation_id = $1",
      [request.operationId],
    );
    const operationRow = operation.rows[0];
    if (!operationRow)
      throw new LedgerError(
        "RESERVATION_NOT_FOUND",
        `operation not found: ${request.operationId}`,
      );

    const insertedIdempotency = await client.query<{
      reservation_id: string | null;
    }>(
      `INSERT INTO idempotency_records (idempotency_key, payload_hash, intent_id, operation_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING reservation_id`,
      [
        request.idempotencyKey,
        payloadHash,
        operationRow.intent_id,
        request.operationId,
      ],
    );
    if (!insertedIdempotency.rowCount) {
      const existing = await client.query<{
        payload_hash: string;
        reservation_id: string | null;
      }>(
        "SELECT payload_hash, reservation_id FROM idempotency_records WHERE idempotency_key = $1 FOR UPDATE",
        [request.idempotencyKey],
      );
      const existingRow = existing.rows[0];
      if (!existingRow || existingRow.payload_hash !== payloadHash)
        throw new IdempotencyConflictError(request.idempotencyKey);
      if (!existingRow.reservation_id)
        throw new Error("idempotency record has no result reservation");
      return getReservation(client, existingRow.reservation_id);
    }

    const budget = await client.query<{ available: string }>(
      "SELECT available FROM budget_accounts WHERE budget_id = $1 FOR UPDATE",
      [request.budgetId],
    );
    const budgetRow = budget.rows[0];
    if (!budgetRow)
      throw new LedgerError(
        "RESERVATION_NOT_FOUND",
        `budget not found: ${request.budgetId}`,
      );
    if (BigInt(budgetRow.available) < BigInt(amount))
      throw new InsufficientBudgetError(
        request.budgetId,
        amount,
        String(budgetRow.available),
      );
    await client.query(
      `UPDATE budget_accounts
       SET available = available - $1::numeric, reserved = reserved + $1::numeric,
           version = version + 1, updated_at = now() WHERE budget_id = $2`,
      [amount, request.budgetId],
    );
    const insertedReservation = await client.query<ReservationRow>(
      `INSERT INTO budget_reservations
         (reservation_id, budget_id, operation_id, idempotency_key, amount_atomic, status, expires_at)
       VALUES ($1, $2, $3, $4, $5::numeric, 'HELD', $6)
       RETURNING ${reservationColumns}`,
      [
        request.reservationId,
        request.budgetId,
        request.operationId,
        request.idempotencyKey,
        amount,
        expiresAt,
      ],
    );
    const reservation = mapReservation(insertedReservation.rows[0]!);
    await client.query(
      "UPDATE idempotency_records SET reservation_id = $1 WHERE idempotency_key = $2",
      [reservation.reservationId, request.idempotencyKey],
    );
    await appendAuditEvent(client, {
      ...request.audit,
      eventId: transitionEventId(request.audit, "budget.reservation.created"),
      eventType: "budget.reservation.created",
      data: eventData(reservation),
    });
    return reservation;
  });
};

type TransitionInput = { reservationId: string; audit: AuditContext };

const transitionReservation = async (
  pool: Pool,
  input: TransitionInput,
  transition: (
    client: PoolClient,
    reservation: ReservationSnapshot,
  ) => Promise<ReservationSnapshot>,
): Promise<ReservationSnapshot> =>
  withSerializableTransaction(pool, async (client) =>
    transition(
      client,
      await getReservationForUpdate(client, input.reservationId),
    ),
  );

const writeTransitionAudit = async (
  client: PoolClient,
  audit: AuditContext,
  eventType: AuditEventType,
  reservation: ReservationSnapshot,
  data: Record<string, unknown> = {},
): Promise<void> =>
  appendAuditEvent(client, {
    ...audit,
    eventId: transitionEventId(audit, eventType),
    eventType,
    data: eventData(reservation, data),
  });

export const releaseReservation = (
  pool: Pool,
  input: TransitionInput,
): Promise<ReservationSnapshot> =>
  transitionReservation(pool, input, async (client, reservation) => {
    if (reservation.status === "RELEASED") return reservation;
    if (reservation.status !== "HELD" && reservation.status !== "AUTHORIZED")
      throw new LedgerError(
        "INVALID_RESERVATION_TRANSITION",
        `cannot release ${reservation.status} reservation`,
      );
    await client.query(
      `UPDATE budget_accounts SET available = available + $1::numeric, reserved = reserved - $1::numeric,
       version = version + 1, updated_at = now() WHERE budget_id = $2`,
      [reservation.amountAtomic, reservation.budgetId],
    );
    await client.query(
      "UPDATE budget_reservations SET status = 'RELEASED', updated_at = now() WHERE reservation_id = $1",
      [reservation.reservationId],
    );
    const next = { ...reservation, status: "RELEASED" as const };
    await writeTransitionAudit(
      client,
      input.audit,
      "budget.reservation.released",
      next,
    );
    return next;
  });

export const expireReservation = (
  pool: Pool,
  input: TransitionInput & { now: string | Date },
): Promise<ReservationSnapshot> =>
  transitionReservation(pool, input, async (client, reservation) => {
    if (reservation.status === "EXPIRED") return reservation;
    if (reservation.status !== "HELD" && reservation.status !== "AUTHORIZED")
      throw new LedgerError(
        "INVALID_RESERVATION_TRANSITION",
        `cannot expire ${reservation.status} reservation`,
      );
    const now = validDate(input.now);
    if (new Date(reservation.expiresAt).getTime() > now.getTime())
      throw new LedgerError(
        "RESERVATION_NOT_EXPIRED",
        `reservation ${reservation.reservationId} has not expired`,
      );
    await client.query(
      `UPDATE budget_accounts SET available = available + $1::numeric, reserved = reserved - $1::numeric,
       version = version + 1, updated_at = now() WHERE budget_id = $2`,
      [reservation.amountAtomic, reservation.budgetId],
    );
    await client.query(
      "UPDATE budget_reservations SET status = 'EXPIRED', updated_at = now() WHERE reservation_id = $1",
      [reservation.reservationId],
    );
    const next = { ...reservation, status: "EXPIRED" as const };
    await writeTransitionAudit(
      client,
      input.audit,
      "budget.reservation.expired",
      next,
    );
    return next;
  });

export const finalizeReservation = (
  pool: Pool,
  input: TransitionInput & {
    actualSpendAtomic: string;
    proofReference: string;
  },
): Promise<ReservationSnapshot> => {
  const actualSpend = parseAtomic(input.actualSpendAtomic);
  return transitionReservation(pool, input, async (client, reservation) => {
    if (reservation.status === "FINALIZED") return reservation;
    if (
      !["HELD", "AUTHORIZED", "BROADCAST", "DISPUTED"].includes(
        reservation.status,
      )
    )
      throw new LedgerError(
        "INVALID_RESERVATION_TRANSITION",
        `cannot finalize ${reservation.status} reservation`,
      );
    if (BigInt(actualSpend) > BigInt(reservation.amountAtomic))
      throw new LedgerError(
        "INVALID_ATOMIC_AMOUNT",
        "actual spend exceeds reserved amount",
      );
    await client.query(
      `UPDATE budget_accounts
       SET available = available + ($1::numeric - $2::numeric), reserved = reserved - $1::numeric,
           finalized_spend = finalized_spend + $2::numeric, version = version + 1, updated_at = now()
       WHERE budget_id = $3`,
      [reservation.amountAtomic, actualSpend, reservation.budgetId],
    );
    await client.query(
      `UPDATE budget_reservations SET status = 'FINALIZED', finalized_spend_atomic = $1::numeric,
       proof_reference = $2, updated_at = now() WHERE reservation_id = $3`,
      [actualSpend, input.proofReference, reservation.reservationId],
    );
    const next = {
      ...reservation,
      status: "FINALIZED" as const,
      finalizedSpendAtomic: actualSpend,
      proofReference: input.proofReference,
    };
    await writeTransitionAudit(
      client,
      input.audit,
      "budget.reservation.finalized",
      next,
      { proofReference: input.proofReference },
    );
    return next;
  });
};

export const disputeReservation = (
  pool: Pool,
  input: TransitionInput & { reason: string },
): Promise<ReservationSnapshot> =>
  transitionReservation(pool, input, async (client, reservation) => {
    if (reservation.status === "DISPUTED") return reservation;
    if (!["HELD", "AUTHORIZED", "BROADCAST"].includes(reservation.status))
      throw new LedgerError(
        "INVALID_RESERVATION_TRANSITION",
        `cannot dispute ${reservation.status} reservation`,
      );
    await client.query(
      "UPDATE budget_reservations SET status = 'DISPUTED', updated_at = now() WHERE reservation_id = $1",
      [reservation.reservationId],
    );
    const next = { ...reservation, status: "DISPUTED" as const };
    await writeTransitionAudit(
      client,
      input.audit,
      "budget.reservation.disputed",
      next,
      { reason: input.reason },
    );
    return next;
  });
