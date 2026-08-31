import type { Pool, PoolClient } from "pg";

import { appendAuditEvent, type AuditContext } from "@crip/audit";
import {
  canonicalExecutionEnvelopeV2Schema,
  hashExecutionEnvelope,
  policyDecisionSchema,
  simulationEvidenceSchema,
  transitionLifecycleState,
  type ExecutionEnvelopeV2,
  type PolicyDecision,
} from "@crip/schemas";

import {
  hashExecutableCandidate,
  hashSimulationEvidence,
  type ExecutableTransferCandidate,
  type SuccessfulFreshSimulation,
} from "./simulation.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^0x[0-9a-f]{64}$/;

export class PreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreparationError";
  }
}

const assertId = (value: string, name: string): void => {
  if (!ID.test(value)) throw new PreparationError(`${name} is not canonical`);
};

const assertHash = (value: string, name: string): void => {
  if (!HASH.test(value)) throw new PreparationError(`${name} is not canonical`);
};

const withTransaction = async <T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

const transition = async (
  client: PoolClient,
  operationId: string,
  expected: string,
  next: string,
  audit?: AuditContext,
): Promise<void> => {
  if (!transitionLifecycleState(expected as never, next as never))
    throw new PreparationError(
      `invalid lifecycle transition: ${expected} -> ${next}`,
    );
  const result = await client.query(
    `UPDATE operations
     SET current_state = $1, version = version + 1, updated_at = now()
     WHERE operation_id = $2 AND current_state = $3`,
    [next, operationId, expected],
  );
  if (result.rowCount !== 1)
    throw new PreparationError(
      `operation cannot transition from ${expected} to ${next}: ${operationId}`,
    );
  if (!audit) return;
  const correlation = await client.query<{
    owner_id: string;
    agent_id: string;
    wallet_id: string;
    intent_id: string;
    policy_id: string;
    policy_version: number;
  }>(
    `SELECT ag.owner_id, o.agent_id, o.wallet_id, o.intent_id,
            o.policy_id, o.policy_version
     FROM operations o
     JOIN agents ag ON ag.agent_id = o.agent_id
     WHERE o.operation_id = $1`,
    [operationId],
  );
  const row = correlation.rows[0];
  if (!row)
    throw new PreparationError(
      `operation correlation is missing: ${operationId}`,
    );
  const reservation = await client.query<{ reservation_id: string }>(
    "SELECT reservation_id FROM budget_reservations WHERE operation_id = $1",
    [operationId],
  );
  const reservationId = reservation.rows[0]?.reservation_id;
  if (!reservationId)
    throw new PreparationError(
      `reservation correlation is missing: ${operationId}`,
    );
  await appendAuditEvent(client, {
    eventId: audit.eventId,
    eventType: "operation.state.changed",
    actorType: audit.actorType,
    actorId: audit.actorId,
    traceId: audit.traceId,
    reservationId,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    walletId: row.wallet_id,
    intentId: row.intent_id,
    operationId,
    policyId: row.policy_id,
    policyVersion: Number(row.policy_version),
    data: { previousState: expected, state: next, reservationId },
  });
};

export const advanceOperationLifecycle = async (
  pool: Pool,
  input: {
    operationId: string;
    expected: string;
    next: string;
    audit?: AuditContext;
  },
): Promise<void> => {
  assertId(input.operationId, "operationId");
  await withTransaction(pool, async (client) => {
    await client.query(
      "SELECT operation_id FROM operations WHERE operation_id = $1 FOR UPDATE",
      [input.operationId],
    );
    await transition(
      client,
      input.operationId,
      input.expected,
      input.next,
      input.audit,
    );
  });
};

export const persistPolicyDecision = async (
  pool: Pool,
  input: {
    decisionId: string;
    operationId: string;
    decision: PolicyDecision;
    audit?: AuditContext;
  },
): Promise<void> => {
  assertId(input.decisionId, "decisionId");
  assertId(input.operationId, "operationId");
  const decision = policyDecisionSchema.parse(input.decision);
  assertHash(decision.decisionHash, "decisionHash");
  await withTransaction(pool, async (client) => {
    const operation = await client.query<{
      current_state: string;
      policy_id: string;
      policy_version: number;
    }>(
      `SELECT current_state, policy_id, policy_version
       FROM operations WHERE operation_id = $1 FOR UPDATE`,
      [input.operationId],
    );
    const row = operation.rows[0];
    if (!row || row.current_state !== "SIMULATED")
      throw new PreparationError(
        "policy decision requires a simulated operation",
      );
    if (
      row.policy_id !== decision.policyId ||
      row.policy_version !== decision.policyVersion
    )
      throw new PreparationError(
        "policy decision does not match operation policy",
      );
    await client.query(
      `INSERT INTO policy_decisions
        (decision_id, operation_id, policy_id, policy_version, decision, decision_hash, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (decision_id) DO NOTHING`,
      [
        input.decisionId,
        input.operationId,
        decision.policyId,
        decision.policyVersion,
        decision.decision,
        decision.decisionHash,
        JSON.stringify(decision),
      ],
    );
    const persisted = await client.query<{
      operation_id: string;
      decision_hash: string;
    }>(
      "SELECT operation_id, decision_hash FROM policy_decisions WHERE decision_id = $1",
      [input.decisionId],
    );
    const persistedRow = persisted.rows[0];
    if (
      !persistedRow ||
      persistedRow.operation_id !== input.operationId ||
      persistedRow.decision_hash !== decision.decisionHash
    )
      throw new PreparationError(
        "policy decision id is bound to different evidence",
      );
    await transition(
      client,
      input.operationId,
      "SIMULATED",
      "POLICY_FINALIZED",
      input.audit,
    );
  });
};

export const persistSimulation = async (
  pool: Pool,
  input: {
    simulationId: string;
    operationId: string;
    executable: ExecutableTransferCandidate;
    simulation: SuccessfulFreshSimulation;
    fixtureInstanceId: string;
    audit?: AuditContext;
  },
): Promise<void> => {
  assertId(input.simulationId, "simulationId");
  assertId(input.operationId, "operationId");
  assertId(input.fixtureInstanceId, "fixtureInstanceId");
  const simulation = simulationEvidenceSchema.parse(input.simulation);
  if (
    simulation.outcome !== "success" ||
    simulation.fixtureInstanceId !== input.fixtureInstanceId ||
    simulation.candidateHash !== hashExecutableCandidate(input.executable) ||
    simulation.evidenceHash !== hashSimulationEvidence(input.simulation)
  )
    throw new PreparationError(
      "simulation evidence does not match executable candidate",
    );
  await withTransaction(pool, async (client) => {
    const operation = await client.query<{ current_state: string }>(
      "SELECT current_state FROM operations WHERE operation_id = $1 FOR UPDATE",
      [input.operationId],
    );
    if (operation.rows[0]?.current_state !== "VERIFIED")
      throw new PreparationError("simulation requires a verified operation");
    await client.query(
      `INSERT INTO transaction_simulations
        (simulation_id, operation_id, transfer_core_candidate_hash, fixture_instance_id, chain_id,
         block_number, block_hash, sender_address, sender_nonce, token_balance_atomic, native_balance_wei,
         gas_estimate, gas_limit, base_fee_per_gas, max_priority_fee_per_gas, max_fee_per_gas, access_list,
         outcome, expected_asset_deltas, maximum_native_fee_atomic, simulator_version, evidence_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $22)
       ON CONFLICT (simulation_id) DO NOTHING`,
      [
        input.simulationId,
        input.operationId,
        simulation.candidateHash,
        simulation.fixtureInstanceId,
        simulation.chainId,
        simulation.blockNumber,
        simulation.blockHash,
        simulation.from,
        simulation.senderNonce,
        simulation.tokenBalance,
        simulation.nativeBalance,
        simulation.gasEstimate,
        simulation.gasLimit,
        simulation.baseFeePerGas,
        simulation.maxPriorityFeePerGas,
        simulation.maxFeePerGas,
        JSON.stringify(simulation.accessList),
        simulation.outcome === "success" ? "SUCCESS" : "REVERT",
        JSON.stringify(simulation.expectedAssetDeltas),
        simulation.maximumNativeFeeAtomic,
        simulation.simulatorVersion,
        simulation.evidenceHash,
      ],
    );
    await transition(
      client,
      input.operationId,
      "VERIFIED",
      "SIMULATED",
      input.audit,
    );
  });
};

export const persistExecutionEnvelope = async (
  pool: Pool,
  input: {
    operationId: string;
    envelope: ExecutionEnvelopeV2;
    audit?: AuditContext;
  },
): Promise<void> => {
  assertId(input.operationId, "operationId");
  const envelope = canonicalExecutionEnvelopeV2Schema.parse(input.envelope);
  if (hashExecutionEnvelope(envelope) !== envelope.envelopeHash)
    throw new PreparationError("execution envelope hash is invalid");
  await withTransaction(pool, async (client) => {
    const operation = await client.query<{ current_state: string }>(
      `SELECT o.current_state
       FROM operations o
       JOIN budget_reservations r ON r.operation_id = o.operation_id
       WHERE o.operation_id = $1 AND r.status = 'HELD'
       FOR UPDATE OF o, r`,
      [input.operationId],
    );
    if (operation.rows[0]?.current_state !== "BUDGET_RESERVED")
      throw new PreparationError(
        "execution envelope requires a held budget reservation",
      );
    await client.query(
      `INSERT INTO execution_envelopes
        (envelope_id, operation_id, revision, envelope_hash, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (envelope_id) DO NOTHING`,
      [
        envelope.envelopeId,
        input.operationId,
        envelope.revision,
        envelope.envelopeHash,
        JSON.stringify(envelope),
      ],
    );
    await transition(
      client,
      input.operationId,
      "BUDGET_RESERVED",
      "ENVELOPE_FINALIZED",
      input.audit,
    );
  });
};
