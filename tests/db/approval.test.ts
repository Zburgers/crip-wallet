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
  consumeApproval,
  createApprovalRequest,
  rejectApproval,
  replaceExecutionEnvelope,
  revokeApproval,
  type ApprovalAuditContext,
} from "@crip/approvals";
import {
  applyMigrations,
  reserveBudget,
  type AuditContext,
} from "@crip/budget-ledger";
import { attachEnvelopeHash } from "@crip/schemas";
import { loadLocalRuntime } from "../../tooling/local-runtime.mjs";

const repositoryRoot = join(import.meta.dirname, "../..");
const runtime = loadLocalRuntime({ root: repositoryRoot });
const pool = new Pool({
  host: runtime.postgres.host,
  port: runtime.postgres.port,
  database: runtime.postgres.database,
  user: runtime.postgres.user,
  password: runtime.postgres.password,
  max: 8,
});
const assetAddress = "0x0000000000000000000000000000000000000001";
const zeroHash = `0x${"1".repeat(64)}`;
type Queryable = Pick<PoolClient, "query">;

const auditContext = (operationId: string, suffix: string): AuditContext => ({
  eventId: `evt:${operationId}:${suffix}`,
  actorType: "system",
  actorId: "approval-test",
  traceId: createHash("md5").update(`${operationId}:${suffix}`).digest("hex"),
});

const approvalAudit = (
  operationId: string,
  suffix: string,
  actorType: ApprovalAuditContext["actorType"] = "system",
): ApprovalAuditContext => ({
  ...auditContext(operationId, suffix),
  actorType,
  actorId: actorType === "owner" ? "owner_1" : "approval-test",
});

const seedFixture = async (client: Queryable): Promise<void> => {
  await client.query(`
    INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'Approval test owner');
    INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'Approval test agent');
    INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'Approval test wallet');
    INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
    INSERT INTO policy_versions (policy_id, version, document, document_hash)
      VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:0000000000000000000000000000000000000000000000000000000000000000');
    INSERT INTO budget_accounts (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address, allocated, available, reserved, finalized_spend)
      VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '${assetAddress}', 100, 100, 0, 0);
  `);
};

const reset = async (): Promise<void> => {
  await pool.query(
    "TRUNCATE authorization_evidence, approval_decisions, approval_requests, audit_events, idempotency_records, budget_reservations, budget_accounts, operations, intents, policy_decisions, execution_envelopes, policy_versions, policies, wallets, agents, owners CASCADE",
  );
  await seedFixture(pool);
};

const insertOperation = async (operationId: string): Promise<void> => {
  await pool.query(
    `INSERT INTO intents (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, $3::jsonb, $4)`,
    [
      `intent_${operationId}`,
      `intent-key-${operationId}`,
      JSON.stringify({ operationId }),
      `sha256:${createHash("sha256").update(operationId).digest("hex")}`,
    ],
  );
  await pool.query(
    `INSERT INTO operations (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED')`,
    [operationId, `intent_${operationId}`],
  );
};

const prepareApprovalFixture = async (operationId = "op_1") => {
  await insertOperation(operationId);
  const reservationId = `res_${operationId}`;
  await reserveBudget(pool, {
    reservationId,
    budgetId: "budget_1",
    operationId,
    idempotencyKey: `reserve-key-${operationId}`,
    idempotencyPayload: { operationId, amount: "10" },
    amountAtomic: "10",
    expiresAt: "2099-01-01T00:00:00.000Z",
    audit: auditContext(operationId, "reserve"),
  });
  const decisionId = `decision_${operationId}`;
  await pool.query(
    `INSERT INTO policy_decisions
      (decision_id, operation_id, policy_id, policy_version, decision, decision_hash, payload)
     VALUES ($1, $2, 'policy_1', 1, 'REQUIRE_APPROVAL', $3, $4::jsonb)`,
    [
      decisionId,
      operationId,
      zeroHash,
      JSON.stringify({ decision: "REQUIRE_APPROVAL", policyVersion: 1 }),
    ],
  );
  const envelope = attachEnvelopeHash({
    schemaVersion: "1.0",
    envelopeHash: zeroHash,
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
    to: assetAddress,
    value: "0",
    calldata: "0xa9059cbb",
    decodedFunction: "erc20.transfer",
    decodedArguments: {
      assetAddress,
      recipient: "0x0000000000000000000000000000000000000020",
      amountAtomic: "10",
    },
    expectedAssetDeltas: [
      {
        assetAddress,
        from: "0x0000000000000000000000000000000000000010",
        to: "0x0000000000000000000000000000000000000020",
        amountAtomic: "10",
      },
    ],
    simulationBlockReference: "100",
    simulationResultHash: zeroHash,
    nonceStrategy: "pending",
    gasLimit: "21000",
    maximumFeeConstraints: {
      asset: "native",
      maxFeePerGas: "1",
      maximumNetworkFeeAtomic: "21000",
    },
    policyId: "policy_1",
    policyVersion: 1,
    policyDecisionHash: zeroHash,
    budgetReservationId: reservationId,
    createdAt: "2020-01-01T10:00:00Z",
    expiresAt: "2099-01-01T10:10:00Z",
    riskDecision: "REVIEW",
    approvalRequirement: "owner",
  });
  await pool.query(
    `INSERT INTO execution_envelopes (envelope_id, operation_id, revision, envelope_hash, payload)
     VALUES ($1, $2, 1, $3, $4::jsonb)`,
    [
      envelope.envelopeId,
      operationId,
      envelope.envelopeHash,
      JSON.stringify(envelope),
    ],
  );
  await pool.query(
    "UPDATE operations SET current_state = 'ENVELOPE_FINALIZED', version = version + 1 WHERE operation_id = $1",
    [operationId],
  );
  return { operationId, reservationId, decisionId, envelope };
};

const requestApproval = async (
  fixture: Awaited<ReturnType<typeof prepareApprovalFixture>>,
  expiresAt = "2099-01-01T10:05:00Z",
) =>
  createApprovalRequest(pool, {
    approvalId: `approval_${fixture.operationId}`,
    operationId: fixture.operationId,
    reservationId: fixture.reservationId,
    envelopeId: fixture.envelope.envelopeId,
    envelopeRevision: fixture.envelope.revision,
    envelopeHash: fixture.envelope.envelopeHash,
    policyDecisionId: fixture.decisionId,
    issuedAt: "2020-01-01T10:00:00Z",
    expiresAt,
    nonce: `nonce_${fixture.operationId}`,
    audit: approvalAudit(fixture.operationId, "requested"),
  });

const approve = async (
  fixture: Awaited<ReturnType<typeof prepareApprovalFixture>>,
) =>
  approveApproval(pool, {
    approvalId: `approval_${fixture.operationId}`,
    approverId: "owner_1",
    now: "2099-01-01T10:01:00Z",
    audit: approvalAudit(fixture.operationId, "approved", "owner"),
  });

const consume = async (
  fixture: Awaited<ReturnType<typeof prepareApprovalFixture>>,
) =>
  consumeApproval(pool, {
    approvalId: `approval_${fixture.operationId}`,
    operationId: fixture.operationId,
    envelopeId: fixture.envelope.envelopeId,
    envelopeRevision: fixture.envelope.revision,
    envelopeHash: fixture.envelope.envelopeHash,
    consumerId: "authorization-service",
    now: "2099-01-01T10:02:00Z",
    audit: approvalAudit(fixture.operationId, "consumed"),
  });

describe.sequential("WP-03 approval authorization proof", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(reset);
  afterAll(async () => pool.end());

  test("approves and atomically consumes one exact envelope", async () => {
    const fixture = await prepareApprovalFixture();
    const requested = await requestApproval(fixture);
    expect(requested.status).toBe("PENDING");
    const approved = await approve(fixture);
    expect(approved.status).toBe("APPROVED");

    const evidence = await consume(fixture);

    expect(evidence).toMatchObject({
      approvalId: requested.approvalId,
      operationId: fixture.operationId,
      envelopeId: fixture.envelope.envelopeId,
      envelopeRevision: 1,
      envelopeHash: fixture.envelope.envelopeHash,
      policyDecisionId: fixture.decisionId,
      policyVersion: 1,
      approverId: "owner_1",
    });
    await expect(
      pool.query(
        `SELECT a.status, o.current_state, r.status AS reservation_status,
                ae.authorization_id, ae.envelope_hash, ae.policy_version
         FROM approval_requests a
         JOIN operations o ON o.operation_id = a.operation_id
         JOIN budget_reservations r ON r.reservation_id = a.reservation_id
         JOIN authorization_evidence ae ON ae.approval_id = a.approval_id
         WHERE a.approval_id = $1`,
        [requested.approvalId],
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          status: "CONSUMED",
          current_state: "AUTHORIZED",
          reservation_status: "AUTHORIZED",
          envelope_hash: fixture.envelope.envelopeHash,
          policy_version: 1,
        }),
      ],
    });
  });

  test("database rejects an impossible authorized operation without evidence", async () => {
    const fixture = await prepareApprovalFixture();
    await expect(
      pool.query(
        "UPDATE operations SET current_state = 'AUTHORIZED' WHERE operation_id = $1",
        [fixture.operationId],
      ),
    ).rejects.toThrow(
      /authorized operation lacks coherent consumed approval and reservation/,
    );
    await expect(
      pool.query(
        "SELECT current_state FROM operations WHERE operation_id = $1",
        [fixture.operationId],
      ),
    ).resolves.toMatchObject({
      rows: [{ current_state: "ENVELOPE_FINALIZED" }],
    });
  });

  test("approval binding columns are immutable after issuance", async () => {
    const fixture = await prepareApprovalFixture();
    const approval = await requestApproval(fixture);
    await expect(
      pool.query(
        "UPDATE approval_requests SET envelope_hash = $1 WHERE approval_id = $2",
        [`0x${"9".repeat(64)}`, approval.approvalId],
      ),
    ).rejects.toThrow(/approval binding is immutable|authoritative operation/);
  });

  test("database rejects approver assignment while an approval is pending", async () => {
    const fixture = await prepareApprovalFixture();
    const approval = await requestApproval(fixture);
    await expect(
      pool.query(
        "UPDATE approval_requests SET approver_id = 'owner_1' WHERE approval_id = $1",
        [approval.approvalId],
      ),
    ).rejects.toThrow(/pending approval cannot carry approver identity/);
  });

  test("database recomputes the canonical envelope hash before persistence", async () => {
    const fixture = await prepareApprovalFixture();
    const tampered = {
      ...fixture.envelope,
      envelopeId: `${fixture.envelope.envelopeId}_tampered`,
      revision: 2,
      supersedesEnvelopeId: fixture.envelope.envelopeId,
      calldata: "0xa9059cbb00",
      envelopeHash: fixture.envelope.envelopeHash,
    };
    await expect(
      pool.query(
        `INSERT INTO execution_envelopes (envelope_id, operation_id, revision, envelope_hash, payload)
         VALUES ($1, $2, 2, $3, $4::jsonb)`,
        [
          tampered.envelopeId,
          fixture.operationId,
          tampered.envelopeHash,
          JSON.stringify(tampered),
        ],
      ),
    ).rejects.toThrow(/canonical hash of its payload/);
  });

  test("database envelope hash helper matches Ethereum Keccak-256 vectors", async () => {
    const vectors = await pool.query<{ empty: string; abc: string }>(
      `SELECT approval_keccak256(convert_to('', 'UTF8')) AS empty,
              approval_keccak256(convert_to('abc', 'UTF8')) AS abc`,
    );
    expect(vectors.rows[0]).toEqual({
      empty: "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      abc: "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    });
  });

  test("database rejects a hash-valid but schema-invalid envelope", async () => {
    const fixture = await prepareApprovalFixture();
    const malformed = { ...fixture.envelope, calldata: "not-hex" };
    const hashResult = await pool.query<{ hash: string }>(
      `SELECT '0x' || approval_keccak256(
        convert_to('crip/execution-envelopev1', 'UTF8')
          || decode('00', 'hex')
          || convert_to(canonicalize_approval_jsonb($1::jsonb - 'envelopeHash'), 'UTF8')
      ) AS hash`,
      [JSON.stringify(malformed)],
    );
    await expect(
      pool.query(
        `INSERT INTO execution_envelopes (envelope_id, operation_id, revision, envelope_hash, payload)
         VALUES ($1, $2, 2, $3, $4::jsonb)`,
        [
          `${fixture.envelope.envelopeId}_invalid_schema`,
          fixture.operationId,
          hashResult.rows[0]!.hash,
          JSON.stringify(malformed),
        ],
      ),
    ).rejects.toThrow(/canonical schema/);
  });

  test("rejection cannot authorize and releases the held reservation", async () => {
    const fixture = await prepareApprovalFixture();
    await requestApproval(fixture);
    const rejected = await rejectApproval(pool, {
      approvalId: `approval_${fixture.operationId}`,
      approverId: "owner_1",
      reason: "not approved by owner",
      audit: approvalAudit(fixture.operationId, "rejected", "owner"),
    });
    expect(rejected.status).toBe("REJECTED");
    await expect(consume(fixture)).rejects.toMatchObject({
      code: "APPROVAL_REJECTED",
    });
    await expect(
      pool.query(
        "SELECT current_state FROM operations WHERE operation_id = $1",
        [fixture.operationId],
      ),
    ).resolves.toMatchObject({ rows: [{ current_state: "REJECTED" }] });
  });

  test("revocation cannot authorize an approved request", async () => {
    const fixture = await prepareApprovalFixture();
    await requestApproval(fixture);
    await approve(fixture);
    const revoked = await revokeApproval(pool, {
      approvalId: `approval_${fixture.operationId}`,
      reason: "owner emergency revoke",
      audit: approvalAudit(fixture.operationId, "revoked", "owner"),
    });
    expect(revoked.status).toBe("REVOKED");
    await expect(consume(fixture)).rejects.toMatchObject({
      code: "APPROVAL_REVOKED",
    });
  });

  test("expiry is enforced at approval and consumption boundaries", async () => {
    const fixture = await prepareApprovalFixture();
    await requestApproval(fixture, "2020-01-01T10:00:30Z");
    await expect(approve(fixture)).rejects.toMatchObject({
      code: "APPROVAL_EXPIRED",
    });
    await expect(
      pool.query(
        `SELECT a.status, o.current_state, r.status AS reservation_status
         FROM approval_requests a
         JOIN operations o ON o.operation_id = a.operation_id
         JOIN budget_reservations r ON r.reservation_id = a.reservation_id
         WHERE a.approval_id = $1`,
        [`approval_${fixture.operationId}`],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          status: "EXPIRED",
          current_state: "EXPIRED",
          reservation_status: "EXPIRED",
        },
      ],
    });
  });

  test("database rejects direct authorization after the approval lifetime", async () => {
    const fixture = await prepareApprovalFixture();
    await requestApproval(fixture, "2020-01-01T10:00:30Z");
    await expect(
      pool.query(
        `UPDATE approval_requests
         SET status = 'APPROVED', approver_id = 'owner_1', approved_at = now()
         WHERE approval_id = $1`,
        [`approval_${fixture.operationId}`],
      ),
    ).rejects.toThrow(/approval binding does not match/);
  });

  test("replay after consumption fails closed and never creates another evidence row", async () => {
    const fixture = await prepareApprovalFixture();
    await requestApproval(fixture);
    await approve(fixture);
    await consume(fixture);
    await expect(consume(fixture)).rejects.toMatchObject({
      code: "APPROVAL_REPLAYED",
    });
    const evidence = await pool.query(
      "SELECT count(*)::int AS count FROM authorization_evidence WHERE approval_id = $1",
      [`approval_${fixture.operationId}`],
    );
    expect(evidence.rows[0]?.count).toBe(1);
  });

  test.each([
    ["wrong operation", { operationId: "op_other" }],
    ["wrong envelope", { envelopeId: "env_other" }],
    ["wrong revision", { envelopeRevision: 2 }],
    ["wrong hash", { envelopeHash: `0x${"2".repeat(64)}` }],
  ])(
    "rejects %s without changing authorization state",
    async (_label, override) => {
      const fixture = await prepareApprovalFixture();
      await requestApproval(fixture);
      await approve(fixture);
      await expect(
        consumeApproval(pool, {
          approvalId: `approval_${fixture.operationId}`,
          operationId: override.operationId ?? fixture.operationId,
          envelopeId: override.envelopeId ?? fixture.envelope.envelopeId,
          envelopeRevision:
            override.envelopeRevision ?? fixture.envelope.revision,
          envelopeHash: override.envelopeHash ?? fixture.envelope.envelopeHash,
          consumerId: "authorization-service",
          now: "2099-01-01T10:02:00Z",
          audit: approvalAudit(fixture.operationId, `wrong-${_label}`),
        }),
      ).rejects.toMatchObject({ code: "APPROVAL_BINDING_MISMATCH" });
      const state = await pool.query(
        "SELECT status FROM approval_requests WHERE approval_id = $1",
        [`approval_${fixture.operationId}`],
      );
      expect(state.rows[0]?.status).toBe("APPROVED");
    },
  );

  test("replacing an approved envelope invalidates the old approval atomically", async () => {
    const fixture = await prepareApprovalFixture();
    await requestApproval(fixture);
    await approve(fixture);
    const replacement = attachEnvelopeHash({
      ...fixture.envelope,
      envelopeId: `${fixture.envelope.envelopeId}_2`,
      revision: 2,
      supersedesEnvelopeId: fixture.envelope.envelopeId,
      calldata: "0xa9059cbb00",
    });
    await replaceExecutionEnvelope(pool, {
      operationId: fixture.operationId,
      envelope: replacement,
      reason: "simulation changed calldata",
      audit: approvalAudit(fixture.operationId, "replacement", "system"),
    });
    await expect(
      pool.query(
        `SELECT a.status, o.current_state, r.status AS reservation_status
         FROM approval_requests a
         JOIN operations o ON o.operation_id = a.operation_id
         JOIN budget_reservations r ON r.reservation_id = a.reservation_id
         WHERE a.approval_id = $1`,
        [`approval_${fixture.operationId}`],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          status: "REVOKED",
          current_state: "REVALIDATION_REQUIRED",
          reservation_status: "RELEASED",
        },
      ],
    });

    await expect(consume(fixture)).rejects.toMatchObject({
      code: "APPROVAL_REVOKED",
    });
    await expect(
      pool.query(
        "SELECT count(*)::int AS count FROM execution_envelopes WHERE operation_id = $1",
        [fixture.operationId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 2 }] });
  });

  test("replacing after consumption invalidates current authorization but preserves historical evidence", async () => {
    const fixture = await prepareApprovalFixture();
    await requestApproval(fixture);
    await approve(fixture);
    await consume(fixture);
    const replacement = attachEnvelopeHash({
      ...fixture.envelope,
      envelopeId: `${fixture.envelope.envelopeId}_2`,
      revision: 2,
      supersedesEnvelopeId: fixture.envelope.envelopeId,
      calldata: "0xa9059cbb00",
    });
    await replaceExecutionEnvelope(pool, {
      operationId: fixture.operationId,
      envelope: replacement,
      reason: "post-approval revalidation",
      audit: approvalAudit(fixture.operationId, "consumed-replacement"),
    });
    await expect(
      pool.query(
        `SELECT o.current_state, r.status AS reservation_status,
                count(ae.authorization_id)::int AS evidence_count
         FROM operations o
         JOIN budget_reservations r ON r.operation_id = o.operation_id
         LEFT JOIN authorization_evidence ae ON ae.operation_id = o.operation_id
         WHERE o.operation_id = $1
         GROUP BY o.current_state, r.status`,
        [fixture.operationId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          current_state: "REVALIDATION_REQUIRED",
          reservation_status: "RELEASED",
          evidence_count: 1,
        },
      ],
    });
  });

  test("wrong policy decision/version is revalidation-required", async () => {
    const fixture = await prepareApprovalFixture();
    await pool.query(
      `INSERT INTO policy_versions (policy_id, version, document, document_hash)
       VALUES ('policy_1', 2, '{"schemaVersion":"1.0"}', 'sha256:${"2".repeat(64)}')`,
    );
    await pool.query(
      `INSERT INTO policy_decisions
        (decision_id, operation_id, policy_id, policy_version, decision, decision_hash, payload)
       VALUES ('decision_wrong_version', $1, 'policy_1', 2, 'REQUIRE_APPROVAL', $2, '{"decision":"REQUIRE_APPROVAL"}'::jsonb)`,
      [fixture.operationId, `0x${"3".repeat(64)}`],
    );
    await expect(
      createApprovalRequest(pool, {
        approvalId: "approval_wrong_version",
        operationId: fixture.operationId,
        reservationId: fixture.reservationId,
        envelopeId: fixture.envelope.envelopeId,
        envelopeRevision: 1,
        envelopeHash: fixture.envelope.envelopeHash,
        policyDecisionId: "decision_wrong_version",
        issuedAt: "2099-01-01T10:00:00Z",
        expiresAt: "2099-01-01T10:05:00Z",
        nonce: "nonce_wrong_version",
        audit: approvalAudit(fixture.operationId, "wrong-version"),
      }),
    ).rejects.toMatchObject({ code: "REVALIDATION_REQUIRED" });
  });

  test("same approval request and approval decision retries are idempotent", async () => {
    const fixture = await prepareApprovalFixture();
    const first = await requestApproval(fixture);
    const second = await requestApproval(fixture);
    expect(second).toEqual(first);
    const firstApproval = await approve(fixture);
    const secondApproval = await approve(fixture);
    expect(secondApproval).toEqual(firstApproval);
    const events = await pool.query(
      "SELECT event_type, count(*)::int AS count FROM audit_events WHERE operation_id = $1 GROUP BY event_type ORDER BY event_type",
      [fixture.operationId],
    );
    expect(events.rows).toEqual(
      expect.arrayContaining([
        { event_type: "approval.requested", count: 1 },
        { event_type: "approval.approved", count: 1 },
      ]),
    );
  });

  test("audit evidence covers the request, approval, and consumed authorization path", async () => {
    const fixture = await prepareApprovalFixture();
    await requestApproval(fixture);
    await approve(fixture);
    await consume(fixture);
    const events = await pool.query<{
      event_type: string;
      data: Record<string, unknown>;
    }>(
      "SELECT event_type, data FROM audit_events WHERE operation_id = $1 ORDER BY sequence_no",
      [fixture.operationId],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        "approval.requested",
        "approval.approved",
        "budget.reservation.authorized",
        "approval.consumed",
        "operation.state.changed",
      ]),
    );
    const consumed = events.rows.find(
      (row) => row.event_type === "approval.consumed",
    );
    expect(consumed?.data).toMatchObject({
      approvalId: `approval_${fixture.operationId}`,
      envelopeId: fixture.envelope.envelopeId,
      envelopeRevision: 1,
      envelopeHash: fixture.envelope.envelopeHash,
      policyDecisionId: fixture.decisionId,
      policyVersion: 1,
      approverId: "owner_1",
    });
  });
});
