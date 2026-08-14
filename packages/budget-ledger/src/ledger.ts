import {
  appendAuditEvent,
  type AuditContext,
  type AuditCorrelation,
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

export interface BroadcastEvidence {
  transactionHash: string;
  nonce: string;
  receiptReference: string;
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
const qualifiedReservationColumns = [
  "r.reservation_id",
  "r.budget_id",
  "r.operation_id",
  "r.idempotency_key",
  "r.amount_atomic",
  "r.finalized_spend_atomic",
  "r.status",
  "r.expires_at",
  "r.proof_reference",
].join(", ");

type ReservationRow = {
  reservation_id: string;
  budget_id: string;
  operation_id: string;
  agent_id: string;
  wallet_id: string;
  policy_id: string;
  policy_version: number;
  idempotency_key: string;
  amount_atomic: string;
  finalized_spend_atomic: string;
  status: ReservationStatus;
  expires_at: Date | string;
  proof_reference: string | null;
  intent_row_id: string;
  intent_agent_id: string;
  intent_wallet_id: string;
  intent_policy_id: string;
  intent_policy_version: number;
  budget_agent_id: string;
  budget_wallet_id: string;
  budget_policy_id: string;
  budget_policy_version: number;
  owner_id: string;
  wallet_owner_id: string;
  policy_owner_id: string;
  policy_agent_id: string;
  policy_wallet_id: string;
};

type ReservationBinding = {
  reservation: ReservationSnapshot;
  correlation: AuditCorrelation;
};

type BindingRow = Pick<
  ReservationRow,
  | "reservation_id"
  | "budget_id"
  | "operation_id"
  | "intent_row_id"
  | "agent_id"
  | "wallet_id"
  | "policy_id"
  | "policy_version"
  | "intent_agent_id"
  | "intent_wallet_id"
  | "intent_policy_id"
  | "intent_policy_version"
  | "budget_agent_id"
  | "budget_wallet_id"
  | "budget_policy_id"
  | "budget_policy_version"
  | "owner_id"
  | "wallet_owner_id"
  | "policy_owner_id"
  | "policy_agent_id"
  | "policy_wallet_id"
>;

type BudgetRow = {
  budget_id: string;
  allocated: string;
  available: string;
  reserved: string;
  finalized_spend: string;
  version: string;
};

type BroadcastEvidenceRow = {
  transaction_hash: string;
  nonce: string;
  receipt_reference: string;
  verification_source: string;
  verification_status: "PENDING" | "VERIFIED";
  verified_at: Date | string | null;
  verified_by: string | null;
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

const parseBroadcastEvidence = (
  evidence: BroadcastEvidence,
): BroadcastEvidence => {
  if (!/^0x[0-9a-f]{64}$/.test(evidence.transactionHash))
    throw new LedgerError(
      "INVALID_BROADCAST_EVIDENCE",
      "broadcast evidence requires a canonical transaction hash",
    );
  const nonce = parseAtomic(evidence.nonce);
  if (!/^receipt:[A-Za-z0-9._:/-]+$/.test(evidence.receiptReference))
    throw new LedgerError(
      "INVALID_BROADCAST_EVIDENCE",
      "broadcast evidence requires a canonical receipt reference",
    );
  return { ...evidence, nonce };
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

const assertAuditCorrelation = (
  audit: AuditContext,
  correlation: AuditCorrelation,
): void => {
  for (const [field, assertedValue] of Object.entries(
    audit.assertedCorrelation ?? {},
  )) {
    if (
      assertedValue !== undefined &&
      assertedValue !== correlation[field as keyof AuditCorrelation]
    )
      throw new LedgerError(
        "AUDIT_CORRELATION_MISMATCH",
        `audit correlation assertion does not match persisted ${field}`,
      );
  }
};

const mapAuditCorrelation = (row: BindingRow): AuditCorrelation => ({
  reservationId: row.reservation_id,
  budgetId: row.budget_id,
  ownerId: row.owner_id,
  agentId: row.agent_id,
  walletId: row.wallet_id,
  intentId: row.intent_row_id,
  operationId: row.operation_id,
  policyId: row.policy_id,
  policyVersion: row.policy_version,
});

const assertBindingConsistency = (row: BindingRow): void => {
  if (
    row.intent_agent_id !== row.agent_id ||
    row.intent_wallet_id !== row.wallet_id ||
    row.intent_policy_id !== row.policy_id ||
    row.intent_policy_version !== row.policy_version ||
    row.budget_agent_id !== row.agent_id ||
    row.budget_wallet_id !== row.wallet_id ||
    row.budget_policy_id !== row.policy_id ||
    row.budget_policy_version !== row.policy_version ||
    row.owner_id !== row.wallet_owner_id ||
    row.owner_id !== row.policy_owner_id ||
    row.policy_agent_id !== row.agent_id ||
    row.policy_wallet_id !== row.wallet_id
  )
    throw new LedgerError(
      "BUDGET_BINDING_MISMATCH",
      "reservation, budget, operation, intent, and policy bindings differ",
    );
};

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
): Promise<ReservationBinding> => {
  const result = await client.query<ReservationRow>(
    `SELECT ${qualifiedReservationColumns},
            o.agent_id,
            o.wallet_id,
            o.policy_id,
            o.policy_version,
            i.intent_id AS intent_row_id,
            i.agent_id AS intent_agent_id,
            i.wallet_id AS intent_wallet_id,
            i.policy_id AS intent_policy_id,
            i.policy_version AS intent_policy_version,
            b.agent_id AS budget_agent_id,
            b.wallet_id AS budget_wallet_id,
            b.policy_id AS budget_policy_id,
            b.policy_version AS budget_policy_version,
            a.owner_id,
            w.owner_id AS wallet_owner_id,
            p.owner_id AS policy_owner_id,
            p.agent_id AS policy_agent_id,
            p.wallet_id AS policy_wallet_id
     FROM budget_reservations r
     JOIN budget_accounts b ON b.budget_id = r.budget_id
     JOIN operations o ON o.operation_id = r.operation_id
     JOIN intents i ON i.intent_id = o.intent_id
     JOIN agents a ON a.agent_id = o.agent_id
     JOIN wallets w ON w.wallet_id = o.wallet_id
     JOIN policies p ON p.policy_id = o.policy_id
     WHERE r.reservation_id = $1
     FOR UPDATE OF r, b, o, i, a, w, p`,
    [reservationId],
  );
  const row = result.rows[0];
  if (!row)
    throw new LedgerError(
      "RESERVATION_NOT_FOUND",
      `reservation not found: ${reservationId}`,
    );
  assertBindingConsistency(row);
  const reservation = mapReservation(row);
  return { reservation, correlation: mapAuditCorrelation(row) };
};

const getReservationBindingForReserve = async (
  client: PoolClient,
  budgetId: string,
  operationId: string,
): Promise<AuditCorrelation> => {
  const result = await client.query<BindingRow>(
    `SELECT $3::text AS reservation_id, b.budget_id, o.operation_id,
            o.intent_id AS intent_row_id, o.agent_id, o.wallet_id,
            o.policy_id, o.policy_version,
            i.agent_id AS intent_agent_id,
            i.wallet_id AS intent_wallet_id,
            i.policy_id AS intent_policy_id,
            i.policy_version AS intent_policy_version,
            b.agent_id AS budget_agent_id,
            b.wallet_id AS budget_wallet_id,
            b.policy_id AS budget_policy_id,
            b.policy_version AS budget_policy_version,
            a.owner_id,
            w.owner_id AS wallet_owner_id,
            p.owner_id AS policy_owner_id,
            p.agent_id AS policy_agent_id,
            p.wallet_id AS policy_wallet_id
     FROM operations o
     JOIN intents i ON i.intent_id = o.intent_id
     JOIN agents a ON a.agent_id = o.agent_id
     JOIN wallets w ON w.wallet_id = o.wallet_id
     JOIN policies p ON p.policy_id = o.policy_id
     JOIN budget_accounts b ON b.budget_id = $1
     WHERE o.operation_id = $2
     FOR UPDATE OF o, b, i, a, w, p`,
    [budgetId, operationId, "pending"],
  );
  const row = result.rows[0];
  if (!row)
    throw new LedgerError(
      "RESERVATION_NOT_FOUND",
      `operation or budget not found: ${operationId}/${budgetId}`,
    );
  assertBindingConsistency(row);
  return mapAuditCorrelation(row);
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

const getBroadcastEvidence = async (
  client: PoolClient,
  reservationId: string,
): Promise<BroadcastEvidenceRow> => {
  const result = await client.query<BroadcastEvidenceRow>(
    `SELECT transaction_hash, nonce, receipt_reference, verification_source,
            verification_status, verified_at, verified_by
     FROM reservation_broadcast_evidence WHERE reservation_id = $1`,
    [reservationId],
  );
  const row = result.rows[0];
  if (!row)
    throw new LedgerError(
      "INVALID_BROADCAST_EVIDENCE",
      `verified broadcast evidence is missing: ${reservationId}`,
    );
  return row;
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
  const payloadHash = hashIdempotencyPayload({
    request: {
      amountAtomic: amount,
      budgetId: request.budgetId,
      expiresAt: expiresAt.toISOString(),
      operationId: request.operationId,
    },
    payload: request.idempotencyPayload,
  });
  return withSerializableTransaction(pool, async (client) => {
    const persistedCorrelation = await getReservationBindingForReserve(
      client,
      request.budgetId,
      request.operationId,
    );
    const correlation = {
      ...persistedCorrelation,
      reservationId: request.reservationId,
    };
    assertAuditCorrelation(request.audit, correlation);

    const insertedIdempotency = await client.query<{
      reservation_id: string | null;
    }>(
      `INSERT INTO idempotency_records (idempotency_key, payload_hash, intent_id, operation_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING reservation_id`,
      [
        request.idempotencyKey,
        payloadHash,
        persistedCorrelation.intentId,
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
      eventId: transitionEventId(request.audit, "budget.reservation.created"),
      actorType: request.audit.actorType,
      actorId: request.audit.actorId,
      traceId: request.audit.traceId,
      ...correlation,
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
    correlation: AuditCorrelation,
  ) => Promise<ReservationSnapshot>,
): Promise<ReservationSnapshot> =>
  withSerializableTransaction(pool, async (client) => {
    const binding = await getReservationForUpdate(client, input.reservationId);
    assertAuditCorrelation(input.audit, binding.correlation);
    return transition(client, binding.reservation, binding.correlation);
  });

const writeTransitionAudit = async (
  client: PoolClient,
  audit: AuditContext,
  eventType: AuditEventType,
  reservation: ReservationSnapshot,
  correlation: AuditCorrelation,
  data: Record<string, unknown> = {},
): Promise<void> =>
  appendAuditEvent(client, {
    eventId: transitionEventId(audit, eventType),
    actorType: audit.actorType,
    actorId: audit.actorId,
    traceId: audit.traceId,
    ...correlation,
    eventType,
    data: eventData(reservation, data),
  });

export const authorizeReservation = (
  pool: Pool,
  input: TransitionInput,
): Promise<ReservationSnapshot> =>
  transitionReservation(
    pool,
    input,
    async (client, reservation, correlation) => {
      if (reservation.status === "AUTHORIZED") return reservation;
      if (reservation.status !== "HELD")
        throw new LedgerError(
          "INVALID_RESERVATION_TRANSITION",
          `cannot authorize ${reservation.status} reservation`,
        );
      await client.query(
        "UPDATE budget_reservations SET status = 'AUTHORIZED', updated_at = now() WHERE reservation_id = $1",
        [reservation.reservationId],
      );
      const next = { ...reservation, status: "AUTHORIZED" as const };
      await writeTransitionAudit(
        client,
        input.audit,
        "budget.reservation.authorized",
        next,
        correlation,
      );
      return next;
    },
  );

export const markReservationBroadcast = (
  pool: Pool,
  input: TransitionInput & { evidence: BroadcastEvidence },
): Promise<ReservationSnapshot> =>
  transitionReservation(
    pool,
    input,
    async (client, reservation, correlation) => {
      if (reservation.status === "BROADCAST") {
        await getBroadcastEvidence(client, reservation.reservationId);
        return reservation;
      }
      if (reservation.status !== "AUTHORIZED")
        throw new LedgerError(
          "INVALID_RESERVATION_TRANSITION",
          `cannot mark ${reservation.status} reservation as broadcast`,
        );
      if (input.audit.actorType !== "adapter")
        throw new LedgerError(
          "INVALID_BROADCAST_EVIDENCE",
          "only an adapter actor may record verified broadcast evidence",
        );
      const evidence = parseBroadcastEvidence(input.evidence);
      await client.query(
        `INSERT INTO reservation_broadcast_evidence
       (reservation_id, transaction_hash, nonce, receipt_reference, verification_source)
       VALUES ($1, $2, $3::numeric, $4, $5)`,
        [
          reservation.reservationId,
          evidence.transactionHash,
          evidence.nonce,
          evidence.receiptReference,
          input.audit.actorId,
        ],
      );
      await client.query(
        "UPDATE budget_reservations SET status = 'BROADCAST', updated_at = now() WHERE reservation_id = $1",
        [reservation.reservationId],
      );
      const next = { ...reservation, status: "BROADCAST" as const };
      await writeTransitionAudit(
        client,
        input.audit,
        "budget.reservation.broadcast",
        next,
        correlation,
        {
          transactionHash: evidence.transactionHash,
          nonce: evidence.nonce,
          proofReference: evidence.receiptReference,
        },
      );
      return next;
    },
  );

export const verifyBroadcastEvidence = (
  pool: Pool,
  input: TransitionInput,
): Promise<ReservationSnapshot> =>
  transitionReservation(
    pool,
    input,
    async (client, reservation, correlation) => {
      if (reservation.status !== "BROADCAST")
        throw new LedgerError(
          "INVALID_RESERVATION_TRANSITION",
          `cannot verify evidence for ${reservation.status} reservation`,
        );
      if (
        input.audit.actorType !== "worker" ||
        !input.audit.actorId.startsWith("reconciler:")
      )
        throw new LedgerError(
          "INVALID_BROADCAST_EVIDENCE",
          "only a reconciler worker may verify broadcast evidence",
        );
      const evidence = await getBroadcastEvidence(
        client,
        reservation.reservationId,
      );
      if (evidence.verification_status === "VERIFIED") return reservation;
      await client.query(
        `UPDATE reservation_broadcast_evidence
       SET verification_status = 'VERIFIED', verified_at = now(), verified_by = $1
       WHERE reservation_id = $2`,
        [input.audit.actorId, reservation.reservationId],
      );
      await writeTransitionAudit(
        client,
        input.audit,
        "budget.reservation.evidence.verified",
        reservation,
        correlation,
        {
          transactionHash: evidence.transaction_hash,
          nonce: String(evidence.nonce),
          proofReference: evidence.receipt_reference,
          verificationStatus: "VERIFIED",
        },
      );
      return reservation;
    },
  );

export const releaseReservation = (
  pool: Pool,
  input: TransitionInput,
): Promise<ReservationSnapshot> =>
  transitionReservation(
    pool,
    input,
    async (client, reservation, correlation) => {
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
        correlation,
      );
      return next;
    },
  );

export const expireReservation = (
  pool: Pool,
  input: TransitionInput & { now: string | Date },
): Promise<ReservationSnapshot> =>
  transitionReservation(
    pool,
    input,
    async (client, reservation, correlation) => {
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
        correlation,
      );
      return next;
    },
  );

export const finalizeReservation = (
  pool: Pool,
  input: TransitionInput & {
    actualSpendAtomic: string;
    proofReference: string;
  },
): Promise<ReservationSnapshot> => {
  const actualSpend = parseAtomic(input.actualSpendAtomic);
  return transitionReservation(
    pool,
    input,
    async (client, reservation, correlation) => {
      if (reservation.status === "FINALIZED") return reservation;
      if (reservation.status !== "BROADCAST")
        throw new LedgerError(
          "INVALID_RESERVATION_TRANSITION",
          `cannot finalize ${reservation.status} reservation`,
        );
      const evidence = await getBroadcastEvidence(
        client,
        reservation.reservationId,
      );
      if (evidence.verification_status !== "VERIFIED")
        throw new LedgerError(
          "INVALID_BROADCAST_EVIDENCE",
          "finalization requires independently verified broadcast evidence",
        );
      if (input.proofReference !== evidence.receipt_reference)
        throw new LedgerError(
          "INVALID_BROADCAST_EVIDENCE",
          "finalization proof must match the verified broadcast receipt",
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
        correlation,
        {
          proofReference: input.proofReference,
          transactionHash: evidence.transaction_hash,
          nonce: String(evidence.nonce),
        },
      );
      return next;
    },
  );
};

export const disputeReservation = (
  pool: Pool,
  input: TransitionInput & { reason: string },
): Promise<ReservationSnapshot> =>
  transitionReservation(
    pool,
    input,
    async (client, reservation, correlation) => {
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
        correlation,
        { reason: input.reason },
      );
      return next;
    },
  );
