import { createHash } from "node:crypto";
import { join } from "node:path";

import { Pool } from "pg";
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
  type ApprovalAuditContext,
} from "@crip/approvals";
import { applyMigrations, reserveBudget } from "@crip/budget-ledger";
import { attachEnvelopeHash } from "@crip/schemas";
import { loadLocalRuntime } from "../../tooling/local-runtime.mjs";

const root = join(import.meta.dirname, "../..");
const runtime = loadLocalRuntime({ root });
const pool = new Pool({
  host: runtime.postgres.host,
  port: runtime.postgres.port,
  database: runtime.postgres.database,
  user: runtime.postgres.user,
  password: runtime.postgres.password,
  max: 8,
});
const asset = "0x0000000000000000000000000000000000000001";
const decisionHash = `0x${"4".repeat(64)}`;

const audit = (
  operationId: string,
  suffix: string,
  owner = false,
): ApprovalAuditContext => ({
  eventId: `evt:${operationId}:${suffix}`,
  actorType: owner ? "owner" : "system",
  actorId: owner ? "owner_1" : "concurrency-test",
  traceId: createHash("md5").update(`${operationId}:${suffix}`).digest("hex"),
});

const seed = async () => {
  await pool.query(`
    INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'Concurrency owner');
    INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'Concurrency agent');
    INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'Concurrency wallet');
    INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
    INSERT INTO policy_versions (policy_id, version, document, document_hash) VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:0000000000000000000000000000000000000000000000000000000000000000');
    INSERT INTO control_fences (scope_type, scope_id, state) VALUES
      ('SYSTEM', 'system', 'ACTIVE'), ('OWNER', 'owner_1', 'ACTIVE'),
      ('AGENT', 'agent_1', 'ACTIVE'), ('POLICY', 'policy_1', 'ACTIVE');
    INSERT INTO budget_accounts (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address, allocated, available, reserved, finalized_spend)
      VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '${asset}', 100, 100, 0, 0);
    INSERT INTO intents (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
      VALUES ('intent_race', 'intent-key-race', 'agent_1', 'wallet_1', 'policy_1', 1, '{"operationId":"op_race"}', 'sha256:${"5".repeat(64)}');
    INSERT INTO operations (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
      VALUES ('op_race', 'intent_race', 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED');
  `);
  await reserveBudget(pool, {
    reservationId: "res_race",
    budgetId: "budget_1",
    operationId: "op_race",
    idempotencyKey: "reserve-key-race",
    idempotencyPayload: { operationId: "op_race", amount: "10" },
    amountAtomic: "10",
    expiresAt: "2099-01-01T00:00:00.000Z",
    audit: {
      eventId: "evt:op_race:reserve",
      actorType: "system",
      actorId: "concurrency-test",
      traceId: createHash("md5").update("reserve-race").digest("hex"),
    },
  });
  await pool.query(
    `INSERT INTO policy_decisions (decision_id, operation_id, policy_id, policy_version, decision, decision_hash, payload)
     VALUES ('decision_race', 'op_race', 'policy_1', 1, 'REQUIRE_APPROVAL', $1, '{"decision":"REQUIRE_APPROVAL"}'::jsonb)`,
    [decisionHash],
  );
  const envelope = attachEnvelopeHash({
    schemaVersion: "1.0",
    envelopeHash: decisionHash,
    envelopeId: "env_race_1",
    revision: 1,
    intentId: "intent_race",
    intentHash: `sha256:${"6".repeat(64)}`,
    agentId: "agent_1",
    walletId: "wallet_1",
    adapterId: "local-anvil",
    adapterVersion: "0.1.0",
    chainId: "eip155:31337",
    from: "0x0000000000000000000000000000000000000010",
    to: asset,
    value: "0",
    calldata: "0xa9059cbb",
    decodedFunction: "erc20.transfer",
    decodedArguments: {
      assetAddress: asset,
      recipient: "0x0000000000000000000000000000000000000020",
      amountAtomic: "10",
    },
    expectedAssetDeltas: [
      {
        assetAddress: asset,
        from: "0x0000000000000000000000000000000000000010",
        to: "0x0000000000000000000000000000000000000020",
        amountAtomic: "10",
      },
    ],
    simulationBlockReference: "100",
    simulationResultHash: decisionHash,
    nonceStrategy: "pending",
    gasLimit: "21000",
    maximumFeeConstraints: {
      asset: "native",
      maxFeePerGas: "1",
      maximumNetworkFeeAtomic: "21000",
    },
    policyId: "policy_1",
    policyVersion: 1,
    policyDecisionHash: decisionHash,
    budgetReservationId: "res_race",
    createdAt: "2020-01-01T10:00:00Z",
    expiresAt: "2099-01-01T10:10:00Z",
    riskDecision: "REVIEW",
    approvalRequirement: "owner",
  });
  await pool.query(
    `INSERT INTO execution_envelopes (envelope_id, operation_id, revision, envelope_hash, payload)
     VALUES ('env_race_1', 'op_race', 1, $1, $2::jsonb)`,
    [envelope.envelopeHash, JSON.stringify(envelope)],
  );
  await pool.query(
    "UPDATE operations SET current_state = 'ENVELOPE_FINALIZED' WHERE operation_id = 'op_race'",
  );
  await createApprovalRequest(pool, {
    approvalId: "approval_race",
    operationId: "op_race",
    reservationId: "res_race",
    envelopeId: "env_race_1",
    envelopeRevision: 1,
    envelopeHash: envelope.envelopeHash,
    policyDecisionId: "decision_race",
    issuedAt: "2020-01-01T10:00:00Z",
    expiresAt: "2099-01-01T10:10:00Z",
    nonce: "nonce_race",
    audit: audit("op_race", "requested"),
  });
  await approveApproval(pool, {
    approvalId: "approval_race",
    approverId: "owner_1",
    now: "2099-01-01T10:01:00Z",
    audit: audit("op_race", "approved", true),
  });
  return envelope;
};

describe.sequential("WP-03 concurrent approval consumption", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE authorization_invalidations, authorization_evidence, approval_decisions, approval_requests, audit_events, idempotency_records, budget_reservations, budget_accounts, operations, intents, policy_decisions, execution_envelopes, policy_versions, policies, wallets, agents, owners, control_fences CASCADE",
    );
  });
  afterAll(async () => pool.end());

  test("two concurrent consumers cannot both consume one approval", async () => {
    const envelope = await seed();
    const attempts = await Promise.allSettled(
      ["a", "b"].map((suffix) =>
        consumeApproval(pool, {
          approvalId: "approval_race",
          operationId: "op_race",
          envelopeId: "env_race_1",
          envelopeRevision: 1,
          envelopeHash: envelope.envelopeHash,
          consumerId: `consumer-${suffix}`,
          now: "2099-01-01T10:02:00Z",
          audit: audit("op_race", `consume-${suffix}`),
        }),
      ),
    );
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "APPROVAL_REPLAYED" }),
    });
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM authorization_evidence WHERE approval_id = 'approval_race'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });
});
