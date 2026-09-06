import { createHash } from "node:crypto";

import { appendAuditEvent, type AuditCorrelation } from "@crip/audit";
import {
  claimRecoveryLease,
  markReservationBroadcast,
  resolveRecovery,
  verifyBroadcastEvidence,
  type AuditContext,
  type BroadcastEvidence,
  type RecoveryResolution,
  type ReservationSnapshot,
} from "@crip/budget-ledger";
import {
  canonicalizeIdempotencyPayload,
  isValidLifecycleTransition,
  type LifecycleState,
} from "@crip/schemas";
import {
  verifyUntrustedChainEvidence,
  type ChainEvidenceExpectation,
  type ChainEvidenceMismatch,
  type UntrustedChainEvidence,
  type VerifiedChainEvidence,
} from "@crip/transaction-pipeline";
import type { Pool, PoolClient } from "pg";
import { componentAuthPayloadHash } from "@crip/trust-boundary";

export interface ReconciliationAudits {
  broadcast: AuditContext;
  verification: AuditContext;
  claim: AuditContext;
  resolve: AuditContext;
}

export interface ReconciliationInput {
  expectation: ChainEvidenceExpectation;
  evidence: UntrustedChainEvidence;
  broadcastEvidence: BroadcastEvidence;
  audits: ReconciliationAudits;
  attemptId: string;
  leaseDurationSeconds?: number;
  /** Deterministic test barriers at durable crash boundaries. */
  barriers?: {
    afterRecoveryResolved?(): Promise<void>;
    afterEconomicEffectPersisted?(): Promise<void>;
  };
}

export interface ReconciliationSuccess {
  ok: true;
  evidence: VerifiedChainEvidence;
  reservation: ReservationSnapshot;
}

export interface ReconciliationFailure {
  ok: false;
  mismatches: readonly ChainEvidenceMismatch[];
  reservation: ReservationSnapshot;
}

export type ReconciliationResult =
  ReconciliationSuccess | ReconciliationFailure;

type BindingRow = {
  signed_transaction_id: string;
  operation_id: string;
  reservation_id: string;
  envelope_id: string;
  envelope_revision: number;
  envelope_hash: string;
  authorization_id: string;
  fixture_instance_id: string;
  expected_transaction_hash: string;
  status: string;
};

type OperationBinding = {
  state: LifecycleState;
  reservation: ReservationSnapshot;
  correlation: AuditCorrelation;
};

const withClient = async <T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
};

const evidenceHash = (domain: string, value: unknown): string =>
  `0x${createHash("sha256")
    .update(domain, "utf8")
    .update(
      canonicalizeIdempotencyPayload(
        JSON.parse(JSON.stringify(value)) as never,
      ),
      "utf8",
    )
    .digest("hex")}`;

const loadBroadcastBinding = async (
  client: PoolClient,
  input: ReconciliationInput,
): Promise<BindingRow> => {
  const result = await client.query<BindingRow>(
    `SELECT signed_transaction_id, operation_id, reservation_id, envelope_id,
            envelope_revision, envelope_hash, authorization_id,
            fixture_instance_id, expected_transaction_hash, status
     FROM broadcast_attempts
     WHERE attempt_id = $1`,
    [input.attemptId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("broadcast attempt is not durable");
  const expected = input.expectation;
  if (
    row.operation_id !== expected.operationId ||
    row.reservation_id !== expected.reservationId ||
    row.envelope_id !== expected.envelopeId ||
    row.envelope_revision !== expected.envelopeRevision ||
    row.envelope_hash !== expected.envelopeHash ||
    row.authorization_id !== expected.authorizationId ||
    row.fixture_instance_id !== expected.fixtureInstanceId ||
    row.expected_transaction_hash !== expected.expectedTransactionHash
  )
    throw new Error(
      "broadcast attempt does not match reconciliation authority",
    );
  if (row.status !== "ACCEPTED" && row.status !== "UNKNOWN")
    throw new Error(`broadcast attempt is not recoverable: ${row.status}`);
  return row;
};

const loadOperationBinding = async (
  pool: Pool,
  input: ReconciliationInput,
): Promise<OperationBinding> => {
  const result = await pool.query<{
    current_state: LifecycleState;
    intent_id: string;
    agent_id: string;
    wallet_id: string;
    policy_id: string;
    policy_version: number;
    owner_id: string;
    reservation_id: string;
    budget_id: string;
    idempotency_key: string;
    amount_atomic: string;
    finalized_spend_atomic: string;
    status: ReservationSnapshot["status"];
    expires_at: Date | string;
    proof_reference: string | null;
  }>(
    `SELECT o.current_state, o.intent_id, o.agent_id, o.wallet_id,
            o.policy_id, o.policy_version, w.owner_id,
            r.reservation_id, r.budget_id, r.idempotency_key,
            r.amount_atomic, r.finalized_spend_atomic, r.status,
            r.expires_at, r.proof_reference
     FROM operations o
     JOIN wallets w ON w.wallet_id = o.wallet_id
     JOIN budget_reservations r ON r.operation_id = o.operation_id
     WHERE o.operation_id = $1 AND r.reservation_id = $2`,
    [input.expectation.operationId, input.expectation.reservationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("operation and reservation binding is missing");
  return {
    state: row.current_state,
    reservation: {
      reservationId: row.reservation_id,
      budgetId: row.budget_id,
      operationId: input.expectation.operationId,
      idempotencyKey: row.idempotency_key,
      amountAtomic: row.amount_atomic,
      finalizedSpendAtomic: row.finalized_spend_atomic,
      status: row.status,
      expiresAt: new Date(row.expires_at).toISOString(),
      proofReference: row.proof_reference,
    },
    correlation: {
      reservationId: row.reservation_id,
      budgetId: row.budget_id,
      ownerId: row.owner_id,
      agentId: row.agent_id,
      walletId: row.wallet_id,
      intentId: row.intent_id,
      operationId: input.expectation.operationId,
      policyId: row.policy_id,
      policyVersion: row.policy_version,
    },
  };
};

const hasDurableTransactionEvidence = async (
  pool: Pool,
  input: ReconciliationInput,
  transactionHash: string,
): Promise<boolean> => {
  const result = await pool.query(
    `SELECT 1 FROM chain_transaction_evidence
     WHERE operation_id = $1 AND reservation_id = $2 AND transaction_hash = $3`,
    [
      input.expectation.operationId,
      input.expectation.reservationId,
      transactionHash,
    ],
  );
  return result.rowCount === 1;
};

const persistVerifiedEvidence = async (
  pool: Pool,
  input: ReconciliationInput,
  verified: VerifiedChainEvidence,
): Promise<void> => {
  if (verified.transactionIndex === undefined)
    throw new Error(
      "verified transaction index is required for durable evidence",
    );
  const txEvidenceId = `txe:${input.attemptId}`;
  const receiptEvidenceId = `receipt:${input.attemptId}`;
  const logEvidenceId = `log:${input.attemptId}`;
  await withClient(pool, async (client) => {
    await client.query("BEGIN");
    try {
      const binding = await loadBroadcastBinding(client, input);
      const existing = await client.query<{
        transaction_evidence_id: string;
        operation_id: string;
        reservation_id: string;
        envelope_id: string;
        fixture_instance_id: string;
        transaction_hash: string;
      }>(
        `SELECT transaction_evidence_id, operation_id, reservation_id,
                envelope_id, fixture_instance_id, transaction_hash
         FROM chain_transaction_evidence WHERE transaction_hash = $1`,
        [verified.transactionHash],
      );
      const prior = existing.rows[0];
      if (
        prior &&
        (prior.operation_id !== verified.operationId ||
          prior.reservation_id !== verified.reservationId ||
          prior.envelope_id !== verified.envelopeId ||
          prior.fixture_instance_id !== verified.fixtureInstanceId ||
          prior.transaction_hash !== verified.transactionHash)
      )
        throw new Error("chain evidence is already bound to another operation");

      const transactionEvidenceId =
        prior?.transaction_evidence_id ?? txEvidenceId;
      if (!prior) {
        await client.query(
          `INSERT INTO chain_transaction_evidence
             (transaction_evidence_id, broadcast_attempt_id, signed_transaction_id,
              operation_id, reservation_id, envelope_id, envelope_revision,
              envelope_hash, authorization_id, fixture_instance_id, chain_id,
              transaction_hash, block_number, block_hash, transaction_index,
              from_address, to_address, value_atomic, calldata, nonce,
              transaction_type, gas_limit, max_priority_fee_per_gas, max_fee_per_gas,
              access_list, evidence_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
                   $26)`,
          [
            transactionEvidenceId,
            input.attemptId,
            binding.signed_transaction_id,
            verified.operationId,
            verified.reservationId,
            verified.envelopeId,
            verified.envelopeRevision,
            verified.envelopeHash,
            verified.authorizationId,
            verified.fixtureInstanceId,
            verified.chainId,
            verified.transactionHash,
            verified.blockNumber,
            verified.blockHash,
            verified.transactionIndex,
            verified.from,
            verified.to,
            verified.valueAtomic,
            verified.calldata,
            verified.nonce,
            verified.transactionType,
            verified.gasLimit,
            verified.maxPriorityFeePerGas,
            verified.maxFeePerGas,
            JSON.stringify(verified.accessList),
            evidenceHash("crip/chain-transaction-evidence/v1\u0000", verified),
          ],
        );
      }

      const receipt = await client.query<{ receipt_evidence_id: string }>(
        `SELECT receipt_evidence_id FROM chain_receipt_evidence
         WHERE transaction_evidence_id = $1`,
        [transactionEvidenceId],
      );
      const persistedReceiptId =
        receipt.rows[0]?.receipt_evidence_id ?? receiptEvidenceId;
      if (!receipt.rows[0]) {
        await client.query(
          `INSERT INTO chain_receipt_evidence
             (receipt_evidence_id, transaction_evidence_id, operation_id,
              reservation_id, envelope_id, envelope_revision, envelope_hash,
              authorization_id, fixture_instance_id, transaction_hash, chain_id,
              block_number, block_hash, receipt_status, gas_used,
              effective_gas_price, log_count, evidence_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   $14, $15, $16, $17, $18)`,
          [
            persistedReceiptId,
            transactionEvidenceId,
            verified.operationId,
            verified.reservationId,
            verified.envelopeId,
            verified.envelopeRevision,
            verified.envelopeHash,
            verified.authorizationId,
            verified.fixtureInstanceId,
            verified.transactionHash,
            verified.chainId,
            verified.blockNumber,
            verified.blockHash,
            verified.receiptStatus,
            verified.gasUsed,
            verified.effectiveGasPrice,
            verified.transfer ? 1 : 0,
            evidenceHash("crip/chain-receipt-evidence/v1\u0000", verified),
          ],
        );
      }

      if (verified.transfer) {
        const log = await client.query<{ log_evidence_id: string }>(
          `SELECT log_evidence_id FROM chain_transfer_logs
           WHERE receipt_evidence_id = $1`,
          [persistedReceiptId],
        );
        if (!log.rows[0])
          await client.query(
            `INSERT INTO chain_transfer_logs
               (log_evidence_id, receipt_evidence_id, log_index, token_address,
                from_address, to_address, amount_atomic)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              logEvidenceId,
              persistedReceiptId,
              verified.transfer.logIndex,
              verified.transfer.tokenAddress,
              verified.transfer.from,
              verified.transfer.to,
              verified.transfer.amountAtomic,
            ],
          );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
};

const assertExactLegacyEvidence = (
  input: ReconciliationInput,
  verified: VerifiedChainEvidence,
): void => {
  const evidence = input.broadcastEvidence;
  if (
    evidence.transactionHash !== input.expectation.expectedTransactionHash ||
    evidence.transactionHash !== verified.transactionHash
  )
    throw new Error(
      "broadcast evidence transaction hash does not match verified execution",
    );
  if (
    evidence.nonce !== input.expectation.envelope.nonce ||
    evidence.nonce !== verified.nonce
  )
    throw new Error(
      "broadcast evidence nonce does not match verified execution",
    );
  if (evidence.receiptReference !== `receipt:${input.attemptId}`)
    throw new Error(
      "broadcast evidence receipt reference does not match durable receipt evidence",
    );
};

const loadResolvedRecovery = async (
  pool: Pool,
  input: ReconciliationInput,
): Promise<RecoveryResolution | null> => {
  const result = await pool.query<{
    operation_id: string;
    reservation_id: string;
    lease_version: string;
    outcome: RecoveryResolution["outcome"];
    reason: string;
    actual_spend_atomic: string | null;
    proof_reference: string | null;
  }>(
    `SELECT operation_id, reservation_id, lease_version, outcome, reason,
            actual_spend_atomic, proof_reference
     FROM recovery_attempts WHERE attempt_id = $1`,
    [input.attemptId],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (
    row.operation_id !== input.expectation.operationId ||
    row.reservation_id !== input.expectation.reservationId
  )
    throw new Error(
      "resolved recovery attempt has conflicting execution identity",
    );
  return {
    attemptId: input.attemptId,
    operationId: row.operation_id,
    reservationId: row.reservation_id,
    leaseVersion: row.lease_version,
    outcome: row.outcome,
    reason: row.reason,
    ...(row.actual_spend_atomic === null
      ? {}
      : { actualSpendAtomic: row.actual_spend_atomic }),
    ...(row.proof_reference === null
      ? {}
      : { proofReference: row.proof_reference }),
    ...(row.outcome === "FAILED" ? { verifiedRevert: true } : {}),
  };
};

const readReceiptReference = async (
  pool: Pool,
  reservationId: string,
): Promise<string> => {
  const result = await pool.query<{ receipt_reference: string }>(
    `SELECT receipt_reference FROM reservation_broadcast_evidence
     WHERE reservation_id = $1`,
    [reservationId],
  );
  const reference = result.rows[0]?.receipt_reference;
  if (!reference) throw new Error("broadcast receipt reference is missing");
  return reference;
};

const insertEconomicEffect = async (
  pool: Pool,
  input: ReconciliationInput,
  verified: VerifiedChainEvidence,
  receiptReference: string,
  resolution: RecoveryResolution,
): Promise<void> => {
  if (!verified.transfer || !input.audits.resolve.componentAuth)
    throw new Error(
      "successful reconciliation requires authenticated transfer evidence",
    );
  const inserted = await pool.query<{ effect_id: string }>(
    `INSERT INTO execution_economic_effects
       (effect_id, operation_id, reservation_id, envelope_id, envelope_revision,
        envelope_hash, authorization_id, receipt_evidence_id, transaction_hash,
        asset_address, from_address, to_address, amount_atomic,
        reconciler_credential_id, reconciler_component_id, reconciler_auth_signature,
        reconciler_auth_payload_hash, effect_hash)
     SELECT $1, $2, $3, $4, $5, $6, $7, r.receipt_evidence_id, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17
     FROM chain_receipt_evidence r
     WHERE r.transaction_hash = $8
     ON CONFLICT (operation_id) DO NOTHING
     RETURNING effect_id`,
    [
      `effect:${input.attemptId}`,
      verified.operationId,
      verified.reservationId,
      verified.envelopeId,
      verified.envelopeRevision,
      verified.envelopeHash,
      verified.authorizationId,
      verified.transactionHash,
      verified.transfer.tokenAddress,
      verified.transfer.from,
      verified.transfer.to,
      verified.transfer.amountAtomic,
      input.audits.resolve.componentAuth.credentialId,
      input.audits.resolve.componentAuth.componentId,
      input.audits.resolve.componentAuth.signature,
      componentAuthPayloadHash(
        "recovery.resolve",
        input.audits.resolve.componentAuth,
        {
          attemptId: resolution.attemptId,
          operationId: resolution.operationId,
          reservationId: resolution.reservationId,
          leaseVersion: resolution.leaseVersion,
          outcome: resolution.outcome,
          reason: resolution.reason,
          actualSpendAtomic: resolution.actualSpendAtomic ?? null,
          proofReference: resolution.proofReference ?? null,
          evidence: {
            transactionHash: input.broadcastEvidence.transactionHash,
            nonce: input.broadcastEvidence.nonce,
            receiptReference: input.broadcastEvidence.receiptReference,
          },
        },
      ),
      evidenceHash("crip/economic-effect/v1\u0000", {
        operationId: verified.operationId,
        transactionHash: verified.transactionHash,
        amountAtomic: verified.transfer.amountAtomic,
        receiptReference,
      }),
    ],
  );
  if (inserted.rowCount === 1) return;
  const existing = await pool.query<{
    reservation_id: string;
    envelope_id: string;
    transaction_hash: string;
    receipt_evidence_id: string;
    amount_atomic: string;
  }>(
    `SELECT reservation_id, envelope_id, transaction_hash,
            receipt_evidence_id, amount_atomic
     FROM execution_economic_effects WHERE operation_id = $1`,
    [verified.operationId],
  );
  const prior = existing.rows[0];
  if (
    !prior ||
    prior.reservation_id !== verified.reservationId ||
    prior.envelope_id !== verified.envelopeId ||
    prior.transaction_hash !== verified.transactionHash ||
    prior.amount_atomic !== verified.transfer.amountAtomic
  )
    throw new Error(
      "economic effect conflicts with the existing operation result",
    );
};

const resolveMismatch = async (
  pool: Pool,
  input: ReconciliationInput,
  mismatches: readonly ChainEvidenceMismatch[],
): Promise<ReconciliationFailure> => {
  const lease = await claimRecoveryLease(pool, {
    attemptId: input.attemptId,
    operationId: input.expectation.operationId,
    reservationId: input.expectation.reservationId,
    leaseDurationSeconds: input.leaseDurationSeconds ?? 60,
    audit: input.audits.claim,
  });
  const resolution: RecoveryResolution = {
    attemptId: input.attemptId,
    operationId: input.expectation.operationId,
    reservationId: input.expectation.reservationId,
    leaseVersion: lease.leaseVersion,
    outcome: "CONFLICT",
    reason: `chain evidence mismatch: ${mismatches.map((item) => item.code).join(",")}`,
  };
  const reservation = await resolveRecovery(pool, {
    ...resolution,
    audit: input.audits.resolve,
  });
  await advanceOperationLifecycle(
    pool,
    input,
    "DISPUTED",
    resolution,
    reservation,
  );
  return { ok: false, mismatches, reservation };
};

const advanceOperationLifecycle = async (
  pool: Pool,
  input: ReconciliationInput,
  target: "RECONCILED" | "DISPUTED",
  resolution: RecoveryResolution,
  reservation: ReservationSnapshot,
): Promise<void> => {
  const binding = await loadOperationBinding(pool, input);
  if (binding.state === target || binding.state === "RECONCILED") return;
  if (target === "DISPUTED" && binding.state === "DISPUTED") return;
  const path: readonly LifecycleState[] =
    target === "DISPUTED"
      ? ["DISPUTED"]
      : resolution.outcome === "CONFIRMED"
        ? ["BROADCAST", "PENDING_CONFIRMATION", "CONFIRMED", "RECONCILED"]
        : ["BROADCAST", "PENDING_CONFIRMATION", "REVERTED", "RECONCILED"];
  await withClient(pool, async (client) => {
    await client.query("BEGIN");
    try {
      let current = binding.state;
      for (const next of path) {
        if (current === next) continue;
        if (!isValidLifecycleTransition(current, next))
          throw new Error(
            `invalid reconciliation lifecycle transition: ${current} -> ${next}`,
          );
        const updated = await client.query(
          `UPDATE operations SET current_state = $1, version = version + 1, updated_at = now()
           WHERE operation_id = $2 AND current_state = $3`,
          [next, input.expectation.operationId, current],
        );
        if (updated.rowCount !== 1)
          throw new Error(
            `operation lifecycle changed before ${current} -> ${next}`,
          );
        await appendAuditEvent(client, {
          eventId: `${input.audits.resolve.eventId}:lifecycle:${current}:${next}`,
          actorType: "worker",
          actorId:
            input.audits.resolve.componentAuth?.componentId ??
            input.audits.resolve.actorId,
          traceId: input.audits.resolve.traceId,
          ...binding.correlation,
          eventType: "operation.state.changed",
          data: {
            reservationId: reservation.reservationId,
            previousState: current,
            state: next,
            ...(resolution.proofReference
              ? { proofReference: resolution.proofReference }
              : {}),
            ...(resolution.actualSpendAtomic
              ? { actualSpendAtomic: resolution.actualSpendAtomic }
              : {}),
            ...(input.expectation.expectedTransactionHash
              ? { transactionHash: input.expectation.expectedTransactionHash }
              : {}),
            reason: resolution.reason,
          },
        });
        current = next;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
};

/**
 * Reconcile only a verified, operation-bound local-chain result. RPC payloads
 * remain untrusted until the independent verifier succeeds; all economic
 * mutation remains behind ADR-0014 authentication and the recovery lease.
 */
const reconcileLocalChainEvidenceCore = async (
  pool: Pool,
  input: ReconciliationInput,
): Promise<ReconciliationResult> => {
  await withClient(pool, (client) => loadBroadcastBinding(client, input));
  const result = verifyUntrustedChainEvidence(
    input.expectation,
    input.evidence,
  );
  const current = await loadOperationBinding(pool, input);
  if (!result.ok) {
    if (current.state === "DISPUTED" || current.state === "RECONCILED")
      return {
        ok: false,
        mismatches: result.mismatches,
        reservation: current.reservation,
      };
    return resolveMismatch(pool, input, result.mismatches);
  }
  if (current.state === "RECONCILED") {
    if (
      !(await hasDurableTransactionEvidence(
        pool,
        input,
        result.verified.transactionHash,
      ))
    )
      throw new Error("reconciled operation is missing durable chain evidence");
    return {
      ok: true,
      evidence: result.verified,
      reservation: current.reservation,
    };
  }

  assertExactLegacyEvidence(input, result.verified);

  const priorResolution = await loadResolvedRecovery(pool, input);
  if (priorResolution) {
    if (
      (result.verified.receiptStatus === "SUCCESS" &&
        priorResolution.outcome !== "CONFIRMED") ||
      (result.verified.receiptStatus === "REVERT" &&
        priorResolution.outcome !== "FAILED") ||
      priorResolution.proofReference !==
        input.broadcastEvidence.receiptReference
    )
      throw new Error(
        "resolved recovery attempt conflicts with verified evidence",
      );
    const reservation = await resolveRecovery(pool, {
      ...priorResolution,
      audit: input.audits.resolve,
    });
    if (result.verified.receiptStatus === "SUCCESS") {
      await insertEconomicEffect(
        pool,
        input,
        result.verified,
        input.broadcastEvidence.receiptReference,
        priorResolution,
      );
      await input.barriers?.afterEconomicEffectPersisted?.();
    }
    await advanceOperationLifecycle(
      pool,
      input,
      "RECONCILED",
      priorResolution,
      reservation,
    );
    return { ok: true, evidence: result.verified, reservation };
  }

  await markReservationBroadcast(pool, {
    reservationId: input.expectation.reservationId,
    evidence: input.broadcastEvidence,
    audit: input.audits.broadcast,
  });
  await verifyBroadcastEvidence(pool, {
    reservationId: input.expectation.reservationId,
    audit: input.audits.verification,
  });
  await persistVerifiedEvidence(pool, input, result.verified);
  const receiptReference = await readReceiptReference(
    pool,
    input.expectation.reservationId,
  );
  const lease = await claimRecoveryLease(pool, {
    attemptId: input.attemptId,
    operationId: input.expectation.operationId,
    reservationId: input.expectation.reservationId,
    leaseDurationSeconds: input.leaseDurationSeconds ?? 60,
    audit: input.audits.claim,
  });
  const resolution: RecoveryResolution =
    result.verified.receiptStatus === "SUCCESS"
      ? {
          attemptId: input.attemptId,
          operationId: input.expectation.operationId,
          reservationId: input.expectation.reservationId,
          leaseVersion: lease.leaseVersion,
          outcome: "CONFIRMED",
          reason:
            "matching canonical transaction, receipt, block, and Transfer evidence",
          actualSpendAtomic: result.verified.tokenSpendAtomic,
          proofReference: receiptReference,
        }
      : {
          attemptId: input.attemptId,
          operationId: input.expectation.operationId,
          reservationId: input.expectation.reservationId,
          leaseVersion: lease.leaseVersion,
          outcome: "FAILED",
          reason: "matching status-0 receipt proves the transfer reverted",
          actualSpendAtomic: "0",
          proofReference: receiptReference,
          verifiedRevert: true,
        };
  const reservation = await resolveRecovery(pool, {
    ...resolution,
    audit: input.audits.resolve,
  });
  await input.barriers?.afterRecoveryResolved?.();
  if (result.verified.receiptStatus === "SUCCESS")
    await insertEconomicEffect(
      pool,
      input,
      result.verified,
      receiptReference,
      resolution,
    );
  if (result.verified.receiptStatus === "SUCCESS")
    await input.barriers?.afterEconomicEffectPersisted?.();
  await advanceOperationLifecycle(
    pool,
    input,
    "RECONCILED",
    resolution,
    reservation,
  );
  return { ok: true, evidence: result.verified, reservation };
};

/** Serialize retries for one operation; durable idempotency still owns results. */
export const reconcileLocalChainEvidence = async (
  pool: Pool,
  input: ReconciliationInput,
): Promise<ReconciliationResult> =>
  withClient(pool, async (lockClient) => {
    const lockIdentity = `crip:p2-05c:${input.expectation.operationId}`;
    await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [
      lockIdentity,
    ]);
    try {
      return await reconcileLocalChainEvidenceCore(pool, input);
    } finally {
      await lockClient
        .query("SELECT pg_advisory_unlock(hashtext($1))", [lockIdentity])
        .catch(() => undefined);
    }
  });
