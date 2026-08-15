import { createHash } from "node:crypto";
import { join } from "node:path";

import { Pool, type PoolClient } from "pg";
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
  changeControlFence,
  consumeApproval,
  createApprovalRequest,
  revalidateAuthorization,
  type ApprovalAuditContext,
  type ControlScopeType,
} from "@crip/approvals";
import {
  applyMigrations,
  reserveBudget,
  withSerializableTransaction,
} from "@crip/budget-ledger";
import { attachEnvelopeHash } from "@crip/schemas";
import { loadLocalRuntime } from "../../tooling/local-runtime.mjs";
import { createLocalOwnerTestCredential } from "../db/local-owner-auth.js";

const root = join(import.meta.dirname, "../..");
const runtime = loadLocalRuntime({ root });
const pool = new Pool({
  host: runtime.postgres.host,
  port: runtime.postgres.port,
  database: runtime.postgres.database,
  user: runtime.postgres.user,
  password: runtime.postgres.password,
  max: 12,
});
const asset = "0x0000000000000000000000000000000000000001";
const hash = `0x${"7".repeat(64)}`;
const ownerCredential = createLocalOwnerTestCredential(
  "owner_1",
  "owner_1_fence_key",
);

const audit = (
  operationId: string,
  suffix: string,
  actorType: ApprovalAuditContext["actorType"] = "system",
): ApprovalAuditContext => ({
  eventId: `evt:${operationId}:${suffix}`,
  actorType,
  actorId: actorType === "owner" ? "owner_1" : "fence-test",
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
    `INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'Fence owner');
     INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'Fence agent');
     INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'Fence wallet');
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
  await pool.query(
    `INSERT INTO local_owner_approval_keys
      (key_id, owner_id, algorithm, public_key)
     VALUES ($1, $2, 'ED25519', $3)`,
    [
      ownerCredential.keyId,
      ownerCredential.ownerId,
      ownerCredential.publicKeyPem,
    ],
  );
};

const insertApproval = async (
  operationId: string,
  approvalId = `approval_${operationId}`,
  createApproval = true,
  createReservation = true,
  approvalExpiresAt = "2099-01-01T10:05:00Z",
  approvalNow = "2099-01-01T10:01:00Z",
): Promise<{
  operationId: string;
  approvalId: string;
  envelopeHash: string;
  authorizationId: string | null;
  reservationId: string;
  envelopeId: string;
  decisionId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}> => {
  const intentId = `intent_${operationId}`;
  const reservationId = `reservation_${operationId}`;
  const decisionId = `decision_${operationId}`;
  const envelopeId = `envelope_${operationId}`;
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
  if (createReservation)
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
  await pool.query(
    `INSERT INTO policy_decisions
      (decision_id, operation_id, policy_id, policy_version, decision, decision_hash, payload)
     VALUES ($1, $2, 'policy_1', 1, 'REQUIRE_APPROVAL', $3, '{"decision":"REQUIRE_APPROVAL"}'::jsonb)`,
    [decisionId, operationId, hash],
  );
  const envelope = attachEnvelopeHash({
    schemaVersion: "1.0",
    envelopeHash: hash,
    envelopeId,
    revision: 1,
    intentId,
    intentHash: `sha256:${"1".repeat(64)}`,
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
    simulationResultHash: hash,
    nonceStrategy: "pending",
    gasLimit: "21000",
    maximumFeeConstraints: {
      asset: "native",
      maxFeePerGas: "1",
      maximumNetworkFeeAtomic: "21000",
    },
    policyId: "policy_1",
    policyVersion: 1,
    policyDecisionHash: hash,
    budgetReservationId: reservationId,
    createdAt: "2020-01-01T10:00:00Z",
    expiresAt: "2099-01-01T10:10:00Z",
    riskDecision: "REVIEW",
    approvalRequirement: "owner",
  });
  await pool.query(
    `INSERT INTO execution_envelopes
      (envelope_id, operation_id, revision, envelope_hash, payload)
     VALUES ($1, $2, 1, $3, $4::jsonb)`,
    [envelopeId, operationId, envelope.envelopeHash, JSON.stringify(envelope)],
  );
  await pool.query(
    `UPDATE operations SET current_state = 'ENVELOPE_FINALIZED', version = version + 1
     WHERE operation_id = $1`,
    [operationId],
  );
  if (createApproval) {
    const approvalNonce = `nonce_${operationId}`;
    await createApprovalRequest(pool, {
      approvalId,
      operationId,
      reservationId,
      envelopeId,
      envelopeRevision: 1,
      envelopeHash: envelope.envelopeHash,
      policyDecisionId: decisionId,
      issuedAt: "2020-01-01T10:00:00Z",
      expiresAt: approvalExpiresAt,
      nonce: approvalNonce,
      audit: audit(operationId, "requested"),
    });
    await approveApproval(pool, {
      approvalId,
      authentication: ownerCredential.authenticate({
        approvalId,
        envelopeHash: envelope.envelopeHash,
        policyId: "policy_1",
        policyVersion: 1,
        expiresAt: approvalExpiresAt,
        nonce: approvalNonce,
      }),
      now: approvalNow,
      audit: audit(operationId, "approved", "owner"),
    });
  }
  return {
    operationId,
    approvalId,
    envelopeHash: envelope.envelopeHash,
    authorizationId: null,
    reservationId,
    envelopeId,
    decisionId,
    issuedAt: "2020-01-01T10:00:00Z",
    expiresAt: approvalExpiresAt,
    nonce: `nonce_${operationId}`,
  };
};

const consume = async (
  fixture: Awaited<ReturnType<typeof insertApproval>>,
  suffix = "consume",
  now = "2099-01-01T10:02:00Z",
) =>
  consumeApproval(pool, {
    approvalId: fixture.approvalId,
    operationId: fixture.operationId,
    envelopeId: `envelope_${fixture.operationId}`,
    envelopeRevision: 1,
    envelopeHash: fixture.envelopeHash,
    consumerId: `consumer-${suffix}`,
    now,
    audit: audit(fixture.operationId, suffix),
  });

const control = (
  scopeType: ControlScopeType,
  scopeId: string,
  command: "PAUSE" | "RESUME" | "REVOKE",
  operationId: string,
) =>
  changeControlFence(pool, {
    scopeType,
    scopeId,
    command,
    audit: audit(
      operationId,
      `${scopeType.toLowerCase()}-${command.toLowerCase()}`,
      "owner",
    ),
  });

const state = async (operationId: string) =>
  (
    await pool.query(
      `SELECT o.current_state, r.status AS reservation_status, a.status AS approval_status,
            b.allocated::text, b.available::text, b.reserved::text, b.finalized_spend::text
     FROM operations o
     JOIN budget_reservations r ON r.operation_id = o.operation_id
     LEFT JOIN approval_requests a ON a.operation_id = o.operation_id
     JOIN budget_accounts b ON b.budget_id = r.budget_id
     WHERE o.operation_id = $1`,
      [operationId],
    )
  ).rows[0];

const race = async (
  fixture: Awaited<ReturnType<typeof insertApproval>>,
  scopeType: "AGENT" | "SYSTEM",
): Promise<PromiseSettledResult<unknown>[]> => {
  const blocker: PoolClient = await pool.connect();
  await blocker.query("BEGIN");
  await blocker.query(
    `SELECT 1 FROM control_fences WHERE scope_type = $1 AND scope_id = $2 FOR UPDATE`,
    [scopeType, scopeType === "SYSTEM" ? "system" : "agent_1"],
  );
  let ready = 0;
  let releaseReady!: () => void;
  const allReady = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });
  const markReady = async () => {
    ready += 1;
    if (ready === 2) releaseReady();
    await allReady;
  };
  const consumer = (async () => {
    await markReady();
    return consume(fixture, "racing-consumer");
  })();
  const changer = (async () => {
    await markReady();
    return control(
      scopeType,
      scopeType === "SYSTEM" ? "system" : "agent_1",
      scopeType === "SYSTEM" ? "PAUSE" : "REVOKE",
      fixture.operationId,
    );
  })();
  await allReady;
  await blocker.query("COMMIT");
  blocker.release();
  const results = await Promise.allSettled([consumer, changer]);
  return results;
};

const assertRaceOutcome = async (
  operationId: string,
  results: PromiseSettledResult<unknown>[],
): Promise<void> => {
  expect(results[1]?.status).toBe("fulfilled");
  const consumer = results[0];
  const counts = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM authorization_evidence WHERE operation_id = $1) AS evidence_count,
       (SELECT count(*)::int FROM authorization_invalidations WHERE operation_id = $1) AS invalidation_count`,
    [operationId],
  );
  if (consumer?.status === "fulfilled") {
    expect(counts.rows[0]).toEqual({
      evidence_count: 1,
      invalidation_count: 1,
    });
  } else {
    expect(consumer?.status).toBe("rejected");
    expect((consumer as PromiseRejectedResult).reason).toMatchObject({
      code: expect.stringMatching(/APPROVAL_REVOKED|REVALIDATION_REQUIRED/),
    });
    expect(counts.rows[0]).toEqual({
      evidence_count: 0,
      invalidation_count: 0,
    });
  }
};

describe.sequential("WP-04 revocation and pause control fences", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(reset);
  afterAll(async () => pool.end());

  test("revoke before authorization creation invalidates the held operation", async () => {
    const fixture = await insertApproval(
      "op_revoke_before_creation",
      undefined,
      false,
    );
    await control("AGENT", "agent_1", "REVOKE", fixture.operationId);
    await expect(
      createApprovalRequest(pool, {
        approvalId: fixture.approvalId,
        operationId: fixture.operationId,
        reservationId: fixture.reservationId,
        envelopeId: fixture.envelopeId,
        envelopeRevision: 1,
        envelopeHash: fixture.envelopeHash,
        policyDecisionId: fixture.decisionId,
        issuedAt: fixture.issuedAt,
        expiresAt: fixture.expiresAt,
        nonce: fixture.nonce,
        audit: audit(fixture.operationId, "late-request"),
      }),
    ).rejects.toMatchObject({ code: "REVALIDATION_REQUIRED" });
    expect(await state(fixture.operationId)).toMatchObject({
      current_state: "REVOKED",
      reservation_status: "RELEASED",
      allocated: "100",
      available: "100",
      reserved: "0",
      finalized_spend: "0",
    });
  });

  test("pause before reservation prevents a later reservation from leaking funds", async () => {
    const operationId = "op_pause_before_reservation";
    await pool.query(
      `INSERT INTO intents
        (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
       VALUES ('intent_pause_before_reservation', 'intent-key-pause-before-reservation', 'agent_1', 'wallet_1', 'policy_1', 1, $1::jsonb, $2)`,
      [
        JSON.stringify({ operationId }),
        `sha256:${createHash("sha256").update(operationId).digest("hex")}`,
      ],
    );
    await pool.query(
      `INSERT INTO operations
        (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
       VALUES ($1, 'intent_pause_before_reservation', 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED')`,
      [operationId],
    );
    await control("SYSTEM", "system", "PAUSE", operationId);
    await expect(
      reserveBudget(pool, {
        reservationId: "reservation_pause_before_reservation",
        budgetId: "budget_1",
        operationId,
        idempotencyKey: `reserve-key-${operationId}`,
        idempotencyPayload: { operationId, amount: "10" },
        amountAtomic: "10",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: audit(operationId, "late-reserve"),
      }),
    ).rejects.toMatchObject({ code: "CONTROL_FENCE_INACTIVE" });
    await expect(
      pool.query(
        "SELECT allocated::text, available::text, reserved::text, finalized_spend::text FROM budget_accounts WHERE budget_id = 'budget_1'",
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          allocated: "100",
          available: "100",
          reserved: "0",
          finalized_spend: "0",
        },
      ],
    });
  });

  test("revoke before authorization fails closed and releases the held reservation", async () => {
    const fixture = await insertApproval("op_revoke_before");
    await control("AGENT", "agent_1", "REVOKE", fixture.operationId);
    await expect(consume(fixture)).rejects.toMatchObject({
      code: "APPROVAL_REVOKED",
    });
    expect(await state(fixture.operationId)).toMatchObject({
      current_state: "REVOKED",
      reservation_status: "RELEASED",
      approval_status: "REVOKED",
      allocated: "100",
      available: "100",
      reserved: "0",
      finalized_spend: "0",
    });
  });

  test("revoke immediately after authorization invalidates the pre-sign fence", async () => {
    const fixture = await insertApproval("op_revoke_after");
    const evidence = await consume(fixture);
    await control("AGENT", "agent_1", "REVOKE", fixture.operationId);
    await expect(
      revalidateAuthorization(pool, {
        operationId: fixture.operationId,
        authorizationId: evidence.authorizationId,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REVALIDATION_REQUIRED" });
    expect(await state(fixture.operationId)).toMatchObject({
      current_state: "REVOKED",
      reservation_status: "RELEASED",
    });
  });

  test("expired authorization evidence fails the pre-execution revalidation", async () => {
    const fixture = await insertApproval("op_expired_revalidation");
    const evidence = await consume(fixture, "expired-consumer");
    await pool.query(
      "ALTER TABLE authorization_evidence DISABLE TRIGGER authorization_evidence_is_immutable",
    );
    try {
      await pool.query(
        `UPDATE authorization_evidence
         SET issued_at = '2020-01-01T10:00:00Z', expires_at = '2020-01-01T10:05:00Z',
             authorized_at = '2020-01-01T10:01:00Z', consumed_at = '2020-01-01T10:02:00Z'
         WHERE authorization_id = $1`,
        [evidence.authorizationId],
      );
    } finally {
      await pool.query(
        "ALTER TABLE authorization_evidence ENABLE TRIGGER authorization_evidence_is_immutable",
      );
    }
    await expect(
      revalidateAuthorization(pool, {
        operationId: fixture.operationId,
        authorizationId: evidence.authorizationId,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REVALIDATION_REQUIRED" });
  });

  test("pause before authorization fails closed", async () => {
    const fixture = await insertApproval("op_pause_before");
    await control("SYSTEM", "system", "PAUSE", fixture.operationId);
    await expect(consume(fixture)).rejects.toMatchObject({
      code: "APPROVAL_REVOKED",
    });
    expect(await state(fixture.operationId)).toMatchObject({
      current_state: "REVALIDATION_REQUIRED",
      reservation_status: "RELEASED",
    });
  });

  test("pause after authorization and resume do not resurrect a stale approval", async () => {
    const fixture = await insertApproval("op_pause_resume");
    const evidence = await consume(fixture);
    const paused = await control(
      "SYSTEM",
      "system",
      "PAUSE",
      fixture.operationId,
    );
    const resumed = await control(
      "SYSTEM",
      "system",
      "RESUME",
      fixture.operationId,
    );
    expect(resumed.fenceVersion).toBe(paused.fenceVersion + 1);
    await expect(
      revalidateAuthorization(pool, {
        operationId: fixture.operationId,
        authorizationId: evidence.authorizationId,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REVALIDATION_REQUIRED" });
    expect(await state(fixture.operationId)).toMatchObject({
      current_state: "REVALIDATION_REQUIRED",
      reservation_status: "RELEASED",
    });
  });

  test("repeated revoke and pause commands are idempotent", async () => {
    const fixture = await insertApproval("op_repeated");
    const firstRevoke = await control(
      "AGENT",
      "agent_1",
      "REVOKE",
      fixture.operationId,
    );
    const secondRevoke = await control(
      "AGENT",
      "agent_1",
      "REVOKE",
      fixture.operationId,
    );
    const firstPause = await control(
      "SYSTEM",
      "system",
      "PAUSE",
      fixture.operationId,
    );
    const secondPause = await control(
      "SYSTEM",
      "system",
      "PAUSE",
      fixture.operationId,
    );
    expect(firstRevoke.changed).toBe(true);
    expect(secondRevoke).toMatchObject({
      changed: false,
      fenceVersion: firstRevoke.fenceVersion,
    });
    expect(firstPause.changed).toBe(true);
    expect(secondPause).toMatchObject({
      changed: false,
      fenceVersion: firstPause.fenceVersion,
    });
  });

  test("owner, agent, and policy revocation are independent authoritative fences", async () => {
    const ownerFixture = await insertApproval("op_owner_fence");
    await control("OWNER", "owner_1", "REVOKE", ownerFixture.operationId);
    await expect(consume(ownerFixture)).rejects.toMatchObject({
      code: "APPROVAL_REVOKED",
    });
    await reset();
    const agentFixture = await insertApproval("op_agent_fence");
    await control("AGENT", "agent_1", "REVOKE", agentFixture.operationId);
    await expect(consume(agentFixture)).rejects.toMatchObject({
      code: "APPROVAL_REVOKED",
    });
    await reset();
    const policyFixture = await insertApproval("op_policy_fence");
    await control("POLICY", "policy_1", "REVOKE", policyFixture.operationId);
    await expect(consume(policyFixture)).rejects.toMatchObject({
      code: "APPROVAL_REVOKED",
    });
    await expect(
      pool.query("SELECT status FROM policies WHERE policy_id = 'policy_1'"),
    ).resolves.toMatchObject({ rows: [{ status: "revoked" }] });
  });

  test("concurrent revoke and consume linearize safely behind the fence lock", async () => {
    const fixture = await insertApproval("op_revoke_race");
    const results = await race(fixture, "AGENT");
    await assertRaceOutcome(fixture.operationId, results);
    expect(await state(fixture.operationId)).toMatchObject({
      current_state: "REVOKED",
      reservation_status: "RELEASED",
      allocated: "100",
      available: "100",
      reserved: "0",
      finalized_spend: "0",
    });
  });

  test("concurrent pause and consume linearize safely behind the system fence lock", async () => {
    const fixture = await insertApproval("op_pause_race");
    const results = await race(fixture, "SYSTEM");
    await assertRaceOutcome(fixture.operationId, results);
    expect(await state(fixture.operationId)).toMatchObject({
      current_state: "REVALIDATION_REQUIRED",
      reservation_status: "RELEASED",
      allocated: "100",
      available: "100",
      reserved: "0",
      finalized_spend: "0",
    });
  });

  test("transaction rollback leaves the authoritative fence and audit unchanged", async () => {
    const before = await pool.query(
      "SELECT fence_version, state FROM control_fences WHERE scope_type = 'SYSTEM' AND scope_id = 'system'",
    );
    await expect(
      withSerializableTransaction(pool, async (client) => {
        await client.query(
          "UPDATE control_fences SET fence_version = fence_version + 1, state = 'PAUSED' WHERE scope_type = 'SYSTEM' AND scope_id = 'system'",
        );
        throw new Error("synthetic control transaction failure");
      }),
    ).rejects.toThrow("synthetic control transaction failure");
    await expect(
      pool.query(
        "SELECT fence_version, state FROM control_fences WHERE scope_type = 'SYSTEM' AND scope_id = 'system'",
      ),
    ).resolves.toMatchObject({ rows: before.rows });
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE event_type = 'system.paused'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  test("control mutation rollback removes fence, invalidation, release, and audit side effects", async () => {
    const fixture = await insertApproval("op_control_rollback");
    await consume(fixture);
    const before = await pool.query(
      "SELECT fence_version, state FROM control_fences WHERE scope_type = 'AGENT' AND scope_id = 'agent_1'",
    );
    await pool.query(`
      CREATE OR REPLACE FUNCTION public.wp04_fail_control_invalidation() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic control invalidation failure'; END; $$;
      CREATE TRIGGER wp04_fail_control_invalidation
      BEFORE INSERT ON authorization_invalidations
      FOR EACH ROW EXECUTE FUNCTION public.wp04_fail_control_invalidation();
    `);
    try {
      await expect(
        control("AGENT", "agent_1", "REVOKE", fixture.operationId),
      ).rejects.toThrow("synthetic control invalidation failure");
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS wp04_fail_control_invalidation ON authorization_invalidations;
        DROP FUNCTION IF EXISTS public.wp04_fail_control_invalidation();
      `);
    }
    await expect(
      pool.query(
        "SELECT fence_version, state FROM control_fences WHERE scope_type = 'AGENT' AND scope_id = 'agent_1'",
      ),
    ).resolves.toMatchObject({ rows: before.rows });
    expect(await state(fixture.operationId)).toMatchObject({
      current_state: "AUTHORIZED",
      reservation_status: "AUTHORIZED",
      available: "90",
      reserved: "10",
    });
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM authorization_invalidations WHERE operation_id = $1",
        [fixture.operationId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE event_type = 'agent.revoked'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  test("control audit and operation audit preserve ordering and correlation", async () => {
    const fixture = await insertApproval("op_audit_fence");
    await control("AGENT", "agent_1", "REVOKE", fixture.operationId);
    await expect(
      pool.query(
        `INSERT INTO audit_events
          (event_id, event_type, sequence_no, actor_type, actor_id,
           owner_id, agent_id, wallet_id, intent_id, operation_id, policy_id,
           policy_version, trace_id, data, previous_event_hash, event_hash,
           canonical_payload, reservation_id)
         VALUES ('evt:forged-control', 'agent.revoked', 999, 'system', 'fence-test',
                 NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                 '${"a".repeat(32)}', '{"scopeType":"AGENT","scopeId":"agent_1","fenceVersion":999,"controlState":"REVOKED"}'::jsonb,
                 NULL, '0x${"0".repeat(64)}', '{}', NULL)`,
      ),
    ).rejects.toThrow("control audit event does not match authoritative fence");
    const controlEvents = await pool.query(
      "SELECT event_id, sequence_no, trace_id, data FROM audit_events WHERE operation_id IS NULL AND event_type = 'agent.revoked'",
    );
    const operationEvents = await pool.query(
      "SELECT event_type, sequence_no, trace_id, data FROM audit_events WHERE operation_id = $1 ORDER BY sequence_no",
      [fixture.operationId],
    );
    expect(controlEvents.rows).toHaveLength(1);
    expect(operationEvents.rows.map((row) => row.event_type)).toEqual([
      "budget.reservation.created",
      "approval.requested",
      "approval.approved",
      "budget.reservation.released",
      "approval.revoked",
      "operation.state.changed",
    ]);
    expect(operationEvents.rows.at(-1)?.data).toMatchObject({
      scopeType: "AGENT",
      scopeId: "agent_1",
      fenceVersion: 2,
      controlState: "REVOKED",
    });
    const fencedEvents = operationEvents.rows.filter(
      (row) => row.data.scopeType !== undefined,
    );
    expect(
      fencedEvents.every(
        (row) => row.trace_id === controlEvents.rows[0]?.trace_id,
      ),
    ).toBe(true);
    expect(Number(operationEvents.rows.at(-1)?.sequence_no)).toBeGreaterThan(
      Number(operationEvents.rows.at(-2)?.sequence_no),
    );
  });
});
