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
  componentAuthPayloadHash,
  type ComponentAuthorization,
  type ComponentRole,
  verifyComponentAction,
} from "@crip/trust-boundary";

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

export interface RecoveryLease {
  operationId: string;
  reservationId: string;
  credentialId: string;
  componentId: string;
  leaseVersion: string;
  leaseExpiresAt: string;
}

export type RecoveryOutcome = "CONFIRMED" | "FAILED" | "AMBIGUOUS" | "CONFLICT";

export interface RecoveryResolution {
  attemptId: string;
  operationId: string;
  reservationId: string;
  leaseVersion: string;
  outcome: RecoveryOutcome;
  reason: string;
  actualSpendAtomic?: string;
  proofReference?: string;
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
  adapter_credential_id: string;
  adapter_component_id: string;
  adapter_component_role: "ADAPTER";
  adapter_auth_signature: string;
  adapter_auth_payload_hash: string;
  verification_credential_id: string | null;
  verification_component_id: string | null;
  verification_component_role: "RECONCILER" | null;
  verification_auth_signature: string | null;
  verification_auth_payload_hash: string | null;
};

type AuthenticatedComponent = {
  credentialId: string;
  componentId: string;
  role: ComponentRole;
  authPayloadHash: string;
  signature: string;
};

const authenticateComponent = async (
  client: PoolClient,
  authorization: ComponentAuthorization | undefined,
  expectedRole: ComponentRole,
  action: string,
  payload: Record<string, unknown>,
): Promise<AuthenticatedComponent> => {
  if (!authorization || authorization.role !== expectedRole)
    throw new LedgerError(
      "COMPONENT_AUTHENTICATION_FAILED",
      `authenticated ${expectedRole.toLowerCase()} credential is required`,
    );
  const result = await client.query<{
    component_id: string;
    component_role: ComponentRole;
    public_key: string;
    status: "ACTIVE" | "REVOKED";
  }>(
    `SELECT component_id, component_role, public_key, status
     FROM trusted_component_credentials WHERE credential_id = $1`,
    [authorization.credentialId],
  );
  const credential = result.rows[0];
  if (!credential || credential.status !== "ACTIVE")
    throw new LedgerError(
      "COMPONENT_NOT_TRUSTED",
      `component credential is not active: ${authorization.credentialId}`,
    );
  if (
    credential.component_id !== authorization.componentId ||
    credential.component_role !== authorization.role ||
    !verifyComponentAction(
      authorization,
      credential.public_key,
      action,
      payload,
    )
  )
    throw new LedgerError(
      "COMPONENT_AUTHENTICATION_FAILED",
      "component action signature is invalid",
    );
  return {
    credentialId: authorization.credentialId,
    componentId: credential.component_id,
    role: credential.component_role,
    authPayloadHash: componentAuthPayloadHash(action, authorization, payload),
    signature: authorization.signature,
  };
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

const lockReservationControlFences = async (
  client: PoolClient,
  operationId: string,
): Promise<void> => {
  const identity = await client.query<{
    owner_id: string;
    agent_id: string;
    policy_id: string;
    policy_status: string;
  }>(
    `SELECT ag.owner_id, o.agent_id, o.policy_id, p.status AS policy_status
     FROM operations o
     JOIN agents ag ON ag.agent_id = o.agent_id
     JOIN policies p ON p.policy_id = o.policy_id
     WHERE o.operation_id = $1`,
    [operationId],
  );
  const target = identity.rows[0];
  if (!target)
    throw new LedgerError(
      "RESERVATION_NOT_FOUND",
      `operation not found: ${operationId}`,
    );

  const scopes = [
    ["SYSTEM", "system"],
    ["OWNER", target.owner_id],
    ["AGENT", target.agent_id],
    ["POLICY", target.policy_id],
  ] as const;
  const states: string[] = [];
  for (const [scopeType, scopeId] of scopes) {
    const result = await client.query<{ state: string }>(
      `SELECT state FROM control_fences
       WHERE scope_type = $1 AND scope_id = $2
       FOR UPDATE`,
      [scopeType, scopeId],
    );
    const state = result.rows[0]?.state;
    if (!state)
      throw new LedgerError(
        "CONTROL_FENCE_INACTIVE",
        `authoritative control fence is missing: ${scopeType}:${scopeId}`,
      );
    states.push(state);
  }
  if (
    states[0] !== "ACTIVE" ||
    states[1] !== "ACTIVE" ||
    states[2] !== "ACTIVE" ||
    states[3] !== "ACTIVE" ||
    target.policy_status === "revoked"
  )
    throw new LedgerError(
      "CONTROL_FENCE_INACTIVE",
      `operation cannot reserve while a control fence is inactive: ${operationId}`,
    );
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
            verification_status, verified_at, verified_by,
            adapter_credential_id, adapter_component_id, adapter_component_role,
            adapter_auth_signature, adapter_auth_payload_hash,
            verification_credential_id, verification_component_id,
            verification_component_role, verification_auth_signature,
            verification_auth_payload_hash
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
    await lockReservationControlFences(client, request.operationId);
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
  authenticated?: AuthenticatedComponent,
): Promise<void> =>
  appendAuditEvent(client, {
    eventId: transitionEventId(audit, eventType),
    actorType: authenticated
      ? authenticated.role === "ADAPTER"
        ? "adapter"
        : "worker"
      : audit.actorType,
    actorId: authenticated?.componentId ?? audit.actorId,
    traceId: audit.traceId,
    ...correlation,
    eventType,
    data: eventData(
      reservation,
      authenticated
        ? {
            ...data,
            credentialId: authenticated.credentialId,
            componentId: authenticated.componentId,
            componentRole: authenticated.role,
            authPayloadHash: authenticated.authPayloadHash,
            authenticationMethod: "ed25519",
          }
        : data,
    ),
  });

const assertCanonicalAuthorizationEvidence = async (
  client: PoolClient,
  reservation: ReservationSnapshot,
): Promise<void> => {
  const result = await client.query<{ authorization_id: string }>(
    `SELECT ae.authorization_id
     FROM authorization_evidence ae
     JOIN operations o ON o.operation_id = ae.operation_id
     JOIN execution_envelopes e
       ON e.operation_id = ae.operation_id
      AND e.envelope_id = ae.envelope_id
      AND e.revision = ae.envelope_revision
     JOIN policy_decisions pd
       ON pd.operation_id = ae.operation_id
      AND pd.decision_id = ae.policy_decision_id
     LEFT JOIN authorization_invalidations ai
       ON ai.authorization_id = ae.authorization_id
     WHERE ae.reservation_id = $1
       AND ae.operation_id = $2
       AND o.current_state = 'AUTHORIZED'
       AND ai.authorization_id IS NULL
       AND e.envelope_hash = ae.envelope_hash
       AND pd.decision_hash = ae.policy_decision_hash
       AND pd.policy_id = ae.policy_id
       AND pd.policy_version = ae.policy_version
       AND NOT EXISTS (
         SELECT 1
         FROM execution_envelopes latest
         WHERE latest.operation_id = ae.operation_id
           AND latest.revision > ae.envelope_revision
       )
     FOR SHARE OF ae, o, e, pd`,
    [reservation.reservationId, reservation.operationId],
  );
  if (result.rowCount !== 1)
    throw new LedgerError(
      "INVALID_RESERVATION_TRANSITION",
      "canonical authorization evidence is missing, invalidated, stale, or inconsistent",
    );
};

/**
 * Verify a reservation that was authorized by the canonical authorization
 * service. This function intentionally cannot manufacture AUTHORIZED state.
 */
export const authorizeReservation = (
  pool: Pool,
  input: TransitionInput,
): Promise<ReservationSnapshot> =>
  transitionReservation(pool, input, async (client, reservation) => {
    if (reservation.status !== "AUTHORIZED")
      throw new LedgerError(
        "INVALID_RESERVATION_TRANSITION",
        "reservation authorization must be committed by the canonical authorization path",
      );
    await assertCanonicalAuthorizationEvidence(client, reservation);
    return reservation;
  });

export const markReservationBroadcast = (
  pool: Pool,
  input: TransitionInput & { evidence: BroadcastEvidence },
): Promise<ReservationSnapshot> =>
  transitionReservation(
    pool,
    input,
    async (client, reservation, correlation) => {
      const evidence = parseBroadcastEvidence(input.evidence);
      const authenticated = await authenticateComponent(
        client,
        input.audit.componentAuth,
        "ADAPTER",
        "broadcast",
        {
          reservationId: reservation.reservationId,
          transactionHash: evidence.transactionHash,
          nonce: evidence.nonce,
          receiptReference: evidence.receiptReference,
        },
      );
      if (
        reservation.status !== "AUTHORIZED" &&
        reservation.status !== "BROADCAST"
      )
        throw new LedgerError(
          "INVALID_RESERVATION_TRANSITION",
          `cannot mark ${reservation.status} reservation as broadcast`,
        );
      await assertCanonicalAuthorizationEvidence(client, reservation);
      if (reservation.status === "BROADCAST") {
        const existing = await getBroadcastEvidence(
          client,
          reservation.reservationId,
        );
        if (
          existing.transaction_hash !== evidence.transactionHash ||
          String(existing.nonce) !== evidence.nonce ||
          existing.receipt_reference !== evidence.receiptReference
        )
          throw new LedgerError(
            "RECOVERY_CONFLICT",
            "broadcast evidence conflicts with the immutable execution record",
          );
        return reservation;
      }
      await client.query(
        `INSERT INTO reservation_broadcast_evidence
       (reservation_id, transaction_hash, nonce, receipt_reference, verification_source,
        adapter_credential_id, adapter_component_id, adapter_component_role,
        adapter_auth_signature, adapter_auth_payload_hash)
       VALUES ($1, $2, $3::numeric, $4, $5, $6, $7, $8, $9, $10)`,
        [
          reservation.reservationId,
          evidence.transactionHash,
          evidence.nonce,
          evidence.receiptReference,
          authenticated.componentId,
          authenticated.credentialId,
          authenticated.componentId,
          authenticated.role,
          authenticated.signature,
          authenticated.authPayloadHash,
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
        authenticated,
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
      const evidence = await getBroadcastEvidence(
        client,
        reservation.reservationId,
      );
      const authenticated = await authenticateComponent(
        client,
        input.audit.componentAuth,
        "RECONCILER",
        "verify",
        {
          reservationId: reservation.reservationId,
          transactionHash: evidence.transaction_hash,
          nonce: String(evidence.nonce),
          receiptReference: evidence.receipt_reference,
        },
      );
      if (evidence.verification_status === "VERIFIED") return reservation;
      await client.query(
        `UPDATE reservation_broadcast_evidence
       SET verification_status = 'VERIFIED', verified_at = now(), verified_by = $1,
           verification_credential_id = $2, verification_component_id = $3,
           verification_component_role = $4, verification_auth_signature = $5,
           verification_auth_payload_hash = $6
       WHERE reservation_id = $7`,
        [
          `reconciler:${authenticated.componentId}`,
          authenticated.credentialId,
          authenticated.componentId,
          authenticated.role,
          authenticated.signature,
          authenticated.authPayloadHash,
          reservation.reservationId,
        ],
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
        authenticated,
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

const MAX_RECOVERY_LEASE_SECONDS = 300;

export interface RecoveryClaimRequest {
  attemptId: string;
  operationId: string;
  reservationId: string;
  leaseDurationSeconds: number;
  /** @deprecated Recovery leases use the database clock; caller time is ignored. */
  now?: string | Date;
  audit: AuditContext;
}

const recoveryEventId = (audit: AuditContext, suffix: string): string =>
  `${audit.eventId}:recovery:${suffix}`;

const recoveryPayload = (
  input: RecoveryResolution,
  evidence: BroadcastEvidenceRow | null,
): Record<string, unknown> => ({
  attemptId: input.attemptId,
  operationId: input.operationId,
  reservationId: input.reservationId,
  leaseVersion: input.leaseVersion,
  outcome: input.outcome,
  reason: input.reason,
  actualSpendAtomic: input.actualSpendAtomic ?? null,
  proofReference: input.proofReference ?? null,
  evidence: evidence
    ? {
        transactionHash: evidence.transaction_hash,
        nonce: String(evidence.nonce),
        receiptReference: evidence.receipt_reference,
      }
    : null,
});

const writeRecoveryAudit = async (
  client: PoolClient,
  audit: AuditContext,
  eventType: AuditEventType,
  reservation: ReservationSnapshot,
  correlation: AuditCorrelation,
  authenticated: AuthenticatedComponent,
  data: Record<string, unknown>,
): Promise<void> =>
  appendAuditEvent(client, {
    eventId: recoveryEventId(
      audit,
      `${eventType.replaceAll(".", ":")}:${data.attemptId ?? "claim"}`,
    ),
    actorType: "worker",
    actorId: authenticated.componentId,
    traceId: audit.traceId,
    ...correlation,
    eventType,
    data: eventData(reservation, {
      ...data,
      credentialId: authenticated.credentialId,
      componentId: authenticated.componentId,
      componentRole: authenticated.role,
      authPayloadHash: authenticated.authPayloadHash,
      authenticationMethod: "ed25519",
    }),
  });

/** Claim one durable recovery lease. A worker label alone has no authority. */
export const claimRecoveryLease = async (
  pool: Pool,
  input: RecoveryClaimRequest,
): Promise<RecoveryLease> => {
  if (
    !Number.isInteger(input.leaseDurationSeconds) ||
    input.leaseDurationSeconds <= 0 ||
    input.leaseDurationSeconds > MAX_RECOVERY_LEASE_SECONDS
  )
    throw new LedgerError(
      "RECOVERY_LEASE_STALE",
      `recovery lease duration must be an integer between 1 and ${MAX_RECOVERY_LEASE_SECONDS} seconds`,
    );
  return withSerializableTransaction(pool, async (client) => {
    const binding = await getReservationForUpdate(client, input.reservationId);
    if (binding.reservation.operationId !== input.operationId)
      throw new LedgerError(
        "BUDGET_BINDING_MISMATCH",
        "recovery operation and reservation do not match",
      );
    const authenticated = await authenticateComponent(
      client,
      input.audit.componentAuth,
      "RECONCILER",
      "recovery.claim",
      {
        attemptId: input.attemptId,
        operationId: input.operationId,
        reservationId: input.reservationId,
        leaseDurationSeconds: input.leaseDurationSeconds,
      },
    );
    const existing = await client.query<{
      lease_version: string;
      lease_state: "ACTIVE" | "RESOLVED";
      lease_is_live: boolean;
    }>(
      `SELECT lease_version, lease_state,
              lease_expires_at > clock_timestamp() AS lease_is_live
       FROM operation_recovery_leases WHERE operation_id = $1 FOR UPDATE`,
      [input.operationId],
    );
    const current = existing.rows[0];
    if (current?.lease_state === "ACTIVE" && current.lease_is_live)
      throw new LedgerError(
        "RECOVERY_LEASE_HELD",
        "recovery operation is already leased",
      );
    const leaseVersion = current ? BigInt(current.lease_version) + 1n : 1n;
    if (leaseVersion > BigInt(Number.MAX_SAFE_INTEGER))
      throw new LedgerError(
        "RECOVERY_LEASE_STALE",
        "recovery lease version exhausted",
      );
    const persisted = await client.query<{
      lease_expires_at: Date | string;
    }>(
      `INSERT INTO operation_recovery_leases
         (operation_id, reservation_id, credential_id, lease_version, lease_expires_at, lease_state)
       VALUES (
         $1, $2, $3, $4,
         clock_timestamp() + ($5::integer * interval '1 second'),
         'ACTIVE'
       )
       ON CONFLICT (operation_id) DO UPDATE SET
         reservation_id = EXCLUDED.reservation_id,
         credential_id = EXCLUDED.credential_id,
         lease_version = EXCLUDED.lease_version,
         lease_expires_at = EXCLUDED.lease_expires_at,
         lease_state = 'ACTIVE', updated_at = clock_timestamp()
       RETURNING lease_expires_at`,
      [
        input.operationId,
        input.reservationId,
        authenticated.credentialId,
        leaseVersion.toString(),
        input.leaseDurationSeconds,
      ],
    );
    const leaseExpiresAt = persisted.rows[0]?.lease_expires_at;
    if (!leaseExpiresAt)
      throw new LedgerError(
        "RECOVERY_LEASE_STALE",
        "recovery lease was not persisted",
      );
    await writeRecoveryAudit(
      client,
      input.audit,
      "execution.recovery.claimed",
      binding.reservation,
      binding.correlation,
      authenticated,
      { attemptId: input.attemptId, leaseVersion: Number(leaseVersion) },
    );
    return {
      operationId: input.operationId,
      reservationId: input.reservationId,
      credentialId: authenticated.credentialId,
      componentId: authenticated.componentId,
      leaseVersion: leaseVersion.toString(),
      leaseExpiresAt: new Date(leaseExpiresAt).toISOString(),
    };
  });
};

/**
 * Resolve an uncertain outcome under a live lease. AMBIGUOUS and CONFLICT
 * always retain the reservation. CONFIRMED finalizes only matching immutable
 * evidence; FAILED releases only pre-broadcast reservations.
 */
export const resolveRecovery = async (
  pool: Pool,
  input: RecoveryResolution & { audit: AuditContext },
): Promise<ReservationSnapshot> => {
  const actualSpend = input.actualSpendAtomic
    ? parseAtomic(input.actualSpendAtomic)
    : undefined;
  if (input.outcome === "CONFIRMED" && (!actualSpend || !input.proofReference))
    throw new LedgerError(
      "INVALID_BROADCAST_EVIDENCE",
      "confirmed recovery requires spend and proof",
    );
  return withSerializableTransaction(pool, async (client) => {
    const binding = await getReservationForUpdate(client, input.reservationId);
    if (binding.reservation.operationId !== input.operationId)
      throw new LedgerError(
        "BUDGET_BINDING_MISMATCH",
        "recovery operation and reservation do not match",
      );
    const evidenceResult = await client.query<BroadcastEvidenceRow>(
      `SELECT transaction_hash, nonce, receipt_reference, verification_source,
              verification_status, verified_at, verified_by,
              adapter_credential_id, adapter_component_id, adapter_component_role,
              adapter_auth_signature, adapter_auth_payload_hash,
              verification_credential_id, verification_component_id,
              verification_component_role, verification_auth_signature,
              verification_auth_payload_hash
       FROM reservation_broadcast_evidence WHERE reservation_id = $1`,
      [input.reservationId],
    );
    const evidence = evidenceResult.rows[0] ?? null;
    const authenticated = await authenticateComponent(
      client,
      input.audit.componentAuth,
      "RECONCILER",
      "recovery.resolve",
      recoveryPayload(input, evidence),
    );
    const resolutionHash = authenticated.authPayloadHash;
    const prior = await client.query<{
      operation_id: string;
      reservation_id: string;
      resolution_hash: string;
    }>(
      `SELECT operation_id, reservation_id, resolution_hash
       FROM recovery_attempts WHERE attempt_id = $1 FOR UPDATE`,
      [input.attemptId],
    );
    if (prior.rows[0]) {
      if (
        prior.rows[0].operation_id !== input.operationId ||
        prior.rows[0].reservation_id !== input.reservationId ||
        prior.rows[0].resolution_hash !== resolutionHash
      )
        throw new LedgerError(
          "RECOVERY_CONFLICT",
          "recovery attempt was replayed with different evidence",
        );
      return binding.reservation;
    }
    const lease = await client.query<{
      reservation_id: string;
      credential_id: string;
      lease_version: string;
      lease_expires_at: Date | string;
      lease_state: "ACTIVE" | "RESOLVED";
    }>(
      `SELECT reservation_id, credential_id, lease_version, lease_expires_at, lease_state
       FROM operation_recovery_leases WHERE operation_id = $1 FOR UPDATE`,
      [input.operationId],
    );
    const current = lease.rows[0];
    if (
      !current ||
      current.reservation_id !== input.reservationId ||
      current.credential_id !== authenticated.credentialId ||
      current.lease_version !== input.leaseVersion ||
      current.lease_state !== "ACTIVE" ||
      new Date(current.lease_expires_at).getTime() <= Date.now()
    )
      throw new LedgerError(
        "RECOVERY_LEASE_STALE",
        "recovery lease is stale or not owned by this worker",
      );

    let next = binding.reservation;
    if (input.outcome === "CONFIRMED") {
      if (!evidence || binding.reservation.status !== "BROADCAST")
        throw new LedgerError(
          "INVALID_BROADCAST_EVIDENCE",
          "confirmed recovery requires broadcast evidence",
        );
      if (input.proofReference !== evidence.receipt_reference)
        throw new LedgerError(
          "INVALID_BROADCAST_EVIDENCE",
          "recovery proof does not match broadcast evidence",
        );
      const confirmedSpend = actualSpend;
      if (!confirmedSpend)
        throw new LedgerError(
          "INVALID_BROADCAST_EVIDENCE",
          "confirmed recovery spend is missing",
        );
      if (BigInt(confirmedSpend) > BigInt(binding.reservation.amountAtomic))
        throw new LedgerError(
          "INVALID_ATOMIC_AMOUNT",
          "recovered spend exceeds reserved amount",
        );
      if (evidence.verification_status === "PENDING") {
        await client.query(
          `UPDATE reservation_broadcast_evidence
           SET verification_status = 'VERIFIED', verified_at = now(), verified_by = $1,
               verification_credential_id = $2, verification_component_id = $3,
               verification_component_role = $4, verification_auth_signature = $5,
               verification_auth_payload_hash = $6
           WHERE reservation_id = $7`,
          [
            `reconciler:${authenticated.componentId}`,
            authenticated.credentialId,
            authenticated.componentId,
            authenticated.role,
            authenticated.signature,
            authenticated.authPayloadHash,
            input.reservationId,
          ],
        );
        await writeRecoveryAudit(
          client,
          input.audit,
          "budget.reservation.evidence.verified",
          binding.reservation,
          binding.correlation,
          authenticated,
          {
            attemptId: input.attemptId,
            leaseVersion: Number(input.leaseVersion),
            transactionHash: evidence.transaction_hash,
            nonce: String(evidence.nonce),
            proofReference: evidence.receipt_reference,
            verificationStatus: "VERIFIED",
          },
        );
      }
      await client.query(
        `UPDATE budget_accounts
         SET available = available + ($1::numeric - $2::numeric),
             reserved = reserved - $1::numeric,
             finalized_spend = finalized_spend + $2::numeric,
             version = version + 1, updated_at = now()
         WHERE budget_id = $3`,
        [
          binding.reservation.amountAtomic,
          confirmedSpend,
          binding.reservation.budgetId,
        ],
      );
      await client.query(
        `UPDATE budget_reservations
         SET status = 'FINALIZED', finalized_spend_atomic = $1::numeric,
             proof_reference = $2, updated_at = now()
         WHERE reservation_id = $3`,
        [confirmedSpend, input.proofReference, input.reservationId],
      );
      next = {
        ...binding.reservation,
        status: "FINALIZED",
        finalizedSpendAtomic: confirmedSpend,
        proofReference: input.proofReference,
      };
      await writeRecoveryAudit(
        client,
        input.audit,
        "budget.reservation.finalized",
        next,
        binding.correlation,
        authenticated,
        {
          attemptId: input.attemptId,
          leaseVersion: Number(input.leaseVersion),
          actualSpendAtomic: confirmedSpend,
          proofReference: input.proofReference,
          transactionHash: evidence.transaction_hash,
          nonce: String(evidence.nonce),
        },
      );
    } else if (
      input.outcome === "FAILED" &&
      ["HELD", "AUTHORIZED"].includes(binding.reservation.status)
    ) {
      await client.query(
        `UPDATE budget_accounts SET available = available + $1::numeric,
         reserved = reserved - $1::numeric, version = version + 1, updated_at = now()
         WHERE budget_id = $2`,
        [binding.reservation.amountAtomic, binding.reservation.budgetId],
      );
      await client.query(
        "UPDATE budget_reservations SET status = 'RELEASED', updated_at = now() WHERE reservation_id = $1",
        [input.reservationId],
      );
      next = { ...binding.reservation, status: "RELEASED" };
      await writeRecoveryAudit(
        client,
        input.audit,
        "budget.reservation.released",
        next,
        binding.correlation,
        authenticated,
        {
          attemptId: input.attemptId,
          leaseVersion: Number(input.leaseVersion),
          reason: input.reason,
        },
      );
    } else if (
      ["AMBIGUOUS", "CONFLICT"].includes(input.outcome) ||
      (input.outcome === "FAILED" &&
        ["BROADCAST", "DISPUTED"].includes(binding.reservation.status))
    ) {
      if (binding.reservation.status !== "DISPUTED") {
        await client.query(
          "UPDATE budget_reservations SET status = 'DISPUTED', updated_at = now() WHERE reservation_id = $1",
          [input.reservationId],
        );
        next = { ...binding.reservation, status: "DISPUTED" };
        await writeRecoveryAudit(
          client,
          input.audit,
          "budget.reservation.disputed",
          next,
          binding.correlation,
          authenticated,
          {
            attemptId: input.attemptId,
            leaseVersion: Number(input.leaseVersion),
            reason: input.reason,
          },
        );
      }
    } else {
      throw new LedgerError(
        "INVALID_RESERVATION_TRANSITION",
        `cannot resolve ${input.outcome} for ${binding.reservation.status} reservation`,
      );
    }
    await client.query(
      `INSERT INTO recovery_attempts
         (attempt_id, operation_id, reservation_id, lease_version, credential_id,
          outcome, resolution_hash, reason, actual_spend_atomic, proof_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10)`,
      [
        input.attemptId,
        input.operationId,
        input.reservationId,
        input.leaseVersion,
        authenticated.credentialId,
        input.outcome,
        resolutionHash,
        input.reason,
        actualSpend ?? null,
        input.proofReference ?? null,
      ],
    );
    await client.query(
      "UPDATE operation_recovery_leases SET lease_state = 'RESOLVED', updated_at = now() WHERE operation_id = $1",
      [input.operationId],
    );
    await writeRecoveryAudit(
      client,
      input.audit,
      input.outcome === "AMBIGUOUS"
        ? "execution.recovery.ambiguous"
        : input.outcome === "CONFLICT"
          ? "execution.recovery.conflict"
          : "execution.recovery.resolved",
      next,
      binding.correlation,
      authenticated,
      {
        attemptId: input.attemptId,
        leaseVersion: Number(input.leaseVersion),
        recoveryOutcome: input.outcome,
        resolutionHash,
        reason: input.reason,
      },
    );
    return next;
  });
};
