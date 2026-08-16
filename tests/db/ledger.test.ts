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
  type ApprovalAuditContext,
} from "@crip/approvals";
import {
  applyMigrations,
  appendAuditEvent,
  authorizeReservation as verifyAuthorizedReservation,
  disputeReservation,
  expireReservation,
  finalizeReservation,
  getBudget,
  markReservationBroadcast,
  releaseReservation,
  reserveBudget,
  verifyAuditEvent,
  verifyBroadcastEvidence,
  withSerializableTransaction,
  type AuditContext,
  type AuditEventInput,
} from "@crip/budget-ledger";
import { attachEnvelopeHash } from "@crip/schemas";
import {
  generateComponentCredential,
  signComponentAction,
} from "@crip/trust-boundary";
import { loadLocalRuntime } from "../../tooling/local-runtime.mjs";
import { createLocalOwnerTestCredential } from "./local-owner-auth.js";

const repositoryRoot = join(import.meta.dirname, "../..");
const assetAddress = "0x0000000000000000000000000000000000000001";
const zeroHash = `0x${"1".repeat(64)}`;
const adapterCredential = generateComponentCredential({
  credentialId: "credential_adapter_test",
  componentId: "adapter_test",
  role: "ADAPTER",
});
const reconcilerCredential = generateComponentCredential({
  credentialId: "credential_reconciler_test",
  componentId: "reconciler_test",
  role: "RECONCILER",
});
const ownerCredential = createLocalOwnerTestCredential(
  "owner_1",
  "owner_1_ledger_key",
);
type Queryable = Pick<PoolClient, "query">;

const runtime = loadLocalRuntime({ root: repositoryRoot });

const pool = new Pool({
  host: runtime.postgres.host,
  port: runtime.postgres.port,
  database: runtime.postgres.database,
  user: runtime.postgres.user,
  password: runtime.postgres.password,
  max: 8,
});

const auditContext = (operationId: string): AuditContext => ({
  eventId: `evt_${operationId}`,
  actorType: "system",
  actorId: "ledger-test",
  traceId: createHash("md5").update(operationId).digest("hex"),
});

const approvalAudit = (
  operationId: string,
  suffix: string,
  actorType: ApprovalAuditContext["actorType"] = "system",
): ApprovalAuditContext => ({
  eventId: `evt:${operationId}:${suffix}`,
  actorType,
  actorId: actorType === "owner" ? "owner_1" : "authorization-test",
  traceId: createHash("md5").update(`${operationId}:${suffix}`).digest("hex"),
});

const assertedCorrelation = (
  operationId: string,
  reservationId: string,
): NonNullable<AuditContext["assertedCorrelation"]> => ({
  reservationId,
  budgetId: "budget_1",
  ownerId: "owner_1",
  agentId: "agent_1",
  walletId: "wallet_1",
  intentId: `intent_${operationId}`,
  operationId,
  policyId: "policy_1",
  policyVersion: 1,
});

const persistedAuditInput = (
  operationId: string,
  reservationId: string,
): AuditEventInput => ({
  eventId: `evt_${operationId}`,
  actorType: "system",
  actorId: "ledger-test",
  traceId: createHash("md5").update(operationId).digest("hex"),
  reservationId,
  ownerId: "owner_1",
  agentId: "agent_1",
  walletId: "wallet_1",
  intentId: `intent_${operationId}`,
  operationId,
  policyId: "policy_1",
  policyVersion: 1,
  eventType: "budget.reservation.created",
  data: { reservationId, amountAtomic: "10" },
});

const adapterAuditContext = (
  operationId: string,
  reservationId: string,
  evidence: {
    transactionHash: string;
    nonce: string;
    receiptReference: string;
  },
): AuditContext => ({
  ...auditContext(operationId),
  actorType: "adapter",
  actorId: "adapter-test",
  componentAuth: signComponentAction(adapterCredential, "broadcast", {
    reservationId,
    ...evidence,
  }),
});

const reconcilerAuditContext = (
  operationId: string,
  reservationId: string,
  evidence: {
    transactionHash: string;
    nonce: string;
    receiptReference: string;
  },
): AuditContext => ({
  ...auditContext(operationId),
  actorType: "worker",
  actorId: "reconciler:ledger-test",
  componentAuth: signComponentAction(reconcilerCredential, "verify", {
    reservationId,
    ...evidence,
  }),
});

const withAssertedCorrelation = (
  audit: AuditContext,
  operationId: string,
  reservationId: string,
): AuditContext => ({
  ...audit,
  assertedCorrelation: assertedCorrelation(operationId, reservationId),
});

const seedFixture = async (client: Queryable): Promise<void> => {
  await client.query(`
    INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'Ledger test owner');
    INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'Ledger test agent');
    INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'Ledger test wallet');
    INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
    INSERT INTO policy_versions (policy_id, version, document, document_hash) VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:0000000000000000000000000000000000000000000000000000000000000000');
    INSERT INTO control_fences (scope_type, scope_id, state) VALUES
      ('SYSTEM', 'system', 'ACTIVE'), ('OWNER', 'owner_1', 'ACTIVE'),
      ('AGENT', 'agent_1', 'ACTIVE'), ('POLICY', 'policy_1', 'ACTIVE');
    INSERT INTO trusted_component_credentials
      (credential_id, component_id, component_role, public_key)
    VALUES
      ('${adapterCredential.credentialId}', '${adapterCredential.componentId}', 'ADAPTER', '${adapterCredential.publicKey}'),
      ('${reconcilerCredential.credentialId}', '${reconcilerCredential.componentId}', 'RECONCILER', '${reconcilerCredential.publicKey}');
    INSERT INTO budget_accounts (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address, allocated, available, reserved, finalized_spend)
      VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '${assetAddress}', 100, 100, 0, 0);
  `);
  await client.query(
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

const insertOperation = async (
  client: Queryable,
  operationId: string,
): Promise<void> => {
  await client.query(
    `INSERT INTO intents (intent_id, idempotency_key, agent_id, wallet_id, policy_id, policy_version, payload, payload_hash)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, $3::jsonb, $4)`,
    [
      `intent_${operationId}`,
      `intent-key-${operationId}`,
      JSON.stringify({ operationId }),
      `sha256:${createHash("sha256").update(operationId).digest("hex")}`,
    ],
  );
  await client.query(
    `INSERT INTO operations (operation_id, intent_id, agent_id, wallet_id, policy_id, policy_version, current_state)
     VALUES ($1, $2, 'agent_1', 'wallet_1', 'policy_1', 1, 'POLICY_FINALIZED')`,
    [operationId, `intent_${operationId}`],
  );
};

const reset = async (): Promise<void> => {
  await pool.query(
    "TRUNCATE recovery_attempts, operation_recovery_leases, trusted_component_credentials, audit_events, idempotency_records, budget_reservations, budget_accounts, operations, intents, policy_decisions, execution_envelopes, policy_versions, policies, wallets, agents, owners, control_fences CASCADE",
  );
  await withSerializableTransaction(pool, seedFixture);
};

const reserve = (
  operationId: string,
  reservationId: string,
  key: string,
  amount: string,
  expiresAt = "2099-01-01T00:00:00.000Z",
) =>
  reserveBudget(pool, {
    reservationId,
    budgetId: "budget_1",
    operationId,
    idempotencyKey: key,
    idempotencyPayload: { amount, operationId },
    amountAtomic: amount,
    expiresAt,
    audit: auditContext(operationId),
  });

const authorizeReservation = async (
  targetPool: Pool,
  input: { reservationId: string; audit: AuditContext },
) => {
  if (input.audit.assertedCorrelation)
    return verifyAuthorizedReservation(targetPool, input);

  const reservationResult = await targetPool.query<{
    operation_id: string;
    amount_atomic: string;
    status: string;
  }>(
    `SELECT operation_id, amount_atomic, status
     FROM budget_reservations
     WHERE reservation_id = $1`,
    [input.reservationId],
  );
  const reservation = reservationResult.rows[0];
  if (!reservation) return verifyAuthorizedReservation(targetPool, input);
  if (reservation.status === "AUTHORIZED")
    return verifyAuthorizedReservation(targetPool, input);
  if (reservation.status !== "HELD")
    return verifyAuthorizedReservation(targetPool, input);

  const operationId = reservation.operation_id;
  const decisionId = `decision_${operationId}`;
  await targetPool.query(
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
      amountAtomic: String(reservation.amount_atomic),
    },
    expectedAssetDeltas: [
      {
        assetAddress,
        from: "0x0000000000000000000000000000000000000010",
        to: "0x0000000000000000000000000000000000000020",
        amountAtomic: String(reservation.amount_atomic),
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
    budgetReservationId: input.reservationId,
    createdAt: "2020-01-01T10:00:00Z",
    expiresAt: "2099-01-01T10:10:00Z",
    riskDecision: "REVIEW",
    approvalRequirement: "owner",
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
    `UPDATE operations
     SET current_state = 'ENVELOPE_FINALIZED', version = version + 1
     WHERE operation_id = $1 AND current_state = 'POLICY_FINALIZED'`,
    [operationId],
  );
  const approvalId = `approval_${operationId}`;
  const approvalExpiresAt = "2099-01-01T10:05:00Z";
  const approvalNonce = `nonce_${operationId}`;
  await createApprovalRequest(targetPool, {
    approvalId,
    operationId,
    reservationId: input.reservationId,
    envelopeId: envelope.envelopeId,
    envelopeRevision: envelope.revision,
    envelopeHash: envelope.envelopeHash,
    policyDecisionId: decisionId,
    issuedAt: "2020-01-01T10:00:00Z",
    expiresAt: approvalExpiresAt,
    nonce: approvalNonce,
    audit: approvalAudit(operationId, "requested"),
  });
  await approveApproval(targetPool, {
    approvalId,
    authentication: ownerCredential.authenticate({
      approvalId,
      envelopeHash: envelope.envelopeHash,
      policyId: "policy_1",
      policyVersion: 1,
      expiresAt: approvalExpiresAt,
      nonce: approvalNonce,
    }),
    now: "2099-01-01T10:01:00Z",
    audit: approvalAudit(operationId, "approved", "owner"),
  });
  await consumeApproval(targetPool, {
    approvalId,
    operationId,
    envelopeId: envelope.envelopeId,
    envelopeRevision: envelope.revision,
    envelopeHash: envelope.envelopeHash,
    consumerId: "authorization-service",
    now: "2099-01-01T10:02:00Z",
    audit: approvalAudit(operationId, "consumed"),
  });
  return verifyAuthorizedReservation(targetPool, input);
};

describe.sequential("WS-003 PostgreSQL budget ledger", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(reset);
  afterAll(async () => pool.end());

  test("applies a forward-only migration and records its checksum", async () => {
    const migration = await pool.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
    );
    expect(migration.rows).toHaveLength(21);
    expect(migration.rows.map((row) => row.filename)).toEqual([
      "0001_ws003_budget_ledger.sql",
      "0002_ws003_idempotency_binding_guard.sql",
      "0003_ws003_reservation_broadcast_audit.sql",
      "0004_ws003_evidence_and_binding_guards.sql",
      "0005_ws003_audit_hash_guard.sql",
      "0006_ws003_audit_hash_domain_fix.sql",
      "0007_ws003_evidence_verification.sql",
      "0008_ws003_audit_row_binding_guard.sql",
      "0009_ws003_audit_legacy_fail_closed.sql",
      "0010_ws003_parent_binding_guards.sql",
      "0011_ws003_pending_evidence_default_fix.sql",
      "0012_ws003_evidence_guard_column_fix.sql",
      "0013_ws003_audit_reservation_correlation.sql",
      "0014_ws003_audit_correlation_hardening.sql",
      "0015_wp03_approval_authorization.sql",
      "0016_wp04_control_fences.sql",
      "0017_wp05_authenticated_recovery.sql",
      "0018_wp05_evidence_trigger_fix.sql",
      "0019_wp07_canonical_authorization_guard.sql",
      "0020_wp08_owner_approval_auth.sql",
      "0021_wp08_owner_approval_auth_fix.sql",
    ]);
    expect(
      migration.rows.every((row) => /^sha256:[0-9a-f]{64}$/.test(row.checksum)),
    ).toBe(true);
    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name",
      [
        [
          "policies",
          "intents",
          "operations",
          "execution_envelopes",
          "policy_decisions",
          "approval_requests",
          "approval_decisions",
          "authorization_evidence",
          "authorization_invalidations",
          "budget_accounts",
          "budget_reservations",
          "control_fences",
          "trusted_component_credentials",
          "operation_recovery_leases",
          "recovery_attempts",
          "idempotency_records",
          "audit_events",
          "local_owner_approval_keys",
          "owner_approval_authentications",
        ],
      ],
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "approval_decisions",
      "approval_requests",
      "audit_events",
      "authorization_evidence",
      "authorization_invalidations",
      "budget_accounts",
      "budget_reservations",
      "control_fences",
      "execution_envelopes",
      "idempotency_records",
      "intents",
      "local_owner_approval_keys",
      "operation_recovery_leases",
      "operations",
      "owner_approval_authentications",
      "policies",
      "policy_decisions",
      "recovery_attempts",
      "trusted_component_credentials",
    ]);
  });

  test("is idempotent on upgrade and fails closed on migration checksum drift", async () => {
    const before = await pool.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
    );
    await expect(applyMigrations(pool)).resolves.toBeUndefined();
    expect(
      (
        await pool.query<{ filename: string; checksum: string }>(
          "SELECT filename, checksum FROM schema_migrations ORDER BY filename",
        )
      ).rows,
    ).toEqual(before.rows);

    const target = before.rows.at(-1)!;
    const driftedChecksum = `sha256:${"f".repeat(64)}`;
    await pool.query(
      "UPDATE schema_migrations SET checksum = $1 WHERE filename = $2",
      [driftedChecksum, target.filename],
    );
    await expect(applyMigrations(pool)).rejects.toThrow(
      `migration checksum mismatch: ${target.filename}`,
    );
    await pool.query(
      "UPDATE schema_migrations SET checksum = $1 WHERE filename = $2",
      [target.checksum, target.filename],
    );
    await expect(applyMigrations(pool)).resolves.toBeUndefined();
  });

  test("fails closed before upgrading a legacy audit row without a v1 payload", async () => {
    await insertOperation(pool, "op_legacy_audit");
    await reserve(
      "op_legacy_audit",
      "res_legacy_audit",
      "legacy-audit-key",
      "10",
    );
    const migration = await pool.query<{
      checksum: string;
      applied_at: Date;
    }>(
      "SELECT checksum, applied_at FROM schema_migrations WHERE filename = '0009_ws003_audit_legacy_fail_closed.sql'",
    );
    const event = await pool.query<{
      event_id: string;
      canonical_payload: string;
    }>(
      "SELECT event_id, canonical_payload FROM audit_events WHERE operation_id = $1",
      ["op_legacy_audit"],
    );
    const original = event.rows[0]!;
    await pool.query(
      "DROP TRIGGER audit_events_are_append_only ON audit_events",
    );
    await pool.query(
      "ALTER TABLE audit_events ALTER COLUMN canonical_payload DROP NOT NULL",
    );
    await pool.query(
      "UPDATE audit_events SET canonical_payload = NULL WHERE event_id = $1",
      [original.event_id],
    );
    await pool.query(
      "DELETE FROM schema_migrations WHERE filename = '0009_ws003_audit_legacy_fail_closed.sql'",
    );
    try {
      await expect(applyMigrations(pool)).rejects.toThrow(/legacy audit rows/i);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM schema_migrations WHERE filename = '0009_ws003_audit_legacy_fail_closed.sql'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await pool.query(
        "UPDATE audit_events SET canonical_payload = $1 WHERE event_id = $2",
        [original.canonical_payload, original.event_id],
      );
      await pool.query(
        "ALTER TABLE audit_events ALTER COLUMN canonical_payload SET NOT NULL",
      );
      await pool.query(
        `CREATE TRIGGER audit_events_are_append_only
         BEFORE UPDATE OR DELETE ON audit_events
         FOR EACH ROW EXECUTE FUNCTION reject_immutable_record()`,
      );
      await pool.query(
        "INSERT INTO schema_migrations (filename, checksum, applied_at) VALUES ($1, $2, $3)",
        [
          "0009_ws003_audit_legacy_fail_closed.sql",
          migration.rows[0]!.checksum,
          migration.rows[0]!.applied_at,
        ],
      );
      await expect(applyMigrations(pool)).resolves.toBeUndefined();
    }
  });

  test("serializes concurrent migration runners and rolls back failed DDL", async () => {
    await expect(
      Promise.all([applyMigrations(pool), applyMigrations(pool)]),
    ).resolves.toEqual([undefined, undefined]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TABLE migration_recovery_probe (id integer PRIMARY KEY)",
      );
      await expect(client.query("SELECT 1 / 0")).rejects.toThrow();
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(
      (
        await pool.query(
          "SELECT to_regclass('public.migration_recovery_probe') AS table_name",
        )
      ).rows[0]?.table_name,
    ).toBeNull();
    await expect(applyMigrations(pool)).resolves.toBeUndefined();
  });

  test("reserves available budget and audits the state change transactionally", async () => {
    await insertOperation(pool, "op_reserve");
    expect(
      (await reserve("op_reserve", "res_reserve", "reserve-key", "30")).status,
    ).toBe("HELD");
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      allocated: "100",
      available: "70",
      reserved: "30",
      finalizedSpend: "0",
    });
    expect(
      (await pool.query("SELECT event_type FROM audit_events")).rows,
    ).toEqual([{ event_type: "budget.reservation.created" }]);
  });

  test("rejects a reservation audit asserted as another valid operation", async () => {
    await insertOperation(pool, "op_reservation_a");
    await insertOperation(pool, "op_reservation_b");
    await expect(
      reserveBudget(pool, {
        reservationId: "res_reservation_a",
        budgetId: "budget_1",
        operationId: "op_reservation_a",
        idempotencyKey: "reservation-correlation-key",
        idempotencyPayload: { operationId: "op_reservation_a" },
        amountAtomic: "10",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: withAssertedCorrelation(
          auditContext("op_reservation_a"),
          "op_reservation_b",
          "res_reservation_b",
        ),
      }),
    ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "100",
      reserved: "0",
    });
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM audit_events"))
        .rows[0]?.count,
    ).toBe(0);
  });

  test.each([
    ["intentId", "intent_other"],
    ["ownerId", "owner_other"],
    ["agentId", "agent_other"],
    ["walletId", "wallet_other"],
    ["policyId", "policy_other"],
    ["policyVersion", 2],
  ] as const)(
    "rejects an asserted correlation mismatch for %s",
    (field, value) => {
      const operationId = `op_asserted_${field}`;
      const reservationId = `res_asserted_${field}`;
      return insertOperation(pool, operationId).then(() =>
        expect(
          reserveBudget(pool, {
            reservationId,
            budgetId: "budget_1",
            operationId,
            idempotencyKey: `asserted-${field}`,
            idempotencyPayload: { operationId },
            amountAtomic: "10",
            expiresAt: "2099-01-01T00:00:00.000Z",
            audit: {
              ...auditContext(operationId),
              assertedCorrelation: {
                ...assertedCorrelation(operationId, reservationId),
                [field]: value,
              },
            },
          }),
        ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" }),
      );
    },
  );

  test("rejects alternate operation correlation across every reservation mutation", async () => {
    const cases = [
      "authorize",
      "broadcast",
      "verify",
      "release",
      "expire",
      "finalize",
      "dispute",
    ] as const;
    for (const kind of cases) {
      const operationId = `op_transition_${kind}`;
      const reservationId = `res_transition_${kind}`;
      const otherOperationId = `op_other_${kind}`;
      const otherReservationId = `res_other_${kind}`;
      await insertOperation(pool, operationId);
      await insertOperation(pool, otherOperationId);
      await reserve(
        operationId,
        reservationId,
        `transition-${kind}-key`,
        "1",
        kind === "expire" ? "2020-01-01T00:00:00.000Z" : undefined,
      );
      const forged = (base: AuditContext): AuditContext =>
        withAssertedCorrelation(base, otherOperationId, otherReservationId);

      if (kind === "authorize") {
        await expect(
          authorizeReservation(pool, {
            reservationId,
            audit: forged(auditContext(operationId)),
          }),
        ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" });
      } else if (kind === "broadcast") {
        await authorizeReservation(pool, {
          reservationId,
          audit: auditContext(operationId),
        });
        await expect(
          markReservationBroadcast(pool, {
            reservationId,
            audit: forged(
              adapterAuditContext(operationId, reservationId, {
                transactionHash: `0x${"a".repeat(64)}`,
                nonce: "1",
                receiptReference: `receipt:${kind}`,
              }),
            ),
            evidence: {
              transactionHash: `0x${"a".repeat(64)}`,
              nonce: "1",
              receiptReference: `receipt:${kind}`,
            },
          }),
        ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" });
      } else if (kind === "verify") {
        await authorizeReservation(pool, {
          reservationId,
          audit: auditContext(operationId),
        });
        await markReservationBroadcast(pool, {
          reservationId,
          audit: adapterAuditContext(operationId, reservationId, {
            transactionHash: `0x${"b".repeat(64)}`,
            nonce: "1",
            receiptReference: `receipt:${kind}`,
          }),
          evidence: {
            transactionHash: `0x${"b".repeat(64)}`,
            nonce: "1",
            receiptReference: `receipt:${kind}`,
          },
        });
        await expect(
          verifyBroadcastEvidence(pool, {
            reservationId,
            audit: forged(
              reconcilerAuditContext(operationId, reservationId, {
                transactionHash: `0x${"b".repeat(64)}`,
                nonce: "1",
                receiptReference: `receipt:${kind}`,
              }),
            ),
          }),
        ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" });
      } else if (kind === "release") {
        await expect(
          releaseReservation(pool, {
            reservationId,
            audit: forged(auditContext(operationId)),
          }),
        ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" });
      } else if (kind === "expire") {
        await expect(
          expireReservation(pool, {
            reservationId,
            now: "2021-01-01T00:00:00.000Z",
            audit: forged(auditContext(operationId)),
          }),
        ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" });
      } else if (kind === "finalize") {
        await authorizeReservation(pool, {
          reservationId,
          audit: auditContext(operationId),
        });
        await markReservationBroadcast(pool, {
          reservationId,
          audit: adapterAuditContext(operationId, reservationId, {
            transactionHash: `0x${"c".repeat(64)}`,
            nonce: "1",
            receiptReference: `receipt:${kind}`,
          }),
          evidence: {
            transactionHash: `0x${"c".repeat(64)}`,
            nonce: "1",
            receiptReference: `receipt:${kind}`,
          },
        });
        await verifyBroadcastEvidence(pool, {
          reservationId,
          audit: reconcilerAuditContext(operationId, reservationId, {
            transactionHash: `0x${"c".repeat(64)}`,
            nonce: "1",
            receiptReference: `receipt:${kind}`,
          }),
        });
        await expect(
          finalizeReservation(pool, {
            reservationId,
            actualSpendAtomic: "1",
            proofReference: `receipt:${kind}`,
            audit: forged(auditContext(operationId)),
          }),
        ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" });
      } else {
        await expect(
          disputeReservation(pool, {
            reservationId,
            reason: "correlation test",
            audit: forged(auditContext(operationId)),
          }),
        ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" });
      }

      const persisted = await pool.query<{
        status: string;
        operation_id: string;
      }>(
        "SELECT status, operation_id FROM budget_reservations WHERE reservation_id = $1",
        [reservationId],
      );
      expect(persisted.rows[0]?.operation_id).toBe(operationId);
      expect(persisted.rows[0]?.status).not.toBe("FINALIZED");
      const forgedEvents = await pool.query(
        "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
        [otherOperationId],
      );
      expect(forgedEvents.rows[0]?.count).toBe(0);
    }
  });

  test("does not let an idempotent retry introduce alternate correlation", async () => {
    await insertOperation(pool, "op_idempotency_a");
    await insertOperation(pool, "op_idempotency_b");
    await reserve(
      "op_idempotency_a",
      "res_idempotency_a",
      "correlation-retry-key",
      "10",
    );
    await expect(
      reserveBudget(pool, {
        reservationId: "res_idempotency_retry",
        budgetId: "budget_1",
        operationId: "op_idempotency_a",
        idempotencyKey: "correlation-retry-key",
        idempotencyPayload: { amount: "10", operationId: "op_idempotency_a" },
        amountAtomic: "10",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: withAssertedCorrelation(
          auditContext("op_idempotency_a"),
          "op_idempotency_b",
          "res_idempotency_b",
        ),
      }),
    ).rejects.toMatchObject({ code: "AUDIT_CORRELATION_MISMATCH" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "90",
      reserved: "10",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_idempotency_a"],
        )
      ).rows[0]?.count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_idempotency_b"],
        )
      ).rows[0]?.count,
    ).toBe(0);
  });

  test("database guard rejects direct mismatch for every financial correlation field", async () => {
    await insertOperation(pool, "op_direct_a");
    await insertOperation(pool, "op_direct_b");
    await reserve("op_direct_a", "res_direct_a", "direct-a-key", "10");
    const mismatches = [
      ["operationId", "op_direct_b"],
      ["intentId", "intent_direct_b"],
      ["ownerId", "owner_direct_b"],
      ["agentId", "agent_direct_b"],
      ["walletId", "wallet_direct_b"],
      ["policyId", "policy_direct_b"],
      ["policyVersion", 2],
    ] as const;
    for (const [field, value] of mismatches) {
      const eventId = `evt_direct_mismatch_${field}`;
      await expect(
        withSerializableTransaction(pool, async (client) => {
          await appendAuditEvent(client, {
            ...persistedAuditInput("op_direct_a", "res_direct_a"),
            eventId,
            [field]: value,
            data: { reservationId: "res_direct_a", amountAtomic: "10" },
          } as AuditEventInput);
        }),
      ).rejects.toThrow(/correlation mismatch|authoritative binding/i);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM audit_events WHERE event_id = $1",
            [eventId],
          )
        ).rows[0]?.count,
      ).toBe(0);
    }
  });

  test("raw SQL cannot bypass the persisted correlation trigger", async () => {
    await insertOperation(pool, "op_raw_a");
    await insertOperation(pool, "op_raw_b");
    await reserve("op_raw_a", "res_raw_a", "raw-a-key", "10");
    const mismatches = [
      ["operation_id", "op_raw_b"],
      ["intent_id", "intent_raw_b"],
      ["owner_id", "owner_raw_b"],
      ["agent_id", "agent_raw_b"],
      ["wallet_id", "wallet_raw_b"],
      ["policy_id", "policy_raw_b"],
      ["policy_version", 2],
    ] as const;
    for (const [index, [field, value]] of mismatches.entries()) {
      const values = {
        owner_id: "owner_1",
        agent_id: "agent_1",
        wallet_id: "wallet_1",
        intent_id: "intent_raw_a",
        operation_id: "op_raw_a",
        policy_id: "policy_1",
        policy_version: 1,
      };
      values[field] = value as never;
      await expect(
        pool.query(
          `INSERT INTO audit_events
            (event_id, event_type, sequence_no, actor_type, actor_id, owner_id, agent_id, wallet_id,
             intent_id, operation_id, policy_id, policy_version, trace_id, data, previous_event_hash,
             event_hash, occurred_at, canonical_payload, reservation_id)
           VALUES ($1, 'budget.reservation.created', $2, 'system', 'raw-test', $3, $4, $5,
             $6, $7, $8, $9, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             '{"reservationId":"res_raw_a","amountAtomic":"10"}'::jsonb, NULL,
             $10, '2026-08-15T00:00:00Z', '{}', 'res_raw_a')`,
          [
            `evt_raw_mismatch_${field}`,
            99 + index,
            values.owner_id,
            values.agent_id,
            values.wallet_id,
            values.intent_id,
            values.operation_id,
            values.policy_id,
            values.policy_version,
            `0x${"0".repeat(64)}`,
          ],
        ),
      ).rejects.toThrow(/correlation mismatch|authoritative binding/i);
    }
  });

  test("enforces balanced numeric constraints and foreign keys", async () => {
    await expect(
      pool.query(
        "UPDATE budget_accounts SET reserved = 1 WHERE budget_id = 'budget_1'",
      ),
    ).rejects.toThrow(/budget_accounts_invariant/i);
    await expect(
      pool.query("DELETE FROM policies WHERE policy_id = 'policy_1'"),
    ).rejects.toThrow(/foreign key/i);
  });

  test("rejects insufficient available budget without a reservation or audit row", async () => {
    await insertOperation(pool, "op_insufficient");
    await expect(
      reserve("op_insufficient", "res_insufficient", "insufficient-key", "101"),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BUDGET" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM budget_reservations",
        )
      ).rows[0]?.count,
    ).toBe(0);
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM audit_events"))
        .rows[0]?.count,
    ).toBe(0);
    expect((await getBudget(pool, "budget_1")).snapshot.available).toBe("100");
  });

  test("releases and expires reservations back into available", async () => {
    await insertOperation(pool, "op_release");
    await insertOperation(pool, "op_expire");
    await reserve("op_release", "res_release", "release-key", "20");
    await releaseReservation(pool, {
      reservationId: "res_release",
      audit: auditContext("op_release"),
    });
    await releaseReservation(pool, {
      reservationId: "res_release",
      audit: auditContext("op_release"),
    });
    await reserve(
      "op_expire",
      "res_expire",
      "expire-key",
      "15",
      "2020-01-01T00:00:00.000Z",
    );
    await expireReservation(pool, {
      reservationId: "res_expire",
      now: "2021-01-01T00:00:00.000Z",
      audit: auditContext("op_expire"),
    });
    await expireReservation(pool, {
      reservationId: "res_expire",
      now: "2021-01-01T00:00:00.000Z",
      audit: auditContext("op_expire"),
    });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      allocated: "100",
      available: "100",
      reserved: "0",
      finalizedSpend: "0",
    });
  });

  test("direct ledger calls cannot manufacture authorization or broadcast", async () => {
    await insertOperation(pool, "op_authorization_bypass");
    await reserve(
      "op_authorization_bypass",
      "res_authorization_bypass",
      "authorization-bypass-key",
      "40",
    );
    await expect(
      verifyAuthorizedReservation(pool, {
        reservationId: "res_authorization_bypass",
        audit: auditContext("op_authorization_bypass"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESERVATION_TRANSITION" });
    await expect(
      pool.query(
        "UPDATE budget_reservations SET status = 'AUTHORIZED' WHERE reservation_id = $1",
        ["res_authorization_bypass"],
      ),
    ).rejects.toThrow(/current canonical authorization evidence/i);
    const evidence = {
      transactionHash: `0x${"4".repeat(64)}`,
      nonce: "4",
      receiptReference: "receipt:authorization-bypass",
    };
    await expect(
      markReservationBroadcast(pool, {
        reservationId: "res_authorization_bypass",
        audit: adapterAuditContext(
          "op_authorization_bypass",
          "res_authorization_bypass",
          evidence,
        ),
        evidence,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESERVATION_TRANSITION" });
    await expect(
      pool.query(
        `SELECT r.status,
                count(be.reservation_id)::int AS broadcast_evidence_count,
                count(ae.authorization_id)::int AS authorization_evidence_count
         FROM budget_reservations r
         LEFT JOIN reservation_broadcast_evidence be
           ON be.reservation_id = r.reservation_id
         LEFT JOIN authorization_evidence ae
           ON ae.reservation_id = r.reservation_id
         WHERE r.reservation_id = $1
         GROUP BY r.status`,
        ["res_authorization_bypass"],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          status: "HELD",
          broadcast_evidence_count: 0,
          authorization_evidence_count: 0,
        },
      ],
    });
  });

  test("finalizes actual spend and releases unused reservation", async () => {
    await insertOperation(pool, "op_finalize");
    await reserve("op_finalize", "res_finalize", "finalize-key", "40");
    await authorizeReservation(pool, {
      reservationId: "res_finalize",
      audit: auditContext("op_finalize"),
    });
    await markReservationBroadcast(pool, {
      reservationId: "res_finalize",
      audit: adapterAuditContext("op_finalize", "res_finalize", {
        transactionHash: `0x${"1".repeat(64)}`,
        nonce: "1",
        receiptReference: "receipt:op_finalize",
      }),
      evidence: {
        transactionHash: `0x${"1".repeat(64)}`,
        nonce: "1",
        receiptReference: "receipt:op_finalize",
      },
    });
    await verifyBroadcastEvidence(pool, {
      reservationId: "res_finalize",
      audit: reconcilerAuditContext("op_finalize", "res_finalize", {
        transactionHash: `0x${"1".repeat(64)}`,
        nonce: "1",
        receiptReference: "receipt:op_finalize",
      }),
    });
    const finalized = await finalizeReservation(pool, {
      reservationId: "res_finalize",
      actualSpendAtomic: "25",
      proofReference: "receipt:op_finalize",
      audit: auditContext("op_finalize"),
    });
    expect(finalized).toMatchObject({
      status: "FINALIZED",
      finalizedSpendAtomic: "25",
    });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      allocated: "100",
      available: "75",
      reserved: "0",
      finalizedSpend: "25",
    });
  });

  test("rejects broadcast and finalization without adapter evidence", async () => {
    await insertOperation(pool, "op_forged_broadcast");
    await reserve(
      "op_forged_broadcast",
      "res_forged_broadcast",
      "forged-broadcast-key",
      "40",
    );
    await authorizeReservation(pool, {
      reservationId: "res_forged_broadcast",
      audit: auditContext("op_forged_broadcast"),
    });
    await expect(
      markReservationBroadcast(pool, {
        reservationId: "res_forged_broadcast",
        audit: auditContext("op_forged_broadcast"),
        evidence: {
          transactionHash: `0x${"3".repeat(64)}`,
          nonce: "3",
          receiptReference: "receipt:forged",
        },
      }),
    ).rejects.toMatchObject({ code: "COMPONENT_AUTHENTICATION_FAILED" });
    await expect(
      pool.query(
        "UPDATE budget_reservations SET status = 'BROADCAST' WHERE reservation_id = $1",
        ["res_forged_broadcast"],
      ),
    ).rejects.toThrow(/broadcast evidence required/i);
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "60",
      reserved: "40",
      finalizedSpend: "0",
    });
  });

  test("marks ambiguous state disputed without releasing reserved value", async () => {
    await insertOperation(pool, "op_dispute");
    await reserve("op_dispute", "res_dispute", "dispute-key", "35");
    expect(
      (
        await disputeReservation(pool, {
          reservationId: "res_dispute",
          reason: "broadcast outcome is ambiguous",
          audit: auditContext("op_dispute"),
        })
      ).status,
    ).toBe("DISPUTED");
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "65",
      reserved: "35",
      finalizedSpend: "0",
    });
  });

  test("does not finalize a disputed reservation without a verified resolution", async () => {
    await insertOperation(pool, "op_disputed_release");
    await reserve(
      "op_disputed_release",
      "res_disputed_release",
      "disputed-release-key",
      "35",
    );
    await disputeReservation(pool, {
      reservationId: "res_disputed_release",
      reason: "broadcast outcome is ambiguous",
      audit: auditContext("op_disputed_release"),
    });

    await expect(
      finalizeReservation(pool, {
        reservationId: "res_disputed_release",
        actualSpendAtomic: "0",
        proofReference: "unverified-reference",
        audit: auditContext("op_disputed_release"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESERVATION_TRANSITION" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "65",
      reserved: "35",
      finalizedSpend: "0",
    });
  });

  test("records authorization and broadcast reservation transitions before finalization", async () => {
    await insertOperation(pool, "op_lifecycle");
    await reserve("op_lifecycle", "res_lifecycle", "lifecycle-key", "40");
    expect(
      (
        await authorizeReservation(pool, {
          reservationId: "res_lifecycle",
          audit: auditContext("op_lifecycle"),
        })
      ).status,
    ).toBe("AUTHORIZED");
    expect(
      (
        await markReservationBroadcast(pool, {
          reservationId: "res_lifecycle",
          audit: adapterAuditContext("op_lifecycle", "res_lifecycle", {
            transactionHash: `0x${"2".repeat(64)}`,
            nonce: "2",
            receiptReference: "receipt:op_lifecycle",
          }),
          evidence: {
            transactionHash: `0x${"2".repeat(64)}`,
            nonce: "2",
            receiptReference: "receipt:op_lifecycle",
          },
        })
      ).status,
    ).toBe("BROADCAST");
    await expect(
      finalizeReservation(pool, {
        reservationId: "res_lifecycle",
        actualSpendAtomic: "25",
        proofReference: "receipt:op_lifecycle",
        audit: auditContext("op_lifecycle"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_BROADCAST_EVIDENCE" });
    await verifyBroadcastEvidence(pool, {
      reservationId: "res_lifecycle",
      audit: reconcilerAuditContext("op_lifecycle", "res_lifecycle", {
        transactionHash: `0x${"2".repeat(64)}`,
        nonce: "2",
        receiptReference: "receipt:op_lifecycle",
      }),
    });
    await expect(
      pool.query(
        "UPDATE reservation_broadcast_evidence SET transaction_hash = $1 WHERE reservation_id = $2",
        [`0x${"f".repeat(64)}`, "res_lifecycle"],
      ),
    ).rejects.toThrow(/immutable record/i);
    expect(
      (
        await finalizeReservation(pool, {
          reservationId: "res_lifecycle",
          actualSpendAtomic: "25",
          proofReference: "receipt:op_lifecycle",
          audit: auditContext("op_lifecycle"),
        })
      ).status,
    ).toBe("FINALIZED");
    expect(
      (
        await pool.query(
          `SELECT event_type FROM audit_events
           WHERE operation_id = $1
             AND event_type LIKE 'budget.reservation.%'
           ORDER BY sequence_no`,
          ["op_lifecycle"],
        )
      ).rows.map((row) => row.event_type),
    ).toEqual([
      "budget.reservation.created",
      "budget.reservation.authorized",
      "budget.reservation.broadcast",
      "budget.reservation.evidence.verified",
      "budget.reservation.finalized",
    ]);
  });

  test("verifies the persisted audit timestamp, correlation, hash, and chain link", async () => {
    await insertOperation(pool, "op_audit_verify");
    await reserve(
      "op_audit_verify",
      "res_audit_verify",
      "audit-verify-key",
      "10",
    );
    const rows = await pool.query<{
      event_id: string;
      event_type: string;
      occurred_at: Date;
      sequence_no: string;
      actor_type: string;
      actor_id: string;
      owner_id: string;
      agent_id: string;
      wallet_id: string;
      intent_id: string;
      operation_id: string;
      policy_id: string;
      policy_version: number;
      trace_id: string;
      data: Record<string, unknown>;
      previous_event_hash: string | null;
      event_hash: string;
    }>(
      "SELECT * FROM audit_events WHERE operation_id = $1 ORDER BY sequence_no",
      ["op_audit_verify"],
    );
    const row = rows.rows[0]!;
    const verified = verifyAuditEvent({
      eventId: row.event_id,
      eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
      sequence: Number(row.sequence_no),
      actorType: row.actor_type,
      actorId: row.actor_id,
      ownerId: row.owner_id,
      agentId: row.agent_id,
      walletId: row.wallet_id,
      intentId: row.intent_id,
      operationId: row.operation_id,
      policyId: row.policy_id,
      policyVersion: row.policy_version,
      traceId: row.trace_id,
      data: row.data,
      previousEventHash: row.previous_event_hash,
      eventHash: row.event_hash,
    });
    expect(verified.eventHash).toBe(row.event_hash);
    expect(() => verifyAuditEvent({ ...verified, traceId: "bad" })).toThrow();
    expect(() =>
      verifyAuditEvent({
        ...verified,
        eventHash: `0x${"f".repeat(64)}`,
      }),
    ).toThrow(/hash mismatch/);
    await expect(
      pool.query(
        `INSERT INTO audit_events
          (event_id, event_type, sequence_no, actor_type, actor_id, owner_id, agent_id, wallet_id,
           intent_id, operation_id, policy_id, policy_version, trace_id, data, previous_event_hash,
           event_hash, occurred_at, canonical_payload, reservation_id)
         VALUES ('evt_tampered', 'budget.reservation.created', 99, 'system', 'ledger-test',
           'owner_1', 'agent_1', 'wallet_1', 'intent_op_audit_verify', 'op_audit_verify',
           'policy_1', 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}'::jsonb, NULL,
           $1, '2026-08-13T00:00:00Z', '{}', 'res_audit_verify')`,
        [`0x${"0".repeat(64)}`],
      ),
    ).rejects.toThrow(
      /canonical audit payload|hash does not match|payload\/reservation correlation/i,
    );
  });

  test("retries SQLSTATE 40001 a bounded number of times", async () => {
    let attempts = 0;
    await expect(
      withSerializableTransaction(
        pool,
        async () => {
          attempts += 1;
          const error = new Error(
            "synthetic serialization failure",
          ) as Error & { code: string };
          error.code = "40001";
          throw error;
        },
        { maxRetries: 2, retryDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ code: "40001" });
    expect(attempts).toBe(3);
  });

  test("rolls back the balance when the transactional audit write fails", async () => {
    await insertOperation(pool, "op_audit_rollback");
    await expect(
      withSerializableTransaction(pool, async (client) => {
        await client.query(
          "UPDATE budget_accounts SET available = available - 10, reserved = reserved + 10 WHERE budget_id = 'budget_1'",
        );
        await appendAuditEvent(client, {
          ...persistedAuditInput("op_audit_rollback", "missing-rollback"),
          eventId: "evt_bad",
          eventType: "not-a-real-event",
          data: { amountAtomic: "10" },
        } as never);
      }),
    ).rejects.toThrow();
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "100",
      reserved: "0",
    });
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM audit_events"))
        .rows[0]?.count,
    ).toBe(0);
  });

  test("rejects untyped audit payloads and rolls back the state change", async () => {
    await insertOperation(pool, "op_audit_contract");
    await expect(
      withSerializableTransaction(pool, async (client) => {
        await client.query(
          "UPDATE budget_accounts SET available = available - 10, reserved = reserved + 10 WHERE budget_id = 'budget_1'",
        );
        await appendAuditEvent(client, {
          ...persistedAuditInput("op_audit_contract", "missing-contract"),
          eventId: "evt_audit_contract",
          eventType: "budget.reservation.created",
          data: { privateKey: "must-not-persist" },
        } as never);
      }),
    ).rejects.toThrow();
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "100",
      reserved: "0",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_audit_contract"],
        )
      ).rows[0]?.count,
    ).toBe(0);
  });

  test("returns the original state for an idempotent retry and rejects payload conflict", async () => {
    await insertOperation(pool, "op_idempotent");
    const first = await reserve(
      "op_idempotent",
      "res_idempotent",
      "same-key",
      "20",
    );
    const retry = await reserveBudget(pool, {
      reservationId: "different-id",
      budgetId: "budget_1",
      operationId: "op_idempotent",
      idempotencyKey: "same-key",
      idempotencyPayload: { amount: "20", operationId: "op_idempotent" },
      amountAtomic: "20",
      expiresAt: "2099-01-01T00:00:00.000Z",
      audit: auditContext("op_idempotent"),
    });
    expect(retry).toEqual(first);
    await expect(
      reserveBudget(pool, {
        reservationId: "other",
        budgetId: "budget_1",
        operationId: "op_idempotent",
        idempotencyKey: "same-key",
        idempotencyPayload: { amount: "21", operationId: "op_idempotent" },
        amountAtomic: "21",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: auditContext("op_idempotent"),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await getBudget(pool, "budget_1")).snapshot.reserved).toBe("20");
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM audit_events"))
        .rows[0]?.count,
    ).toBe(1);
  });

  test("rejects a same-payload retry whose bound request fields changed", async () => {
    await insertOperation(pool, "op_idempotency_binding");
    await reserveBudget(pool, {
      reservationId: "res_idempotency_binding",
      budgetId: "budget_1",
      operationId: "op_idempotency_binding",
      idempotencyKey: "bound-key",
      idempotencyPayload: { invoice: "same" },
      amountAtomic: "20",
      expiresAt: "2099-01-01T00:00:00.000Z",
      audit: auditContext("op_idempotency_binding"),
    });

    await expect(
      reserveBudget(pool, {
        reservationId: "different-reservation",
        budgetId: "budget_1",
        operationId: "op_idempotency_binding",
        idempotencyKey: "bound-key",
        idempotencyPayload: { invoice: "same" },
        amountAtomic: "21",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: auditContext("op_idempotency_binding"),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "80",
      reserved: "20",
    });
  });

  test("rejects a reservation whose operation and budget bindings differ", async () => {
    await insertOperation(pool, "op_binding_mismatch");
    await pool.query(
      "INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ('policy_2', 'owner_1', 'agent_1', 'wallet_1', 'active')",
    );
    await pool.query(
      "INSERT INTO policy_versions (policy_id, version, document, document_hash) VALUES ('policy_2', 1, '{\"schemaVersion\":\"1.0\"}', $1)",
      [`sha256:${"2".repeat(64)}`],
    );
    await pool.query(
      `INSERT INTO budget_accounts
       (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address,
        allocated, available, reserved, finalized_spend)
       VALUES ('budget_2', 'agent_1', 'wallet_1', 'policy_2', 1,
        '${assetAddress}', 100, 100, 0, 0)`,
    );
    await expect(
      reserveBudget(pool, {
        reservationId: "res_binding_mismatch",
        budgetId: "budget_2",
        operationId: "op_binding_mismatch",
        idempotencyKey: "binding-mismatch-key",
        idempotencyPayload: { invoice: "binding" },
        amountAtomic: "10",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: auditContext("op_binding_mismatch"),
      }),
    ).rejects.toMatchObject({ code: "BUDGET_BINDING_MISMATCH" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "100",
      reserved: "0",
    });
    await expect(
      pool.query(
        "UPDATE budget_accounts SET policy_id = 'policy_2' WHERE budget_id = 'budget_1'",
      ),
    ).rejects.toThrow(/immutable budget binding/i);
  });

  test("coalesces concurrent worker retries into one reservation and audit event", async () => {
    await insertOperation(pool, "op_worker_retry");
    const requests = Array.from({ length: 8 }, (_, index) =>
      reserveBudget(pool, {
        reservationId: `retry-reservation-${index}`,
        budgetId: "budget_1",
        operationId: "op_worker_retry",
        idempotencyKey: "worker-retry-key",
        idempotencyPayload: { invoice: "same", amount: "20" },
        amountAtomic: "20",
        expiresAt: "2099-01-01T00:00:00.000Z",
        audit: auditContext("op_worker_retry"),
      }),
    );
    const results = await Promise.all(requests);
    const reservationIds = new Set(
      results.map((result) => result.reservationId),
    );
    expect(reservationIds.size).toBe(1);
    expect([...reservationIds][0]).toMatch(/^retry-reservation-[0-7]$/);
    expect((await getBudget(pool, "budget_1")).snapshot.reserved).toBe("20");
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM budget_reservations WHERE idempotency_key = $1",
          ["worker-retry-key"],
        )
      ).rows[0]?.count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_worker_retry"],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  test("replays the original reservation after a simulated lost worker response", async () => {
    await insertOperation(pool, "op_response_loss");
    const request = {
      reservationId: "response-loss-original",
      budgetId: "budget_1",
      operationId: "op_response_loss",
      idempotencyKey: "response-loss-key",
      idempotencyPayload: { invoice: "response-loss", amount: "20" },
      amountAtomic: "20",
      expiresAt: "2099-01-01T00:00:00.000Z",
      audit: auditContext("op_response_loss"),
    } as const;
    await expect(
      (async () => {
        await reserveBudget(pool, request);
        throw new Error("worker response lost after commit");
      })(),
    ).rejects.toThrow("worker response lost after commit");
    const retry = await reserveBudget(pool, {
      ...request,
      reservationId: "response-loss-retry",
    });
    expect(retry.reservationId).toBe("response-loss-original");
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "80",
      reserved: "20",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_response_loss"],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  test("retries a mutated serializable transaction without duplicating its audit event", async () => {
    await insertOperation(pool, "op_serializable_retry");
    await reserve(
      "op_serializable_retry",
      "res_serializable_retry",
      "serializable-retry-key",
      "1",
    );
    let attempts = 0;
    await withSerializableTransaction(pool, async (client) => {
      attempts += 1;
      await client.query(
        "UPDATE budget_accounts SET available = available - 10, reserved = reserved + 10 WHERE budget_id = 'budget_1'",
      );
      await appendAuditEvent(client, {
        ...persistedAuditInput(
          "op_serializable_retry",
          "res_serializable_retry",
        ),
        eventId: "evt_serializable_retry",
        eventType: "budget.reservation.created",
        data: {
          reservationId: "res_serializable_retry",
          amountAtomic: "10",
        },
      });
      if (attempts === 1) {
        const error = new Error("synthetic serialization failure") as Error & {
          code: string;
        };
        error.code = "40001";
        throw error;
      }
    });
    expect(attempts).toBe(2);
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "89",
      reserved: "11",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1",
          ["op_serializable_retry"],
        )
      ).rows[0]?.count,
    ).toBe(2);
  });

  test("retries a real PostgreSQL serialization failure without duplicating audit", async () => {
    await insertOperation(pool, "op_real_serialization_1");
    await insertOperation(pool, "op_real_serialization_2");
    await reserve(
      "op_real_serialization_1",
      "res_real_serialization_1",
      "real-serialization-key-1",
      "10",
    );
    await reserve(
      "op_real_serialization_2",
      "res_real_serialization_2",
      "real-serialization-key-2",
      "10",
    );
    let firstPasses = 0;
    let ready = 0;
    let release!: () => void;
    const start = new Promise<void>((resolve) => {
      release = resolve;
    });
    let allReady!: () => void;
    const readyBarrier = new Promise<void>((resolve) => {
      allReady = resolve;
    });
    const run = (operationId: string) =>
      withSerializableTransaction(pool, async (client) => {
        const firstPass = firstPasses < 2;
        firstPasses += 1;
        await client.query(
          "SELECT available FROM budget_accounts WHERE budget_id = 'budget_1'",
        );
        if (firstPass) {
          ready += 1;
          if (ready === 2) allReady();
          await start;
        }
        await client.query(
          "UPDATE budget_accounts SET available = available - 10, reserved = reserved + 10 WHERE budget_id = 'budget_1'",
        );
        await appendAuditEvent(client, {
          ...persistedAuditInput(
            operationId,
            operationId === "op_real_serialization_1"
              ? "res_real_serialization_1"
              : "res_real_serialization_2",
          ),
          eventId: `evt_${operationId}`,
          eventType: "budget.reservation.created",
          data: {
            reservationId:
              operationId === "op_real_serialization_1"
                ? "res_real_serialization_1"
                : "res_real_serialization_2",
            amountAtomic: "10",
          },
        });
      });
    const requests = [
      run("op_real_serialization_1"),
      run("op_real_serialization_2"),
    ];
    await readyBarrier;
    release();
    await Promise.all(requests);
    expect(firstPasses).toBe(3);
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "60",
      reserved: "40",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE event_type = 'budget.reservation.created'",
        )
      ).rows[0]?.count,
    ).toBe(4);
  });

  test("enforces immutable policy versions and append-only audit rows", async () => {
    await insertOperation(pool, "op_immutable");
    await expect(
      pool.query(
        "UPDATE policy_versions SET document = '{\"changed\":true}' WHERE policy_id = 'policy_1' AND version = 1",
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      pool.query(
        "DELETE FROM policy_versions WHERE policy_id = 'policy_1' AND version = 1",
      ),
    ).rejects.toThrow(/immutable/i);
    await reserve("op_immutable", "res_immutable", "immutable-key", "10");
    await expect(pool.query("DELETE FROM audit_events")).rejects.toThrow(
      /immutable/i,
    );
    await expect(
      pool.query(
        "UPDATE idempotency_records SET payload_hash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'",
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(pool.query("DELETE FROM idempotency_records")).rejects.toThrow(
      /immutable/i,
    );
  });
});
