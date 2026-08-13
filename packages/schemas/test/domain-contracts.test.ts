import { describe, expect, it } from "vitest";

import {
  ENFORCEMENT_GRADES,
  ERROR_CODES,
  LIFECYCLE_TRANSITIONS,
  adapterCapabilityManifestSchema,
  auditEventSchema,
  canonicalExecutionEnvelopeSchema,
  errorCodeSchema,
  stableErrorSchema,
  isValidLifecycleTransition,
  lifecycleStateSchema,
  lifecycleTransitionSchema,
  meetsMinimumEnforcementGrade,
  policyDecisionSchema,
  policySchema,
  telemetryAttributeSchema,
  transitionLifecycleState,
} from "../src/index.js";

const policy = {
  schemaVersion: "1.0",
  policyId: "policy_local_agent_01",
  version: 1,
  status: "active",
  subject: {
    agentId: "agent_local_01",
    walletId: "wallet_local_01",
  },
  mode: "autonomous-within-policy",
  validity: {
    notBefore: "2026-08-06T00:00:00Z",
    expiresAt: "2026-08-07T00:00:00Z",
  },
  chains: { allow: ["eip155:31337"] },
  assets: {
    allow: [
      {
        chainId: "eip155:31337",
        type: "erc20",
        address: "0x1111111111111111111111111111111111111111",
      },
    ],
  },
  recipients: {
    allow: ["0x2222222222222222222222222222222222222222"],
  },
  actions: { allow: ["asset.transfer"] },
  budgets: {
    total: {
      assetAddress: "0x1111111111111111111111111111111111111111",
      atomic: "2000000",
    },
    perTransaction: { atomic: "500000" },
  },
  networkFees: { maximumPerTransactionAtomic: "1000000000000000" },
  signatures: {
    personalSign: "deny",
    typedData: "deny",
    rawDigest: "deny",
  },
  transactions: {
    requireSimulation: true,
    denyUnknownCalldata: true,
    denyDelegatecall: true,
    denyUnlimitedApprovals: true,
  },
  enforcement: {
    minimumBudgetGrade: "CONTROL_PLANE",
    minimumRecipientGrade: "CONTROL_PLANE",
  },
} as const;

const policyDecision = {
  schemaVersion: "1.0",
  decision: "ALLOW_AUTONOMOUS",
  policyId: "policy_local_agent_01",
  policyVersion: 1,
  evaluatedAt: "2026-08-06T15:01:00Z",
  rules: [
    {
      rule: "chain.allowlist",
      result: "pass",
    },
    {
      rule: "budget.per_transaction",
      result: "pass",
      limitAtomic: "500000",
      requestedAtomic: "500000",
    },
  ],
  requiredEnforcement: { budget: "CONTROL_PLANE" },
  decisionHash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
} as const;

const envelope = {
  schemaVersion: "1.0",
  envelopeId: "env_local_001",
  revision: 1,
  intentId: "int_local_001",
  intentHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  agentId: "agent_local_01",
  walletId: "wallet_local_01",
  adapterId: "local-anvil",
  adapterVersion: "0.1.0",
  chainId: "eip155:31337",
  from: "0x3333333333333333333333333333333333333333",
  to: "0x1111111111111111111111111111111111111111",
  value: "0",
  calldata: "0xa9059cbb",
  decodedFunction: "erc20.transfer",
  decodedArguments: {
    assetAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    amountAtomic: "500000",
  },
  expectedAssetDeltas: [
    {
      assetAddress: "0x1111111111111111111111111111111111111111",
      from: "0x3333333333333333333333333333333333333333",
      to: "0x2222222222222222222222222222222222222222",
      amountAtomic: "500000",
    },
  ],
  simulationBlockReference: "0x10",
  simulationResultHash:
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  nonceStrategy: "pending",
  gasLimit: "100000",
  maximumFeeConstraints: {
    asset: "native",
    maxFeePerGas: "1000000000",
    maximumNetworkFeeAtomic: "1000000000000000",
  },
  policyId: "policy_local_agent_01",
  policyVersion: 1,
  policyDecisionHash:
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  budgetReservationId: "res_local_001",
  createdAt: "2026-08-06T15:02:00Z",
  expiresAt: "2026-08-06T15:10:00Z",
  riskDecision: "ALLOW",
  approvalRequirement: "none",
  envelopeHash:
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
} as const;

const adapterManifest = {
  adapter: { id: "local-anvil", version: "0.1.0" },
  chains: ["eip155:31337"],
  custody: {
    model: "disposable-local-test-key",
    ownerKeyExposedToAgent: false,
  },
  operations: {
    readState: true,
    erc20Transfer: true,
    arbitraryCall: false,
    typedData: false,
  },
  enforcement: {
    totalBudget: "CONTROL_PLANE",
    perTransactionBudget: "CONTROL_PLANE",
    chainAllowlist: "CONTROL_PLANE",
    recipientAllowlist: "CONTROL_PLANE",
    functionAllowlist: "CONTROL_PLANE",
    expiry: "CONTROL_PLANE",
  },
  approvals: { asynchronous: true },
  simulation: { supported: true },
} as const;

const auditEvent = {
  eventId: "evt_local_001",
  eventType: "budget.reservation.created",
  occurredAt: "2026-08-06T15:01:05Z",
  actorType: "system",
  actorId: "policy-engine",
  ownerId: "owner_local_01",
  agentId: "agent_local_01",
  walletId: "wallet_local_01",
  intentId: "int_local_001",
  operationId: "op_local_001",
  policyId: "policy_local_agent_01",
  policyVersion: 1,
  traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  data: {
    reservationId: "res_local_001",
    assetAddress: "0x1111111111111111111111111111111111111111",
    amountAtomic: "500000",
  },
  previousEventHash: null,
  eventHash:
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
} as const;

describe("policy and policy-decision contracts", () => {
  it("accepts the canonical strict policy", () => {
    expect(policySchema.parse(policy)).toEqual(policy);
  });

  it.each([
    ["unknown top-level field", { ...policy, unlimited: true }],
    [
      "unknown nested field",
      { ...policy, subject: { ...policy.subject, ownerId: "owner" } },
    ],
    ["float policy version", { ...policy, version: 1.5 }],
    ["unsupported mode", { ...policy, mode: "anything-goes" }],
    [
      "lowercase enforcement grade",
      {
        ...policy,
        enforcement: {
          ...policy.enforcement,
          minimumBudgetGrade: "control_plane",
        },
      },
    ],
    ["noncanonical address", { ...policy, recipients: { allow: ["0xABC"] } }],
  ])("rejects %s", (_name, candidate) => {
    expect(policySchema.safeParse(candidate).success).toBe(false);
  });

  it("accepts a policy decision and supports fail-closed indeterminate", () => {
    expect(policyDecisionSchema.parse(policyDecision)).toEqual(policyDecision);
    expect(
      policyDecisionSchema.parse({
        ...policyDecision,
        decision: "INDETERMINATE",
      }).decision,
    ).toBe("INDETERMINATE");
  });

  it.each([
    ["unknown field", { ...policyDecision, extra: true }],
    ["float version", { ...policyDecision, policyVersion: 1.5 }],
    [
      "unsupported rule result",
      { ...policyDecision, rules: [{ rule: "x", result: "maybe" }] },
    ],
    ["invalid hash", { ...policyDecision, decisionHash: "0x1234" }],
  ])("rejects invalid policy decision %s", (_name, candidate) => {
    expect(policyDecisionSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("lifecycle state and transition contracts", () => {
  it("accepts every canonical lifecycle state", () => {
    const states = [
      "DRAFT",
      "VALIDATED",
      "POLICY_PRECHECKED",
      "CONSTRUCTED",
      "DECODED",
      "VERIFIED",
      "SIMULATED",
      "POLICY_FINALIZED",
      "BUDGET_RESERVED",
      "ENVELOPE_FINALIZED",
      "AWAITING_APPROVAL",
      "AUTHORIZED",
      "SIGNING",
      "SIGNED",
      "BROADCAST",
      "PENDING_CONFIRMATION",
      "CONFIRMED",
      "RECONCILED",
      "REJECTED",
      "DENIED",
      "EXPIRED",
      "SIMULATION_FAILED",
      "SIGNING_FAILED",
      "BROADCAST_FAILED",
      "REVERTED",
      "CANCELLED",
      "DISPUTED",
      "REVOKED",
      "REVALIDATION_REQUIRED",
    ] as const;

    for (const state of states)
      expect(lifecycleStateSchema.parse(state)).toBe(state);
  });

  it("permits the canonical happy path and rejects skips and terminal exits", () => {
    expect(transitionLifecycleState("DRAFT", "VALIDATED")).toBe("VALIDATED");
    expect(transitionLifecycleState("ENVELOPE_FINALIZED", "AUTHORIZED")).toBe(
      "AUTHORIZED",
    );
    expect(transitionLifecycleState("SIGNED", "BROADCAST")).toBe("BROADCAST");
    expect(transitionLifecycleState("CONFIRMED", "RECONCILED")).toBe(
      "RECONCILED",
    );
    expect(() => transitionLifecycleState("DRAFT", "SIGNED")).toThrow();
    expect(() => transitionLifecycleState("RECONCILED", "DRAFT")).toThrow();
    expect(() => transitionLifecycleState("AUTHORIZED", "SIGNED")).toThrow();
  });

  it("accepts exactly the published transition table", () => {
    const states = Object.keys(LIFECYCLE_TRANSITIONS) as Array<
      keyof typeof LIFECYCLE_TRANSITIONS
    >;
    for (const from of states) {
      for (const to of states) {
        expect(isValidLifecycleTransition(from, to)).toBe(
          LIFECYCLE_TRANSITIONS[from].includes(to),
        );
      }
    }
  });

  it("validates transition objects strictly", () => {
    expect(
      lifecycleTransitionSchema.parse({ from: "DRAFT", to: "VALIDATED" }),
    ).toEqual({
      from: "DRAFT",
      to: "VALIDATED",
    });
    expect(
      lifecycleTransitionSchema.safeParse({ from: "DRAFT", to: "SIGNED" })
        .success,
    ).toBe(false);
    expect(
      lifecycleTransitionSchema.safeParse({
        from: "DRAFT",
        to: "VALIDATED",
        reason: "x",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown lifecycle values and non-string transition inputs", () => {
    expect(lifecycleStateSchema.safeParse("authorized").success).toBe(false);
    expect(() => transitionLifecycleState("DRAFT", "AUTHORIZED")).toThrow();
    expect(() => transitionLifecycleState("DRAFT", 1.5 as never)).toThrow();
  });
});

describe("execution envelope contract", () => {
  it("accepts the complete immutable envelope shape", () => {
    expect(canonicalExecutionEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it.each([
    ["unknown top-level field", { ...envelope, calldataHash: "0x" }],
    [
      "unknown nested decoded argument",
      {
        ...envelope,
        decodedArguments: { ...envelope.decodedArguments, selector: "0x" },
      },
    ],
    ["float revision", { ...envelope, revision: 1.5 }],
    ["float gas limit", { ...envelope, gasLimit: 100000.5 }],
    ["invalid calldata", { ...envelope, calldata: "0xGG" }],
    ["unsupported risk decision", { ...envelope, riskDecision: "MAYBE" }],
  ])("rejects %s", (_name, candidate) => {
    expect(canonicalExecutionEnvelopeSchema.safeParse(candidate).success).toBe(
      false,
    );
  });
});

describe("adapter manifest contract", () => {
  it("accepts the reference local adapter manifest", () => {
    expect(adapterCapabilityManifestSchema.parse(adapterManifest)).toEqual(
      adapterManifest,
    );
  });

  it.each([
    ["unknown field", { ...adapterManifest, provider: "local" }],
    [
      "unknown operation",
      {
        ...adapterManifest,
        operations: { ...adapterManifest.operations, signAnything: true },
      },
    ],
    [
      "exposed owner key",
      {
        ...adapterManifest,
        custody: { ...adapterManifest.custody, ownerKeyExposedToAgent: true },
      },
    ],
    [
      "float adapter version",
      {
        ...adapterManifest,
        adapter: { ...adapterManifest.adapter, version: 0.1 },
      },
    ],
    [
      "unsupported grade",
      {
        ...adapterManifest,
        enforcement: {
          ...adapterManifest.enforcement,
          expiry: "control_plane",
        },
      },
    ],
  ])("rejects %s", (_name, candidate) => {
    expect(adapterCapabilityManifestSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it("uses the shared strongest-to-weakest grade ordering", () => {
    expect(ENFORCEMENT_GRADES).toEqual([
      "ONCHAIN",
      "SIGNER",
      "CONTROL_PLANE",
      "ADVISORY",
      "UNSUPPORTED",
    ]);
    expect(meetsMinimumEnforcementGrade("SIGNER", "CONTROL_PLANE")).toBe(true);
    expect(meetsMinimumEnforcementGrade("ADVISORY", "CONTROL_PLANE")).toBe(
      false,
    );
  });
});

describe("audit, telemetry, and stable error contracts", () => {
  it("accepts a correlated append-only audit event", () => {
    expect(auditEventSchema.parse(auditEvent)).toEqual(auditEvent);
  });

  it.each([
    ["unknown event field", { ...auditEvent, secret: "never" }],
    [
      "unknown payload field",
      { ...auditEvent, data: { ...auditEvent.data, privateKey: "never" } },
    ],
    ["float policy version", { ...auditEvent, policyVersion: 1.5 }],
    ["unsupported event type", { ...auditEvent, eventType: "wallet.magic" }],
    ["invalid trace id", { ...auditEvent, traceId: "trace" }],
  ])("rejects %s", (_name, candidate) => {
    expect(auditEventSchema.safeParse(candidate).success).toBe(false);
  });

  it("accepts only stable telemetry identifiers", () => {
    expect(telemetryAttributeSchema.parse("crip.intent.id")).toBe(
      "crip.intent.id",
    );
    expect(telemetryAttributeSchema.safeParse("intent.id").success).toBe(false);
    expect(telemetryAttributeSchema.safeParse(1.5).success).toBe(false);
  });

  it("publishes the stable error taxonomy with execution context", () => {
    expect(errorCodeSchema.parse("BROADCAST_UNKNOWN")).toBe(
      "BROADCAST_UNKNOWN",
    );
    expect(errorCodeSchema.safeParse("UNKNOWN_ERROR").success).toBe(false);
    expect(ERROR_CODES).toContain("INVALID_LIFECYCLE_TRANSITION");
    expect(
      stableErrorSchema.parse({
        code: "BROADCAST_UNKNOWN",
        message: "The broadcast result is unknown.",
        retryable: false,
        lifecycleState: "DISPUTED",
        fundsMayHaveMoved: true,
        safeNextAction: "check_operation",
        correlationId: "op_local_001",
      }),
    ).toMatchObject({ code: "BROADCAST_UNKNOWN", fundsMayHaveMoved: true });
    expect(
      stableErrorSchema.safeParse({
        code: "BROADCAST_UNKNOWN",
        message: "unknown",
        retryable: false,
        lifecycleState: "DISPUTED",
        fundsMayHaveMoved: true,
        safeNextAction: "check_operation",
        correlationId: "op_local_001",
        retryAfterSeconds: 1.5,
      }).success,
    ).toBe(false);
  });
});
