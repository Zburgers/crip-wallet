import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
  authorizeAutonomous,
  changeControlFence,
  consumeApproval,
  createApprovalRequest,
  revalidateAuthorization,
  type AuthorizeAutonomousInput,
} from "@crip/approvals";
import {
  applyMigrations,
  reserveBudget,
  type AuditContext,
} from "@crip/budget-ledger";
import { attachEnvelopeHash } from "@crip/schemas";
import { loadLocalRuntime } from "../../tooling/local-runtime.mjs";
import { createLocalOwnerTestCredential } from "./local-owner-auth.js";

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

const hash = `0x${"1".repeat(64)}`;
const asset = "0x0000000000000000000000000000000000000001";
const ownerCredential = createLocalOwnerTestCredential(
  "owner_1",
  "owner_1_autonomous_authorization_key",
);

const audit = (operationId: string, suffix: string): AuditContext => ({
  eventId: `evt:${operationId}:${suffix}`,
  actorType: "system",
  actorId: "autonomous-authorization-test",
  traceId: createHash("md5").update(`${operationId}:${suffix}`).digest("hex"),
});

const reset = async (targetPool: Pool = pool): Promise<void> => {
  await targetPool.query(
    "TRUNCATE authorization_invalidations, authorization_evidence, approval_decisions, approval_requests, audit_events, idempotency_records, budget_reservations, budget_accounts, operations, intents, policy_decisions, execution_envelopes, policy_versions, policies, wallets, agents, owners, control_fences CASCADE",
  );
  await targetPool.query(`
    INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'Autonomous owner');
    INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'Autonomous agent');
    INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'Autonomous wallet');
    INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status)
      VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
    INSERT INTO policy_versions (policy_id, version, document, document_hash)
      VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:0000000000000000000000000000000000000000000000000000000000000000');
    INSERT INTO control_fences (scope_type, scope_id, state) VALUES
      ('SYSTEM', 'system', 'ACTIVE'), ('OWNER', 'owner_1', 'ACTIVE'),
      ('AGENT', 'agent_1', 'ACTIVE'), ('POLICY', 'policy_1', 'ACTIVE');
    INSERT INTO budget_accounts
      (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address,
       allocated, available, reserved, finalized_spend)
      VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '${asset}', 100, 100, 0, 0);
  `);
};

const waitForAdvisoryWaiters = async (minimum: number): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM pg_locks
       WHERE locktype = 'advisory' AND NOT granted`,
    );
    if (Number(result.rows[0]?.count ?? 0) >= minimum) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`advisory barrier did not observe ${minimum} waiters`);
};

const seed = async (
  input: {
    operationId?: string;
    decision?: "ALLOW_AUTONOMOUS" | "REQUIRE_APPROVAL" | "DENY";
    expiresAt?: string;
    policyVersion?: number;
  },
  targetPool: Pool = pool,
) => {
  const operationId = input.operationId ?? "op_auto";
  const policyVersion = input.policyVersion ?? 1;
  if (policyVersion !== 1) {
    await targetPool.query(
      `INSERT INTO policy_versions (policy_id, version, document, document_hash)
       VALUES ('policy_1', $1, '{"schemaVersion":"1.0"}', $2)`,
      [policyVersion, `sha256:${"2".repeat(64)}`],
    );
  }
  await targetPool.query(
    `INSERT INTO intents
      (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', $3, $4::jsonb, $5)`,
    [
      `intent_${operationId}`,
      `intent-key-${operationId}`,
      policyVersion,
      JSON.stringify({ operationId }),
      `sha256:${createHash("sha256").update(operationId).digest("hex")}`,
    ],
  );
  await targetPool.query(
    `INSERT INTO operations
      (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', $3, 'POLICY_FINALIZED')`,
    [operationId, `intent_${operationId}`, policyVersion],
  );
  const reservationId = `res_${operationId}`;
  await reserveBudget(targetPool, {
    reservationId,
    budgetId: "budget_1",
    operationId,
    idempotencyKey: `reserve-key-${operationId}`,
    idempotencyPayload: { operationId, amount: "10" },
    amountAtomic: "10",
    expiresAt: "2099-01-01T00:00:00.000Z",
    audit: audit(operationId, "reserve"),
  });
  const decision = input.decision ?? "ALLOW_AUTONOMOUS";
  const decisionId = `decision_${operationId}`;
  await targetPool.query(
    `INSERT INTO policy_decisions
      (decision_id, operation_id, policy_id, policy_version, decision, decision_hash, payload)
     VALUES ($1, $2, 'policy_1', $3, $4, $5, $6::jsonb)`,
    [
      decisionId,
      operationId,
      policyVersion,
      decision,
      hash,
      JSON.stringify({ decision, policyVersion }),
    ],
  );
  const envelope = attachEnvelopeHash({
    schemaVersion: "1.0",
    envelopeHash: hash,
    envelopeId: `env_${operationId}_1`,
    revision: 1,
    intentId: `intent_${operationId}`,
    intentHash: `sha256:${createHash("sha256").update(operationId).digest("hex")}`,
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
    policyVersion,
    policyDecisionHash: hash,
    budgetReservationId: reservationId,
    createdAt: "2020-01-01T10:00:00Z",
    expiresAt: input.expiresAt ?? "2099-01-01T10:10:00Z",
    riskDecision: decision === "ALLOW_AUTONOMOUS" ? "ALLOW" : "REVIEW",
    approvalRequirement: decision === "ALLOW_AUTONOMOUS" ? "none" : "owner",
  });
  await targetPool.query(
    `INSERT INTO execution_envelopes
      (envelope_id, operation_id, revision, envelope_hash, payload)
     VALUES ($1, $2, 1, $3, $4::jsonb)`,
    [
      envelope.envelopeId,
      operationId,
      envelope.envelopeHash,
      JSON.stringify(envelope),
    ],
  );
  await targetPool.query(
    "UPDATE operations SET current_state = 'ENVELOPE_FINALIZED', version = version + 1 WHERE operation_id = $1",
    [operationId],
  );
  const request: AuthorizeAutonomousInput = {
    authorizationId: `auth_${operationId}`,
    operationId,
    reservationId,
    envelopeId: envelope.envelopeId,
    envelopeRevision: envelope.revision,
    envelopeHash: envelope.envelopeHash as `0x${string}`,
    policyDecisionId: decisionId,
    policyDecisionHash: hash as `0x${string}`,
    idempotencyKey: `autonomous-key-${operationId}`,
  };
  return { operationId, reservationId, decisionId, envelope, request };
};

describe.sequential("P2-05D-PRE-A autonomous authorization", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(async () => reset());
  afterAll(async () => pool.end());

  test("creates one canonical AUTONOMOUS_POLICY authorization without approval evidence", async () => {
    const fixture = await seed({});
    const result = await authorizeAutonomous(
      pool,
      fixture.request,
      audit(fixture.operationId, "authorize"),
    );

    expect(result).toMatchObject({
      authorizationKind: "AUTONOMOUS_POLICY",
      approvalId: null,
      approverId: null,
      operationId: fixture.operationId,
      reservationId: fixture.reservationId,
      policyDecisionId: fixture.decisionId,
    });
    await expect(
      pool.query(
        `SELECT ae.authorization_kind, ae.approval_id, ae.approver_id,
                ae.owner_authentication_id, o.current_state, r.status,
                count(*) OVER () AS evidence_count
         FROM authorization_evidence ae
         JOIN operations o ON o.operation_id = ae.operation_id
         JOIN budget_reservations r ON r.reservation_id = ae.reservation_id
         WHERE ae.operation_id = $1`,
        [fixture.operationId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          authorization_kind: "AUTONOMOUS_POLICY",
          approval_id: null,
          approver_id: null,
          owner_authentication_id: null,
          current_state: "AUTHORIZED",
          status: "AUTHORIZED",
          evidence_count: "1",
        },
      ],
    });
  });

  test.each(["REQUIRE_APPROVAL", "DENY"] as const)(
    "%s cannot create autonomous authorization",
    async (decision) => {
      const fixture = await seed({ decision });
      await expect(
        authorizeAutonomous(
          pool,
          fixture.request,
          audit(fixture.operationId, "rejected"),
        ),
      ).rejects.toMatchObject({ code: "AUTONOMOUS_POLICY_REQUIRED" });
    },
  );

  test("stale decision version, decision hash, envelope, and reservation claims fail closed", async () => {
    const fixture = await seed({});
    await expect(
      authorizeAutonomous(
        pool,
        { ...fixture.request, policyDecisionHash: `0x${"2".repeat(64)}` },
        audit(fixture.operationId, "wrong-decision-hash"),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_BINDING_MISMATCH" });
    await expect(
      authorizeAutonomous(
        pool,
        { ...fixture.request, reservationId: "res_other" },
        audit(fixture.operationId, "wrong-reservation"),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_BINDING_MISMATCH" });
    await expect(
      authorizeAutonomous(
        pool,
        { ...fixture.request, envelopeRevision: 2 },
        audit(fixture.operationId, "stale-envelope"),
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_BINDING_MISMATCH" });
  });

  test("expired autonomous envelope is rejected", async () => {
    const fixture = await seed({ expiresAt: "2020-01-01T10:10:00Z" });
    await expect(
      authorizeAutonomous(
        pool,
        fixture.request,
        audit(fixture.operationId, "expired"),
      ),
    ).rejects.toMatchObject({ code: "REVALIDATION_REQUIRED" });
  });

  test.each([
    ["SYSTEM", "system", "PAUSE"],
    ["OWNER", "owner_1", "REVOKE"],
    ["AGENT", "agent_1", "REVOKE"],
    ["POLICY", "policy_1", "REVOKE"],
  ] as const)(
    "%s control change invalidates autonomous authorization before issuance",
    async (scopeType, scopeId, command) => {
      const fixture = await seed({
        operationId: `op_${scopeType.toLowerCase()}`,
      });
      await changeControlFence(pool, {
        scopeType,
        scopeId,
        command,
        audit: audit(fixture.operationId, `control-${scopeType.toLowerCase()}`),
      });
      await expect(
        authorizeAutonomous(
          pool,
          fixture.request,
          audit(fixture.operationId, "after-control-change"),
        ),
      ).rejects.toMatchObject({ code: "REVALIDATION_REQUIRED" });
    },
  );

  test("invalidation before signing and changed fences fail revalidation", async () => {
    const fixture = await seed({ operationId: "op_revalidate" });
    const evidence = await authorizeAutonomous(
      pool,
      fixture.request,
      audit(fixture.operationId, "authorize"),
    );
    await changeControlFence(pool, {
      scopeType: "SYSTEM",
      scopeId: "system",
      command: "PAUSE",
      audit: audit(fixture.operationId, "pause-after-authorization"),
    });
    await expect(
      revalidateAuthorization(pool, {
        operationId: fixture.operationId,
        authorizationId: evidence.authorizationId,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_REVALIDATION_REQUIRED" });
    await expect(
      pool.query(
        `SELECT o.current_state, r.status, ai.invalidation_id
         FROM operations o
         JOIN budget_reservations r ON r.operation_id = o.operation_id
         JOIN authorization_invalidations ai ON ai.authorization_id = $1
         WHERE o.operation_id = $2`,
        [evidence.authorizationId, fixture.operationId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          current_state: "REVALIDATION_REQUIRED",
          status: "RELEASED",
          invalidation_id: expect.any(String),
        },
      ],
    });
  });

  test("direct forged autonomous insertion is rejected by the canonical database guard", async () => {
    const fixture = await seed({});
    await expect(
      pool.query(
        `INSERT INTO authorization_evidence
          (authorization_id, authorization_kind, approval_id, operation_id,
           reservation_id, envelope_id, envelope_revision, envelope_hash,
           policy_decision_id, policy_decision_hash, policy_id, policy_version,
           approver_id, issued_at, expires_at, authorized_at, consumed_at,
           consumer_id, consumption_nonce, system_fence_version, system_state,
           owner_fence_version, owner_state, agent_fence_version, agent_state,
           policy_fence_version, policy_state)
         VALUES ('forged', 'AUTONOMOUS_POLICY', NULL, $1, $2, $3, 1, $4, $5,
                 $6, 'policy_1', 1, NULL, '2020-01-01T10:00:00Z',
                 '2099-01-01T10:10:00Z', '2026-08-31T00:00:00Z',
                 '2026-08-31T00:00:00Z', 'forger', 'forged:nonce', 1,
                 'ACTIVE', 1, 'ACTIVE', 1, 'ACTIVE', 1, 'ACTIVE')`,
        [
          fixture.operationId,
          fixture.reservationId,
          fixture.envelope.envelopeId,
          fixture.envelope.envelopeHash,
          fixture.decisionId,
          hash,
        ],
      ),
    ).rejects.toThrow(/authorization evidence binding mismatch|canonical/i);
  });

  test("exact retry returns the winner and a conflicting retry fails", async () => {
    const fixture = await seed({});
    const first = await authorizeAutonomous(
      pool,
      fixture.request,
      audit(fixture.operationId, "first"),
    );
    const second = await authorizeAutonomous(
      pool,
      fixture.request,
      audit(fixture.operationId, "retry"),
    );
    expect(second).toEqual(first);
    await expect(
      authorizeAutonomous(
        pool,
        { ...fixture.request, idempotencyKey: "different-key" },
        audit(fixture.operationId, "conflict"),
      ),
    ).rejects.toMatchObject({ code: "AUTONOMOUS_CONFLICT" });
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM authorization_evidence WHERE operation_id = $1",
        [fixture.operationId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  test("concurrent autonomous writers serialize to one canonical winner", async () => {
    const fixture = await seed({ operationId: "op_concurrent_autonomous" });
    const gate = await pool.connect();
    const lockSql =
      "SELECT pg_advisory_lock(hashtext('crip-wallet-autonomous-authorization:' || $1))";
    const unlockSql =
      "SELECT pg_advisory_unlock(hashtext('crip-wallet-autonomous-authorization:' || $1))";
    await gate.query("BEGIN");
    await gate.query(lockSql, [fixture.operationId]);
    try {
      const attempts = [
        authorizeAutonomous(
          pool,
          fixture.request,
          audit(fixture.operationId, "concurrent-a"),
        ),
        authorizeAutonomous(
          pool,
          {
            ...fixture.request,
            authorizationId: "auth_concurrent_autonomous_b",
            idempotencyKey: "autonomous-key-concurrent-b",
          },
          audit(fixture.operationId, "concurrent-b"),
        ),
      ];
      await waitForAdvisoryWaiters(2);
      await gate.query(unlockSql, [fixture.operationId]);
      await gate.query("COMMIT");
      const results = await Promise.allSettled(attempts);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ code: "AUTONOMOUS_CONFLICT" }),
      });
    } finally {
      await gate.query("ROLLBACK").catch(() => undefined);
      gate.release();
    }
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM authorization_evidence WHERE operation_id = $1",
        [fixture.operationId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  test("autonomous and owner approval paths have one winner", async () => {
    const fixture = await seed({
      operationId: "op_owner_autonomous_race",
      decision: "REQUIRE_APPROVAL",
    });
    await pool.query(
      `INSERT INTO local_owner_approval_keys
        (key_id, owner_id, algorithm, public_key)
       VALUES ($1, 'owner_1', 'ED25519', $2)`,
      [ownerCredential.keyId, ownerCredential.publicKeyPem],
    );
    const approvalId = "approval_owner_autonomous_race";
    const approvalExpiresAt = "2099-01-01T10:10:00Z";
    const nonce = "owner-autonomous-race-nonce";
    await createApprovalRequest(pool, {
      approvalId,
      operationId: fixture.operationId,
      reservationId: fixture.reservationId,
      envelopeId: fixture.envelope.envelopeId,
      envelopeRevision: fixture.envelope.revision,
      envelopeHash: fixture.envelope.envelopeHash,
      policyDecisionId: fixture.decisionId,
      issuedAt: "2020-01-01T10:00:00Z",
      expiresAt: approvalExpiresAt,
      nonce,
      audit: audit(fixture.operationId, "owner-request"),
    });
    await approveApproval(pool, {
      approvalId,
      authentication: ownerCredential.authenticate({
        approvalId,
        envelopeHash: fixture.envelope.envelopeHash,
        policyId: "policy_1",
        policyVersion: 1,
        expiresAt: approvalExpiresAt,
        nonce,
      }),
      now: "2099-01-01T10:01:00Z",
      audit: {
        ...audit(fixture.operationId, "owner-approved"),
        actorType: "owner",
        actorId: "owner_1",
      },
    });
    const results = await Promise.allSettled([
      authorizeAutonomous(
        pool,
        fixture.request,
        audit(fixture.operationId, "autonomous-race"),
      ),
      consumeApproval(pool, {
        approvalId,
        operationId: fixture.operationId,
        envelopeId: fixture.envelope.envelopeId,
        envelopeRevision: fixture.envelope.revision,
        envelopeHash: fixture.envelope.envelopeHash,
        consumerId: "owner-race-consumer",
        now: "2099-01-01T10:02:00Z",
        audit: audit(fixture.operationId, "owner-consume"),
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "AUTONOMOUS_POLICY_REQUIRED" }),
    });
    await expect(
      pool.query(
        "SELECT authorization_kind, approval_id FROM authorization_evidence WHERE operation_id = $1",
        [fixture.operationId],
      ),
    ).resolves.toMatchObject({
      rows: [{ authorization_kind: "OWNER_APPROVAL", approval_id: approvalId }],
    });
  });

  test("0023 to 0024 upgrade preserves existing owner authorization rows and FKs", async () => {
    const database = `crip_wallet_upgrade_${process.pid}`;
    const admin = new Pool({
      host: runtime.postgres.host,
      port: runtime.postgres.port,
      database: "postgres",
      user: runtime.postgres.user,
      password: runtime.postgres.password,
      max: 2,
    });
    let legacyPool: Pool | undefined;
    try {
      await admin.query(`CREATE DATABASE "${database}"`);
      legacyPool = new Pool({
        host: runtime.postgres.host,
        port: runtime.postgres.port,
        database,
        user: runtime.postgres.user,
        password: runtime.postgres.password,
        max: 4,
      });
      const migrationFiles = readdirSync(join(root, "migrations"))
        .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file))
        .sort(
          (left, right) => Number(left.slice(0, 4)) - Number(right.slice(0, 4)),
        );
      expect(migrationFiles.slice(-2).map((file) => file.slice(0, 4))).toEqual([
        "0023",
        "0024",
      ]);
      for (const filename of migrationFiles.filter(
        (file) => Number(file.slice(0, 4)) <= 23,
      ))
        await legacyPool.query(
          readFileSync(join(root, "migrations", filename), "utf8"),
        );
      await reset(legacyPool);

      const fixture = await seed(
        { operationId: "op_upgrade_owner", decision: "REQUIRE_APPROVAL" },
        legacyPool,
      );
      await legacyPool.query(
        `INSERT INTO local_owner_approval_keys
          (key_id, owner_id, algorithm, public_key)
         VALUES ($1, 'owner_1', 'ED25519', $2)`,
        [ownerCredential.keyId, ownerCredential.publicKeyPem],
      );
      const approvalId = "approval_upgrade_owner";
      const expiresAt = "2099-01-01T10:10:00Z";
      const nonce = "upgrade-owner-nonce";
      await createApprovalRequest(legacyPool, {
        approvalId,
        operationId: fixture.operationId,
        reservationId: fixture.reservationId,
        envelopeId: fixture.envelope.envelopeId,
        envelopeRevision: fixture.envelope.revision,
        envelopeHash: fixture.envelope.envelopeHash,
        policyDecisionId: fixture.decisionId,
        issuedAt: "2020-01-01T10:00:00Z",
        expiresAt,
        nonce,
        audit: audit(fixture.operationId, "upgrade-request"),
      });
      await approveApproval(legacyPool, {
        approvalId,
        authentication: ownerCredential.authenticate({
          approvalId,
          envelopeHash: fixture.envelope.envelopeHash,
          policyId: "policy_1",
          policyVersion: 1,
          expiresAt,
          nonce,
        }),
        now: "2099-01-01T10:01:00Z",
        audit: {
          ...audit(fixture.operationId, "upgrade-approved"),
          actorType: "owner",
          actorId: "owner_1",
        },
      });
      await consumeApproval(legacyPool, {
        approvalId,
        operationId: fixture.operationId,
        envelopeId: fixture.envelope.envelopeId,
        envelopeRevision: fixture.envelope.revision,
        envelopeHash: fixture.envelope.envelopeHash,
        consumerId: "upgrade-owner-consumer",
        now: "2099-01-01T10:02:00Z",
        audit: audit(fixture.operationId, "upgrade-consumed"),
      });
      const before = await legacyPool.query(
        "SELECT authorization_id, approval_id FROM authorization_evidence WHERE operation_id = $1",
        [fixture.operationId],
      );
      expect(before.rows).toHaveLength(1);

      await legacyPool.query(
        readFileSync(
          join(
            root,
            "migrations",
            "0024_canonical_autonomous_authorization.sql",
          ),
          "utf8",
        ),
      );
      await expect(
        legacyPool.query(
          `SELECT authorization_kind, approval_id, approver_id
           FROM authorization_evidence WHERE operation_id = $1`,
          [fixture.operationId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            authorization_kind: "OWNER_APPROVAL",
            approval_id: approvalId,
            approver_id: "owner_1",
          },
        ],
      });
      await expect(
        legacyPool.query(
          `SELECT count(*)::int AS count
           FROM pg_constraint
           WHERE conrelid = 'authorization_evidence'::regclass
             AND confrelid = 'approval_requests'::regclass`,
        ),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    } finally {
      await legacyPool?.end();
      await admin.query(`DROP DATABASE "${database}"`).catch(() => undefined);
      await admin.end();
    }
  }, 30000);
});
