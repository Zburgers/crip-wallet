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
import {
  applyMigrations,
  authorizeReservation as verifyAuthorizedReservation,
  claimRecoveryLease,
  getBudget,
  markReservationBroadcast,
  resolveRecovery,
  reserveBudget,
  verifyBroadcastEvidence,
  type AuditContext,
  type BroadcastEvidence,
  type RecoveryLease,
  type RecoveryResolution,
} from "@crip/budget-ledger";
import { attachEnvelopeHash } from "@crip/schemas";
import {
  generateComponentCredential,
  signComponentAction,
} from "@crip/trust-boundary";
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
const asset = "0x0000000000000000000000000000000000000001";
const zeroHash = `0x${"1".repeat(64)}`;
const ownerCredential = createLocalOwnerTestCredential(
  "owner_1",
  "owner_1_wp05_key",
);
const adapter = generateComponentCredential({
  credentialId: "credential_wp05_adapter",
  componentId: "adapter_wp05",
  role: "ADAPTER",
});
const reconciler = generateComponentCredential({
  credentialId: "credential_wp05_reconciler",
  componentId: "reconciler_wp05",
  role: "RECONCILER",
});

const now = (): string => new Date().toISOString();
const trace = (value: string): string =>
  createHash("md5").update(value).digest("hex");
const audit = (operationId: string, suffix: string): AuditContext => ({
  eventId: `evt:${operationId}:${suffix}`,
  actorType: "system",
  actorId: "untrusted-caller-label",
  traceId: trace(`${operationId}:${suffix}`),
});
const approvalAudit = (
  operationId: string,
  suffix: string,
  actorType: ApprovalAuditContext["actorType"] = "system",
): ApprovalAuditContext => ({
  eventId: `evt:${operationId}:approval:${suffix}`,
  actorType,
  actorId: actorType === "owner" ? "owner_1" : "authorization-test",
  traceId: trace(`${operationId}:approval:${suffix}`),
});

const evidence = (suffix: string): BroadcastEvidence => ({
  transactionHash: `0x${suffix.repeat(64).slice(0, 64)}`,
  nonce: "1",
  receiptReference: `receipt:wp05:${suffix}`,
});

const adapterAudit = (
  operationId: string,
  reservationId: string,
  value: BroadcastEvidence,
): AuditContext => ({
  ...audit(operationId, `adapter:${reservationId}`),
  actorType: "adapter",
  actorId: "adapter:impersonated-label",
  componentAuth: signComponentAction(adapter, "broadcast", {
    reservationId,
    transactionHash: value.transactionHash,
    nonce: value.nonce,
    receiptReference: value.receiptReference,
  }),
});

const reconcilerAudit = (
  operationId: string,
  reservationId: string,
  value: BroadcastEvidence | null,
): AuditContext => ({
  ...audit(operationId, `reconciler:${reservationId}`),
  actorType: "worker",
  actorId: "reconciler:impersonated-label",
  componentAuth: signComponentAction(reconciler, "verify", {
    reservationId,
    ...(value ?? {}),
  }),
});

const recoveryPayload = (
  value: RecoveryResolution,
  broadcast: BroadcastEvidence | null,
): Record<string, unknown> => ({
  attemptId: value.attemptId,
  operationId: value.operationId,
  reservationId: value.reservationId,
  leaseVersion: value.leaseVersion,
  outcome: value.outcome,
  reason: value.reason,
  actualSpendAtomic: value.actualSpendAtomic ?? null,
  proofReference: value.proofReference ?? null,
  evidence: broadcast,
});

const recoveryAudit = (
  value: RecoveryResolution,
  broadcast: BroadcastEvidence | null,
): AuditContext => ({
  ...audit(value.operationId, `recovery:${value.attemptId}`),
  actorType: "worker",
  actorId: "reconciler:forged-label",
  componentAuth: signComponentAction(
    reconciler,
    "recovery.resolve",
    recoveryPayload(value, broadcast),
  ),
});

const claimAudit = (
  operationId: string,
  reservationId: string,
  attemptId: string,
  leaseDurationSeconds: number,
): AuditContext => ({
  ...audit(operationId, `claim:${attemptId}`),
  actorType: "worker",
  actorId: "worker:forged-label",
  componentAuth: signComponentAction(reconciler, "recovery.claim", {
    attemptId,
    operationId,
    reservationId,
    leaseDurationSeconds,
  }),
});

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

const authorizeCanonically = async (
  operationId: string,
  reservationId: string,
  amount: string,
): Promise<void> => {
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
    to: asset,
    value: "0",
    calldata: "0xa9059cbb",
    decodedFunction: "erc20.transfer",
    decodedArguments: {
      assetAddress: asset,
      recipient: "0x0000000000000000000000000000000000000020",
      amountAtomic: amount,
    },
    expectedAssetDeltas: [
      {
        assetAddress: asset,
        from: "0x0000000000000000000000000000000000000010",
        to: "0x0000000000000000000000000000000000000020",
        amountAtomic: amount,
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
  await pool.query(
    `UPDATE operations
     SET current_state = 'ENVELOPE_FINALIZED', version = version + 1
     WHERE operation_id = $1 AND current_state = 'POLICY_FINALIZED'`,
    [operationId],
  );
  const approvalId = `approval_${operationId}`;
  const approvalExpiresAt = "2099-01-01T10:05:00Z";
  const approvalNonce = `nonce_${operationId}`;
  await createApprovalRequest(pool, {
    approvalId,
    operationId,
    reservationId,
    envelopeId: envelope.envelopeId,
    envelopeRevision: envelope.revision,
    envelopeHash: envelope.envelopeHash,
    policyDecisionId: decisionId,
    issuedAt: "2020-01-01T10:00:00Z",
    expiresAt: approvalExpiresAt,
    nonce: approvalNonce,
    audit: approvalAudit(operationId, "requested"),
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
    now: "2099-01-01T10:01:00Z",
    audit: approvalAudit(operationId, "approved", "owner"),
  });
  await consumeApproval(pool, {
    approvalId,
    operationId,
    envelopeId: envelope.envelopeId,
    envelopeRevision: envelope.revision,
    envelopeHash: envelope.envelopeHash,
    consumerId: "authorization-service",
    now: "2099-01-01T10:02:00Z",
    audit: approvalAudit(operationId, "consumed"),
  });
  await verifyAuthorizedReservation(pool, {
    reservationId,
    audit: audit(operationId, "authorize-verified"),
  });
};

const reserve = async (
  operationId: string,
  reservationId: string,
  amount = "20",
): Promise<void> => {
  await reserveBudget(pool, {
    reservationId,
    budgetId: "budget_1",
    operationId,
    idempotencyKey: `reserve-key-${operationId}`,
    idempotencyPayload: { operationId, amount },
    amountAtomic: amount,
    expiresAt: "2099-01-01T00:00:00.000Z",
    audit: audit(operationId, "reserve"),
  });
  await authorizeCanonically(operationId, reservationId, amount);
};

const reserveForRecoveryClaim = async (
  operationId: string,
  reservationId: string,
  amount = "20",
): Promise<void> => {
  await reserveBudget(pool, {
    reservationId,
    budgetId: "budget_1",
    operationId,
    idempotencyKey: `reserve-key-${operationId}`,
    idempotencyPayload: { operationId, amount },
    amountAtomic: amount,
    expiresAt: "2099-01-01T00:00:00.000Z",
    audit: audit(operationId, "reserve"),
  });
};

const setup = async (): Promise<void> => {
  await pool.query(`
    INSERT INTO owners (owner_id, display_name) VALUES ('owner_1', 'WP05 owner');
    INSERT INTO agents (agent_id, owner_id, display_name) VALUES ('agent_1', 'owner_1', 'WP05 agent');
    INSERT INTO wallets (wallet_id, owner_id, display_name) VALUES ('wallet_1', 'owner_1', 'WP05 wallet');
    INSERT INTO policies (policy_id, owner_id, agent_id, wallet_id, status) VALUES ('policy_1', 'owner_1', 'agent_1', 'wallet_1', 'active');
    INSERT INTO policy_versions (policy_id, version, document, document_hash) VALUES ('policy_1', 1, '{"schemaVersion":"1.0"}', 'sha256:${"0".repeat(64)}');
    INSERT INTO control_fences (scope_type, scope_id, state) VALUES
      ('SYSTEM', 'system', 'ACTIVE'), ('OWNER', 'owner_1', 'ACTIVE'),
      ('AGENT', 'agent_1', 'ACTIVE'), ('POLICY', 'policy_1', 'ACTIVE');
    INSERT INTO trusted_component_credentials (credential_id, component_id, component_role, public_key)
      VALUES ('${adapter.credentialId}', '${adapter.componentId}', 'ADAPTER', '${adapter.publicKey}'),
             ('${reconciler.credentialId}', '${reconciler.componentId}', 'RECONCILER', '${reconciler.publicKey}');
    INSERT INTO budget_accounts (budget_id, agent_id, wallet_id, policy_id, policy_version, asset_address, allocated, available, reserved, finalized_spend)
      VALUES ('budget_1', 'agent_1', 'wallet_1', 'policy_1', 1, '${asset}', 100, 100, 0, 0);
  `);
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

const reset = async (): Promise<void> => {
  await pool.query(
    "TRUNCATE recovery_attempts, operation_recovery_leases, trusted_component_credentials, audit_events, idempotency_records, budget_reservations, budget_accounts, operations, intents, policy_decisions, execution_envelopes, policy_versions, policies, wallets, agents, owners, control_fences CASCADE",
  );
  await setup();
};

const broadcast = async (
  operationId: string,
  reservationId: string,
  value: BroadcastEvidence,
): Promise<void> => {
  await markReservationBroadcast(pool, {
    reservationId,
    evidence: value,
    audit: adapterAudit(operationId, reservationId, value),
  });
};

const claim = async (
  operationId: string,
  reservationId: string,
  attemptId: string,
  leaseDurationSeconds = 60,
): Promise<RecoveryLease> =>
  claimRecoveryLease(pool, {
    attemptId,
    operationId,
    reservationId,
    leaseDurationSeconds,
    now: now(),
    audit: claimAudit(
      operationId,
      reservationId,
      attemptId,
      leaseDurationSeconds,
    ),
  });

describe.sequential("WP-05 authenticated reconciliation and recovery", () => {
  beforeAll(async () => applyMigrations(pool));
  beforeEach(reset);
  afterAll(async () => pool.end());

  test("rejects unauthenticated adapters and impersonated reconcilers", async () => {
    await insertOperation("op_auth_reject");
    await reserve("op_auth_reject", "res_auth_reject");
    const value = evidence("a");
    await expect(
      markReservationBroadcast(pool, {
        reservationId: "res_auth_reject",
        evidence: value,
        audit: audit("op_auth_reject", "unauthenticated-adapter"),
      }),
    ).rejects.toMatchObject({ code: "COMPONENT_AUTHENTICATION_FAILED" });
    const forged = adapterAudit("op_auth_reject", "res_auth_reject", value);
    forged.componentAuth = {
      ...forged.componentAuth!,
      componentId: "adapter_impostor",
    };
    await expect(
      markReservationBroadcast(pool, {
        reservationId: "res_auth_reject",
        evidence: value,
        audit: forged,
      }),
    ).rejects.toMatchObject({ code: "COMPONENT_AUTHENTICATION_FAILED" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "80",
      reserved: "20",
    });
  });

  test("accepts authenticated adapter and reconciler identities", async () => {
    await insertOperation("op_auth_accept");
    await reserve("op_auth_accept", "res_auth_accept");
    const value = evidence("b");
    await broadcast("op_auth_accept", "res_auth_accept", value);
    const impersonatedReconciler = adapterAudit(
      "op_auth_accept",
      "res_auth_accept",
      value,
    );
    impersonatedReconciler.actorType = "worker";
    impersonatedReconciler.actorId = "reconciler:spoofed-label";
    await expect(
      verifyBroadcastEvidence(pool, {
        reservationId: "res_auth_accept",
        audit: impersonatedReconciler,
      }),
    ).rejects.toMatchObject({ code: "COMPONENT_AUTHENTICATION_FAILED" });
    await verifyBroadcastEvidence(pool, {
      reservationId: "res_auth_accept",
      audit: reconcilerAudit("op_auth_accept", "res_auth_accept", value),
    });
    const row = await pool.query<{
      adapter_component_id: string;
      verification_component_id: string;
      verification_status: string;
    }>(
      "SELECT adapter_component_id, verification_component_id, verification_status FROM reservation_broadcast_evidence WHERE reservation_id = $1",
      ["res_auth_accept"],
    );
    expect(row.rows[0]).toEqual({
      adapter_component_id: "adapter_wp05",
      verification_component_id: "reconciler_wp05",
      verification_status: "VERIFIED",
    });
  });

  test("binds lease duration into recovery claim authentication", async () => {
    await insertOperation("op_claim_duration");
    await reserveForRecoveryClaim("op_claim_duration", "res_claim_duration");
    const signedAudit = claimAudit(
      "op_claim_duration",
      "res_claim_duration",
      "attempt_claim_duration",
      60,
    );
    await expect(
      claimRecoveryLease(pool, {
        attemptId: "attempt_claim_duration",
        operationId: "op_claim_duration",
        reservationId: "res_claim_duration",
        leaseDurationSeconds: 61,
        now: "9999-01-01T00:00:00Z",
        audit: signedAudit,
      }),
    ).rejects.toMatchObject({ code: "COMPONENT_AUTHENTICATION_FAILED" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM operation_recovery_leases WHERE operation_id = $1",
          ["op_claim_duration"],
        )
      ).rows[0]?.count,
    ).toBe(0);
  });

  test("uses the database clock and bounds recovery lease duration", async () => {
    await insertOperation("op_claim_clock");
    await reserveForRecoveryClaim("op_claim_clock", "res_claim_clock");
    const lease = await claimRecoveryLease(pool, {
      attemptId: "attempt_claim_clock",
      operationId: "op_claim_clock",
      reservationId: "res_claim_clock",
      leaseDurationSeconds: 120,
      now: "1900-01-01T00:00:00Z",
      audit: claimAudit(
        "op_claim_clock",
        "res_claim_clock",
        "attempt_claim_clock",
        120,
      ),
    });
    const timing = await pool.query<{
      lease_is_live: boolean;
      remaining_seconds: string;
    }>(
      `SELECT lease_expires_at > clock_timestamp() AS lease_is_live,
            extract(epoch FROM (lease_expires_at - clock_timestamp()))::text AS remaining_seconds
     FROM operation_recovery_leases WHERE operation_id = $1`,
      ["op_claim_clock"],
    );
    expect(timing.rows[0]?.lease_is_live).toBe(true);
    expect(Number(timing.rows[0]?.remaining_seconds)).toBeGreaterThan(100);
    expect(lease.leaseExpiresAt).not.toContain("1900");

    await expect(
      claimRecoveryLease(pool, {
        attemptId: "attempt_claim_steal",
        operationId: "op_claim_clock",
        reservationId: "res_claim_clock",
        leaseDurationSeconds: 120,
        now: "9999-01-01T00:00:00Z",
        audit: claimAudit(
          "op_claim_clock",
          "res_claim_clock",
          "attempt_claim_steal",
          120,
        ),
      }),
    ).rejects.toMatchObject({ code: "RECOVERY_LEASE_HELD" });

    await expect(
      claimRecoveryLease(pool, {
        attemptId: "attempt_claim_unbounded",
        operationId: "op_claim_clock",
        reservationId: "res_claim_clock",
        leaseDurationSeconds: 301,
        audit: claimAudit(
          "op_claim_clock",
          "res_claim_clock",
          "attempt_claim_unbounded",
          301,
        ),
      }),
    ).rejects.toMatchObject({ code: "RECOVERY_LEASE_STALE" });
  });

  test("response loss is replay-safe and ambiguous recovery retains funds", async () => {
    await insertOperation("op_response_loss");
    await reserve("op_response_loss", "res_response_loss", "30");
    const value = evidence("c");
    await broadcast("op_response_loss", "res_response_loss", value);
    await expect(
      broadcast("op_response_loss", "res_response_loss", value),
    ).resolves.toBeUndefined();
    const lease = await claim(
      "op_response_loss",
      "res_response_loss",
      "attempt_response_loss",
    );
    const resolution: RecoveryResolution = {
      attemptId: "attempt_response_loss",
      operationId: "op_response_loss",
      reservationId: "res_response_loss",
      leaseVersion: lease.leaseVersion,
      outcome: "AMBIGUOUS",
      reason: "adapter response was lost after the execution boundary",
    };
    await expect(
      resolveRecovery(pool, {
        ...resolution,
        audit: recoveryAudit(resolution, value),
      }),
    ).resolves.toMatchObject({ status: "DISPUTED" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "70",
      reserved: "30",
      finalizedSpend: "0",
    });
  });

  test("crash before persistence can be recovered after lease expiry", async () => {
    await insertOperation("op_crash_before");
    await reserve("op_crash_before", "res_crash_before");
    const expiredLease = await claim(
      "op_crash_before",
      "res_crash_before",
      "attempt_crash_before",
      1,
    );
    await pool.query(
      "UPDATE operation_recovery_leases SET lease_expires_at = now() - interval '1 second' WHERE operation_id = $1",
      ["op_crash_before"],
    );
    const lease = await claim(
      "op_crash_before",
      "res_crash_before",
      "attempt_crash_after",
    );
    expect(BigInt(lease.leaseVersion)).toBe(
      BigInt(expiredLease.leaseVersion) + 1n,
    );
    const resolution: RecoveryResolution = {
      attemptId: "attempt_crash_after",
      operationId: "op_crash_before",
      reservationId: "res_crash_before",
      leaseVersion: lease.leaseVersion,
      outcome: "AMBIGUOUS",
      reason: "worker crashed before durable outcome persistence",
    };
    await expect(
      resolveRecovery(pool, {
        ...resolution,
        audit: recoveryAudit(resolution, null),
      }),
    ).resolves.toMatchObject({ status: "DISPUTED" });
  });

  test("crash after evidence persistence and duplicate recovery finalize once", async () => {
    await insertOperation("op_crash_after");
    await reserve("op_crash_after", "res_crash_after", "40");
    const value = evidence("d");
    await broadcast("op_crash_after", "res_crash_after", value);
    const lease = await claim(
      "op_crash_after",
      "res_crash_after",
      "attempt_finalize",
    );
    const resolution: RecoveryResolution = {
      attemptId: "attempt_finalize",
      operationId: "op_crash_after",
      reservationId: "res_crash_after",
      leaseVersion: lease.leaseVersion,
      outcome: "CONFIRMED",
      reason: "receipt recovered after worker crash",
      actualSpendAtomic: "25",
      proofReference: value.receiptReference,
    };
    const result = await resolveRecovery(pool, {
      ...resolution,
      audit: recoveryAudit(resolution, value),
    });
    await expect(
      resolveRecovery(pool, {
        ...resolution,
        audit: recoveryAudit(resolution, value),
      }),
    ).resolves.toMatchObject({ status: "FINALIZED" });
    expect(result).toMatchObject({
      status: "FINALIZED",
      finalizedSpendAtomic: "25",
    });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "75",
      reserved: "0",
      finalizedSpend: "25",
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE operation_id = $1 AND event_type = 'budget.reservation.finalized'",
          ["op_crash_after"],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  test("simultaneous recoverers and stale workers cannot mutate the reservation", async () => {
    await insertOperation("op_race_recovery");
    await reserve("op_race_recovery", "res_race_recovery");
    const attempts = await Promise.allSettled([
      claim("op_race_recovery", "res_race_recovery", "attempt_race_a"),
      claim("op_race_recovery", "res_race_recovery", "attempt_race_b"),
    ]);
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    const winner = attempts.find(
      (item) => item.status === "fulfilled",
    ) as PromiseFulfilledResult<RecoveryLease>;
    const stale = await pool.query(
      "UPDATE operation_recovery_leases SET lease_expires_at = now() - interval '1 second' WHERE operation_id = $1",
      ["op_race_recovery"],
    );
    expect(stale.rowCount).toBe(1);
    const nextLease = await claim(
      "op_race_recovery",
      "res_race_recovery",
      "attempt_race_c",
    );
    const staleResolution: RecoveryResolution = {
      attemptId: "attempt_race_a",
      operationId: "op_race_recovery",
      reservationId: "res_race_recovery",
      leaseVersion: winner.value.leaseVersion,
      outcome: "AMBIGUOUS",
      reason: "stale worker",
    };
    await expect(
      resolveRecovery(pool, {
        ...staleResolution,
        audit: recoveryAudit(staleResolution, null),
      }),
    ).rejects.toMatchObject({ code: "RECOVERY_LEASE_STALE" });
    expect(BigInt(nextLease.leaseVersion)).toBe(
      BigInt(winner.value.leaseVersion) + 1n,
    );
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "80",
      reserved: "20",
      finalizedSpend: "0",
    });
  });

  test("conflicting evidence is rejected and protected funds remain held", async () => {
    await insertOperation("op_conflict");
    await reserve("op_conflict", "res_conflict", "15");
    const first = evidence("e");
    const second = evidence("f");
    await broadcast("op_conflict", "res_conflict", first);
    await expect(
      broadcast("op_conflict", "res_conflict", second),
    ).rejects.toMatchObject({
      code: "RECOVERY_CONFLICT",
    });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "85",
      reserved: "15",
      finalizedSpend: "0",
    });
  });

  test("verified revert releases the reservation with zero token spend", async () => {
    await insertOperation("op_verified_revert");
    await reserve("op_verified_revert", "res_verified_revert", "15");
    const value = evidence("b");
    await broadcast("op_verified_revert", "res_verified_revert", value);
    // Reconciliation begins after the signer has advanced the operation.
    await pool.query(
      "UPDATE operations SET current_state = 'SIGNED', version = version + 1 WHERE operation_id = $1",
      ["op_verified_revert"],
    );
    await verifyBroadcastEvidence(pool, {
      reservationId: "res_verified_revert",
      audit: reconcilerAudit(
        "op_verified_revert",
        "res_verified_revert",
        value,
      ),
    });
    const lease = await claim(
      "op_verified_revert",
      "res_verified_revert",
      "attempt_verified_revert",
    );
    const resolution = {
      attemptId: "attempt_verified_revert",
      operationId: "op_verified_revert",
      reservationId: "res_verified_revert",
      leaseVersion: lease.leaseVersion,
      outcome: "FAILED" as const,
      reason: "matching status-0 receipt proves the transfer reverted",
      actualSpendAtomic: "0",
      proofReference: value.receiptReference,
      verifiedRevert: true,
    };
    const recovery = recoveryAudit(resolution, value);
    recovery.componentAuth = signComponentAction(
      reconciler,
      "recovery.resolve",
      { ...recoveryPayload(resolution, value), verifiedRevert: true },
    );

    await expect(
      resolveRecovery(pool, { ...resolution, audit: recovery }),
    ).resolves.toMatchObject({ status: "RELEASED" });
    expect((await getBudget(pool, "budget_1")).snapshot).toMatchObject({
      available: "100",
      reserved: "0",
      finalizedSpend: "0",
    });
  });
});
