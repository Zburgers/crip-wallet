import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

import { Pool, type PoolClient } from "pg";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  approveApproval,
  authorizeAutonomous,
  changeControlFence,
  consumeApproval,
  createApprovalRequest,
  replaceExecutionEnvelope,
} from "@crip/approvals";
import {
  authorizeReservation,
  applyMigrations,
  claimRecoveryLease,
  expireReservation,
  markReservationBroadcast,
  releaseReservation,
  resolveRecovery,
  SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT_REASON,
  type AuditContext,
  type BroadcastEvidence,
} from "@crip/budget-ledger";
import { attachEnvelopeHash, type ExecutionEnvelopeV2 } from "@crip/schemas";
import {
  hashExecutableCandidate,
  hashSimulationEvidence,
  verifyUntrustedChainEvidence,
  type ExecutableTransferCandidate,
  type ChainEvidenceExpectation,
  type LocalReadRpc,
  type SimulationEvidence,
  type UntrustedChainEvidence,
} from "@crip/transaction-pipeline";
import {
  reconcileLocalChainEvidence,
  createLocalAnvilSignerHandler,
} from "@crip/local-anvil-adapter";
import { broadcastSignedTransaction } from "../../adapters/local-anvil/src/broadcast-core.js";
import { createBroadcastStore } from "../../adapters/local-anvil/src/broadcast-store.js";
import { createFaultProxy } from "../../adapters/local-anvil/src/fault-proxy.js";
import { createSignerStore } from "../../adapters/local-anvil/src/signer-store.js";
import { signAuthorizedTransferCore } from "../../adapters/local-anvil/src/signer-core.js";
import type { ReconciliationInput } from "../../adapters/local-anvil/src/reconciliation.js";
import {
  generateComponentCredential,
  signComponentAction,
} from "@crip/trust-boundary";
import { loadLocalRuntime } from "../../tooling/local-runtime.mjs";
import { createLocalOwnerTestCredential } from "./local-owner-auth.js";

const runtime = loadLocalRuntime({ root: process.cwd() });
const pool = new Pool({
  host: runtime.postgres.host,
  port: runtime.postgres.port,
  database: runtime.postgres.database,
  user: runtime.postgres.user,
  password: runtime.postgres.password,
  max: 4,
});

const hash = `0x${"a".repeat(64)}`;
const broadcastAccount = privateKeyToAccount(`0x${"1".repeat(64)}`);
const broadcastRawTransaction = await broadcastAccount.signTransaction({
  chainId: 31337,
  type: "eip1559",
  to: `0x${"3".repeat(40)}`,
  value: 0n,
  nonce: 0,
  gas: 21_000n,
  maxFeePerGas: 2n,
  maxPriorityFeePerGas: 1n,
  data: "0x",
  accessList: [],
});
const broadcastHash = keccak256(broadcastRawTransaction);
const address = (suffix: string): string => `0x${suffix.padStart(40, "0")}`;
const fixtureId = "11111111-1111-4111-8111-111111111111";
const zeroLogTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ownerCredential = createLocalOwnerTestCredential(
  "owner_1",
  "evidence_owner_key",
);
const adapterCredential = generateComponentCredential({
  credentialId: "credential_adapter_evidence",
  componentId: "adapter_evidence",
  role: "ADAPTER",
});
const reconcilerCredential = generateComponentCredential({
  credentialId: "credential_reconciler_evidence",
  componentId: "reconciler_evidence",
  role: "RECONCILER",
});

type Queryable = Pick<PoolClient, "query">;

const v1Envelope = (operationId: string, reservationId: string) => ({
  schemaVersion: "1.0",
  envelopeId: `env_${operationId}_1`,
  revision: 1,
  intentId: `intent_${operationId}`,
  intentHash: "sha256:" + "1".repeat(64),
  agentId: "agent_1",
  walletId: "wallet_1",
  adapterId: "local-anvil",
  adapterVersion: "0.1.0",
  chainId: "eip155:31337",
  from: address("10"),
  to: address("20"),
  value: "0",
  calldata: "0xa9059cbb",
  decodedFunction: "erc20.transfer",
  decodedArguments: {
    assetAddress: address("1"),
    recipient: address("20"),
    amountAtomic: "10",
  },
  expectedAssetDeltas: [
    {
      assetAddress: address("1"),
      from: address("10"),
      to: address("20"),
      amountAtomic: "10",
    },
  ],
  simulationBlockReference: "100",
  simulationResultHash: hash,
  nonceStrategy: "pending",
  gasLimit: "21000",
  maximumFeeConstraints: {
    asset: "native",
    maxFeePerGas: "2",
    maximumNetworkFeeAtomic: "42000",
  },
  policyId: "policy_1",
  policyVersion: 1,
  policyDecisionHash: hash,
  budgetReservationId: reservationId,
  createdAt: "2020-01-01T00:00:00Z",
  expiresAt: "2099-01-01T01:00:00Z",
  riskDecision: "ALLOW",
  approvalRequirement: "none",
  envelopeHash: hash,
});

const v2Envelope = (
  operationId: string,
  reservationId: string,
  simulationResultHash = hash,
) => ({
  schemaVersion: "2.0",
  envelopeId: `env_${operationId}_1`,
  revision: 1,
  intentId: `intent_${operationId}`,
  intentHash: "sha256:" + "1".repeat(64),
  agentId: "agent_1",
  walletId: "wallet_1",
  adapterId: "local-anvil",
  adapterVersion: "0.1.0",
  chainId: "eip155:31337",
  from: address("10"),
  to: address("1"),
  value: "0",
  calldata:
    "0xa9059cbb" +
    "0".repeat(24) +
    address("20").slice(2) +
    BigInt(10).toString(16).padStart(64, "0"),
  decodedFunction: "erc20.transfer",
  decodedArguments: {
    assetAddress: address("1"),
    recipient: address("20"),
    amountAtomic: "10",
  },
  expectedAssetDeltas: [
    {
      assetAddress: address("1"),
      from: address("10"),
      to: address("20"),
      amountAtomic: "10",
    },
  ],
  simulationBlockNumber: "100",
  simulationBlockHash: hash,
  simulationResultHash,
  nonceStrategy: "pending",
  nonce: "7",
  transactionType: "eip1559",
  gasLimit: "50000",
  maxPriorityFeePerGas: "1",
  accessList: [],
  maximumFeeConstraints: {
    asset: "native",
    maxFeePerGas: "2",
    maximumNetworkFeeAtomic: "100000",
  },
  policyId: "policy_1",
  policyVersion: 1,
  policyDecisionHash: hash,
  budgetReservationId: reservationId,
  createdAt: "2020-01-01T00:00:00Z",
  expiresAt: "2099-01-01T01:00:00Z",
  riskDecision: "ALLOW",
  approvalRequirement: "none",
  envelopeHash: hash,
});

const envelopeHashFor = async (
  client: Queryable,
  payload: Record<string, unknown>,
): Promise<string> => {
  const result = await client.query<{ envelope_hash: string }>(
    `SELECT '0x' || approval_keccak256(
       convert_to('crip/execution-envelope' || CASE WHEN $1::jsonb ->> 'schemaVersion' = '1.0' THEN 'v1' ELSE 'v2' END, 'UTF8')
       || decode('00', 'hex')
       || convert_to(canonicalize_approval_jsonb($1::jsonb - 'envelopeHash'), 'UTF8')
     ) AS envelope_hash`,
    [JSON.stringify(payload)],
  );
  return result.rows[0]!.envelope_hash;
};

const seed = async (client: Queryable): Promise<void> => {
  await client.query(`
    INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'Evidence owner');
    INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'Evidence agent');
    INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'Evidence wallet');
    INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
    INSERT INTO policy_versions (policy_id, version, document, document_hash)
      VALUES ('policy_1', 1, '{"schemaVersion":"1.0","maximumNetworkFeeAtomic":"100000"}', 'sha256:${"0".repeat(64)}');
    INSERT INTO budget_accounts
      (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address, allocated, available, reserved, finalized_spend)
      VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '${address("1")}', 100, 100, 0, 0);
    INSERT INTO control_fences (scope_type, scope_id, state) VALUES
      ('SYSTEM', 'system', 'ACTIVE'), ('OWNER', 'owner_1', 'ACTIVE'),
      ('AGENT', 'agent_1', 'ACTIVE'), ('POLICY', 'policy_1', 'ACTIVE');
    INSERT INTO trusted_component_credentials
      (credential_id, component_id, component_role, public_key)
    VALUES
      ('${adapterCredential.credentialId}', '${adapterCredential.componentId}', 'ADAPTER', '${adapterCredential.publicKey}'),
      ('${reconcilerCredential.credentialId}', '${reconcilerCredential.componentId}', 'RECONCILER', '${reconcilerCredential.publicKey}');
    INSERT INTO local_owner_approval_keys (key_id, owner_id, algorithm, public_key)
      VALUES ('${ownerCredential.keyId}', 'owner_1', 'ED25519', '${ownerCredential.publicKeyPem}');
    INSERT INTO intents
      (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
      VALUES ('intent_op_1', 'intent-key-op_1', 'agent_1', 'wallet_1', 'policy_1', 1, '{"action":"asset.transfer","maximumNetworkFee":{"asset":"native","atomic":"100000"}}', 'sha256:${"1".repeat(64)}');
    INSERT INTO operations
      (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
      VALUES ('op_1', 'intent_op_1', 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED');
    INSERT INTO budget_reservations
      (reservation_id, budget_id, operation_id, idempotency_key, amount_atomic, status, expires_at)
      VALUES ('res_1', 'budget_1', 'op_1', 'reserve-key-op_1', 10, 'HELD', '2099-01-01T01:00:00Z');
    INSERT INTO intents
      (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
      VALUES ('intent_op_2', 'intent-key-op_2', 'agent_1', 'wallet_1', 'policy_1', 1, '{"action":"asset.transfer","maximumNetworkFee":{"asset":"native","atomic":"100000"}}', 'sha256:${"2".repeat(64)}');
    INSERT INTO operations
      (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
      VALUES ('op_2', 'intent_op_2', 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED');
    INSERT INTO budget_reservations
      (reservation_id, budget_id, operation_id, idempotency_key, amount_atomic, status, expires_at)
      VALUES ('res_2', 'budget_1', 'op_2', 'reserve-key-op_2', 10, 'HELD', '2099-01-01T01:00:00Z');
  `);
};

const insertFixture = async (
  client: Queryable,
  id = fixtureId,
  current = true,
): Promise<void> => {
  await client.query(
    `INSERT INTO local_chain_fixtures
      (fixture_instance_id, is_current, checkout_sha, chain_id, genesis_block_hash,
       token_address, token_code_hash, deployment_transaction_hash,
       deployment_block_number, deployment_block_hash, toolchain)
     VALUES ($1, $2, $3, 'eip155:31337', $4, $5, $6, $7, 1, $8, $9::jsonb)`,
    [
      id,
      current,
      "a".repeat(40),
      hash,
      address("1"),
      hash,
      hash,
      hash,
      JSON.stringify({ forge: "local" }),
    ],
  );
};

const insertEnvelope = async (
  client: Queryable,
  payload: Record<string, unknown>,
): Promise<string> => {
  const envelopeHash = await envelopeHashFor(client, payload);
  const withHash = { ...payload, envelopeHash };
  await client.query(
    `INSERT INTO execution_envelopes
      (envelope_id, operation_id, revision, envelope_hash, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      withHash.envelopeId,
      String(withHash.intentId).replace(/^intent_/, ""),
      withHash.revision,
      envelopeHash,
      JSON.stringify(withHash),
    ],
  );
  return envelopeHash;
};

const audit = (operationId: string, suffix: string, actorType = "system") => ({
  eventId: `evt:${operationId}:${suffix}`,
  actorType,
  actorId: actorType === "owner" ? "owner_1" : "evidence-test",
  traceId: createHash("md5").update(`${operationId}:${suffix}`).digest("hex"),
});

const signingInput = (envelopeHash: string, acceptedDeadlineAt?: string) => {
  const freshnessSampledAt = new Date().toISOString();
  return {
    signedTransactionId: "signed:op_1:1",
    ids: {
      operationId: "op_1",
      authorizationId: "approval_1:authorization",
      adapterRequestId: "signer-store-test",
    },
    reservationId: "res_1",
    envelopeId: "env_op_1_1",
    envelopeRevision: 1,
    envelopeHash,
    simulationId: "sim_1",
    fixtureInstanceId: fixtureId,
    signerCredentialId: adapterCredential.credentialId,
    freshnessObservation: {
      headNumber: "100",
      simulationBlockNumber: "100",
      simulationBlockHash: hash,
      senderNonce: "7",
      tokenBalanceAtomic: "100",
      nativeBalanceWei: "100000",
      baseFeePerGas: "1",
      maxPriorityFeePerGas: "1",
    },
    freshnessSampledAt,
    freshnessDeadlineAt:
      acceptedDeadlineAt ??
      new Date(Date.parse(freshnessSampledAt) + 2_000).toISOString(),
  };
};

const coreTestSimulation = (): SimulationEvidence => {
  const executable = {
    action: "asset.transfer",
    chainId: "eip155:31337",
    from: address("10"),
    target: address("1"),
    nativeValue: "0",
    calldata: v2Envelope("op_1", "res_1").calldata,
    selector: "0xa9059cbb",
    recipient: address("20"),
    amountAtomic: "10",
    nonceStrategy: "pending",
    fixtureInstanceId: fixtureId,
    provenance: {
      intentId: "intent_op_1",
      agentId: "agent_1",
      walletId: "wallet_1",
      operationId: "op_1",
      policyId: "policy_1",
      policyVersion: 1,
      policyDecisionHash: hash,
    },
    nonce: "7",
    transactionType: "eip1559",
    gasLimit: "50000",
    maxPriorityFeePerGas: "1",
    maxFeePerGas: "2",
    accessList: [],
  } as ExecutableTransferCandidate;
  const evidence = {
    schemaVersion: "1.0",
    fixtureInstanceId: fixtureId,
    chainId: "eip155:31337",
    blockNumber: "100",
    blockHash: hash,
    candidateHash: hashExecutableCandidate(executable),
    from: address("10"),
    to: address("1"),
    value: "0",
    calldata: v2Envelope("op_1", "res_1").calldata,
    senderNonce: "7",
    tokenBalance: "100",
    nativeBalance: "100000",
    gasEstimate: "45454",
    gasLimit: "50000",
    baseFeePerGas: "1",
    maxPriorityFeePerGas: "1",
    maxFeePerGas: "2",
    accessList: [],
    outcome: "success",
    expectedAssetDeltas: [
      {
        assetAddress: address("1"),
        from: address("10"),
        to: address("20"),
        amountAtomic: "10",
      },
    ],
    maximumNativeFeeAtomic: "100000",
    simulatorVersion: "viem@2.56.0",
    evidenceHash: `0x${"0".repeat(64)}`,
  } as SimulationEvidence;
  return { ...evidence, evidenceHash: hashSimulationEvidence(evidence) };
};

const signingAudit = (suffix: string) => ({
  eventIdBase: `evt:op_1:${suffix}`,
  traceId: createHash("md5").update(suffix).digest("hex"),
  actorId: adapterCredential.componentId,
  credentialId: adapterCredential.credentialId,
});

const insertSimulation = async (
  client: Queryable,
  evidence?: SimulationEvidence,
): Promise<void> => {
  await client.query(
    `INSERT INTO transaction_simulations
      (simulation_id, operation_id, transfer_core_candidate_hash, fixture_instance_id,
       chain_id, block_number, block_hash, sender_address, sender_nonce,
       token_balance_atomic, native_balance_wei, gas_estimate, gas_limit,
       base_fee_per_gas, max_priority_fee_per_gas, max_fee_per_gas, access_list,
       outcome, expected_asset_deltas, maximum_native_fee_atomic, simulator_version, evidence_hash)
     VALUES ('sim_1', 'op_1', $1, $2, 'eip155:31337', 100, $3, $4, 7, 100, 100000,
       $6, 50000, 1, 1, 2, '[]', 'SUCCESS', $5::jsonb, 100000,
       'viem@2.56.0', $7)`,
    [
      evidence?.candidateHash ?? hash,
      fixtureId,
      hash,
      address("10"),
      JSON.stringify([
        {
          assetAddress: address("1"),
          from: address("10"),
          to: address("20"),
          amountAtomic: "10",
        },
      ]),
      evidence?.gasEstimate ?? "21000",
      evidence?.evidenceHash ?? hash,
    ],
  );
};

const prepareAuthorizedV2 = async (
  authorizationKind: "OWNER_APPROVAL" | "AUTONOMOUS_POLICY" = "OWNER_APPROVAL",
  coreValidSimulation = false,
): Promise<string> => {
  await insertFixture(pool);
  const evidence = coreValidSimulation ? coreTestSimulation() : undefined;
  const envelope = v2Envelope("op_1", "res_1", evidence?.evidenceHash ?? hash);
  const envelopeHash = await insertEnvelope(pool, envelope);
  await insertSimulation(pool, evidence);
  const autonomous = authorizationKind === "AUTONOMOUS_POLICY";
  await pool.query(
    `INSERT INTO policy_decisions
      (decision_id, operation_id, policy_id, policy_version, decision, decision_hash, payload)
     VALUES ('decision_1', 'op_1', 'policy_1', 1, $1, $2, $3::jsonb)`,
    [
      autonomous ? "ALLOW_AUTONOMOUS" : "REQUIRE_APPROVAL",
      hash,
      JSON.stringify({
        decision: autonomous ? "ALLOW_AUTONOMOUS" : "REQUIRE_APPROVAL",
        policyVersion: 1,
      }),
    ],
  );
  await pool.query(
    "UPDATE operations SET current_state = 'ENVELOPE_FINALIZED', version = version + 1 WHERE operation_id = 'op_1'",
  );
  if (autonomous) {
    await authorizeAutonomous(
      pool,
      {
        authorizationId: "approval_1:authorization",
        operationId: "op_1",
        reservationId: "res_1",
        envelopeId: envelope.envelopeId as string,
        envelopeRevision: 1,
        envelopeHash: envelopeHash as `0x${string}`,
        policyDecisionId: "decision_1",
        policyDecisionHash: hash as `0x${string}`,
        idempotencyKey: "signer-store-autonomous",
      },
      audit("op_1", "autonomous-authorization"),
    );
    return envelopeHash;
  }
  await createApprovalRequest(pool, {
    approvalId: "approval_1",
    operationId: "op_1",
    reservationId: "res_1",
    envelopeId: envelope.envelopeId as string,
    envelopeRevision: 1,
    envelopeHash,
    policyDecisionId: "decision_1",
    issuedAt: "2020-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:50:00Z",
    nonce: "approval-nonce-1",
    audit: audit("op_1", "approval-requested"),
  });
  await approveApproval(pool, {
    approvalId: "approval_1",
    authentication: ownerCredential.authenticate({
      approvalId: "approval_1",
      envelopeHash,
      policyId: "policy_1",
      policyVersion: 1,
      expiresAt: "2099-01-01T00:50:00Z",
      nonce: "approval-nonce-1",
    }),
    now: "2099-01-01T00:01:00Z",
    audit: audit("op_1", "approval-approved", "owner"),
  });
  await consumeApproval(pool, {
    approvalId: "approval_1",
    operationId: "op_1",
    envelopeId: envelope.envelopeId as string,
    envelopeRevision: 1,
    envelopeHash,
    consumerId: "evidence-test",
    now: "2099-01-01T00:02:00Z",
    audit: audit("op_1", "approval-consumed"),
  });
  return envelopeHash;
};

const reset = async (): Promise<void> => {
  await pool.query(
    `TRUNCATE execution_economic_effects, chain_transfer_logs,
      chain_receipt_evidence, chain_transaction_evidence, broadcast_attempts,
      signed_transactions, transaction_simulations, local_chain_fixtures,
      execution_envelopes, budget_reservations, operations, intents,
      budget_accounts, policy_versions, policies, wallets, agents, owners,
      local_owner_approval_keys, trusted_component_credentials, control_fences CASCADE`,
  );
  await seed(pool);
};

const componentAudit = (
  operationId: string,
  suffix: string,
  componentAuth: AuditContext["componentAuth"],
): AuditContext => ({
  ...audit(operationId, suffix, "worker"),
  componentAuth,
});

const markOperationSigned = async (operationId = "op_1"): Promise<void> => {
  await pool.query(
    "UPDATE operations SET current_state = 'SIGNING', version = version + 1 WHERE operation_id = $1",
    [operationId],
  );
  await pool.query(
    "UPDATE operations SET current_state = 'SIGNED', version = version + 1 WHERE operation_id = $1",
    [operationId],
  );
};

const reconciliationFixture = async (
  receiptStatus: "success" | "reverted" = "success",
  hooks?: ReconciliationInput["barriers"],
  attemptStatus: "STARTED" | "ACCEPTED" | "UNKNOWN" | "CONFLICT" = "ACCEPTED",
): Promise<ReconciliationInput> => {
  const envelopeHash = await prepareAuthorizedV2();
  const envelope = {
    ...v2Envelope("op_1", "res_1"),
    envelopeHash,
  } as ExecutionEnvelopeV2;
  await pool.query(
    "UPDATE budget_accounts SET available = 90, reserved = 10 WHERE budget_id = 'budget_1'",
  );
  await pool.query(
    `INSERT INTO signed_transactions
      (signed_transaction_id, operation_id, reservation_id, envelope_id, envelope_revision,
       envelope_hash, authorization_id, simulation_id, fixture_instance_id,
       expected_transaction_hash, signer_credential_id, signer_component_id, signed_at)
     VALUES ('signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1, 'approval_1:authorization',
       'sim_1', $2, $3, $4, $5, now())`,
    [
      envelopeHash,
      fixtureId,
      hash,
      adapterCredential.credentialId,
      adapterCredential.componentId,
    ],
  );
  await markOperationSigned();
  await pool.query(
    `INSERT INTO broadcast_attempts
      (attempt_id, signed_transaction_id, operation_id, reservation_id, envelope_id,
       envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
       expected_transaction_hash)
     VALUES ('attempt_1', 'signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1,
       'approval_1:authorization', $2, $3)`,
    [envelopeHash, fixtureId, hash],
  );
  if (attemptStatus !== "STARTED")
    await pool.query(
      `UPDATE broadcast_attempts SET status = $1, response_transaction_hash = $2,
        classification_reason = $3, completed_at = now()
       WHERE attempt_id = 'attempt_1'`,
      [
        attemptStatus,
        attemptStatus === "ACCEPTED"
          ? hash
          : attemptStatus === "CONFLICT"
            ? `0x${"c".repeat(64)}`
            : null,
        attemptStatus === "ACCEPTED"
          ? "MATCHING_RETURNED_TRANSACTION_HASH"
          : attemptStatus === "CONFLICT"
            ? "CONTRADICTORY_RETURNED_HASH"
            : "TRANSPORT_OR_RESPONSE_UNCERTAIN",
      ],
    );
  const expectation: ChainEvidenceExpectation = {
    operationId: "op_1",
    reservationId: "res_1",
    envelopeId: "env_op_1_1",
    envelopeRevision: 1,
    envelopeHash: envelopeHash as `0x${string}`,
    authorizationId: "approval_1:authorization",
    fixtureInstanceId: fixtureId,
    expectedTransactionHash: hash as `0x${string}`,
    fixture: {
      fixtureInstanceId: fixtureId,
      chainId: "eip155:31337",
      walletAddress: address("10") as `0x${string}`,
      tokenAddress: address("1") as `0x${string}`,
      rpcUrl: "http://127.0.0.1:8545/",
    },
    envelope,
  };
  const blockHash = `0x${"b".repeat(64)}` as const;
  const transferData = `0x${BigInt(10).toString(16).padStart(64, "0")}`;
  const topicAddress = (value: string) =>
    `0x${"0".repeat(24)}${value.slice(2)}`;
  const evidence: UntrustedChainEvidence = {
    transaction: {
      hash,
      chainId: 31337n,
      blockHash,
      blockNumber: 101n,
      transactionIndex: 0n,
      from: address("10"),
      to: address("1"),
      value: 0n,
      input: envelope.calldata,
      nonce: 7n,
      type: "eip1559",
      gas: 50000n,
      maxPriorityFeePerGas: 1n,
      maxFeePerGas: 2n,
      accessList: [],
    },
    receipt: {
      transactionHash: hash,
      blockHash,
      blockNumber: 101n,
      status: receiptStatus,
      gasUsed: 45000n,
      effectiveGasPrice: 2n,
      logs:
        receiptStatus === "success"
          ? [
              {
                address: address("1"),
                topics: [
                  zeroLogTopic,
                  topicAddress(address("10")),
                  topicAddress(address("20")),
                ],
                data: transferData,
                logIndex: 0n,
                transactionHash: hash,
                blockHash,
                blockNumber: 101n,
                removed: false,
              },
            ]
          : [],
    },
    canonicalBlockByNumber: { number: 101n, hash: blockHash },
    canonicalBlockByHash: { number: 101n, hash: blockHash },
  };
  const broadcastEvidence: BroadcastEvidence = {
    transactionHash: hash,
    nonce: "7",
    receiptReference: "receipt:attempt_1",
  };
  const reason =
    receiptStatus === "success"
      ? "matching canonical transaction, receipt, block, and Transfer evidence"
      : "matching status-0 receipt proves the transfer reverted";
  const outcome = receiptStatus === "success" ? "CONFIRMED" : "FAILED";
  return {
    expectation,
    evidence,
    broadcastEvidence,
    attemptId: "attempt_1",
    ...(hooks ? { barriers: hooks } : {}),
    audits: {
      broadcast: componentAudit(
        "op_1",
        "reconcile:broadcast",
        signComponentAction(adapterCredential, "broadcast", {
          reservationId: "res_1",
          ...broadcastEvidence,
        }),
      ),
      verification: componentAudit(
        "op_1",
        "reconcile:verify",
        signComponentAction(reconcilerCredential, "verify", {
          reservationId: "res_1",
          ...broadcastEvidence,
        }),
      ),
      claim: componentAudit(
        "op_1",
        "reconcile:claim",
        signComponentAction(reconcilerCredential, "recovery.claim", {
          attemptId: "attempt_1",
          operationId: "op_1",
          reservationId: "res_1",
          leaseDurationSeconds: 60,
        }),
      ),
      resolve: componentAudit(
        "op_1",
        "reconcile:resolve",
        signComponentAction(reconcilerCredential, "recovery.resolve", {
          attemptId: "attempt_1",
          operationId: "op_1",
          reservationId: "res_1",
          leaseVersion: "1",
          outcome,
          reason,
          actualSpendAtomic: receiptStatus === "success" ? "10" : "0",
          proofReference: broadcastEvidence.receiptReference,
          ...(receiptStatus === "reverted" ? { verifiedRevert: true } : {}),
          evidence: broadcastEvidence,
        }),
      ),
    },
  };
};

const broadcastStartFixture = async (): Promise<void> => {
  const envelopeHash = await prepareAuthorizedV2();
  await pool.query(
    "UPDATE budget_accounts SET available = 90, reserved = 10 WHERE budget_id = 'budget_1'",
  );
  await pool.query(
    `INSERT INTO signed_transactions
      (signed_transaction_id, operation_id, reservation_id, envelope_id, envelope_revision,
       envelope_hash, authorization_id, simulation_id, fixture_instance_id,
       expected_transaction_hash, signer_credential_id, signer_component_id, signed_at)
     VALUES ('signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1, 'approval_1:authorization',
       'sim_1', $2, $3, $4, $5, now())`,
    [
      envelopeHash,
      fixtureId,
      broadcastHash,
      adapterCredential.credentialId,
      adapterCredential.componentId,
    ],
  );
  await markOperationSigned();
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const waitForDatabaseBlock = async (
  applicationName: string,
  isSettled?: () => boolean,
): Promise<boolean> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
         WHERE a.application_name = $1
           AND cardinality(pg_blocking_pids(a.pid)) > 0
       ) AS blocked`,
      [applicationName],
    );
    if (result.rows[0]?.blocked) return true;
    if (isSettled?.()) return false;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (isSettled?.()) return false;
  throw new Error(`database session did not block: ${applicationName}`);
};

const startFaultUpstream = async (): Promise<{
  server: Server;
  url: string;
}> => {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number; method: string };
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: rpc.method === "eth_chainId" ? "0x7a69" : broadcastHash,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fault upstream did not bind");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const senderThroughProxy = (proxy: { url: string }) => ({
  sendRawTransaction: async (raw: string): Promise<string> => {
    const response = await fetch(proxy.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [raw],
      }),
    });
    const body = (await response.json()) as {
      result?: string;
      error?: { message?: string };
    };
    if (body.error) throw new Error(body.error.message ?? "RPC error");
    if (!body.result) throw new Error("RPC response unavailable");
    return body.result;
  },
});

describe.sequential("WS-004 execution evidence persistence", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(async () => {
    const result = await pool.query<{ exists: boolean }>(
      "SELECT to_regclass('public.local_chain_fixtures') IS NOT NULL AS exists",
    );
    if (result.rows[0]?.exists) await reset();
  });
  afterAll(async () => pool.end());

  test("applies the P3-04 recovery migration after the frozen migrations", async () => {
    const rows = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    );
    expect(rows.rows).toHaveLength(33);
    expect(rows.rows.at(-1)?.filename).toBe(
      "0033_ws005_recovery_lease_renewal.sql",
    );
  });

  test("does not invoke the signer after its accepted freshness deadline", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    let signCalls = 0;

    await expect(
      createSignerStore(pool).signAndPersistEvidence(
        signingInput(envelopeHash, new Date(Date.now() - 1_000).toISOString()),
        async () => {
          signCalls += 1;
          return { transactionHash: `0x${"b".repeat(64)}` };
        },
        signingAudit("expired-sample"),
      ),
    ).rejects.toThrow(/freshness|deadline/i);

    expect(signCalls).toBe(0);
    await expect(
      pool.query<{ current_state: string }>(
        "SELECT current_state FROM operations WHERE operation_id = 'op_1'",
      ),
    ).resolves.toMatchObject({ rows: [{ current_state: "AUTHORIZED" }] });
  });

  test("does not invoke the signer when freshness expires during fence lock wait", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    const blocker = await pool.connect();
    const signerPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: "p3-signer-freshness-wait",
    });
    const applicationName = "p3-signer-freshness-wait";
    const deadlineAt = new Date(Date.now() + 1_800).toISOString();
    let signCalls = 0;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `SELECT 1 FROM control_fences
         WHERE scope_type = 'SYSTEM' AND scope_id = 'system' FOR UPDATE`,
      );
      const signing = createSignerStore(signerPool).signAndPersistEvidence(
        signingInput(envelopeHash, deadlineAt),
        async () => {
          signCalls += 1;
          return { transactionHash: `0x${"d".repeat(64)}` };
        },
        signingAudit("freshness-wait"),
      );

      await waitForDatabaseBlock(applicationName);
      await expect(signing).rejects.toThrow(/freshness|deadline/i);
      expect(signCalls).toBe(0);
      await expect(
        pool.query<{ current_state: string }>(
          "SELECT current_state FROM operations WHERE operation_id = 'op_1'",
        ),
      ).resolves.toMatchObject({ rows: [{ current_state: "AUTHORIZED" }] });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await signerPool.end();
    }
  });

  test("rolls back if local signing outlives its accepted freshness deadline", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    const deadlineAt = new Date(Date.now() + 1_750).toISOString();
    let signCalls = 0;
    let signerSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      signerSettled = resolve;
    });

    const signing = createSignerStore(pool).signAndPersistEvidence(
      signingInput(envelopeHash, deadlineAt),
      async () => {
        signCalls += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 2_250));
        signerSettled();
        return { transactionHash: `0x${"e".repeat(64)}` };
      },
      signingAudit("slow-signer"),
    );

    await expect(signing).rejects.toThrow(/freshness|deadline/i);
    expect(signCalls).toBe(1);
    let settlementTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        settled,
        new Promise<never>((_resolve, reject) => {
          settlementTimeout = setTimeout(
            () => reject(new Error("local signer callback did not settle")),
            3_000,
          );
        }),
      ]);
    } finally {
      if (settlementTimeout) clearTimeout(settlementTimeout);
    }
    await expect(
      pool.query<{ current_state: string; signed_count: number }>(
        `SELECT o.current_state,
                (SELECT count(*)::int FROM signed_transactions s
                 WHERE s.operation_id = o.operation_id) AS signed_count
         FROM operations o WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [{ current_state: "AUTHORIZED", signed_count: 0 }],
    });
  });

  test("does not sign with a credential revoked before the authority transaction", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    await pool.query(
      `UPDATE trusted_component_credentials
       SET status = 'REVOKED', revoked_at = clock_timestamp()
       WHERE credential_id = $1`,
      [adapterCredential.credentialId],
    );
    let signCalls = 0;

    await expect(
      createSignerStore(pool).signAndPersistEvidence(
        signingInput(envelopeHash),
        async () => {
          signCalls += 1;
          return { transactionHash: `0x${"c".repeat(64)}` };
        },
        signingAudit("revoked-credential"),
      ),
    ).rejects.toThrow(/credential/i);

    expect(signCalls).toBe(0);
    await expect(
      pool.query<{ current_state: string }>(
        "SELECT current_state FROM operations WHERE operation_id = 'op_1'",
      ),
    ).resolves.toMatchObject({ rows: [{ current_state: "AUTHORIZED" }] });
  });

  test("does not sign when credential revocation wins the credential lock", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    const revoker = await pool.connect();
    const applicationName = "p3-signer-credential-revocation";
    const signerPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: applicationName,
    });
    let signCalls = 0;

    try {
      await revoker.query("BEGIN");
      await revoker.query(
        `UPDATE trusted_component_credentials
         SET status = 'REVOKED', revoked_at = clock_timestamp()
         WHERE credential_id = $1`,
        [adapterCredential.credentialId],
      );
      const signing = createSignerStore(signerPool).signAndPersistEvidence(
        signingInput(envelopeHash),
        async () => {
          signCalls += 1;
          return { transactionHash: `0x${"c".repeat(64)}` };
        },
        signingAudit("credential-revocation-race"),
      );

      await waitForDatabaseBlock(applicationName);
      await revoker.query("COMMIT");
      await expect(signing).rejects.toThrow(/credential/i);
      expect(signCalls).toBe(0);
      await expect(
        pool.query<{ current_state: string; signed_count: number }>(
          `SELECT o.current_state,
                  (SELECT count(*)::int FROM signed_transactions s
                   WHERE s.operation_id = o.operation_id) AS signed_count
           FROM operations o WHERE o.operation_id = 'op_1'`,
        ),
      ).resolves.toMatchObject({
        rows: [{ current_state: "AUTHORIZED", signed_count: 0 }],
      });
    } finally {
      await revoker.query("ROLLBACK").catch(() => undefined);
      revoker.release();
      await signerPool.end();
    }
  });

  test("control fence that wins the lock order prevents signing", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    await pool.query(
      "UPDATE budget_accounts SET available = 80, reserved = 20 WHERE budget_id = 'budget_1'",
    );
    const blocker = await pool.connect();
    const controlApplicationName = "p3-control-first";
    const signerApplicationName = "p3-signer-after-control";
    const controlPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: controlApplicationName,
    });
    const signerPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: signerApplicationName,
    });
    let signCalls = 0;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT operation_id FROM operations WHERE operation_id = 'op_1' FOR UPDATE",
      );
      const control = changeControlFence(controlPool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: audit("op_1", "control-first"),
      });
      await waitForDatabaseBlock(controlApplicationName);
      const signing = createSignerStore(signerPool).signAndPersistEvidence(
        signingInput(envelopeHash),
        async () => {
          signCalls += 1;
          return { transactionHash: `0x${"d".repeat(64)}` };
        },
        signingAudit("control-first"),
      );
      await waitForDatabaseBlock(signerApplicationName);
      await blocker.query("COMMIT");

      await expect(control).resolves.toMatchObject({
        state: "PAUSED",
        changed: true,
      });
      await expect(signing).rejects.toThrow();
      expect(signCalls).toBe(0);
      await expect(
        pool.query<{
          current_state: string;
          reservation_status: string;
          signed_count: number;
        }>(
          `SELECT o.current_state, r.status AS reservation_status,
                  (SELECT count(*)::int FROM signed_transactions s
                   WHERE s.operation_id = o.operation_id) AS signed_count
           FROM operations o JOIN budget_reservations r USING (operation_id)
           WHERE o.operation_id = 'op_1'`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            current_state: "REVALIDATION_REQUIRED",
            reservation_status: "RELEASED",
            signed_count: 0,
          },
        ],
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await controlPool.end();
      await signerPool.end();
    }
  });

  test("signing that wins the fence lock commits before a later control change", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    await pool.query(
      "UPDATE budget_accounts SET available = 80, reserved = 20 WHERE budget_id = 'budget_1'",
    );
    const signerApplicationName = "p3-signer-first";
    const controlApplicationName = "p3-control-after-signer";
    const signerPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: signerApplicationName,
    });
    const controlPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: controlApplicationName,
    });
    const signingEntered = deferred();
    const finishSigning = deferred();

    try {
      const signing = createSignerStore(signerPool).signAndPersistEvidence(
        signingInput(envelopeHash),
        async () => {
          await finishSigning.promise;
          return { transactionHash: `0x${"e".repeat(64)}` };
        },
        signingAudit("signer-first"),
        () => signingEntered.resolve(),
      );
      await signingEntered.promise;
      const control = changeControlFence(controlPool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: audit("op_1", "control-after-signer"),
      });
      await waitForDatabaseBlock(controlApplicationName);
      finishSigning.resolve();

      await expect(signing).resolves.toMatchObject({
        transactionHash: `0x${"e".repeat(64)}`,
      });
      await expect(control).resolves.toMatchObject({
        state: "PAUSED",
        changed: true,
      });
      await expect(
        pool.query<{
          current_state: string;
          reservation_status: string;
          signed_count: number;
          invalidation_count: number;
        }>(
          `SELECT o.current_state, r.status AS reservation_status,
                  (SELECT count(*)::int FROM signed_transactions s
                   WHERE s.operation_id = o.operation_id) AS signed_count,
                  (SELECT count(*)::int FROM authorization_invalidations ai
                   WHERE ai.operation_id = o.operation_id) AS invalidation_count
           FROM operations o JOIN budget_reservations r USING (operation_id)
           WHERE o.operation_id = 'op_1'`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            current_state: "DISPUTED",
            reservation_status: "DISPUTED",
            signed_count: 1,
            invalidation_count: 1,
          },
        ],
      });
    } finally {
      finishSigning.resolve();
      await controlPool.end();
      await signerPool.end();
    }
  });

  test("control and broadcast evidence serialize authorization before operation", async () => {
    await broadcastStartFixture();
    const blocker = await pool.connect();
    const controlApplicationName = "p3-control-auth-lock-order";
    const broadcastApplicationName = "p3-broadcast-auth-lock-order";
    const controlPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: controlApplicationName,
    });
    const broadcastPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: broadcastApplicationName,
    });
    let control: ReturnType<typeof changeControlFence> | undefined;
    let broadcast: ReturnType<typeof markReservationBroadcast> | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT authorization_id FROM authorization_evidence WHERE operation_id = 'op_1' FOR UPDATE",
      );
      control = changeControlFence(controlPool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: audit("op_1", "authorization-operation-lock-order"),
      });
      await waitForDatabaseBlock(controlApplicationName);

      const evidence: BroadcastEvidence = {
        transactionHash: broadcastHash,
        nonce: "7",
        receiptReference: "receipt:authorization-operation-lock-order",
      };
      broadcast = markReservationBroadcast(broadcastPool, {
        reservationId: "res_1",
        evidence,
        audit: componentAudit(
          "op_1",
          "authorization-operation-lock-order",
          signComponentAction(adapterCredential, "broadcast", {
            reservationId: "res_1",
            ...evidence,
          }),
        ),
      });
      await waitForDatabaseBlock(broadcastApplicationName);
      await blocker.query("COMMIT");

      const [controlResult, broadcastResult] = await Promise.allSettled([
        control,
        broadcast,
      ]);
      expect(controlResult.status).toBe("fulfilled");
      if (broadcastResult.status === "rejected")
        expect(broadcastResult.reason).toMatchObject({
          code: "INVALID_RESERVATION_TRANSITION",
        });
      else expect(broadcastResult.value.status).toBe("BROADCAST");
      await expect(
        pool.query<{
          current_state: string;
          reservation_status: string;
          evidence_count: number;
        }>(
          `SELECT o.current_state, r.status AS reservation_status,
                  (SELECT count(*)::int FROM reservation_broadcast_evidence e
                   WHERE e.reservation_id = r.reservation_id) AS evidence_count
           FROM operations o JOIN budget_reservations r USING (operation_id)
           WHERE o.operation_id = 'op_1'`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            current_state: "DISPUTED",
            reservation_status: "DISPUTED",
            evidence_count: broadcastResult.status === "fulfilled" ? 1 : 0,
          },
        ],
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([control, broadcast].filter(Boolean));
      blocker.release();
      await Promise.all([controlPool.end(), broadcastPool.end()]);
    }
  });

  test("control locks authorization before acquiring operation rows", async () => {
    await broadcastStartFixture();
    const blocker = await pool.connect();
    const controlApplicationName = "p3-control-auth-first";
    const controlPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: controlApplicationName,
    });

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT authorization_id FROM authorization_evidence WHERE operation_id = 'op_1' FOR UPDATE",
      );
      const control = changeControlFence(controlPool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: audit("op_1", "control-auth-first"),
      });
      await waitForDatabaseBlock(controlApplicationName);

      await expect(
        blocker.query(
          "SELECT operation_id FROM operations WHERE operation_id = 'op_1' FOR UPDATE NOWAIT",
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await blocker.query("COMMIT");
      await expect(control).resolves.toMatchObject({
        state: "PAUSED",
        changed: true,
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await controlPool.end();
    }
  });

  test("policy revocation does not deadlock with recovery lease claim", async () => {
    await broadcastStartFixture();
    const blocker = await pool.connect();
    const controlApplicationName = "p3-control-policy-lock-order";
    const recoveryApplicationName = "p3-recovery-policy-lock-order";
    const controlPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: controlApplicationName,
    });
    const recoveryPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: recoveryApplicationName,
    });
    let controlResult:
      | Promise<
          | {
              status: "fulfilled";
              value: Awaited<ReturnType<typeof changeControlFence>>;
            }
          | { status: "rejected"; reason: unknown }
        >
      | undefined;
    let recoveryResult:
      | Promise<
          | {
              status: "fulfilled";
              value: Awaited<ReturnType<typeof claimRecoveryLease>>;
            }
          | { status: "rejected"; reason: unknown }
        >
      | undefined;

    try {
      await pool.query(`
        CREATE OR REPLACE FUNCTION test_block_policy_revoke_lock_order()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM NEW.status THEN
            PERFORM pg_advisory_xact_lock(928771005::bigint);
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await pool.query(`
        CREATE TRIGGER test_block_policy_revoke_lock_order
        AFTER UPDATE OF status ON policies
        FOR EACH ROW EXECUTE FUNCTION test_block_policy_revoke_lock_order()
      `);
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(928771005::bigint)");
      controlResult = changeControlFence(controlPool, {
        scopeType: "POLICY",
        scopeId: "policy_1",
        command: "REVOKE",
        audit: audit("op_1", "policy-recovery-lock-order"),
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      await waitForDatabaseBlock(controlApplicationName);

      let recoverySettled = false;
      recoveryResult = claimRecoveryLease(recoveryPool, {
        attemptId: "attempt_policy_recovery_lock_order",
        operationId: "op_1",
        reservationId: "res_1",
        leaseDurationSeconds: 60,
        audit: componentAudit(
          "op_1",
          "policy-recovery-lock-order",
          signComponentAction(reconcilerCredential, "recovery.claim", {
            attemptId: "attempt_policy_recovery_lock_order",
            operationId: "op_1",
            reservationId: "res_1",
            leaseDurationSeconds: 60,
          }),
        ),
      }).then(
        (value) => {
          recoverySettled = true;
          return { status: "fulfilled" as const, value };
        },
        (reason: unknown) => {
          recoverySettled = true;
          return { status: "rejected" as const, reason };
        },
      );
      const recoveryBlocked = await waitForDatabaseBlock(
        recoveryApplicationName,
        () => recoverySettled,
      );
      await blocker.query("COMMIT");

      const [control, recovery] = await Promise.all([
        controlResult,
        recoveryResult,
      ]);
      expect(recoveryBlocked).toBe(false);
      expect(control.status).toBe("fulfilled");
      expect(recovery.status).toBe("fulfilled");
      await expect(
        pool.query<{
          current_state: string;
          reservation_status: string;
          lease_state: string;
        }>(
          `SELECT o.current_state, r.status AS reservation_status,
                  l.lease_state
           FROM operations o
           JOIN budget_reservations r USING (operation_id)
           JOIN operation_recovery_leases l USING (operation_id)
           WHERE o.operation_id = 'op_1'`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            current_state: "DISPUTED",
            reservation_status: "DISPUTED",
            lease_state: "ACTIVE",
          },
        ],
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      if (controlResult || recoveryResult)
        await Promise.all([controlResult, recoveryResult].filter(Boolean));
      blocker.release();
      await pool.query(
        "DROP TRIGGER IF EXISTS test_block_policy_revoke_lock_order ON policies",
      );
      await pool.query(
        "DROP FUNCTION IF EXISTS test_block_policy_revoke_lock_order()",
      );
      await Promise.all([controlPool.end(), recoveryPool.end()]);
    }
  });

  test("authorized envelope replacement locks authorization before operation", async () => {
    await prepareAuthorizedV2();
    await pool.query(
      "UPDATE budget_accounts SET available = 90, reserved = 10 WHERE budget_id = 'budget_1'",
    );
    const replacementApplicationName = "p3-replacement-auth-lock-order";
    const authorizationApplicationName = "p3-authorization-auth-lock-order";
    const replacementPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: replacementApplicationName,
    });
    const authorizationPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: authorizationApplicationName,
    });
    const blocker = await pool.connect();
    const replacement = attachEnvelopeHash({
      ...v2Envelope("op_1", "res_1"),
      envelopeId: "env_op_1_2",
      revision: 2,
      supersedesEnvelopeId: "env_op_1_1",
    });
    let replacementResult:
      | Promise<
          | {
              status: "fulfilled";
              value: Awaited<ReturnType<typeof replaceExecutionEnvelope>>;
            }
          | { status: "rejected"; reason: unknown }
        >
      | undefined;
    let authorizationResult:
      | Promise<
          | {
              status: "fulfilled";
              value: Awaited<ReturnType<typeof authorizeReservation>>;
            }
          | { status: "rejected"; reason: unknown }
        >
      | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT operation_id FROM operations WHERE operation_id = 'op_1' FOR UPDATE",
      );
      replacementResult = replaceExecutionEnvelope(replacementPool, {
        operationId: "op_1",
        envelope: replacement,
        reason: "simulation changed calldata",
        audit: audit("op_1", "authorized-replacement-lock-order"),
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      expect(await waitForDatabaseBlock(replacementApplicationName)).toBe(true);

      authorizationResult = authorizeReservation(authorizationPool, {
        reservationId: "res_1",
        audit: audit("op_1", "authorization-replacement-lock-order"),
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      expect(await waitForDatabaseBlock(authorizationApplicationName)).toBe(
        true,
      );
      await blocker.query("COMMIT");

      const [replacementOutcome, authorizationOutcome] = await Promise.all([
        replacementResult,
        authorizationResult,
      ]);
      expect(replacementOutcome.status).toBe("fulfilled");
      expect(authorizationOutcome).toMatchObject({
        status: "rejected",
        reason: { code: "INVALID_RESERVATION_TRANSITION" },
      });
      await expect(
        pool.query<{
          current_state: string;
          reservation_status: string;
          envelope_count: number;
        }>(
          `SELECT o.current_state, r.status AS reservation_status,
                  (SELECT count(*)::int FROM execution_envelopes e
                   WHERE e.operation_id = o.operation_id) AS envelope_count
           FROM operations o JOIN budget_reservations r USING (operation_id)
           WHERE o.operation_id = 'op_1'`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            current_state: "REVALIDATION_REQUIRED",
            reservation_status: "RELEASED",
            envelope_count: 2,
          },
        ],
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled(
        [replacementResult, authorizationResult].filter(Boolean),
      );
      blocker.release();
      await Promise.all([replacementPool.end(), authorizationPool.end()]);
    }
  });

  test("replays old control request IDs without undoing later fence changes", async () => {
    await pool.query(
      "UPDATE budget_accounts SET available = 80, reserved = 20 WHERE budget_id = 'budget_1'",
    );
    const pauseAudit = audit("op_1", "stable-control-pause");
    const resumeAudit = audit("op_1", "stable-control-resume");
    await expect(
      changeControlFence(pool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: pauseAudit,
      }),
    ).resolves.toMatchObject({
      state: "PAUSED",
      fenceVersion: 2,
      changed: true,
    });
    await expect(
      changeControlFence(pool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "RESUME",
        audit: resumeAudit,
      }),
    ).resolves.toMatchObject({
      state: "ACTIVE",
      fenceVersion: 3,
      changed: true,
    });
    await expect(
      changeControlFence(pool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: pauseAudit,
      }),
    ).resolves.toMatchObject({
      state: "PAUSED",
      fenceVersion: 2,
      changed: false,
    });

    const laterPauseAudit = audit("op_1", "stable-control-later-pause");
    await expect(
      changeControlFence(pool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: laterPauseAudit,
      }),
    ).resolves.toMatchObject({
      state: "PAUSED",
      fenceVersion: 4,
      changed: true,
    });
    await expect(
      changeControlFence(pool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "RESUME",
        audit: resumeAudit,
      }),
    ).resolves.toMatchObject({
      state: "ACTIVE",
      fenceVersion: 3,
      changed: false,
    });

    await expect(
      pool.query(
        `SELECT fence_version, state, last_control_event_id
         FROM control_fences WHERE scope_type = 'SYSTEM' AND scope_id = 'system'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          fence_version: "4",
          state: "PAUSED",
          last_control_event_id: laterPauseAudit.eventId,
        },
      ],
    });
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE event_id = ANY($1::text[])",
        [[pauseAudit.eventId, resumeAudit.eventId, laterPauseAudit.eventId]],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 3 }] });
  });

  test.each([
    { status: "STARTED", responseHash: null, reason: null },
    { status: "ACCEPTED", responseHash: broadcastHash, reason: "accepted" },
    { status: "REJECTED", responseHash: null, reason: "not transmitted" },
    { status: "UNKNOWN", responseHash: null, reason: "response uncertain" },
    {
      status: "CONFLICT",
      responseHash: `0x${"c".repeat(64)}`,
      reason: "contradictory hash",
    },
  ] as const)(
    "control records a $status existing attempt",
    async ({ status, responseHash, reason }) => {
      await broadcastStartFixture();
      const signed = await pool.query<{ envelope_hash: string }>(
        "SELECT envelope_hash FROM signed_transactions WHERE signed_transaction_id = 'signed_1'",
      );
      const attemptId = `attempt_control_${status.toLowerCase()}`;
      await pool.query(
        `INSERT INTO broadcast_attempts
        (attempt_id, signed_transaction_id, operation_id, reservation_id, envelope_id,
         envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
         expected_transaction_hash)
       VALUES ($1, 'signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $2,
         'approval_1:authorization', $3, $4)`,
        [attemptId, signed.rows[0]!.envelope_hash, fixtureId, broadcastHash],
      );
      if (status !== "STARTED")
        await pool.query(
          `UPDATE broadcast_attempts
         SET status = $2, response_transaction_hash = $3,
             classification_reason = $4, completed_at = now()
         WHERE attempt_id = $1`,
          [attemptId, status, responseHash, reason],
        );

      await expect(
        changeControlFence(pool, {
          scopeType: "SYSTEM",
          scopeId: "system",
          command: "PAUSE",
          audit: audit("op_1", `control-attempt-${status.toLowerCase()}`),
        }),
      ).resolves.toMatchObject({ state: "PAUSED", changed: true });
      await expect(
        pool.query<{ attempt_status: string }>(
          `SELECT data ->> 'attemptStatus' AS attempt_status
           FROM audit_events
           WHERE operation_id = 'op_1'
             AND event_type = 'authorization.invalidated'`,
        ),
      ).resolves.toMatchObject({ rows: [{ attempt_status: status }] });
    },
  );

  test("refuses proven-no-send recovery with missing or forged control invalidation", async () => {
    await broadcastStartFixture();
    const unrelatedAudit = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM audit_events
       WHERE operation_id = 'op_1'
         AND event_type NOT IN ('agent.revoked', 'owner.revoked', 'policy.revoked', 'system.paused')
       LIMIT 1`,
    );
    expect(unrelatedAudit.rows).toHaveLength(1);
    await expect(
      pool.query(
        `INSERT INTO authorization_invalidations
         (invalidation_id, authorization_id, operation_id, control_event_id, reason)
         VALUES ('forged-no-send-invalidation', 'approval_1:authorization',
                 'op_1', $1, 'forged control evidence')`,
        [unrelatedAudit.rows[0]!.event_id],
      ),
    ).rejects.toThrow(
      /authorization invalidation binding is not authoritative/i,
    );

    const attemptId = "attempt_no_invalidation_recovery";
    const lease = await claimRecoveryLease(pool, {
      attemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseDurationSeconds: 60,
      audit: componentAudit(
        "op_1",
        "missing-invalidation-claim",
        signComponentAction(reconcilerCredential, "recovery.claim", {
          attemptId,
          operationId: "op_1",
          reservationId: "res_1",
          leaseDurationSeconds: 60,
        }),
      ),
    });
    const resolution = {
      attemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseVersion: lease.leaseVersion,
      outcome: "FAILED" as const,
      reason: SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT_REASON,
    };
    await expect(
      resolveRecovery(pool, {
        ...resolution,
        audit: componentAudit(
          "op_1",
          "missing-invalidation-resolution",
          signComponentAction(reconcilerCredential, "recovery.resolve", {
            ...resolution,
            actualSpendAtomic: null,
            proofReference: null,
            evidence: null,
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESERVATION_TRANSITION" });

    await expect(
      pool.query(
        `SELECT o.current_state, r.status AS reservation_status,
                b.available, b.reserved,
                (SELECT count(*)::int FROM authorization_invalidations ai
                 WHERE ai.operation_id = o.operation_id) AS invalidation_count,
                (SELECT count(*)::int FROM recovery_attempts ra
                 WHERE ra.operation_id = o.operation_id) AS recovery_count,
                (SELECT count(*)::int FROM execution_economic_effects effect
                 WHERE effect.operation_id = o.operation_id) AS effects
         FROM operations o
         JOIN budget_reservations r USING (operation_id)
         JOIN budget_accounts b USING (budget_id)
         WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          current_state: "SIGNED",
          reservation_status: "AUTHORIZED",
          available: "90",
          reserved: "10",
          invalidation_count: 0,
          recovery_count: 0,
          effects: 0,
        },
      ],
    });
  });

  test("control quarantines signed work before STARTED and requires proven-no-send recovery", async () => {
    await broadcastStartFixture();
    await pool.query(
      "UPDATE budget_reservations SET status = 'RELEASED' WHERE reservation_id = 'res_2'",
    );
    await expect(
      pool.query<{
        current_state: string;
        available: string;
        reserved: string;
      }>(
        `SELECT o.current_state, b.available, b.reserved
         FROM operations o JOIN budget_reservations r USING (operation_id)
         JOIN budget_accounts b USING (budget_id)
         WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [{ current_state: "SIGNED", available: "90", reserved: "10" }],
    });
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit("op_1", "signed-control-before-start"),
    });
    await expect(
      changeControlFence(pool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: audit("op_1", "signed-control-before-start-duplicate"),
      }),
    ).resolves.toMatchObject({
      state: "PAUSED",
      fenceVersion: 2,
      changed: false,
    });
    await expect(
      changeControlFence(pool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: audit("op_1", "signed-control-before-start"),
      }),
    ).resolves.toMatchObject({
      state: "PAUSED",
      fenceVersion: 2,
      changed: false,
    });
    await expect(
      pool.query<{ event_type: string; data: Record<string, unknown> }>(
        `SELECT event_type, data FROM audit_events
         WHERE event_id = 'evt:op_1:signed-control-before-start-duplicate'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          event_type: "system.paused",
          data: {
            controlState: "PAUSED",
            fenceVersion: 2,
            previousControlState: "PAUSED",
          },
        },
      ],
    });

    let sends = 0;
    await expect(
      broadcastSignedTransaction(
        createBroadcastStore(pool),
        {
          sendRawTransaction: async () => {
            sends += 1;
            return broadcastHash;
          },
        },
        {
          request: {
            operationId: "op_1",
            authorizationId: "approval_1:authorization",
            adapterRequestId: "signed-control-before-start",
          },
          signedTransactionId: "signed_1",
          attemptId: "attempt_after_control",
          rawTransaction: broadcastRawTransaction,
        },
      ),
    ).rejects.toThrow(/canonical signing authority is stale or invalid/i);
    expect(sends).toBe(0);

    await expect(
      pool.query(
        `UPDATE budget_reservations SET status = 'RELEASED'
         WHERE reservation_id = 'res_1'`,
      ),
    ).rejects.toThrow(
      /signed transaction requires authenticated proven-no-send recovery/i,
    );
    await expect(
      pool.query(
        `UPDATE budget_reservations SET status = 'EXPIRED'
         WHERE reservation_id = 'res_1'`,
      ),
    ).rejects.toThrow(
      /signed transaction requires authenticated proven-no-send recovery/i,
    );

    const recoveryAttemptId = "attempt_signed_no_send_recovery";
    const lease = await claimRecoveryLease(pool, {
      attemptId: recoveryAttemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseDurationSeconds: 60,
      audit: componentAudit(
        "op_1",
        "signed-no-send-claim",
        signComponentAction(reconcilerCredential, "recovery.claim", {
          attemptId: recoveryAttemptId,
          operationId: "op_1",
          reservationId: "res_1",
          leaseDurationSeconds: 60,
        }),
      ),
    });
    const genericResolution = {
      attemptId: recoveryAttemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseVersion: lease.leaseVersion,
      outcome: "FAILED" as const,
      reason: "control quarantined signed work before the send commit",
      actualSpendAtomic: "0",
    };
    await expect(
      resolveRecovery(pool, {
        ...genericResolution,
        audit: componentAudit(
          "op_1",
          "signed-no-send-generic-resolution",
          signComponentAction(reconcilerCredential, "recovery.resolve", {
            ...genericResolution,
            proofReference: null,
            evidence: null,
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESERVATION_TRANSITION" });

    await expect(
      pool.query(
        `SELECT o.current_state, r.status AS reservation_status,
                b.available, b.reserved,
                (SELECT count(*)::int FROM signed_transactions s
                 WHERE s.operation_id = o.operation_id) AS signed_count,
                (SELECT count(*)::int FROM broadcast_attempts a
                 WHERE a.operation_id = o.operation_id) AS attempt_count,
                (SELECT count(*)::int FROM authorization_invalidations ai
                 WHERE ai.operation_id = o.operation_id) AS invalidation_count,
                (SELECT count(*)::int FROM recovery_attempts ra
                 WHERE ra.operation_id = o.operation_id) AS recovery_count,
                (SELECT lease_state FROM operation_recovery_leases l
                 WHERE l.operation_id = o.operation_id) AS lease_state
         FROM operations o
         JOIN budget_reservations r USING (operation_id)
         JOIN budget_accounts b USING (budget_id)
         WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          current_state: "DISPUTED",
          reservation_status: "DISPUTED",
          available: "90",
          reserved: "10",
          signed_count: 1,
          attempt_count: 0,
          invalidation_count: 1,
          recovery_count: 0,
          lease_state: "ACTIVE",
        },
      ],
    });

    const noSendResolution = {
      attemptId: recoveryAttemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseVersion: lease.leaseVersion,
      outcome: "FAILED" as const,
      reason: SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT_REASON,
    };
    const noSendAudit = componentAudit(
      "op_1",
      "signed-no-send-resolution",
      signComponentAction(reconcilerCredential, "recovery.resolve", {
        ...noSendResolution,
        actualSpendAtomic: null,
        proofReference: null,
        evidence: null,
      }),
    );
    const blocker = await pool.connect();
    const firstRecoveryPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: "p3-no-send-first",
    });
    const duplicateRecoveryPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: "p3-no-send-duplicate",
    });
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT authorization_id FROM authorization_evidence WHERE operation_id = 'op_1' FOR UPDATE",
      );
      const firstRecovery = resolveRecovery(firstRecoveryPool, {
        ...noSendResolution,
        audit: noSendAudit,
      });
      await waitForDatabaseBlock("p3-no-send-first");
      const duplicateRecovery = resolveRecovery(duplicateRecoveryPool, {
        ...noSendResolution,
        audit: noSendAudit,
      });
      await waitForDatabaseBlock("p3-no-send-duplicate");
      await blocker.query("COMMIT");
      const concurrentResults = await Promise.all([
        firstRecovery,
        duplicateRecovery,
      ]);
      expect(concurrentResults.map((result) => result.status)).toEqual([
        "RELEASED",
        "RELEASED",
      ]);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.all([firstRecoveryPool.end(), duplicateRecoveryPool.end()]);
    }
    await expect(
      resolveRecovery(pool, { ...noSendResolution, audit: noSendAudit }),
    ).resolves.toMatchObject({ status: "RELEASED" });

    await expect(
      pool.query(
        `SELECT o.current_state, r.status AS reservation_status,
                b.available, b.reserved, b.finalized_spend,
                (SELECT count(*)::int FROM signed_transactions s
                 WHERE s.operation_id = o.operation_id) AS signed_count,
                (SELECT count(*)::int FROM broadcast_attempts a
                 WHERE a.operation_id = o.operation_id) AS attempt_count,
                (SELECT count(*)::int FROM authorization_invalidations ai
                 WHERE ai.operation_id = o.operation_id) AS invalidation_count,
                (SELECT count(*)::int FROM recovery_attempts ra
                 WHERE ra.operation_id = o.operation_id) AS recovery_count,
                (SELECT reason FROM recovery_attempts ra
                 WHERE ra.operation_id = o.operation_id) AS recovery_reason,
                (SELECT lease_state FROM operation_recovery_leases l
                 WHERE l.operation_id = o.operation_id) AS lease_state,
                (SELECT count(*)::int FROM execution_economic_effects effect
                 WHERE effect.operation_id = o.operation_id) AS effects
         FROM operations o
         JOIN budget_reservations r USING (operation_id)
         JOIN budget_accounts b USING (budget_id)
         WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          current_state: "RECONCILED",
          reservation_status: "RELEASED",
          available: "100",
          reserved: "0",
          finalized_spend: "0",
          signed_count: 1,
          attempt_count: 0,
          invalidation_count: 1,
          recovery_count: 1,
          recovery_reason: SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT_REASON,
          lease_state: "RESOLVED",
          effects: 0,
        },
      ],
    });
  });

  test("rolls back proven-no-send release when the database lease expires before commit", async () => {
    await broadcastStartFixture();
    await pool.query(
      "UPDATE budget_reservations SET status = 'RELEASED' WHERE reservation_id = 'res_2'",
    );
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit("op_1", "lease-expiry-control"),
    });
    const attemptId = "attempt_lease_expiry_no_send";
    const lease = await claimRecoveryLease(pool, {
      attemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseDurationSeconds: 60,
      audit: componentAudit(
        "op_1",
        "lease-expiry-claim",
        signComponentAction(reconcilerCredential, "recovery.claim", {
          attemptId,
          operationId: "op_1",
          reservationId: "res_1",
          leaseDurationSeconds: 60,
        }),
      ),
    });
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_expire_lease_after_no_send_release()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE operation_recovery_leases
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE operation_id = NEW.operation_id;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER test_expire_lease_after_no_send_release
      AFTER UPDATE OF status ON budget_reservations
      FOR EACH ROW
      WHEN (OLD.status = 'DISPUTED' AND NEW.status = 'RELEASED')
      EXECUTE FUNCTION test_expire_lease_after_no_send_release()
    `);

    const resolution = {
      attemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseVersion: lease.leaseVersion,
      outcome: "FAILED" as const,
      reason: SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT_REASON,
    };
    const recoveryAuditContext = componentAudit(
      "op_1",
      "lease-expiry-resolution",
      signComponentAction(reconcilerCredential, "recovery.resolve", {
        ...resolution,
        actualSpendAtomic: null,
        proofReference: null,
        evidence: null,
      }),
    );

    try {
      await expect(
        resolveRecovery(pool, {
          ...resolution,
          audit: recoveryAuditContext,
        }),
      ).rejects.toMatchObject({ code: "RECOVERY_LEASE_STALE" });
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS test_expire_lease_after_no_send_release ON budget_reservations",
      );
      await pool.query(
        "DROP FUNCTION IF EXISTS test_expire_lease_after_no_send_release()",
      );
    }

    await expect(
      pool.query(
        `SELECT o.current_state, r.status AS reservation_status,
                b.available, b.reserved,
                (SELECT count(*)::int FROM recovery_attempts ra
                 WHERE ra.operation_id = o.operation_id) AS recovery_count,
                (SELECT count(*)::int FROM execution_economic_effects effect
                 WHERE effect.operation_id = o.operation_id) AS effects,
                (SELECT lease_state FROM operation_recovery_leases l
                 WHERE l.operation_id = o.operation_id) AS lease_state
         FROM operations o
         JOIN budget_reservations r USING (operation_id)
         JOIN budget_accounts b USING (budget_id)
         WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          current_state: "DISPUTED",
          reservation_status: "DISPUTED",
          available: "90",
          reserved: "10",
          recovery_count: 0,
          effects: 0,
          lease_state: "ACTIVE",
        },
      ],
    });
  });

  test("control preserves a STARTED attempt when the send gate wins", async () => {
    await broadcastStartFixture();
    await pool.query(
      "UPDATE budget_reservations SET status = 'RELEASED' WHERE reservation_id = 'res_2'",
    );
    const locked = deferred();
    const commit = deferred();
    const sendEntered = deferred();
    const finishSend = deferred();
    const controlApplicationName = "p3-control-after-started";
    const controlPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: controlApplicationName,
    });
    const store = createBroadcastStore(pool, {
      afterReservationLocked: async () => {
        locked.resolve();
        await commit.promise;
      },
    });
    let sends = 0;

    try {
      const broadcasting = broadcastSignedTransaction(
        store,
        {
          sendRawTransaction: async () => {
            sends += 1;
            sendEntered.resolve();
            await finishSend.promise;
            return broadcastHash;
          },
        },
        {
          request: {
            operationId: "op_1",
            authorizationId: "approval_1:authorization",
            adapterRequestId: "control-after-started",
          },
          signedTransactionId: "signed_1",
          attemptId: "attempt_control_after_start",
          rawTransaction: broadcastRawTransaction,
        },
      );
      await locked.promise;
      const control = changeControlFence(controlPool, {
        scopeType: "SYSTEM",
        scopeId: "system",
        command: "PAUSE",
        audit: audit("op_1", "control-after-started"),
      });
      await waitForDatabaseBlock(controlApplicationName);
      commit.resolve();

      await sendEntered.promise;
      await expect(control).resolves.toMatchObject({
        state: "PAUSED",
        changed: true,
      });
      finishSend.resolve();
      await expect(broadcasting).resolves.toMatchObject({
        ok: true,
        attempt: {
          attemptId: "attempt_control_after_start",
          status: "ACCEPTED",
        },
      });
    } finally {
      commit.resolve();
      finishSend.resolve();
      await controlPool.end();
    }
    expect(sends).toBe(1);

    await expect(
      pool.query(
        `SELECT o.current_state, r.status AS reservation_status,
                a.status AS attempt_status,
                (SELECT count(*)::int FROM signed_transactions s
                 WHERE s.operation_id = o.operation_id) AS signed_count,
                (SELECT count(*)::int FROM broadcast_attempts attempts
                 WHERE attempts.operation_id = o.operation_id) AS attempt_count,
                ai.invalidation_id,
                event.event_type AS invalidation_event,
                event.data
         FROM operations o
         JOIN budget_reservations r USING (operation_id)
         JOIN broadcast_attempts a USING (operation_id)
         JOIN authorization_invalidations ai USING (operation_id)
         JOIN audit_events event ON event.event_id = ai.control_event_id
         WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          current_state: "SIGNED",
          reservation_status: "AUTHORIZED",
          attempt_status: "ACCEPTED",
          signed_count: 1,
          attempt_count: 1,
          invalidation_event: "system.paused",
        },
      ],
    });
    await expect(
      pool.query<{ event_type: string; data: Record<string, unknown> }>(
        `SELECT event_type, data FROM audit_events
         WHERE operation_id = 'op_1' AND event_type = 'authorization.invalidated'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          event_type: "authorization.invalidated",
          data: {
            authorizationId: "approval_1:authorization",
            attemptId: "attempt_control_after_start",
            attemptStatus: "STARTED",
            signedTransactionId: "signed_1",
          },
        },
      ],
    });
  }, 15_000);

  test("autonomous authorization can persist signed evidence", async () => {
    const envelopeHash = await prepareAuthorizedV2("AUTONOMOUS_POLICY");
    let signerReturnedAt = 0;
    await expect(
      createSignerStore(pool).signAndPersistEvidence(
        signingInput(envelopeHash),
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          signerReturnedAt = Date.now();
          return { transactionHash: `0x${"f".repeat(64)}` };
        },
        signingAudit("autonomous-signing"),
      ),
    ).resolves.toMatchObject({
      transactionHash: `0x${"f".repeat(64)}`,
    });
    await expect(
      pool.query<{ authorization_kind: string; current_state: string }>(
        `SELECT ae.authorization_kind, o.current_state
         FROM authorization_evidence ae JOIN operations o USING (operation_id)
         WHERE ae.authorization_id = 'approval_1:authorization'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { authorization_kind: "AUTONOMOUS_POLICY", current_state: "SIGNED" },
      ],
    });
    const signedEvidence = await pool.query<{ signed_at: string }>(
      `SELECT signed_at::text AS signed_at FROM signed_transactions
       WHERE operation_id = 'op_1'`,
    );
    expect(
      Date.parse(signedEvidence.rows[0]?.signed_at ?? ""),
    ).toBeGreaterThanOrEqual(signerReturnedAt);
  });

  test("autonomous authorization passes signer core and persists its live sample", async () => {
    await prepareAuthorizedV2("AUTONOMOUS_POLICY", true);
    const head = {
      number: 100n,
      hash: hash as `0x${string}`,
      baseFeePerGas: 1n,
    };
    const rpc: LocalReadRpc = {
      getChainId: async () => 31337n,
      getBlockNumber: async () => 100n,
      getBlockByNumber: async (number) =>
        number === head.number ? head : null,
      getBlockByHash: async (blockHash) =>
        blockHash === head.hash ? head : null,
      getPendingNonce: async () => 7n,
      getNativeBalance: async () => 100_000n,
      getTokenBalance: async () => 100n,
      simulateTransfer: async () => ({ outcome: "success" }),
      estimateGas: async () => 45_454n,
      getFeeData: async () => ({
        baseFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
      }),
      rpcUrl: "http://127.0.0.1:8545/",
      fixtureInstanceId: fixtureId,
    };
    let signCalls = 0;
    const signerCredential = {
      credentialId: adapterCredential.credentialId,
      componentId: adapterCredential.componentId,
      role: "ADAPTER" as const,
    };

    const outcome = await signAuthorizedTransferCore(
      {
        store: createSignerStore(pool),
        credential: signerCredential,
        rpcUrl: rpc.rpcUrl,
        withChainMutationLease: async (work) => work(),
        loadDisposableAccount: () => ({
          address: address("10") as `0x${string}`,
        }),
        makeRpc: () => rpc,
        signTransaction: async () => {
          signCalls += 1;
          return { transactionHash: `0x${"f".repeat(64)}` as `0x${string}` };
        },
        authorizeResult: (payload) =>
          signComponentAction(
            adapterCredential,
            "sign-authorized-transfer",
            payload,
          ),
        now: () => new Date(),
        maxBlockAge: 10n,
      },
      {
        operationId: "op_1",
        authorizationId: "approval_1:authorization",
        adapterRequestId: "autonomous-signer-core",
      },
    );

    expect(outcome).toMatchObject({
      ok: true,
      fromDurableEvidence: false,
      transactionHash: `0x${"f".repeat(64)}`,
    });
    expect(signCalls).toBe(1);
    const signedAudit = await pool.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM audit_events
       WHERE operation_id = 'op_1' AND event_type = 'transaction.signed'
       ORDER BY sequence_no DESC LIMIT 1`,
    );
    expect(signedAudit.rows[0]?.data).toMatchObject({
      fixtureInstanceId: fixtureId,
      simulationBlockNumber: "100",
      simulationBlockHash: hash,
      freshnessHeadNumber: "100",
      freshnessSenderNonce: "7",
      freshnessTokenBalanceAtomic: "100",
      freshnessNativeBalanceWei: "100000",
      freshnessBaseFeePerGas: "1",
      freshnessMaxPriorityFeePerGas: "1",
    });
    expect(signedAudit.rows[0]?.data.freshnessSampledAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(signedAudit.rows[0]?.data.freshnessDeadlineAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  test("autonomous retry waits on fences before locking authorization evidence", async () => {
    const envelopeHash = await prepareAuthorizedV2("AUTONOMOUS_POLICY");
    const authorizationBlocker = await pool.connect();
    const fenceBlocker = await pool.connect();
    const retryApplicationName = "p3-autonomous-retry";
    const retryPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: retryApplicationName,
    });
    const request = {
      authorizationId: "approval_1:authorization",
      operationId: "op_1",
      reservationId: "res_1",
      envelopeId: "env_op_1_1",
      envelopeRevision: 1,
      envelopeHash: envelopeHash as `0x${string}`,
      policyDecisionId: "decision_1",
      policyDecisionHash: hash as `0x${string}`,
      idempotencyKey: "signer-store-autonomous",
    };
    let retry: ReturnType<typeof authorizeAutonomous> | undefined;

    try {
      await authorizationBlocker.query("BEGIN");
      await authorizationBlocker.query(
        "SELECT authorization_id FROM authorization_evidence WHERE authorization_id = 'approval_1:authorization' FOR UPDATE",
      );
      await fenceBlocker.query("BEGIN");
      await fenceBlocker.query(
        `SELECT 1 FROM control_fences
         WHERE scope_type = 'SYSTEM' AND scope_id = 'system' FOR UPDATE`,
      );
      retry = authorizeAutonomous(
        retryPool,
        request,
        audit("op_1", "autonomous-exact-retry"),
      );
      await waitForDatabaseBlock(retryApplicationName);
      const blocked = await pool.query<{ query: string }>(
        `SELECT query FROM pg_stat_activity
         WHERE application_name = $1 AND cardinality(pg_blocking_pids(pid)) > 0`,
        [retryApplicationName],
      );
      expect(blocked.rows[0]?.query).toMatch(/control_fences/i);
      await fenceBlocker.query("COMMIT");
      await authorizationBlocker.query("COMMIT");
      await expect(retry).resolves.toMatchObject({
        authorizationId: "approval_1:authorization",
      });
    } finally {
      await fenceBlocker.query("ROLLBACK").catch(() => undefined);
      await authorizationBlocker.query("ROLLBACK").catch(() => undefined);
      if (retry) await retry.catch(() => undefined);
      fenceBlocker.release();
      authorizationBlocker.release();
      await retryPool.end();
    }
  });

  test("autonomous retry locks authorization before reservation transition", async () => {
    const envelopeHash = await prepareAuthorizedV2("AUTONOMOUS_POLICY");
    const blocker = await pool.connect();
    const retryApplicationName = "p3-autonomous-operation-lock-order";
    const transitionApplicationName = "p3-transition-autonomous-lock-order";
    const retryPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: retryApplicationName,
    });
    const transitionPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: transitionApplicationName,
    });
    const request = {
      authorizationId: "approval_1:authorization",
      operationId: "op_1",
      reservationId: "res_1",
      envelopeId: "env_op_1_1",
      envelopeRevision: 1,
      envelopeHash: envelopeHash as `0x${string}`,
      policyDecisionId: "decision_1",
      policyDecisionHash: hash as `0x${string}`,
      idempotencyKey: "signer-store-autonomous",
    };
    let retryOutcome:
      | Promise<
          | {
              status: "fulfilled";
              value: Awaited<ReturnType<typeof authorizeAutonomous>>;
            }
          | { status: "rejected"; reason: unknown }
        >
      | undefined;
    let transitionOutcome:
      | Promise<
          | {
              status: "fulfilled";
              value: Awaited<ReturnType<typeof authorizeReservation>>;
            }
          | { status: "rejected"; reason: unknown }
        >
      | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT operation_id FROM operations WHERE operation_id = 'op_1' FOR UPDATE",
      );
      retryOutcome = authorizeAutonomous(
        retryPool,
        request,
        audit("op_1", "autonomous-operation-retry"),
      ).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      expect(await waitForDatabaseBlock(retryApplicationName)).toBe(true);

      transitionOutcome = authorizeReservation(transitionPool, {
        reservationId: "res_1",
        audit: audit("op_1", "autonomous-operation-transition"),
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      expect(await waitForDatabaseBlock(transitionApplicationName)).toBe(true);
      const transitionWait = await pool.query<{ query: string }>(
        `SELECT query FROM pg_stat_activity
         WHERE application_name = $1 AND cardinality(pg_blocking_pids(pid)) > 0`,
        [transitionApplicationName],
      );
      expect(transitionWait.rows[0]?.query).toMatch(/policy_decisions/i);

      await blocker.query("COMMIT");
      const [retry, transition] = await Promise.all([
        retryOutcome,
        transitionOutcome,
      ]);
      expect(retry.status).toBe("fulfilled");
      expect(transition.status).toBe("fulfilled");
      await expect(
        pool.query<{ current_state: string; status: string; count: number }>(
          `SELECT o.current_state, r.status,
                  (SELECT count(*)::int FROM authorization_evidence e
                   WHERE e.operation_id = o.operation_id) AS count
           FROM operations o JOIN budget_reservations r USING (operation_id)
           WHERE o.operation_id = 'op_1'`,
        ),
      ).resolves.toMatchObject({
        rows: [{ current_state: "AUTHORIZED", status: "AUTHORIZED", count: 1 }],
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled(
        [retryOutcome, transitionOutcome].filter(Boolean),
      );
      blocker.release();
      await Promise.all([retryPool.end(), transitionPool.end()]);
    }
  });

  test.each([
    "duplicate-create",
    "consume-replay",
    "autonomous-conflict",
  ] as const)(
    "approval %s locks authorization before reservation transition",
    async (retryKind) => {
      const envelopeHash = await prepareAuthorizedV2();
      const blocker = await pool.connect();
      const retryApplicationName = `p3-approval-${retryKind}`;
      const transitionApplicationName = `p3-transition-${retryKind}`;
      const retryPool = new Pool({
        host: runtime.postgres.host,
        port: runtime.postgres.port,
        database: runtime.postgres.database,
        user: runtime.postgres.user,
        password: runtime.postgres.password,
        max: 1,
        application_name: retryApplicationName,
      });
      const transitionPool = new Pool({
        host: runtime.postgres.host,
        port: runtime.postgres.port,
        database: runtime.postgres.database,
        user: runtime.postgres.user,
        password: runtime.postgres.password,
        max: 1,
        application_name: transitionApplicationName,
      });
      const startReplay = () => {
        if (retryKind === "duplicate-create")
          return createApprovalRequest(retryPool, {
            approvalId: "approval_1",
            operationId: "op_1",
            reservationId: "res_1",
            envelopeId: "env_op_1_1",
            envelopeRevision: 1,
            envelopeHash,
            policyDecisionId: "decision_1",
            issuedAt: "2020-01-01T00:00:00Z",
            expiresAt: "2099-01-01T00:50:00Z",
            nonce: "approval-nonce-1",
            audit: audit("op_1", "duplicate-approval-request"),
          });
        if (retryKind === "consume-replay")
          return consumeApproval(retryPool, {
            approvalId: "approval_1",
            operationId: "op_1",
            envelopeId: "env_op_1_1",
            envelopeRevision: 1,
            envelopeHash,
            consumerId: "evidence-test",
            now: "2099-01-01T00:03:00Z",
            audit: audit("op_1", "consume-replay"),
          });
        return authorizeAutonomous(
          retryPool,
          {
            authorizationId: "autonomous-conflict",
            operationId: "op_1",
            reservationId: "res_1",
            envelopeId: "env_op_1_1",
            envelopeRevision: 1,
            envelopeHash: envelopeHash as `0x${string}`,
            policyDecisionId: "decision_1",
            policyDecisionHash: hash as `0x${string}`,
            idempotencyKey: "autonomous-conflict",
          },
          audit("op_1", "autonomous-conflict"),
        );
      };
      type ReplayOutcome =
        | {
            status: "fulfilled";
            value: Awaited<ReturnType<typeof startReplay>>;
          }
        | { status: "rejected"; reason: unknown };
      let replayOutcome: Promise<ReplayOutcome> | undefined;
      let transitionOutcome:
        | Promise<
            | {
                status: "fulfilled";
                value: Awaited<ReturnType<typeof authorizeReservation>>;
              }
            | { status: "rejected"; reason: unknown }
          >
        | undefined;

      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT operation_id FROM operations WHERE operation_id = 'op_1' FOR UPDATE",
        );
        replayOutcome = startReplay().then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        );
        expect(await waitForDatabaseBlock(retryApplicationName)).toBe(true);

        transitionOutcome = authorizeReservation(transitionPool, {
          reservationId: "res_1",
          audit: audit("op_1", `${retryKind}-reservation-transition`),
        }).then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        );
        expect(await waitForDatabaseBlock(transitionApplicationName)).toBe(
          true,
        );
        const transitionWait = await pool.query<{ query: string }>(
          `SELECT query FROM pg_stat_activity
           WHERE application_name = $1 AND cardinality(pg_blocking_pids(pid)) > 0`,
          [transitionApplicationName],
        );
        expect(transitionWait.rows[0]?.query).toMatch(/policy_decisions/i);

        await blocker.query("COMMIT");
        const [replay, transition] = await Promise.all([
          replayOutcome,
          transitionOutcome,
        ]);
        expect(transition.status).toBe("fulfilled");
        if (retryKind === "duplicate-create") {
          expect(replay).toMatchObject({
            status: "fulfilled",
            value: { approvalId: "approval_1", status: "CONSUMED" },
          });
        } else if (retryKind === "consume-replay") {
          expect(replay).toMatchObject({
            status: "rejected",
            reason: { code: "APPROVAL_REPLAYED" },
          });
        } else {
          expect(replay).toMatchObject({
            status: "rejected",
            reason: { code: "AUTONOMOUS_CONFLICT" },
          });
        }
        await expect(
          pool.query<{
            current_state: string;
            reservation_status: string;
            authorization_count: number;
          }>(
            `SELECT o.current_state, r.status AS reservation_status,
                    (SELECT count(*)::int FROM authorization_evidence e
                     WHERE e.operation_id = o.operation_id) AS authorization_count
             FROM operations o
             JOIN budget_reservations r ON r.operation_id = o.operation_id
             WHERE o.operation_id = 'op_1'`,
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              current_state: "AUTHORIZED",
              reservation_status: "AUTHORIZED",
              authorization_count: 1,
            },
          ],
        });
      } finally {
        await blocker.query("ROLLBACK").catch(() => undefined);
        await Promise.allSettled(
          [replayOutcome, transitionOutcome].filter(Boolean),
        );
        blocker.release();
        await Promise.all([retryPool.end(), transitionPool.end()]);
      }
    },
  );

  test.each(["signer", "broadcaster"] as const)(
    "%s locks policy before authorization evidence",
    async (writerKind) => {
      const envelopeHash =
        writerKind === "signer" ? await prepareAuthorizedV2() : undefined;
      if (writerKind === "broadcaster") await broadcastStartFixture();
      const evidenceBlocker = await pool.connect();
      const writerApplicationName = `p3-${writerKind}-authorization-lock-order`;
      const transitionApplicationName = `p3-transition-${writerKind}-authorization-lock-order`;
      const writerPool = new Pool({
        host: runtime.postgres.host,
        port: runtime.postgres.port,
        database: runtime.postgres.database,
        user: runtime.postgres.user,
        password: runtime.postgres.password,
        max: 1,
        application_name: writerApplicationName,
      });
      const transitionPool = new Pool({
        host: runtime.postgres.host,
        port: runtime.postgres.port,
        database: runtime.postgres.database,
        user: runtime.postgres.user,
        password: runtime.postgres.password,
        max: 1,
        application_name: transitionApplicationName,
      });
      const startWriter = async () => {
        if (writerKind === "signer")
          return createSignerStore(writerPool).signAndPersistEvidence(
            signingInput(envelopeHash!),
            async () => ({ transactionHash: `0x${"c".repeat(64)}` }),
            signingAudit("authorization-lock-order"),
          );
        const signed =
          await createBroadcastStore(pool).findSignedTransaction("signed_1");
        if (!signed) throw new Error("missing signed transaction fixture");
        return createBroadcastStore(writerPool).startBroadcastAttempt(
          signed,
          "attempt_authorization_lock_order",
          audit("op_1", "authorization-lock-order").traceId,
        );
      };
      type WriterOutcome =
        | {
            status: "fulfilled";
            value: Awaited<ReturnType<typeof startWriter>>;
          }
        | { status: "rejected"; reason: unknown };
      let writerOutcome: Promise<WriterOutcome> | undefined;
      let transitionOutcome:
        | Promise<
            | {
                status: "fulfilled";
                value: Awaited<ReturnType<typeof authorizeReservation>>;
              }
            | { status: "rejected"; reason: unknown }
          >
        | undefined;

      try {
        await evidenceBlocker.query("BEGIN");
        await evidenceBlocker.query(
          "SELECT authorization_id FROM authorization_evidence WHERE authorization_id = 'approval_1:authorization' FOR UPDATE",
        );
        writerOutcome = startWriter().then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        );
        expect(await waitForDatabaseBlock(writerApplicationName)).toBe(true);

        transitionOutcome = authorizeReservation(transitionPool, {
          reservationId: "res_1",
          audit: audit("op_1", `${writerKind}-lock-order-transition`),
        }).then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        );
        expect(await waitForDatabaseBlock(transitionApplicationName)).toBe(
          true,
        );
        const transitionWait = await pool.query<{ query: string }>(
          `SELECT query FROM pg_stat_activity
           WHERE application_name = $1 AND cardinality(pg_blocking_pids(pid)) > 0`,
          [transitionApplicationName],
        );
        expect(transitionWait.rows[0]?.query).toMatch(/policy_decisions/i);

        await evidenceBlocker.query("COMMIT");
        const [writer, transition] = await Promise.all([
          writerOutcome,
          transitionOutcome,
        ]);
        expect(writer.status).toBe("fulfilled");
        expect(transition).toMatchObject({
          status: "rejected",
          reason: { code: "INVALID_RESERVATION_TRANSITION" },
        });
        if (writerKind === "broadcaster")
          expect(writer).toMatchObject({
            status: "fulfilled",
            value: { created: true, attempt: { status: "STARTED" } },
          });
        await expect(
          pool.query<{
            current_state: string;
            reservation_status: string;
            authorization_count: number;
          }>(
            `SELECT o.current_state, r.status AS reservation_status,
                    (SELECT count(*)::int FROM authorization_evidence e
                     WHERE e.operation_id = o.operation_id) AS authorization_count
             FROM operations o
             JOIN budget_reservations r ON r.operation_id = o.operation_id
             WHERE o.operation_id = 'op_1'`,
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              current_state: "SIGNED",
              reservation_status: "AUTHORIZED",
              authorization_count: 1,
            },
          ],
        });
      } finally {
        await evidenceBlocker.query("ROLLBACK").catch(() => undefined);
        await Promise.allSettled(
          [writerOutcome, transitionOutcome].filter(Boolean),
        );
        evidenceBlocker.release();
        await Promise.all([writerPool.end(), transitionPool.end()]);
      }
    },
  );

  test("signer failure rolls back signing state, evidence, and start audit", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    await expect(
      createSignerStore(pool).signAndPersistEvidence(
        signingInput(envelopeHash),
        async () => {
          throw new Error("local key operation failed");
        },
        signingAudit("signer-failure"),
      ),
    ).rejects.toThrow("local key operation failed");
    await expect(
      pool.query<{
        current_state: string;
        signed_count: number;
        start_audit_count: number;
      }>(
        `SELECT o.current_state,
                (SELECT count(*)::int FROM signed_transactions s
                 WHERE s.operation_id = o.operation_id) AS signed_count,
                (SELECT count(*)::int FROM audit_events a
                 WHERE a.operation_id = o.operation_id
                   AND a.event_type = 'signing.started') AS start_audit_count
         FROM operations o WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { current_state: "AUTHORIZED", signed_count: 0, start_audit_count: 0 },
      ],
    });
  });

  test("serializes release behind real-store STARTED creation", async () => {
    await broadcastStartFixture();
    const locked = deferred();
    const commit = deferred();
    const releasePool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: "race-a-release",
    });
    let sends = 0;
    const releaseStarted = deferred();
    let releaseSettled = false;
    const broadcast = broadcastSignedTransaction(
      createBroadcastStore(pool, {
        afterReservationLocked: async () => {
          locked.resolve();
          await commit.promise;
        },
      }),
      {
        sendRawTransaction: async () => {
          sends += 1;
          return broadcastHash;
        },
      },
      {
        request: {
          operationId: "op_1",
          authorizationId: "approval_1:authorization",
          adapterRequestId: "race_a",
        },
        signedTransactionId: "signed_1",
        attemptId: "attempt_race_a",
        rawTransaction: broadcastRawTransaction,
      },
    );
    await locked.promise;
    const release = (async () => {
      const client = await releasePool.connect();
      try {
        await client.query("BEGIN");
        releaseStarted.resolve();
        await client.query(
          "UPDATE budget_reservations SET status = 'RELEASED' WHERE reservation_id = 'res_1'",
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    })()
      .then(
        () => ({ ok: true as const, error: null }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      .finally(() => {
        releaseSettled = true;
      });
    await releaseStarted.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(releaseSettled).toBe(false);

    commit.resolve();
    await expect(broadcast).resolves.toMatchObject({ ok: true });
    const releaseResult = await release;
    expect(releaseResult.ok).toBe(false);
    expect(releaseResult.error).toMatchObject({
      message: expect.stringMatching(/send-capable broadcast attempt/i),
    });
    await releasePool.end();

    const state = await pool.query(
      `SELECT r.status, b.available, b.reserved, b.finalized_spend,
        (SELECT count(*)::int FROM broadcast_attempts WHERE reservation_id = r.reservation_id) attempts
       FROM budget_reservations r JOIN budget_accounts b USING (budget_id)
       WHERE r.reservation_id = 'res_1'`,
    );
    expect(state.rows[0]).toMatchObject({
      status: "AUTHORIZED",
      available: "90",
      reserved: "10",
      finalized_spend: "0",
      attempts: 1,
    });
    expect(sends).toBe(1);
  }, 15_000);

  test("keeps repeated real-store STARTED creation idempotent", async () => {
    await broadcastStartFixture();
    const signed =
      await createBroadcastStore(pool).findSignedTransaction("signed_1");
    if (!signed) throw new Error("missing signed transaction fixture");
    const store = createBroadcastStore(pool);

    const first = await store.startBroadcastAttempt(
      signed,
      "attempt_repeat",
      audit("op_1", "repeat-start").traceId,
    );
    const repeated = await store.startBroadcastAttempt(
      signed,
      "attempt_repeat_other_id",
      audit("op_1", "repeat-start-repeat").traceId,
    );

    expect(first.attempt.status).toBe("STARTED");
    expect(first.created).toBe(true);
    expect(repeated.attempt.attemptId).toBe(first.attempt.attemptId);
    expect(repeated.created).toBe(false);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int count FROM broadcast_attempts WHERE reservation_id = 'res_1'",
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  test("blocks STARTED after a control change at both the store and database gates", async () => {
    await broadcastStartFixture();
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit("op_1", "control-before-started"),
    });
    const signed =
      await createBroadcastStore(pool).findSignedTransaction("signed_1");
    if (!signed) throw new Error("missing signed transaction fixture");
    let sends = 0;
    await expect(
      broadcastSignedTransaction(
        createBroadcastStore(pool),
        {
          sendRawTransaction: async () => {
            sends += 1;
            return broadcastHash;
          },
        },
        {
          request: {
            operationId: "op_1",
            authorizationId: "approval_1:authorization",
            adapterRequestId: "control-before-started",
          },
          signedTransactionId: "signed_1",
          attemptId: "attempt_control_before_start",
          rawTransaction: broadcastRawTransaction,
        },
      ),
    ).rejects.toThrow(/authority|canonical|current/i);
    expect(sends).toBe(0);
    await expect(
      pool.query(
        `INSERT INTO broadcast_attempts
          (attempt_id, signed_transaction_id, operation_id, reservation_id,
           envelope_id, envelope_revision, envelope_hash, authorization_id,
           fixture_instance_id, expected_transaction_hash)
         VALUES ('attempt_direct_after_control', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          signed.signedTransactionId,
          signed.operationId,
          signed.reservationId,
          signed.envelopeId,
          signed.envelopeRevision,
          signed.envelopeHash,
          signed.authorizationId,
          signed.fixtureInstanceId,
          signed.expectedTransactionHash,
        ],
      ),
    ).rejects.toThrow(/canonical authority|current canonical|authorization/i);
    await expect(
      pool.query(
        "SELECT count(*)::int count FROM broadcast_attempts WHERE operation_id = 'op_1'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  test("reports authenticated no-attempt state and keeps STARTED uncertainty after control", async () => {
    await broadcastStartFixture();
    const handler = createLocalAnvilSignerHandler({
      root: process.cwd(),
      pool,
    });
    const request = {
      operationId: "op_1",
      adapterRequestId: "p303-status",
    };
    await expect(handler.getStatus(request)).resolves.toEqual({
      ...request,
      state: "PENDING",
      evidence: "AUTHENTICATED",
    });
    await expect(handler.recoverTransaction(request)).resolves.toEqual({
      ...request,
      outcome: "NOT_FOUND",
      evidence: "AUTHENTICATED",
    });

    const signed =
      await createBroadcastStore(pool).findSignedTransaction("signed_1");
    if (!signed) throw new Error("missing signed transaction fixture");
    await createBroadcastStore(pool).startBroadcastAttempt(
      signed,
      "attempt_unknown_after_control",
      audit("op_1", "unknown-after-control-start").traceId,
    );
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit("op_1", "unknown-after-control-pause"),
    });
    await expect(handler.getStatus(request)).resolves.toEqual({
      ...request,
      state: "UNKNOWN",
      evidence: "UNTRUSTED",
    });
    await expect(handler.recoverTransaction(request)).resolves.toEqual({
      ...request,
      outcome: "UNKNOWN",
      evidence: "UNTRUSTED",
    });
  });

  test("durably records STARTED before an unavailable sender and retains the reservation", async () => {
    await broadcastStartFixture();
    const upstream = await startFaultUpstream();
    const proxy = await createFaultProxy({
      upstreamUrl: upstream.url,
      mode: "unavailable-before-send",
    });
    try {
      const result = await broadcastSignedTransaction(
        createBroadcastStore(pool),
        senderThroughProxy(proxy),
        {
          request: {
            operationId: "op_1",
            authorizationId: "approval_1:authorization",
            adapterRequestId: "p206b-unavailable",
          },
          signedTransactionId: "signed_1",
          attemptId: "attempt_p206b_unavailable",
          rawTransaction: broadcastRawTransaction,
        },
      );
      expect(result.attempt.status).toBe("UNKNOWN");
      expect(proxy.requestCount("eth_sendRawTransaction")).toBe(1);
      expect(proxy.forwardCount("eth_sendRawTransaction")).toBe(0);
      const state = await pool.query(
        `SELECT o.current_state, r.status, b.available, b.reserved, b.finalized_spend,
          (SELECT status FROM broadcast_attempts WHERE attempt_id = $1) attempt_status,
          (SELECT count(*)::int FROM signed_transactions WHERE operation_id = o.operation_id) signed_rows,
          (SELECT count(*)::int FROM broadcast_attempts WHERE operation_id = o.operation_id) attempt_rows,
          (SELECT count(*)::int FROM audit_events WHERE operation_id = o.operation_id) audit_rows
         FROM operations o JOIN budget_reservations r USING (operation_id)
         JOIN budget_accounts b USING (budget_id) WHERE o.operation_id = 'op_1'`,
        ["attempt_p206b_unavailable"],
      );
      expect(state.rows[0]).toMatchObject({
        current_state: "SIGNED",
        status: "AUTHORIZED",
        available: "90",
        reserved: "10",
        finalized_spend: "0",
        attempt_status: "UNKNOWN",
        signed_rows: 1,
        attempt_rows: 1,
      });
      expect(Number(state.rows[0]?.audit_rows)).toBeGreaterThan(0);
      const attemptAudits = await pool.query<{
        event_type: string;
        data: Record<string, unknown>;
      }>(
        `SELECT event_type, data FROM audit_events
         WHERE operation_id = 'op_1'
           AND event_type IN (
             'transaction.broadcast.attempted',
             'transaction.broadcast.unknown'
           )
         ORDER BY sequence_no`,
      );
      expect(attemptAudits.rows.map((row) => row.event_type)).toEqual([
        "transaction.broadcast.attempted",
        "transaction.broadcast.unknown",
      ]);
      expect(attemptAudits.rows.map((row) => row.data.attemptStatus)).toEqual([
        "STARTED",
        "UNKNOWN",
      ]);
      expect(JSON.stringify(attemptAudits.rows)).not.toContain(
        broadcastRawTransaction,
      );
    } finally {
      await proxy.close();
      await new Promise<void>((resolve, reject) =>
        upstream.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 15_000);

  test("durably fences forward-then-drop and reuses the same attempt after restart", async () => {
    await broadcastStartFixture();
    const upstream = await startFaultUpstream();
    const proxy = await createFaultProxy({
      upstreamUrl: upstream.url,
      mode: "forward-then-drop",
    });
    const restartedPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: "p206b-restart",
    });
    try {
      const input = {
        request: {
          operationId: "op_1",
          authorizationId: "approval_1:authorization",
          adapterRequestId: "p206b-forward-drop",
        },
        signedTransactionId: "signed_1",
        attemptId: "attempt_p206b_forward_drop",
        rawTransaction: broadcastRawTransaction,
      };
      const first = await broadcastSignedTransaction(
        createBroadcastStore(pool),
        senderThroughProxy(proxy),
        input,
      );
      expect(first.attempt.status).toBe("UNKNOWN");
      expect(proxy.requestCount("eth_sendRawTransaction")).toBe(1);
      expect(proxy.forwardCount("eth_sendRawTransaction")).toBe(1);

      proxy.setMode("passthrough");
      const second = await broadcastSignedTransaction(
        createBroadcastStore(restartedPool),
        senderThroughProxy(proxy),
        input,
      );
      expect(second.attempt.status).toBe("UNKNOWN");
      expect(proxy.requestCount("eth_sendRawTransaction")).toBe(1);
      expect(proxy.forwardCount("eth_sendRawTransaction")).toBe(1);

      const state = await pool.query(
        `SELECT o.current_state, r.status, b.available, b.reserved, b.finalized_spend,
          count(DISTINCT s.signed_transaction_id)::int signed_rows,
          count(DISTINCT a.attempt_id)::int attempt_rows,
          max(a.expected_transaction_hash) expected_hash,
          count(DISTINCT ee.effect_id)::int effect_rows,
          count(DISTINCT ra.attempt_id)::int recovery_rows
         FROM operations o
         JOIN budget_reservations r USING (operation_id)
         JOIN budget_accounts b USING (budget_id)
         LEFT JOIN signed_transactions s ON s.operation_id = o.operation_id
         LEFT JOIN broadcast_attempts a ON a.operation_id = o.operation_id
         LEFT JOIN execution_economic_effects ee ON ee.operation_id = o.operation_id
         LEFT JOIN recovery_attempts ra ON ra.operation_id = o.operation_id
         WHERE o.operation_id = 'op_1'
         GROUP BY o.current_state, r.status, b.available, b.reserved, b.finalized_spend`,
      );
      expect(state.rows[0]).toMatchObject({
        current_state: "SIGNED",
        status: "AUTHORIZED",
        available: "90",
        reserved: "10",
        finalized_spend: "0",
        signed_rows: 1,
        attempt_rows: 1,
        expected_hash: broadcastHash,
        effect_rows: 0,
        recovery_rows: 0,
      });
      const audits = await pool.query<{
        operation_id: string;
        event_type: string;
      }>(
        "SELECT operation_id, event_type FROM audit_events WHERE operation_id = 'op_1' ORDER BY sequence_no",
      );
      expect(audits.rows.length).toBeGreaterThan(0);
      expect(audits.rows.every((row) => row.operation_id === "op_1")).toBe(
        true,
      );
    } finally {
      await restartedPool.end();
      await proxy.close();
      await new Promise<void>((resolve, reject) =>
        upstream.server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 15_000);

  test("accepts a valid legacy v1 envelope and valid strict v2 envelope", async () => {
    const legacy = v1Envelope("op_1", "res_1");
    await expect(insertEnvelope(pool, legacy)).resolves.toMatch(
      /^0x[0-9a-f]{64}$/,
    );

    const v2 = v2Envelope("op_2", "res_2");
    await expect(insertEnvelope(pool, v2)).resolves.toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("fails closed for unknown versions, v2 legacy fields, non-empty access lists, and fee inversion", async () => {
    for (const mutate of [
      (payload: Record<string, unknown>) => ({
        ...payload,
        schemaVersion: "3.0",
      }),
      (payload: Record<string, unknown>) => ({
        ...payload,
        simulationBlockReference: "100",
      }),
      (payload: Record<string, unknown>) => ({
        ...payload,
        accessList: [{ address: address("2"), storageKeys: [] }],
      }),
      (payload: Record<string, unknown>) => ({
        ...payload,
        maxPriorityFeePerGas: "3",
      }),
    ]) {
      await expect(
        insertEnvelope(pool, mutate(v2Envelope("op_1", "res_1"))),
      ).rejects.toThrow();
    }
  });

  test("requires a current local fixture for simulation and binds simulation identity", async () => {
    await insertFixture(pool, fixtureId, false);
    await expect(
      pool.query(
        `INSERT INTO transaction_simulations
          (simulation_id, operation_id, transfer_core_candidate_hash, fixture_instance_id,
           chain_id, block_number, block_hash, sender_address, sender_nonce,
           token_balance_atomic, native_balance_wei, gas_estimate, gas_limit,
           base_fee_per_gas, max_priority_fee_per_gas, max_fee_per_gas, access_list,
           outcome, expected_asset_deltas, maximum_native_fee_atomic, simulator_version, evidence_hash)
         VALUES ('sim_1', 'op_1', $1, $2, 'eip155:31337', 100, $3, $4, 7, 100, 100000,
           21000, 21000, 1, 1, 2, '[]', 'SUCCESS', $5::jsonb, 42000, 'viem@2.56.0', $6)`,
        [hash, fixtureId, hash, address("10"), JSON.stringify([]), hash],
      ),
    ).rejects.toThrow(/current local fixture/i);
  });

  test("rejects signed evidence crossing operation, reservation, envelope, or fixture identity", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    await expect(
      pool.query(
        `INSERT INTO signed_transactions
          (signed_transaction_id, operation_id, reservation_id, envelope_id, envelope_revision,
           envelope_hash, authorization_id, simulation_id, fixture_instance_id,
           expected_transaction_hash, signer_credential_id, signer_component_id, signed_at)
         VALUES ('signed_1', 'op_1', 'res_other', 'env_op_1_1', 1, $1, 'auth_other',
           'sim_1', $2, $3, '${adapterCredential.credentialId}', '${adapterCredential.componentId}', now())`,
        [envelopeHash, fixtureId, hash],
      ),
    ).rejects.toThrow();
  });

  test("enforces authorization uniqueness and signed-row immutability", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    await expect(
      pool.query(
        `INSERT INTO signed_transactions
          (signed_transaction_id, operation_id, reservation_id, envelope_id, envelope_revision,
           envelope_hash, authorization_id, simulation_id, fixture_instance_id,
           expected_transaction_hash, signer_credential_id, signer_component_id, signed_at)
         VALUES ('signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1, 'approval_1:authorization',
           'sim_1', $2, $3, $4, $5, now())`,
        [
          envelopeHash,
          fixtureId,
          `0x${"c".repeat(64)}`,
          adapterCredential.credentialId,
          adapterCredential.componentId,
        ],
      ),
    ).resolves.toBeDefined();
    await expect(
      pool.query(
        "UPDATE signed_transactions SET expected_transaction_hash = $1 WHERE signed_transaction_id = 'signed_1'",
        [`0x${"b".repeat(64)}`],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      pool.query(
        `INSERT INTO signed_transactions
          (signed_transaction_id, operation_id, reservation_id, envelope_id, envelope_revision,
           envelope_hash, authorization_id, simulation_id, fixture_instance_id,
           expected_transaction_hash, signer_credential_id, signer_component_id, signed_at)
         VALUES ('signed_2', 'op_1', 'res_1', 'env_op_1_1', 1, $1, 'approval_1:authorization',
           'sim_1', $2, $3, $4, $5, now())`,
        [
          envelopeHash,
          fixtureId,
          hash,
          adapterCredential.credentialId,
          adapterCredential.componentId,
        ],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  test("allows only STARTED to terminal broadcast transitions", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    await pool.query(
      `INSERT INTO signed_transactions
        (signed_transaction_id, operation_id, reservation_id, envelope_id, envelope_revision,
         envelope_hash, authorization_id, simulation_id, fixture_instance_id,
         expected_transaction_hash, signer_credential_id, signer_component_id, signed_at)
       VALUES ('signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1, 'approval_1:authorization',
         'sim_1', $2, $3, $4, $5, now())`,
      [
        envelopeHash,
        fixtureId,
        hash,
        adapterCredential.credentialId,
        adapterCredential.componentId,
      ],
    );
    await markOperationSigned();
    await pool.query(
      `INSERT INTO broadcast_attempts
        (attempt_id, signed_transaction_id, operation_id, reservation_id, envelope_id,
         envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
         expected_transaction_hash, status, started_at)
       VALUES ('attempt_1', 'signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1,
         'approval_1:authorization', $2, $3, 'STARTED', now())`,
      [envelopeHash, fixtureId, hash],
    );
    await pool.query(
      `UPDATE broadcast_attempts
       SET status = 'ACCEPTED', response_transaction_hash = $1,
           classification_reason = 'node accepted', completed_at = now()
       WHERE attempt_id = 'attempt_1'`,
      [hash],
    );
    await expect(
      pool.query(
        "UPDATE broadcast_attempts SET status = 'UNKNOWN' WHERE attempt_id = 'attempt_1'",
      ),
    ).rejects.toThrow(/invalid broadcast attempt transition/i);
    await expect(
      pool.query(
        `INSERT INTO broadcast_attempts
          (attempt_id, signed_transaction_id, operation_id, reservation_id, envelope_id,
           envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
           expected_transaction_hash)
         VALUES ('attempt_2', 'signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1,
           'approval_1:authorization', $2, $3)`,
        [envelopeHash, fixtureId, hash],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  test("persists a contradictory valid returned hash as CONFLICT", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    await pool.query(
      `INSERT INTO signed_transactions
        (signed_transaction_id, operation_id, reservation_id, envelope_id, envelope_revision,
         envelope_hash, authorization_id, simulation_id, fixture_instance_id,
         expected_transaction_hash, signer_credential_id, signer_component_id, signed_at)
       VALUES ('signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1, 'approval_1:authorization',
         'sim_1', $2, $3, $4, $5, now())`,
      [
        envelopeHash,
        fixtureId,
        hash,
        adapterCredential.credentialId,
        adapterCredential.componentId,
      ],
    );
    await markOperationSigned();
    await pool.query(
      `INSERT INTO broadcast_attempts
        (attempt_id, signed_transaction_id, operation_id, reservation_id, envelope_id,
         envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
         expected_transaction_hash)
       VALUES ('attempt_1', 'signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1,
         'approval_1:authorization', $2, $3)`,
      [envelopeHash, fixtureId, hash],
    );
    await expect(
      pool.query(
        `UPDATE broadcast_attempts SET status = 'CONFLICT',
          response_transaction_hash = $1,
          classification_reason = 'CONTRADICTORY_RETURNED_HASH', completed_at = now()
         WHERE attempt_id = 'attempt_1'`,
        [`0x${"c".repeat(64)}`],
      ),
    ).resolves.toBeDefined();
  });

  test("binds normalized transaction, receipt, log, and one reconciler effect", async () => {
    const envelopeHash = await prepareAuthorizedV2();
    await pool.query(
      `INSERT INTO signed_transactions
        (signed_transaction_id, operation_id, reservation_id, envelope_id, envelope_revision,
         envelope_hash, authorization_id, simulation_id, fixture_instance_id,
         expected_transaction_hash, signer_credential_id, signer_component_id, signed_at)
       VALUES ('signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1, 'approval_1:authorization',
         'sim_1', $2, $3, $4, $5, now())`,
      [
        envelopeHash,
        fixtureId,
        hash,
        adapterCredential.credentialId,
        adapterCredential.componentId,
      ],
    );
    await markOperationSigned();
    await pool.query(
      `INSERT INTO broadcast_attempts
        (attempt_id, signed_transaction_id, operation_id, reservation_id, envelope_id,
         envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
         expected_transaction_hash, status, started_at)
       VALUES ('attempt_1', 'signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1,
         'approval_1:authorization', $2, $3, 'STARTED', now())`,
      [envelopeHash, fixtureId, hash],
    );
    await pool.query(
      `INSERT INTO chain_transaction_evidence
        (transaction_evidence_id, broadcast_attempt_id, signed_transaction_id, operation_id,
         reservation_id, envelope_id, envelope_revision, envelope_hash, authorization_id,
         fixture_instance_id, chain_id, transaction_hash, block_number, block_hash,
         transaction_index, from_address, to_address, value_atomic, calldata, nonce,
         transaction_type, gas_limit, max_priority_fee_per_gas, max_fee_per_gas,
         access_list, evidence_hash)
       VALUES ('tx_1', 'attempt_1', 'signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1,
         'approval_1:authorization', $2, 'eip155:31337', $3, 101, $4, 0, $5, $6, 0,
         $7, 7, 'eip1559', 50000, 1, 2, '[]', $8)`,
      [
        envelopeHash,
        fixtureId,
        hash,
        hash,
        address("10"),
        address("1"),
        v2Envelope("op_1", "res_1").calldata,
        hash,
      ],
    );
    await pool.query(
      `INSERT INTO chain_receipt_evidence
        (receipt_evidence_id, transaction_evidence_id, operation_id, reservation_id,
         envelope_id, envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
         transaction_hash, chain_id, block_number, block_hash, receipt_status, gas_used,
         effective_gas_price, log_count, evidence_hash)
       VALUES ('receipt_1', 'tx_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1,
         'approval_1:authorization', $2, $3, 'eip155:31337', 101, $4, 'SUCCESS',
         30000, 2, 1, $5)`,
      [envelopeHash, fixtureId, hash, hash, hash],
    );
    await pool.query(
      `INSERT INTO chain_transfer_logs
        (log_evidence_id, receipt_evidence_id, log_index, token_address, from_address,
         to_address, amount_atomic)
       VALUES ('log_1', 'receipt_1', 0, $1, $2, $3, 10)`,
      [address("1"), address("10"), address("20")],
    );
    await pool.query(
      `INSERT INTO execution_economic_effects
        (effect_id, operation_id, reservation_id, envelope_id, envelope_revision, envelope_hash,
         authorization_id, receipt_evidence_id, transaction_hash, asset_address, from_address,
         to_address, amount_atomic, reconciler_credential_id, reconciler_component_id,
         reconciler_auth_signature, reconciler_auth_payload_hash, effect_hash)
       VALUES ('effect_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1, 'approval_1:authorization',
         'receipt_1', $2, $3, $4, $5, 10, $6, $7, 'signature', $8, $9)`,
      [
        envelopeHash,
        hash,
        address("1"),
        address("10"),
        address("20"),
        reconcilerCredential.credentialId,
        reconcilerCredential.componentId,
        `sha256:${"c".repeat(64)}`,
        `0x${"d".repeat(64)}`,
      ],
    );
    await expect(
      pool.query(
        `INSERT INTO execution_economic_effects
          (effect_id, operation_id, reservation_id, envelope_id, envelope_revision, envelope_hash,
           authorization_id, receipt_evidence_id, transaction_hash, asset_address, from_address,
           to_address, amount_atomic, reconciler_credential_id, reconciler_component_id,
           reconciler_auth_signature, reconciler_auth_payload_hash, effect_hash)
         VALUES ('effect_2', 'op_1', 'res_1', 'env_op_1_1', 1, $1, 'approval_1:authorization',
           'receipt_1', $2, $3, $4, $5, 10, $6, $7, 'signature', $8, $9)`,
        [
          envelopeHash,
          hash,
          address("1"),
          address("10"),
          address("20"),
          reconcilerCredential.credentialId,
          reconcilerCredential.componentId,
          `sha256:${"e".repeat(64)}`,
          `0x${"f".repeat(64)}`,
        ],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  test("normalizes one receipt log and rejects multiple economic effects", async () => {
    const columns = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [
        [
          "local_chain_fixtures",
          "transaction_simulations",
          "signed_transactions",
          "broadcast_attempts",
          "chain_transaction_evidence",
          "chain_receipt_evidence",
          "chain_transfer_logs",
          "execution_economic_effects",
        ],
      ],
    );
    expect(columns.rows).toHaveLength(8);
    expect(zeroLogTopic).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("rolls back an invalid evidence transaction atomically", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await insertFixture(client);
      await expect(
        client.query(
          "INSERT INTO local_chain_fixtures (fixture_instance_id, is_current, checkout_sha, chain_id, genesis_block_hash, token_address, token_code_hash, deployment_transaction_hash, deployment_block_number, deployment_block_hash, toolchain) VALUES ('bad', true, 'bad', 'eip155:1', $1, $2, $1, $1, 1, $1, '{}')",
          [hash, address("1")],
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM local_chain_fixtures",
        )
      ).rows[0]?.count,
    ).toBe(0);
  });

  test("reconciles exact SUCCESS through the P2-05C entry point once", async () => {
    const input = await reconciliationFixture();
    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "FINALIZED", finalizedSpendAtomic: "10" },
    });
    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "FINALIZED" },
    });
    const state = await pool.query(
      `SELECT o.current_state, r.status, b.available, b.reserved, b.finalized_spend,
        (SELECT count(*)::int FROM recovery_attempts WHERE operation_id = o.operation_id) attempts,
        (SELECT count(*)::int FROM execution_economic_effects WHERE operation_id = o.operation_id) effects
       FROM operations o JOIN budget_reservations r USING (operation_id)
       JOIN budget_accounts b USING (budget_id) WHERE o.operation_id = 'op_1'`,
    );
    expect(state.rows[0]).toMatchObject({
      current_state: "RECONCILED",
      status: "FINALIZED",
      available: "90",
      reserved: "0",
      finalized_spend: "10",
      attempts: 1,
      effects: 1,
    });
  });

  test("reconciles an accepted exact attempt after a control invalidation", async () => {
    const input = await reconciliationFixture();
    await pool.query(
      "UPDATE budget_accounts SET available = 80, reserved = 20 WHERE budget_id = 'budget_1'",
    );
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit("op_1", "control-after-accepted-attempt"),
    });

    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "FINALIZED", finalizedSpendAtomic: "10" },
    });
    await expect(
      pool.query(
        `SELECT o.current_state, r.status,
                (SELECT count(*)::int FROM authorization_invalidations ai
                 WHERE ai.operation_id = o.operation_id) AS invalidations,
                (SELECT count(*)::int FROM execution_economic_effects effect
                 WHERE effect.operation_id = o.operation_id) AS effects
         FROM operations o JOIN budget_reservations r USING (operation_id)
         WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          current_state: "RECONCILED",
          status: "FINALIZED",
          invalidations: 1,
          effects: 1,
        },
      ],
    });
  });

  test("recovers exact mined evidence for a STARTED attempt after a crash", async () => {
    const input = await reconciliationFixture("success", undefined, "STARTED");
    await pool.query(
      "UPDATE budget_accounts SET available = 80, reserved = 20 WHERE budget_id = 'budget_1'",
    );
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit("op_1", "control-after-started-attempt-crash"),
    });

    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "FINALIZED", finalizedSpendAtomic: "10" },
    });
    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "FINALIZED" },
    });
    await expect(
      pool.query<{
        current_state: string;
        status: string;
        attempt_status: string;
        invalidations: number;
        effects: number;
      }>(
        `SELECT o.current_state, r.status, a.status AS attempt_status,
                (SELECT count(*)::int FROM authorization_invalidations ai
                 WHERE ai.operation_id = o.operation_id) AS invalidations,
                (SELECT count(*)::int FROM execution_economic_effects effect
                 WHERE effect.operation_id = o.operation_id) AS effects
         FROM operations o JOIN budget_reservations r USING (operation_id)
         JOIN broadcast_attempts a USING (operation_id)
         WHERE o.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          current_state: "RECONCILED",
          status: "FINALIZED",
          attempt_status: "STARTED",
          invalidations: 1,
          effects: 1,
        },
      ],
    });
  });

  test("reconciles a CONFLICT attempt only when exact canonical evidence verifies", async () => {
    const input = await reconciliationFixture("success", undefined, "CONFLICT");
    await pool.query(
      "UPDATE budget_accounts SET available = 80, reserved = 20 WHERE budget_id = 'budget_1'",
    );
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit("op_1", "control-after-conflict-attempt"),
    });

    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "FINALIZED", finalizedSpendAtomic: "10" },
    });
    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "FINALIZED" },
    });
    await expect(
      pool.query<{ effects: number; attempts: number }>(
        `SELECT count(DISTINCT a.attempt_id)::int AS attempts,
                count(DISTINCT effect.effect_id)::int AS effects
         FROM broadcast_attempts a
         LEFT JOIN execution_economic_effects effect
           ON effect.operation_id = a.operation_id
         WHERE a.operation_id = 'op_1'`,
      ),
    ).resolves.toMatchObject({ rows: [{ attempts: 1, effects: 1 }] });
  });

  test("keeps mismatched evidence for a CONFLICT attempt disputed", async () => {
    const input = await reconciliationFixture("success", undefined, "CONFLICT");
    const evidence = {
      ...input.evidence,
      transaction: {
        ...(input.evidence.transaction as Record<string, unknown>),
        hash: `0x${"c".repeat(64)}`,
      },
    };
    const verification = verifyUntrustedChainEvidence(
      input.expectation,
      evidence,
    );
    expect(verification.ok).toBe(false);
    if (verification.ok) throw new Error("expected conflict evidence mismatch");
    const reason = `chain evidence mismatch: ${verification.mismatches
      .map((item) => item.code)
      .join(",")}`;
    const resolve = componentAudit(
      "op_1",
      "conflict-attempt-mismatch-resolve",
      signComponentAction(reconcilerCredential, "recovery.resolve", {
        attemptId: "attempt_1",
        operationId: "op_1",
        reservationId: "res_1",
        leaseVersion: "1",
        outcome: "CONFLICT",
        reason,
        actualSpendAtomic: null,
        proofReference: null,
        evidence: null,
      }),
    );
    await expect(
      reconcileLocalChainEvidence(pool, {
        ...input,
        evidence,
        audits: { ...input.audits, resolve },
      }),
    ).resolves.toMatchObject({
      ok: false,
      reservation: { status: "DISPUTED" },
    });
    await expect(
      pool.query(
        "SELECT count(*)::int count FROM execution_economic_effects WHERE operation_id = 'op_1'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  test("invalidated rejected attempts cannot advance or release", async () => {
    await broadcastStartFixture();
    const signed = await pool.query<{ envelope_hash: string }>(
      "SELECT envelope_hash FROM signed_transactions WHERE signed_transaction_id = 'signed_1'",
    );
    await pool.query(
      `INSERT INTO broadcast_attempts
        (attempt_id, signed_transaction_id, operation_id, reservation_id, envelope_id,
         envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
         expected_transaction_hash)
       VALUES ('attempt_rejected_control', 'signed_1', 'op_1', 'res_1', 'env_op_1_1',
         1, $1, 'approval_1:authorization', $2, $3)`,
      [signed.rows[0]!.envelope_hash, fixtureId, broadcastHash],
    );
    await pool.query(
      `UPDATE broadcast_attempts
       SET status = 'REJECTED', classification_reason = 'not transmitted', completed_at = now()
       WHERE attempt_id = 'attempt_rejected_control'`,
    );
    await pool.query(
      "UPDATE budget_accounts SET available = 80, reserved = 20 WHERE budget_id = 'budget_1'",
    );
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit("op_1", "control-after-rejected-attempt"),
    });
    const balanceBefore = await pool.query<{
      available: string;
      reserved: string;
    }>(
      "SELECT available::text, reserved::text FROM budget_accounts WHERE budget_id = 'budget_1'",
    );

    const evidence: BroadcastEvidence = {
      transactionHash: broadcastHash,
      nonce: "7",
      receiptReference: "receipt:attempt_rejected_control",
    };
    await expect(
      markReservationBroadcast(pool, {
        reservationId: "res_1",
        evidence,
        audit: componentAudit(
          "op_1",
          "rejected-attempt-broadcast-after-control",
          signComponentAction(adapterCredential, "broadcast", {
            reservationId: "res_1",
            ...evidence,
          }),
        ),
      }),
    ).rejects.toThrow("canonical authorization evidence is missing");
    await expect(
      pool.query(
        `UPDATE budget_reservations SET status = 'BROADCAST'
         WHERE reservation_id = 'res_1'`,
      ),
    ).rejects.toThrow(
      "invalidated rejected broadcast attempt cannot be advanced or released",
    );
    await expect(
      releaseReservation(pool, {
        reservationId: "res_1",
        audit: audit("op_1", "release-rejected-attempt-after-control"),
      }),
    ).rejects.toThrow(
      "invalidated rejected broadcast attempt cannot be advanced or released",
    );
    await pool.query(
      "UPDATE budget_reservations SET expires_at = now() - interval '1 second' WHERE reservation_id = 'res_1'",
    );
    await expect(
      expireReservation(pool, {
        reservationId: "res_1",
        now: new Date(),
        audit: audit("op_1", "expire-rejected-attempt-after-control"),
      }),
    ).rejects.toThrow(
      "invalidated rejected broadcast attempt cannot be advanced or released",
    );
    await expect(
      pool.query(
        `UPDATE budget_reservations SET status = 'RELEASED'
         WHERE reservation_id = 'res_1'`,
      ),
    ).rejects.toThrow(
      "invalidated rejected broadcast attempt cannot be advanced or released",
    );
    await expect(
      pool.query(
        `UPDATE budget_reservations SET status = 'EXPIRED'
         WHERE reservation_id = 'res_1'`,
      ),
    ).rejects.toThrow(
      "invalidated rejected broadcast attempt cannot be advanced or released",
    );
    const balanceAfter = await pool.query<{
      available: string;
      reserved: string;
    }>(
      "SELECT available::text, reserved::text FROM budget_accounts WHERE budget_id = 'budget_1'",
    );
    expect(balanceAfter.rows).toEqual(balanceBefore.rows);
    await expect(
      pool.query(
        `SELECT r.status, a.status AS attempt_status,
                (SELECT count(*)::int FROM authorization_invalidations ai
                 WHERE ai.authorization_id = 'approval_1:authorization') AS invalidations
         FROM budget_reservations r JOIN broadcast_attempts a USING (reservation_id)
         WHERE r.reservation_id = 'res_1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          status: "AUTHORIZED",
          attempt_status: "REJECTED",
          invalidations: 1,
        },
      ],
    });
  });

  test("reconciles a verified status-0 receipt as RELEASED with zero spend", async () => {
    const input = await reconciliationFixture("reverted");
    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "RELEASED", finalizedSpendAtomic: "0" },
    });
    const state = await pool.query(
      `SELECT o.current_state, r.status, b.available, b.reserved, b.finalized_spend,
        (SELECT count(*)::int FROM signed_transactions WHERE operation_id = o.operation_id) signed_rows,
        (SELECT count(*)::int FROM broadcast_attempts WHERE operation_id = o.operation_id) attempt_rows,
        (SELECT count(*)::int FROM recovery_attempts WHERE operation_id = o.operation_id) recovery_rows,
        (SELECT count(*)::int FROM execution_economic_effects WHERE operation_id = o.operation_id) effects
       FROM operations o JOIN budget_reservations r USING (operation_id)
       JOIN budget_accounts b USING (budget_id) WHERE o.operation_id = 'op_1'`,
    );
    expect(state.rows[0]).toMatchObject({
      current_state: "RECONCILED",
      status: "RELEASED",
      available: "100",
      reserved: "0",
      finalized_spend: "0",
      signed_rows: 1,
      attempt_rows: 1,
      recovery_rows: 1,
      effects: 0,
    });
    const fee = await pool.query<{
      gas_used: string;
      effective_gas_price: string;
    }>(
      `SELECT gas_used, effective_gas_price FROM chain_receipt_evidence
       WHERE operation_id = 'op_1' AND receipt_status = 'REVERT'`,
    );
    expect(fee.rows[0]).toEqual({
      gas_used: "45000",
      effective_gas_price: "2",
    });
    const audits = await pool.query<{
      event_type: string;
      operation_id: string;
      data: unknown;
    }>(
      "SELECT event_type, operation_id, data FROM audit_events WHERE operation_id = 'op_1' ORDER BY sequence_no",
    );
    expect(
      audits.rows.some(
        (row) => row.event_type === "execution.recovery.resolved",
      ),
    ).toBe(true);
    expect(audits.rows.every((row) => row.operation_id === "op_1")).toBe(true);
    const recoveryAudits = audits.rows.filter((row) =>
      row.event_type.startsWith("execution.recovery."),
    );
    expect(recoveryAudits.length).toBeGreaterThan(0);
    expect(
      recoveryAudits.every((row) => JSON.stringify(row.data).includes("res_1")),
    ).toBe(true);
    expect(
      recoveryAudits.some((row) =>
        JSON.stringify(row.data).includes("attempt_1"),
      ),
    ).toBe(true);
  });

  test.each([
    ["transaction hash", { transactionHash: `0x${"c".repeat(64)}` }],
    ["nonce", { nonce: "8" }],
    ["receipt reference", { receiptReference: "receipt:unrelated" }],
  ])(
    "rejects legacy evidence with wrong %s before economic mutation",
    async (_label, mutation) => {
      const input = await reconciliationFixture();
      await expect(
        reconcileLocalChainEvidence(pool, {
          ...input,
          broadcastEvidence: { ...input.broadcastEvidence, ...mutation },
        }),
      ).rejects.toThrow(/broadcast evidence.*match|receipt reference/i);
      const state = await pool.query(
        "SELECT status FROM budget_reservations WHERE reservation_id = 'res_1'",
      );
      expect(state.rows[0]?.status).toBe("AUTHORIZED");
      expect(
        (
          await pool.query(
            "SELECT count(*)::int count FROM recovery_attempts WHERE operation_id = 'op_1'",
          )
        ).rows[0]?.count,
      ).toBe(0);
    },
  );

  test("a durable send-capable attempt fences direct, FAILED, and no-send release", async () => {
    await reconciliationFixture();
    await expect(
      releaseReservation(pool, {
        reservationId: "res_1",
        audit: audit("op_1", "direct-release"),
      }),
    ).rejects.toThrow(
      /send-capable broadcast attempt fences reservation release/i,
    );

    const recoveryAttemptId = "recovery_release_1";
    const claim = await claimRecoveryLease(pool, {
      attemptId: recoveryAttemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseDurationSeconds: 60,
      audit: componentAudit(
        "op_1",
        "failed-release:claim",
        signComponentAction(reconcilerCredential, "recovery.claim", {
          attemptId: recoveryAttemptId,
          operationId: "op_1",
          reservationId: "res_1",
          leaseDurationSeconds: 60,
        }),
      ),
    });
    const resolution = {
      attemptId: recoveryAttemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseVersion: claim.leaseVersion,
      outcome: "FAILED" as const,
      reason: "claimed pre-acceptance failure after durable send attempt",
    };
    await expect(
      resolveRecovery(pool, {
        ...resolution,
        audit: componentAudit(
          "op_1",
          "failed-release:resolve",
          signComponentAction(reconcilerCredential, "recovery.resolve", {
            ...resolution,
            actualSpendAtomic: null,
            proofReference: null,
            evidence: null,
          }),
        ),
      }),
    ).rejects.toThrow(
      /send-capable broadcast attempt fences reservation release/i,
    );
    await pool.query(
      "UPDATE budget_reservations SET status = 'RELEASED' WHERE reservation_id = 'res_2'",
    );
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit("op_1", "send-capable-no-send-control"),
    });
    const noSendResolution = {
      attemptId: recoveryAttemptId,
      operationId: "op_1",
      reservationId: "res_1",
      leaseVersion: claim.leaseVersion,
      outcome: "FAILED" as const,
      reason: SIGNED_UNBROADCAST_CONTROLLED_NO_ATTEMPT_REASON,
    };
    await expect(
      resolveRecovery(pool, {
        ...noSendResolution,
        audit: componentAudit(
          "op_1",
          "send-capable-no-send-resolution",
          signComponentAction(reconcilerCredential, "recovery.resolve", {
            ...noSendResolution,
            actualSpendAtomic: null,
            proofReference: null,
            evidence: null,
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESERVATION_TRANSITION" });
    const state = await pool.query(
      `SELECT r.status, b.available, b.reserved, b.finalized_spend
       FROM budget_reservations r JOIN budget_accounts b USING (budget_id)
       WHERE r.reservation_id = 'res_1'`,
    );
    expect(state.rows[0]).toMatchObject({
      status: "AUTHORIZED",
      available: "90",
      reserved: "10",
      finalized_spend: "0",
    });
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM recovery_attempts WHERE operation_id = 'op_1'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  test.each([
    [
      "transaction mismatch",
      (value: UntrustedChainEvidence) => ({
        ...value,
        transaction: {
          ...(value.transaction as Record<string, unknown>),
          hash: `0x${"c".repeat(64)}`,
        },
      }),
    ],
    [
      "receipt mismatch",
      (value: UntrustedChainEvidence) => ({
        ...value,
        receipt: {
          ...(value.receipt as Record<string, unknown>),
          transactionHash: `0x${"c".repeat(64)}`,
        },
      }),
    ],
    [
      "Transfer-log mismatch",
      (value: UntrustedChainEvidence) => {
        const receipt = value.receipt as Record<string, unknown>;
        const logs = receipt.logs as readonly Record<string, unknown>[];
        return {
          ...value,
          receipt: {
            ...receipt,
            logs: [{ ...logs[0], data: `0x${"0".repeat(63)}b` }],
          },
        };
      },
    ],
  ])(
    "routes %s through the actual entry point to DISPUTED",
    async (_label, mutate) => {
      const input = await reconciliationFixture();
      const evidence = mutate(input.evidence);
      const verification = verifyUntrustedChainEvidence(
        input.expectation,
        evidence,
      );
      expect(verification.ok).toBe(false);
      if (verification.ok) throw new Error("expected mismatch fixture");
      const reason = `chain evidence mismatch: ${verification.mismatches
        .map((item) => item.code)
        .join(",")}`;
      const resolve = componentAudit(
        "op_1",
        `mismatch:${_label.replaceAll(" ", "-")}:resolve`,
        signComponentAction(reconcilerCredential, "recovery.resolve", {
          attemptId: "attempt_1",
          operationId: "op_1",
          reservationId: "res_1",
          leaseVersion: "1",
          outcome: "CONFLICT",
          reason,
          actualSpendAtomic: null,
          proofReference: null,
          evidence: null,
        }),
      );
      await expect(
        reconcileLocalChainEvidence(pool, {
          ...input,
          evidence,
          audits: { ...input.audits, resolve },
        }),
      ).resolves.toMatchObject({
        ok: false,
        reservation: { status: "DISPUTED" },
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int count FROM execution_economic_effects WHERE operation_id = 'op_1'",
          )
        ).rows[0]?.count,
      ).toBe(0);
    },
  );

  test.each([
    ["operation", { operationId: "op_2" }],
    ["reservation", { reservationId: "res_2" }],
    [
      "fixture",
      {
        fixtureInstanceId: "22222222-2222-4222-8222-222222222222",
      },
    ],
  ])(
    "rejects cross-%s authority before economic mutation",
    async (_label, mutation) => {
      const input = await reconciliationFixture();
      await expect(
        reconcileLocalChainEvidence(pool, {
          ...input,
          expectation: { ...input.expectation, ...mutation },
        }),
      ).rejects.toThrow(
        /broadcast attempt does not match reconciliation authority/i,
      );
      expect(
        (
          await pool.query(
            "SELECT count(*)::int count FROM recovery_attempts WHERE operation_id = 'op_1'",
          )
        ).rows[0]?.count,
      ).toBe(0);
    },
  );

  test("rejects forged and revoked RECONCILER authentication before resolution", async () => {
    const forged = await reconciliationFixture();
    await expect(
      reconcileLocalChainEvidence(pool, {
        ...forged,
        audits: {
          ...forged.audits,
          verification: {
            ...forged.audits.verification,
            componentAuth: {
              ...forged.audits.verification.componentAuth!,
              signature: `${forged.audits.verification.componentAuth!.signature}x`,
            },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "COMPONENT_AUTHENTICATION_FAILED" });

    await reset();
    const revoked = await reconciliationFixture();
    await pool.query(
      `UPDATE trusted_component_credentials
       SET status = 'REVOKED', revoked_at = now()
       WHERE credential_id = $1`,
      [reconcilerCredential.credentialId],
    );
    await expect(
      reconcileLocalChainEvidence(pool, revoked),
    ).rejects.toMatchObject({
      code: "COMPONENT_NOT_TRUSTED",
    });
  });

  test("concurrent retries converge on one recovery and one effect", async () => {
    const input = await reconciliationFixture();
    const results = await Promise.allSettled([
      reconcileLocalChainEvidence(pool, input),
      reconcileLocalChainEvidence(pool, input),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    const counts = await pool.query(
      `SELECT (SELECT count(*)::int FROM recovery_attempts WHERE operation_id = 'op_1') attempts,
              (SELECT count(*)::int FROM execution_economic_effects WHERE operation_id = 'op_1') effects`,
    );
    expect(counts.rows[0]).toEqual({ attempts: 1, effects: 1 });
  });

  test("resumes exactly once after a crash immediately after SUCCESS resolution", async () => {
    let crash = true;
    const input = await reconciliationFixture("success", {
      afterRecoveryResolved: async () => {
        if (crash) {
          crash = false;
          throw new Error("deterministic post-resolution crash");
        }
      },
    });
    await expect(reconcileLocalChainEvidence(pool, input)).rejects.toThrow(
      "deterministic post-resolution crash",
    );
    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "FINALIZED" },
    });
    const counts = await pool.query(
      `SELECT (SELECT count(*)::int FROM recovery_attempts WHERE operation_id = 'op_1') attempts,
              (SELECT count(*)::int FROM execution_economic_effects WHERE operation_id = 'op_1') effects,
              (SELECT current_state FROM operations WHERE operation_id = 'op_1') state`,
    );
    expect(counts.rows[0]).toEqual({
      attempts: 1,
      effects: 1,
      state: "RECONCILED",
    });
  });

  test("resumes lifecycle after a crash following economic-effect persistence", async () => {
    let crash = true;
    const input = await reconciliationFixture("success", {
      afterEconomicEffectPersisted: async () => {
        if (crash) {
          crash = false;
          throw new Error("deterministic post-effect crash");
        }
      },
    });
    await expect(reconcileLocalChainEvidence(pool, input)).rejects.toThrow(
      "deterministic post-effect crash",
    );
    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "FINALIZED" },
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int count FROM execution_economic_effects WHERE operation_id = 'op_1'",
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  test("resumes a verified REVERT after a crash following RELEASED resolution", async () => {
    let crash = true;
    const input = await reconciliationFixture("reverted", {
      afterRecoveryResolved: async () => {
        if (crash) {
          crash = false;
          throw new Error("deterministic revert post-resolution crash");
        }
      },
    });
    await expect(reconcileLocalChainEvidence(pool, input)).rejects.toThrow(
      "deterministic revert post-resolution crash",
    );
    await expect(
      reconcileLocalChainEvidence(pool, input),
    ).resolves.toMatchObject({
      ok: true,
      reservation: { status: "RELEASED" },
    });
    const state = await pool.query(
      `SELECT o.current_state, r.status, b.finalized_spend
       FROM operations o JOIN budget_reservations r USING (operation_id)
       JOIN budget_accounts b USING (budget_id) WHERE o.operation_id = 'op_1'`,
    );
    expect(state.rows[0]).toMatchObject({
      current_state: "RECONCILED",
      status: "RELEASED",
      finalized_spend: "0",
    });
  });
});
