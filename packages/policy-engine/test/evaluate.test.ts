import { describe, expect, it } from "vitest";

import { evaluatePolicy, policyEvaluationContextSchema } from "../src/index.js";

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
  actions: { allow: ["wallet.read_state", "asset.transfer"] },
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

const transferIntent = {
  schemaVersion: "1.0",
  intentId: "int_local_001",
  idempotencyKey: "merchant-payment-001",
  agentId: "agent_local_01",
  walletId: "wallet_local_01",
  chainId: "eip155:31337",
  action: "asset.transfer",
  objective: "Pay the approved local merchant",
  asset: {
    type: "erc20",
    address: "0x1111111111111111111111111111111111111111",
    symbolHint: "TEST_USDC",
    decimalsHint: 6,
  },
  amount: { atomic: "500000", displayHint: "0.5" },
  recipient: "0x2222222222222222222222222222222222222222",
  maximumNetworkFee: {
    asset: "native",
    atomic: "1000000000000000",
  },
  notBefore: "2026-08-06T15:00:00Z",
  expiresAt: "2026-08-06T15:10:00Z",
  metadata: {},
} as const;

const readIntent = {
  schemaVersion: "1.0",
  intentId: "int_local_read_001",
  idempotencyKey: "read-wallet-001",
  agentId: "agent_local_01",
  walletId: "wallet_local_01",
  chainId: "eip155:31337",
  action: "wallet.read_state",
  objective: "Read local wallet state",
  notBefore: "2026-08-06T15:00:00Z",
  expiresAt: "2026-08-06T15:10:00Z",
  metadata: {},
} as const;

const context = {
  evaluatedAt: "2026-08-06T15:05:00Z",
  totalSpentAtomic: "1000000",
  enforcement: {
    budget: "CONTROL_PLANE",
    recipient: "CONTROL_PLANE",
  },
} as const;

const rule = (decision: ReturnType<typeof evaluatePolicy>, name: string) =>
  decision.rules.find((candidate) => candidate.rule === name);

describe("deterministic policy evaluation", () => {
  it("allows a transfer when every rule passes in autonomous mode", () => {
    const decision = evaluatePolicy(policy, transferIntent, context);

    expect(decision.decision).toBe("ALLOW_AUTONOMOUS");
    expect(decision.rules.every(({ result }) => result === "pass")).toBe(true);
    expect(decision.policyId).toBe(policy.policyId);
    expect(decision.policyVersion).toBe(policy.version);
    expect(decision.decisionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("evaluates read-only intents without requiring transfer budget fields", () => {
    const decision = evaluatePolicy(policy, readIntent, context);

    expect(decision.decision).toBe("ALLOW_READ");
    expect(rule(decision, "action.allowlist")?.result).toBe("pass");
    expect(rule(decision, "budget.per_transaction")?.result).toBe("pass");
    expect(rule(decision, "network_fee.maximum")?.result).toBe("pass");
  });

  it("requires approval for a valid state-changing request in review mode", () => {
    const decision = evaluatePolicy(
      { ...policy, mode: "review-required" },
      transferIntent,
      context,
    );

    expect(decision.decision).toBe("REQUIRE_APPROVAL");
  });

  it("denies state-changing requests in read-only mode", () => {
    const decision = evaluatePolicy(
      { ...policy, mode: "read-only" },
      transferIntent,
      context,
    );

    expect(decision.decision).toBe("DENY");
    expect(rule(decision, "mode")?.result).toBe("fail");
  });

  it.each([
    ["chain", { chainId: "eip155:1" }, "chain.allowlist"],
    [
      "asset",
      {
        asset: {
          ...transferIntent.asset,
          address: "0x9999999999999999999999999999999999999999",
        },
      },
      "asset.allowlist",
    ],
    [
      "recipient",
      { recipient: "0x9999999999999999999999999999999999999999" },
      "recipient.allowlist",
    ],
    ["action", {}, "action.allowlist"],
    [
      "per-transaction budget",
      { amount: { ...transferIntent.amount, atomic: "500001" } },
      "budget.per_transaction",
    ],
    [
      "total budget",
      { amount: { ...transferIntent.amount, atomic: "1000001" } },
      "budget.total",
    ],
    [
      "native fee ceiling",
      {
        maximumNetworkFee: {
          ...transferIntent.maximumNetworkFee,
          atomic: "1000000000000001",
        },
      },
      "network_fee.maximum",
    ],
  ] as const)("denies an isolated %s violation", (_name, change, ruleName) => {
    const decision = evaluatePolicy(
      _name === "action"
        ? { ...policy, actions: { allow: ["wallet.read_state"] } }
        : policy,
      { ...transferIntent, ...change },
      context,
    );

    expect(decision.decision).toBe("DENY");
    expect(rule(decision, ruleName)?.result).toBe("fail");
  });

  it("denies when the policy validity window has not started or has expired", () => {
    expect(
      evaluatePolicy(policy, transferIntent, {
        ...context,
        evaluatedAt: "2026-08-05T23:59:59Z",
      }).decision,
    ).toBe("DENY");
    expect(
      evaluatePolicy(policy, transferIntent, {
        ...context,
        evaluatedAt: "2026-08-07T00:00:00Z",
      }).decision,
    ).toBe("DENY");
    expect(
      evaluatePolicy(
        policy,
        { ...transferIntent, expiresAt: "2026-08-06T15:04:59Z" },
        context,
      ).decision,
    ).toBe("DENY");
  });

  it("denies when the adapter does not meet either required enforcement grade", () => {
    const decision = evaluatePolicy(policy, transferIntent, {
      ...context,
      enforcement: { budget: "ADVISORY", recipient: "UNSUPPORTED" },
    });

    expect(decision.decision).toBe("DENY");
    expect(rule(decision, "enforcement.budget")?.result).toBe("fail");
    expect(rule(decision, "enforcement.recipient")?.result).toBe("fail");
  });

  it("combines independent failures and never upgrades them to approval", () => {
    const decision = evaluatePolicy(
      { ...policy, mode: "review-required" },
      {
        ...transferIntent,
        chainId: "eip155:1",
        recipient: "0x9999999999999999999999999999999999999999",
        amount: { ...transferIntent.amount, atomic: "1000001" },
        maximumNetworkFee: {
          ...transferIntent.maximumNetworkFee,
          atomic: "1000000000000001",
        },
      },
      {
        ...context,
        enforcement: { budget: "ADVISORY", recipient: "UNSUPPORTED" },
      },
    );

    expect(decision.decision).toBe("DENY");
    expect(
      decision.rules.filter(({ result }) => result === "fail").length,
    ).toBeGreaterThanOrEqual(6);
    expect(decision.decision).not.toBe("REQUIRE_APPROVAL");
  });

  it("turns indeterminate input into a deterministic deny", () => {
    const decision = evaluatePolicy(policy, transferIntent, {
      ...context,
      enforcement: { budget: "UNKNOWN", recipient: "CONTROL_PLANE" },
    });

    expect(decision.decision).toBe("DENY");
    expect(decision.decision).not.toBe("INDETERMINATE");
    expect(decision.rules).toEqual([
      { rule: "input.contract", result: "indeterminate" },
    ]);
  });

  it("rejects floats and unknown fields through the same fail-closed path", () => {
    expect(
      evaluatePolicy({ ...policy, version: 1.5 }, transferIntent, context)
        .decision,
    ).toBe("DENY");
    expect(
      evaluatePolicy(policy, { ...transferIntent, unexpected: true }, context)
        .decision,
    ).toBe("DENY");
  });
});

describe("policy evaluation context", () => {
  it("rejects unknown fields, floats, and unsupported grades", () => {
    expect(policyEvaluationContextSchema.safeParse(context).success).toBe(true);
    expect(
      policyEvaluationContextSchema.safeParse({
        ...context,
        totalSpentAtomic: 1.5,
      }).success,
    ).toBe(false);
    expect(
      policyEvaluationContextSchema.safeParse({
        ...context,
        enforcement: { ...context.enforcement, budget: "control_plane" },
      }).success,
    ).toBe(false);
    expect(
      policyEvaluationContextSchema.safeParse({ ...context, clock: "now" })
        .success,
    ).toBe(false);
  });
});
