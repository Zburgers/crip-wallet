import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import { applyMigrations } from "@crip/budget-ledger";
import {
  hashExecutableCandidate,
  hashSimulationEvidence,
  persistExecutionEnvelope,
  persistSimulation,
  type ExecutableTransferCandidate,
  type SuccessfulFreshSimulation,
} from "@crip/transaction-pipeline";
import { attachEnvelopeHash, type ExecutionEnvelopeV2 } from "@crip/schemas";
import { loadLocalRuntime } from "../../tooling/local-runtime.mjs";

const runtime = loadLocalRuntime({ root: process.cwd() });
const pool = new Pool({
  host: runtime.postgres.host,
  port: runtime.postgres.port,
  database: runtime.postgres.database,
  user: runtime.postgres.user,
  password: runtime.postgres.password,
});

const hash = `0x${"a".repeat(64)}` as `0x${string}`;
const fixtureInstanceId = "11111111-1111-4111-8111-111111111111";
const address = (suffix: string) =>
  `0x${suffix.padStart(40, "0")}` as `0x${string}`;

const executable: ExecutableTransferCandidate = {
  action: "asset.transfer",
  chainId: "eip155:31337",
  from: address("10"),
  target: address("1"),
  nativeValue: "0",
  calldata: `0xa9059cbb${address("20").slice(2).padStart(64, "0")}${BigInt(10).toString(16).padStart(64, "0")}`,
  selector: "0xa9059cbb",
  recipient: address("20"),
  amountAtomic: "10",
  nonceStrategy: "pending",
  fixtureInstanceId,
  provenance: {
    intentId: "intent_op_a",
    agentId: "agent_1",
    walletId: "wallet_1",
    operationId: "op_a",
    policyId: "policy_1",
    policyVersion: 1,
    policyDecisionHash: hash,
  },
  nonce: "7",
  transactionType: "eip1559",
  gasLimit: "21000",
  maxPriorityFeePerGas: "1",
  maxFeePerGas: "2",
  accessList: [],
};

const simulationWithoutHash = {
  schemaVersion: "1.0" as const,
  fixtureInstanceId,
  chainId: "eip155:31337" as const,
  blockNumber: "100",
  blockHash: hash,
  candidateHash: hashExecutableCandidate(executable),
  from: executable.from,
  to: executable.target,
  value: "0" as const,
  calldata: executable.calldata,
  senderNonce: executable.nonce,
  tokenBalance: "100",
  nativeBalance: "100000",
  gasEstimate: "20000",
  gasLimit: executable.gasLimit,
  baseFeePerGas: "1",
  maxPriorityFeePerGas: executable.maxPriorityFeePerGas,
  maxFeePerGas: executable.maxFeePerGas,
  accessList: [] as const,
  outcome: "success" as const,
  expectedAssetDeltas: [
    {
      assetAddress: address("1"),
      from: executable.from,
      to: executable.recipient,
      amountAtomic: executable.amountAtomic,
    },
  ],
  maximumNativeFeeAtomic: "42000",
  simulatorVersion: "viem@2.56.0" as const,
};
const simulation: SuccessfulFreshSimulation = {
  ...simulationWithoutHash,
  evidenceHash: hashSimulationEvidence(simulationWithoutHash),
};

const envelope = (): ExecutionEnvelopeV2 =>
  attachEnvelopeHash({
    schemaVersion: "2.0",
    envelopeId: "env_collision",
    revision: 1,
    intentId: "intent_op_a",
    intentHash: "sha256:" + "1".repeat(64),
    agentId: "agent_1",
    walletId: "wallet_1",
    adapterId: "local-anvil",
    adapterVersion: "0.1.0",
    chainId: "eip155:31337",
    from: executable.from,
    to: executable.target,
    value: "0",
    calldata: executable.calldata,
    decodedFunction: "erc20.transfer",
    decodedArguments: {
      assetAddress: address("1"),
      recipient: executable.recipient,
      amountAtomic: executable.amountAtomic,
    },
    expectedAssetDeltas: simulation.expectedAssetDeltas,
    simulationBlockNumber: simulation.blockNumber,
    simulationBlockHash: simulation.blockHash,
    simulationResultHash: simulation.evidenceHash,
    nonceStrategy: "pending",
    nonce: executable.nonce,
    transactionType: "eip1559",
    gasLimit: executable.gasLimit,
    maxPriorityFeePerGas: executable.maxPriorityFeePerGas,
    accessList: [],
    maximumFeeConstraints: {
      asset: "native",
      maxFeePerGas: executable.maxFeePerGas,
      maximumNetworkFeeAtomic: "42000",
    },
    policyId: "policy_1",
    policyVersion: 1,
    policyDecisionHash: hash,
    budgetReservationId: "res_a",
    createdAt: "2020-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    riskDecision: "ALLOW",
    approvalRequirement: "none",
    envelopeHash: `0x${"0".repeat(64)}`,
  });

const reset = async (): Promise<void> => {
  await pool.query(`TRUNCATE execution_economic_effects, chain_transfer_logs,
    chain_receipt_evidence, chain_transaction_evidence, broadcast_attempts,
    signed_transactions, recovery_attempts, operation_recovery_leases,
    reservation_broadcast_evidence, authorization_invalidations,
    authorization_evidence, approval_decisions, approval_requests,
    owner_approval_authentications, audit_events, idempotency_records,
    budget_reservations, budget_accounts, operations, intents,
    policy_decisions, transaction_simulations, execution_envelopes,
    policy_versions, policies, wallets, agents, owners, control_fences,
    trusted_component_credentials, local_chain_fixtures CASCADE`);
  await pool.query(`
    INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'Collision owner');
    INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'Collision agent');
    INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'Collision wallet');
    INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status)
      VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
    INSERT INTO policy_versions (policy_id, version, document, document_hash)
      VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:${"0".repeat(64)}');
    INSERT INTO control_fences (scope_type, scope_id, state) VALUES
      ('SYSTEM', 'system', 'ACTIVE'), ('OWNER', 'owner_1', 'ACTIVE'),
      ('AGENT', 'agent_1', 'ACTIVE'), ('POLICY', 'policy_1', 'ACTIVE');
    INSERT INTO budget_accounts
      (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address,
       allocated, available, reserved, finalized_spend)
      VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '${address("1")}', 100, 98, 2, 0);
    INSERT INTO local_chain_fixtures
      (fixture_instance_id, is_current, checkout_sha, chain_id, genesis_block_hash,
       token_address, token_code_hash, deployment_transaction_hash,
       deployment_block_number, deployment_block_hash, toolchain)
      VALUES ('${fixtureInstanceId}', true, '${"a".repeat(40)}', 'eip155:31337', '${hash}',
              '${address("1")}', '${hash}', '${hash}', 1, '${hash}', '{"forge":"test"}');
    INSERT INTO intents (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
      VALUES ('intent_op_a', 'key_op_a', 'agent_1', 'wallet_1', 'policy_1', 1, '{"action":"asset.transfer"}', 'sha256:${"1".repeat(64)}'),
             ('intent_op_b', 'key_op_b', 'agent_1', 'wallet_1', 'policy_1', 1, '{"action":"asset.transfer"}', 'sha256:${"2".repeat(64)}');
    INSERT INTO operations (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
      VALUES ('op_a', 'intent_op_a', 'agent_1', 'wallet_1', 'policy_1', 1, 'VERIFIED'),
             ('op_b', 'intent_op_b', 'agent_1', 'wallet_1', 'policy_1', 1, 'VERIFIED');
  `);
};

describe.sequential("P2-05D preparation identity collisions", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(reset);
  afterAll(async () => pool.end());

  test("does not advance a second operation on a simulation id collision", async () => {
    await persistSimulation(pool, {
      simulationId: "sim_collision",
      operationId: "op_a",
      executable,
      simulation,
      fixtureInstanceId,
    });

    await expect(
      persistSimulation(pool, {
        simulationId: "sim_collision",
        operationId: "op_b",
        executable,
        simulation,
        fixtureInstanceId,
      }),
    ).rejects.toThrow(/different evidence|simulation/i);
    await expect(
      pool.query(
        "SELECT current_state FROM operations WHERE operation_id = 'op_b'",
      ),
    ).resolves.toMatchObject({ rows: [{ current_state: "VERIFIED" }] });
  });

  test("does not advance a second operation on an envelope id collision", async () => {
    await pool.query(`
      UPDATE operations SET current_state = 'BUDGET_RESERVED' WHERE operation_id IN ('op_a', 'op_b');
      INSERT INTO budget_reservations
        (reservation_id, budget_id, operation_id, idempotency_key, amount_atomic, status, expires_at)
      VALUES ('res_a', 'budget_1', 'op_a', 'res_key_a', 1, 'HELD', '2099-01-01T00:00:00Z'),
             ('res_b', 'budget_1', 'op_b', 'res_key_b', 1, 'HELD', '2099-01-01T00:00:00Z');
    `);
    const persistedEnvelope = envelope();
    await persistExecutionEnvelope(pool, {
      operationId: "op_a",
      envelope: persistedEnvelope,
    });

    await expect(
      persistExecutionEnvelope(pool, {
        operationId: "op_b",
        envelope: persistedEnvelope,
      }),
    ).rejects.toThrow(/different evidence|envelope/i);
    await expect(
      pool.query(
        "SELECT current_state FROM operations WHERE operation_id = 'op_b'",
      ),
    ).resolves.toMatchObject({ rows: [{ current_state: "BUDGET_RESERVED" }] });
  });
});
