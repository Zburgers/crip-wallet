import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";

import {
  atomicUnitSchema,
  canonicalIntentSchema,
  canonicalizeIdempotencyPayload,
  enforcementGradeSchema,
  meetsMinimumEnforcementGrade,
  policyDecisionSchema,
  policySchema,
  type EnforcementGrade,
  type Policy,
  type PolicyDecision,
  type PolicyDecisionRule,
} from "@crip/schemas";

const utcSecondSchema = z.iso.datetime({ offset: false, precision: 0 });

/** Explicit state supplied by the caller for one deterministic evaluation. */
export const policyEvaluationContextSchema = z.strictObject({
  evaluatedAt: utcSecondSchema,
  totalSpentAtomic: atomicUnitSchema,
  enforcement: z.strictObject({
    budget: enforcementGradeSchema,
    recipient: enforcementGradeSchema,
  }),
});

export type PolicyEvaluationContext = z.infer<
  typeof policyEvaluationContextSchema
>;

const POLICY_DECISION_HASH_DOMAIN = "crip/policy-decision";
const POLICY_DECISION_HASH_VERSION = "v1";
const FALLBACK_EVALUATED_AT = "1970-01-01T00:00:00Z";

const compareAtomic = (left: string, right: string): number => {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
};

const isAtomicAtMost = (value: string, limit: string): boolean =>
  compareAtomic(value, limit) <= 0;

/** Subtract two canonical atomic values without floating point or BigInt. */
const subtractAtomic = (left: string, right: string): string => {
  if (!isAtomicAtMost(right, left)) return "0";

  const digits: number[] = [];
  let borrow = 0;
  let leftIndex = left.length - 1;
  let rightIndex = right.length - 1;

  while (leftIndex >= 0) {
    let digit = Number(left[leftIndex]) - borrow;
    const rightDigit = rightIndex >= 0 ? Number(right[rightIndex]) : 0;
    if (digit < rightDigit) {
      digit += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    digits.push(digit - rightDigit);
    leftIndex -= 1;
    rightIndex -= 1;
  }

  return digits
    .reverse()
    .join("")
    .replace(/^0+(?=\d)/, "");
};

const isWithinWindow = (
  evaluatedAt: string,
  notBefore: string,
  expiresAt: string,
): boolean =>
  Date.parse(evaluatedAt) >= Date.parse(notBefore) &&
  Date.parse(evaluatedAt) < Date.parse(expiresAt);

const pass = (rule: string): PolicyDecisionRule => ({
  rule,
  result: "pass",
});

const fail = (
  rule: string,
  details: Pick<PolicyDecisionRule, "limitAtomic" | "requestedAtomic"> = {},
): PolicyDecisionRule => ({
  rule,
  result: "fail",
  ...details,
});

const indeterminate = (rule: string): PolicyDecisionRule => ({
  rule,
  result: "indeterminate",
});

const hashDecision = (payload: {
  schemaVersion: "1.0";
  decision: PolicyDecision["decision"];
  policyId: string;
  policyVersion: number;
  evaluatedAt: string;
  rules: PolicyDecisionRule[];
  requiredEnforcement: PolicyDecision["requiredEnforcement"];
}): string => {
  const jsonSafePayload = JSON.parse(JSON.stringify(payload)) as Parameters<
    typeof canonicalizeIdempotencyPayload
  >[0];
  const bytes = utf8ToBytes(canonicalizeIdempotencyPayload(jsonSafePayload));
  return `0x${bytesToHex(
    keccak_256(
      concatBytes(
        utf8ToBytes(POLICY_DECISION_HASH_DOMAIN),
        utf8ToBytes(POLICY_DECISION_HASH_VERSION),
        Uint8Array.from([0]),
        bytes,
      ),
    ),
  )}`;
};

const makeDecision = (input: {
  decision: PolicyDecision["decision"];
  policyId: string;
  policyVersion: number;
  evaluatedAt: string;
  rules: PolicyDecisionRule[];
  requiredEnforcement: PolicyDecision["requiredEnforcement"];
}): PolicyDecision => {
  const base = {
    schemaVersion: "1.0" as const,
    decision: input.decision,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    evaluatedAt: input.evaluatedAt,
    rules: input.rules,
    requiredEnforcement: input.requiredEnforcement,
  };

  return policyDecisionSchema.parse({
    ...base,
    decisionHash: hashDecision(base),
  });
};

const validEvaluatedAt = (context: unknown): string => {
  if (typeof context !== "object" || context === null) {
    return FALLBACK_EVALUATED_AT;
  }
  const candidate = (context as { evaluatedAt?: unknown }).evaluatedAt;
  return utcSecondSchema.safeParse(candidate).success
    ? (candidate as string)
    : FALLBACK_EVALUATED_AT;
};

const fallbackPolicyMetadata = (
  policy: unknown,
): {
  policyId: string;
  policyVersion: number;
  requiredEnforcement: PolicyDecision["requiredEnforcement"];
} => {
  const parsed = policySchema.safeParse(policy);
  if (parsed.success) {
    return {
      policyId: parsed.data.policyId,
      policyVersion: parsed.data.version,
      requiredEnforcement: {
        budget: parsed.data.enforcement.minimumBudgetGrade,
        recipient: parsed.data.enforcement.minimumRecipientGrade,
      },
    };
  }

  return {
    policyId: "policy_invalid",
    policyVersion: 1,
    requiredEnforcement: {
      budget: "CONTROL_PLANE",
      recipient: "CONTROL_PLANE",
    },
  };
};

const failClosed = (policy: unknown, context: unknown): PolicyDecision => {
  const metadata = fallbackPolicyMetadata(policy);
  return makeDecision({
    ...metadata,
    evaluatedAt: validEvaluatedAt(context),
    decision: "DENY",
    rules: [indeterminate("input.contract")],
  });
};

const evaluateRules = (
  policy: Policy,
  intent: z.infer<typeof canonicalIntentSchema>,
  context: PolicyEvaluationContext,
): PolicyDecisionRule[] => {
  const transfer = intent.action === "asset.transfer";
  const rules: PolicyDecisionRule[] = [];

  rules.push(
    policy.status === "active" ? pass("policy.status") : fail("policy.status"),
  );
  rules.push(
    intent.agentId === policy.subject.agentId
      ? pass("subject.agent")
      : fail("subject.agent"),
  );
  rules.push(
    intent.walletId === policy.subject.walletId
      ? pass("subject.wallet")
      : fail("subject.wallet"),
  );
  rules.push(
    isWithinWindow(
      context.evaluatedAt,
      policy.validity.notBefore,
      policy.validity.expiresAt,
    )
      ? pass("validity.policy")
      : fail("validity.policy"),
  );
  rules.push(
    isWithinWindow(context.evaluatedAt, intent.notBefore, intent.expiresAt)
      ? pass("validity.intent")
      : fail("validity.intent"),
  );
  rules.push(
    policy.chains.allow.includes(intent.chainId)
      ? pass("chain.allowlist")
      : fail("chain.allowlist"),
  );
  rules.push(
    !transfer ||
      policy.assets.allow.some(
        (asset) =>
          asset.chainId === intent.chainId &&
          asset.type === intent.asset.type &&
          asset.address === intent.asset.address,
      )
      ? pass("asset.allowlist")
      : fail("asset.allowlist"),
  );
  rules.push(
    !transfer || policy.recipients.allow.includes(intent.recipient)
      ? pass("recipient.allowlist")
      : fail("recipient.allowlist"),
  );
  rules.push(
    policy.actions.allow.includes(intent.action)
      ? pass("action.allowlist")
      : fail("action.allowlist"),
  );
  rules.push(
    policy.mode !== "read-only" || !transfer ? pass("mode") : fail("mode"),
  );
  rules.push(
    !transfer ||
      isAtomicAtMost(intent.amount.atomic, policy.budgets.perTransaction.atomic)
      ? pass("budget.per_transaction")
      : fail("budget.per_transaction", {
          limitAtomic: policy.budgets.perTransaction.atomic,
          requestedAtomic: intent.amount.atomic,
        }),
  );

  if (!transfer) {
    rules.push(pass("budget.total"));
    rules.push(pass("network_fee.maximum"));
  } else {
    const remaining = subtractAtomic(
      policy.budgets.total.atomic,
      context.totalSpentAtomic,
    );
    const totalBudgetPass =
      intent.asset.address === policy.budgets.total.assetAddress &&
      isAtomicAtMost(intent.amount.atomic, remaining);
    rules.push(
      totalBudgetPass
        ? pass("budget.total")
        : fail("budget.total", {
            limitAtomic: policy.budgets.total.atomic,
            requestedAtomic: intent.amount.atomic,
          }),
    );
    rules.push(
      isAtomicAtMost(
        intent.maximumNetworkFee.atomic,
        policy.networkFees.maximumPerTransactionAtomic,
      )
        ? pass("network_fee.maximum")
        : fail("network_fee.maximum", {
            limitAtomic: policy.networkFees.maximumPerTransactionAtomic,
            requestedAtomic: intent.maximumNetworkFee.atomic,
          }),
    );
  }

  rules.push(
    meetsMinimumEnforcementGrade(
      context.enforcement.budget,
      policy.enforcement.minimumBudgetGrade,
    )
      ? pass("enforcement.budget")
      : fail("enforcement.budget"),
  );
  rules.push(
    meetsMinimumEnforcementGrade(
      context.enforcement.recipient,
      policy.enforcement.minimumRecipientGrade,
    )
      ? pass("enforcement.recipient")
      : fail("enforcement.recipient"),
  );

  return rules;
};

/**
 * Evaluate one policy deterministically. Any malformed or indeterminate input
 * produces DENY with an explicit indeterminate input rule.
 */
export const evaluatePolicy = (
  policy: unknown,
  intent: unknown,
  context: unknown,
): PolicyDecision => {
  const parsedPolicy = policySchema.safeParse(policy);
  const parsedIntent = canonicalIntentSchema.safeParse(intent);
  const parsedContext = policyEvaluationContextSchema.safeParse(context);

  if (
    !parsedPolicy.success ||
    !parsedIntent.success ||
    !parsedContext.success
  ) {
    return failClosed(policy, context);
  }

  const rules = evaluateRules(
    parsedPolicy.data,
    parsedIntent.data,
    parsedContext.data,
  );
  const hasFailure = rules.some(({ result }) => result !== "pass");
  const decision = hasFailure
    ? "DENY"
    : parsedIntent.data.action === "wallet.read_state"
      ? "ALLOW_READ"
      : parsedPolicy.data.mode === "review-required"
        ? "REQUIRE_APPROVAL"
        : "ALLOW_AUTONOMOUS";

  return makeDecision({
    decision,
    policyId: parsedPolicy.data.policyId,
    policyVersion: parsedPolicy.data.version,
    evaluatedAt: parsedContext.data.evaluatedAt,
    rules,
    requiredEnforcement: {
      budget: parsedPolicy.data.enforcement.minimumBudgetGrade,
      recipient: parsedPolicy.data.enforcement.minimumRecipientGrade,
    },
  });
};

export type { EnforcementGrade };
