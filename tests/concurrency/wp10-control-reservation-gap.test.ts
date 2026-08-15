import { createHash } from "node:crypto";
import { join } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
  changeControlFence,
  type ApprovalAuditContext,
} from "@crip/approvals";
import { applyMigrations, reserveBudget } from "@crip/budget-ledger";
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
const decisionHash = `0x${"7".repeat(64)}`;

const audit = (
  operationId: string,
  suffix: string,
): ApprovalAuditContext => ({
  eventId: `evt:${operationId}:${suffix}`,
  actorType: "owner",
  actorId: "owner_1",
  traceId: createHash("md5").update(`${operationId}:${suffix}`).digest("hex"),
});

const reset = async (): Promise<void> => {
  await pool.query(
    `TRUNCATE authorization_invalidations, authorization_evidence,
      approval_decisions, approval_requests, audit_events, idempotency_records,
      budget_reservations, budget_accounts, operations, intents,
      policy_decisions, execution_envelopes, policy_versions, policies,
      wallets, agents, owners, control_fences CASCADE`,
  );
  await pool.query(
    `INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'WP10 owner');
     INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'WP10 agent');
     INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'WP10 wallet');
     INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status)
       VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
     INSERT INTO control_fences (scope_type, scope_id, state) VALUES
       ('SYSTEM', 'system', 'ACTIVE'), ('OWNER', 'owner_1', 'ACTIVE'),
       ('AGENT', 'agent_1', 'ACTIVE'), ('POLICY', 'policy_1', 'ACTIVE');
     INSERT INTO policy_versions (policy_id, version, document, document_hash)
       VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:${"0".repeat(64)}');
     INSERT INTO budget_accounts
       (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address,
        allocated, available, reserved, finalized_spend)
       VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '${asset}', 100, 100, 0, 0);`,
  );
};

const reserveWithoutEnvelope = async (
  operationId: string,
): Promise<{ reservationId: string }> => {
  const intentId = `intent_${operationId}`;
  const reservationId = `reservation_${operationId}`;
  await pool.query(
    `INSERT INTO intents
      (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, $3::jsonb, $4)`,
    [
      intentId,
      `intent-key-${operationId}`,
      JSON.stringify({ operationId }),
      `sha256:${createHash("sha256").update(operationId).digest("hex")}`,
    ],
  );
  await pool.query(
    `INSERT INTO operations
      (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED')`,
    [operationId, intentId],
  );
  await pool.query(
    `INSERT INTO policy_decisions
      (decision_id, operation_id, policy_id, policy_version, decision, decision_hash, payload)
     VALUES ($1, $2, 'policy_1', 1, 'REQUIRE_APPROVAL', $3, '{"decision":"REQUIRE_APPROVAL"}'::jsonb)`,
    [`decision_${operationId}`, operationId, decisionHash],
  );
  await reserveBudget(pool, {
    reservationId,
    budgetId: "budget_1",
    operationId,
    idempotencyKey: `reserve-key-${operationId}`,
    idempotencyPayload: { operationId, amount: "10" },
    amountAtomic: "10",
    expiresAt: "2099-01-01T00:00:00.000Z",
    audit: audit(operationId, "reserve"),
  });
  return { reservationId };
};

const lifecycle = async (operationId: string) =>
  (
    await pool.query(
      `SELECT o.current_state, r.status AS reservation_status,
              b.allocated::text, b.available::text, b.reserved::text,
              b.finalized_spend::text,
              (SELECT count(*)::int FROM execution_envelopes e WHERE e.operation_id = o.operation_id) AS envelope_count,
              (SELECT count(*)::int FROM approval_requests a WHERE a.operation_id = o.operation_id) AS approval_count
       FROM operations o
       JOIN budget_reservations r ON r.operation_id = o.operation_id
       JOIN budget_accounts b ON b.budget_id = r.budget_id
       WHERE o.operation_id = $1`,
      [operationId],
    )
  ).rows[0];

const expectInvariant = (row: {
  allocated: string;
  available: string;
  reserved: string;
  finalized_spend: string;
}): void => {
  expect(BigInt(row.allocated)).toBe(
    BigInt(row.available) + BigInt(row.reserved) + BigInt(row.finalized_spend),
  );
};

describe.sequential("WP-10 pre-envelope reservation control invalidation", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(reset);
  afterAll(async () => pool.end());

  test("reserve then revoke releases the actual post-reservation state without an envelope", async () => {
    const operationId = "op_wp10_revoke";
    await reserveWithoutEnvelope(operationId);

    const before = await lifecycle(operationId);
    expect(before).toMatchObject({
      current_state: "POLICY_FINALIZED",
      reservation_status: "HELD",
      available: "90",
      reserved: "10",
      envelope_count: 0,
      approval_count: 0,
    });
    expectInvariant(before);

    await changeControlFence(pool, {
      scopeType: "AGENT",
      scopeId: "agent_1",
      command: "REVOKE",
      audit: audit(operationId, "agent-revoke"),
    });

    const after = await lifecycle(operationId);
    expect(after).toMatchObject({
      current_state: "REVOKED",
      reservation_status: "RELEASED",
      allocated: "100",
      available: "100",
      reserved: "0",
      finalized_spend: "0",
      envelope_count: 0,
      approval_count: 0,
    });
    expectInvariant(after);

    await expect(
      reserveBudget(pool, {
        reservationId: `reservation_${operationId}_retry`,
        budgetId: "budget_1",
        operationId,
        idempotencyKey: `reserve-key-${operationId}-retry`,
        idempotencyPayload: { operationId, amount: "10", retry: true },
        amountAtomic: "10",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: audit(operationId, "reserve-after-revoke"),
      }),
    ).rejects.toMatchObject({ code: "CONTROL_FENCE_INACTIVE" });
  });

  test("reserve then pause releases canonical BUDGET_RESERVED state and requires revalidation", async () => {
    const operationId = "op_wp10_pause";
    await reserveWithoutEnvelope(operationId);
    await pool.query(
      `UPDATE operations
       SET current_state = 'BUDGET_RESERVED', version = version + 1, updated_at = now()
       WHERE operation_id = $1`,
      [operationId],
    );

    const before = await lifecycle(operationId);
    expect(before).toMatchObject({
      current_state: "BUDGET_RESERVED",
      reservation_status: "HELD",
      available: "90",
      reserved: "10",
      envelope_count: 0,
      approval_count: 0,
    });
    expectInvariant(before);

    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit(operationId, "system-pause"),
    });

    const paused = await lifecycle(operationId);
    expect(paused).toMatchObject({
      current_state: "REVALIDATION_REQUIRED",
      reservation_status: "RELEASED",
      allocated: "100",
      available: "100",
      reserved: "0",
      finalized_spend: "0",
      envelope_count: 0,
      approval_count: 0,
    });
    expectInvariant(paused);

    await expect(
      reserveBudget(pool, {
        reservationId: `reservation_${operationId}_while_paused`,
        budgetId: "budget_1",
        operationId,
        idempotencyKey: `reserve-key-${operationId}-while-paused`,
        idempotencyPayload: { operationId, amount: "10", paused: true },
        amountAtomic: "10",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: audit(operationId, "reserve-while-paused"),
      }),
    ).rejects.toMatchObject({ code: "CONTROL_FENCE_INACTIVE" });

    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "RESUME",
      audit: audit(operationId, "system-resume"),
    });

    const resumed = await lifecycle(operationId);
    expect(resumed).toMatchObject({
      current_state: "REVALIDATION_REQUIRED",
      reservation_status: "RELEASED",
      allocated: "100",
      available: "100",
      reserved: "0",
      finalized_spend: "0",
    });
    expectInvariant(resumed);
  });
});
