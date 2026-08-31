import { createHash } from "node:crypto";

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
  consumeApproval,
  createApprovalRequest,
} from "@crip/approvals";
import {
  applyMigrations,
  claimRecoveryLease,
  releaseReservation,
  resolveRecovery,
  type AuditContext,
  type BroadcastEvidence,
} from "@crip/budget-ledger";
import { type ExecutionEnvelopeV2 } from "@crip/schemas";
import {
  verifyUntrustedChainEvidence,
  type ChainEvidenceExpectation,
  type UntrustedChainEvidence,
} from "@crip/transaction-pipeline";
import {
  broadcastSignedTransaction,
  createBroadcastStore,
  reconcileLocalChainEvidence,
  type ReconciliationInput,
} from "@crip/local-anvil-adapter";
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

const v2Envelope = (operationId: string, reservationId: string) => ({
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
  simulationResultHash: hash,
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
      VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:${"0".repeat(64)}');
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
      VALUES ('intent_op_1', 'intent-key-op_1', 'agent_1', 'wallet_1', 'policy_1', 1, '{"action":"asset.transfer"}', 'sha256:${"1".repeat(64)}');
    INSERT INTO operations
      (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
      VALUES ('op_1', 'intent_op_1', 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED');
    INSERT INTO budget_reservations
      (reservation_id, budget_id, operation_id, idempotency_key, amount_atomic, status, expires_at)
      VALUES ('res_1', 'budget_1', 'op_1', 'reserve-key-op_1', 10, 'HELD', '2099-01-01T01:00:00Z');
    INSERT INTO intents
      (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
      VALUES ('intent_op_2', 'intent-key-op_2', 'agent_1', 'wallet_1', 'policy_1', 1, '{"action":"asset.transfer"}', 'sha256:${"2".repeat(64)}');
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

const insertSimulation = async (client: Queryable): Promise<void> => {
  await client.query(
    `INSERT INTO transaction_simulations
      (simulation_id, operation_id, transfer_core_candidate_hash, fixture_instance_id,
       chain_id, block_number, block_hash, sender_address, sender_nonce,
       token_balance_atomic, native_balance_wei, gas_estimate, gas_limit,
       base_fee_per_gas, max_priority_fee_per_gas, max_fee_per_gas, access_list,
       outcome, expected_asset_deltas, maximum_native_fee_atomic, simulator_version, evidence_hash)
     VALUES ('sim_1', 'op_1', $1, $2, 'eip155:31337', 100, $3, $4, 7, 100, 100000,
       21000, 50000, 1, 1, 2, '[]', 'SUCCESS', $5::jsonb, 100000,
       'viem@2.56.0', $6)`,
    [
      hash,
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
      hash,
    ],
  );
};

const prepareAuthorizedV2 = async (): Promise<string> => {
  await insertFixture(pool);
  const envelope = v2Envelope("op_1", "res_1");
  const envelopeHash = await insertEnvelope(pool, envelope);
  await insertSimulation(pool);
  await pool.query(
    `INSERT INTO policy_decisions
      (decision_id, operation_id, policy_id, policy_version, decision, decision_hash, payload)
     VALUES ('decision_1', 'op_1', 'policy_1', 1, 'REQUIRE_APPROVAL', $1, $2::jsonb)`,
    [hash, JSON.stringify({ decision: "REQUIRE_APPROVAL", policyVersion: 1 })],
  );
  await pool.query(
    "UPDATE operations SET current_state = 'ENVELOPE_FINALIZED', version = version + 1 WHERE operation_id = 'op_1'",
  );
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

const reconciliationFixture = async (
  receiptStatus: "success" | "reverted" = "success",
  hooks?: ReconciliationInput["barriers"],
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
  await pool.query(
    `INSERT INTO broadcast_attempts
      (attempt_id, signed_transaction_id, operation_id, reservation_id, envelope_id,
       envelope_revision, envelope_hash, authorization_id, fixture_instance_id,
       expected_transaction_hash)
     VALUES ('attempt_1', 'signed_1', 'op_1', 'res_1', 'env_op_1_1', 1, $1,
       'approval_1:authorization', $2, $3)`,
    [envelopeHash, fixtureId, hash],
  );
  await pool.query(
    `UPDATE broadcast_attempts SET status = 'ACCEPTED', response_transaction_hash = $1,
      classification_reason = 'MATCHING_RETURNED_TRANSACTION_HASH', completed_at = now()
     WHERE attempt_id = 'attempt_1'`,
    [hash],
  );
  await pool.query(
    "UPDATE operations SET current_state = 'SIGNING', version = version + 1 WHERE operation_id = 'op_1'",
  );
  await pool.query(
    "UPDATE operations SET current_state = 'SIGNED', version = version + 1 WHERE operation_id = 'op_1'",
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
  await pool.query(
    "UPDATE operations SET current_state = 'SIGNING', version = version + 1 WHERE operation_id = 'op_1'",
  );
  await pool.query(
    "UPDATE operations SET current_state = 'SIGNED', version = version + 1 WHERE operation_id = 'op_1'",
  );
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const waitForDatabaseBlock = async (applicationName: string): Promise<void> => {
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
    if (result.rows[0]?.blocked) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`database session did not block: ${applicationName}`);
};

describe.sequential("WS-004 execution evidence persistence", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(async () => {
    const result = await pool.query<{ exists: boolean }>(
      "SELECT to_regclass('public.local_chain_fixtures') IS NOT NULL AS exists",
    );
    if (result.rows[0]?.exists) await reset();
  });
  afterAll(async () => pool.end());

  test("applies the broadcast-safety migration after the frozen Phase-1 migrations", async () => {
    const rows = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    );
    expect(rows.rows).toHaveLength(24);
    expect(rows.rows.at(-1)?.filename).toBe(
      "0024_canonical_autonomous_authorization.sql",
    );
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

  test("prevents real-store STARTED and send when release commits first", async () => {
    await broadcastStartFixture();
    const releaseClient = await pool.connect();
    await releaseClient.query("BEGIN");
    await releaseClient.query(
      "SELECT 1 FROM budget_reservations WHERE reservation_id = 'res_1' FOR UPDATE",
    );
    await releaseClient.query(
      "UPDATE budget_accounts SET available = 100, reserved = 0 WHERE budget_id = 'budget_1'",
    );
    await releaseClient.query(
      "UPDATE budget_reservations SET status = 'RELEASED' WHERE reservation_id = 'res_1'",
    );
    const startPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: "race-b-start",
    });
    let sends = 0;
    const broadcast = broadcastSignedTransaction(
      createBroadcastStore(startPool),
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
          adapterRequestId: "race_b",
        },
        signedTransactionId: "signed_1",
        attemptId: "attempt_race_b",
        rawTransaction: broadcastRawTransaction,
      },
    );
    await waitForDatabaseBlock("race-b-start");

    await releaseClient.query("COMMIT");
    releaseClient.release();
    await expect(broadcast).rejects.toThrow(/execution-valid.*reservation/i);
    await startPool.end();

    const state = await pool.query(
      `SELECT r.status, b.available, b.reserved, b.finalized_spend,
        (SELECT count(*)::int FROM broadcast_attempts WHERE reservation_id = r.reservation_id) attempts
       FROM budget_reservations r JOIN budget_accounts b USING (budget_id)
       WHERE r.reservation_id = 'res_1'`,
    );
    expect(state.rows[0]).toMatchObject({
      status: "RELEASED",
      available: "100",
      reserved: "0",
      finalized_spend: "0",
      attempts: 0,
    });
    expect(sends).toBe(0);
  }, 15_000);

  test("prevents real-store STARTED when expiry commits first", async () => {
    await broadcastStartFixture();
    const expiryClient = await pool.connect();
    await expiryClient.query("BEGIN");
    await expiryClient.query(
      "SELECT 1 FROM budget_reservations WHERE reservation_id = 'res_1' FOR UPDATE",
    );
    await expiryClient.query(
      "UPDATE budget_accounts SET available = 100, reserved = 0 WHERE budget_id = 'budget_1'",
    );
    await expiryClient.query(
      "UPDATE budget_reservations SET status = 'EXPIRED' WHERE reservation_id = 'res_1'",
    );
    const startPool = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: runtime.postgres.database,
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 1,
      application_name: "race-expiry-start",
    });
    const start = createBroadcastStore(startPool).startBroadcastAttempt(
      {
        signedTransactionId: "signed_1",
        operationId: "op_1",
        reservationId: "res_1",
        envelopeId: "env_op_1_1",
        envelopeRevision: 1,
        envelopeHash: String(
          (
            await pool.query(
              "SELECT envelope_hash FROM signed_transactions WHERE signed_transaction_id = 'signed_1'",
            )
          ).rows[0]?.envelope_hash,
        ),
        authorizationId: "approval_1:authorization",
        fixtureInstanceId: fixtureId,
        expectedTransactionHash: broadcastHash,
      },
      "attempt_expiry_race",
    );
    await waitForDatabaseBlock("race-expiry-start");

    await expiryClient.query("COMMIT");
    expiryClient.release();
    await expect(start).rejects.toThrow(/execution-valid.*reservation/i);
    await startPool.end();

    const state = await pool.query(
      `SELECT status,
        (SELECT count(*)::int FROM broadcast_attempts WHERE reservation_id = 'res_1') attempts
       FROM budget_reservations WHERE reservation_id = 'res_1'`,
    );
    expect(state.rows[0]).toMatchObject({ status: "EXPIRED", attempts: 0 });
  }, 15_000);

  test("keeps repeated real-store STARTED creation idempotent", async () => {
    await broadcastStartFixture();
    const signed =
      await createBroadcastStore(pool).findSignedTransaction("signed_1");
    if (!signed) throw new Error("missing signed transaction fixture");
    const store = createBroadcastStore(pool);

    const first = await store.startBroadcastAttempt(signed, "attempt_repeat");
    const repeated = await store.startBroadcastAttempt(
      signed,
      "attempt_repeat_other_id",
    );

    expect(first.status).toBe("STARTED");
    expect(repeated.attemptId).toBe(first.attemptId);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int count FROM broadcast_attempts WHERE reservation_id = 'res_1'",
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

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

  test("enforces signed hash uniqueness and signed-row immutability", async () => {
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
          hash,
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
      effects: 0,
    });
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

  test("a durable send-capable attempt fences direct and FAILED recovery release", async () => {
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
