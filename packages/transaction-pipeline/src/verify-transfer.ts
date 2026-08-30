import { canonicalIntentSchema } from "@crip/schemas";

import {
  LOCAL_CHAIN_ID,
  STATIC_NONCE_STRATEGY,
  TRANSFER_SELECTOR,
  type DecodeTransferResult,
  type TrustedExecutionContext,
  type TransferCoreCandidate,
  type TransferCoreProvenance,
  type TransferCoreVerificationFailure,
  type TransferCoreVerificationResult,
} from "./candidate.js";
import { decodeTransferIndependent } from "./decode-transfer.js";

const canonicalAddress = (value: unknown): boolean =>
  typeof value === "string" && /^0x[a-f0-9]{40}$/.test(value);

const canonicalIdentifier = (value: unknown): boolean =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

const sameRecord = (left: unknown, right: object): boolean => {
  if (typeof left !== "object" || left === null || Array.isArray(left)) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) && leftRecord[key] === rightRecord[key],
    )
  );
};

const fail = (
  code: TransferCoreVerificationFailure["code"],
  field?: string,
  decodeCode?: TransferCoreVerificationFailure["decodeCode"],
): TransferCoreVerificationFailure => ({
  ok: false,
  code,
  ...(field === undefined ? {} : { field }),
  ...(decodeCode === undefined ? {} : { decodeCode }),
});

const isCandidate = (candidate: unknown): candidate is TransferCoreCandidate =>
  typeof candidate === "object" && candidate !== null;

const isTrustedProvenance = (provenance: unknown): boolean => {
  if (
    typeof provenance !== "object" ||
    provenance === null ||
    Array.isArray(provenance)
  ) {
    return false;
  }
  const candidate = provenance as Record<string, unknown>;
  return (
    (candidate.operationId === undefined ||
      canonicalIdentifier(candidate.operationId)) &&
    (candidate.policyId === undefined ||
      canonicalIdentifier(candidate.policyId)) &&
    (candidate.policyVersion === undefined ||
      (typeof candidate.policyVersion === "number" &&
        Number.isSafeInteger(candidate.policyVersion) &&
        candidate.policyVersion > 0)) &&
    (candidate.policyDecisionHash === undefined ||
      (typeof candidate.policyDecisionHash === "string" &&
        /^0x[0-9a-f]{64}$/.test(candidate.policyDecisionHash)))
  );
};

const isTrusted = (trusted: unknown): trusted is TrustedExecutionContext => {
  if (
    typeof trusted !== "object" ||
    trusted === null ||
    Array.isArray(trusted)
  ) {
    return false;
  }
  const context = trusted as TrustedExecutionContext;
  return (
    context.chainId === LOCAL_CHAIN_ID &&
    canonicalAddress(context.walletAddress) &&
    canonicalAddress(context.tokenAddress) &&
    canonicalIdentifier(context.fixtureInstanceId) &&
    (context.provenance === undefined ||
      isTrustedProvenance(context.provenance))
  );
};

const hasExactKeys = (value: object, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === keys[index])
  );
};

const expectedProvenance = (
  intent: Extract<
    ReturnType<typeof canonicalIntentSchema.parse>,
    { action: "asset.transfer" }
  >,
  trusted: TrustedExecutionContext,
): TransferCoreProvenance => ({
  intentId: intent.intentId,
  agentId: intent.agentId,
  walletId: intent.walletId,
  ...(trusted.provenance ?? {}),
});

const sameDecoded = (
  supplied: DecodeTransferResult,
  actual: Exclude<DecodeTransferResult, { ok: false }>,
): boolean => supplied.ok && sameRecord(supplied, actual);

/** Verify static transfer identity; no dynamic nonce, gas, fee or simulation resolution occurs here. */
export const verifyTransferCore = (
  intent: unknown,
  candidate: unknown,
  decoded: DecodeTransferResult,
  trusted: TrustedExecutionContext,
): TransferCoreVerificationResult => {
  const parsed = canonicalIntentSchema.safeParse(intent);
  if (!parsed.success || parsed.data.action !== "asset.transfer") {
    return fail("INVALID_INTENT");
  }
  if (!isTrusted(trusted)) return fail("INVALID_TRUSTED_CONTEXT");
  if (!isCandidate(candidate)) return fail("INVALID_CANDIDATE");
  if (
    !hasExactKeys(candidate, [
      "action",
      "amountAtomic",
      "calldata",
      "chainId",
      "fixtureInstanceId",
      "from",
      "nativeValue",
      "nonceStrategy",
      "provenance",
      "recipient",
      "selector",
      "target",
    ])
  ) {
    return fail("INVALID_CANDIDATE");
  }

  const actualDecoded = decodeTransferIndependent(candidate.calldata);
  if (!actualDecoded.ok)
    return fail("DECODE_FAILED", "calldata", actualDecoded.code);
  if (!sameDecoded(decoded, actualDecoded))
    return fail("CALLDATA_MISMATCH", "calldata");

  const transfer = parsed.data;
  const expected = expectedProvenance(transfer, trusted);
  if (!sameRecord(candidate.provenance, expected)) {
    return fail("PROVENANCE_MISMATCH", "provenance");
  }
  if (candidate.action !== "asset.transfer")
    return fail("ACTION_MISMATCH", "action");
  if (candidate.selector !== TRANSFER_SELECTOR)
    return fail("SELECTOR_MISMATCH", "selector");
  if (
    candidate.chainId !== LOCAL_CHAIN_ID ||
    candidate.chainId !== transfer.chainId
  ) {
    return fail("CHAIN_MISMATCH", "chainId");
  }
  if (candidate.from !== trusted.walletAddress)
    return fail("SENDER_MISMATCH", "from");
  if (
    candidate.target !== trusted.tokenAddress ||
    candidate.target !== transfer.asset.address
  ) {
    return fail("TARGET_MISMATCH", "target");
  }
  if (candidate.nativeValue !== "0")
    return fail("NATIVE_VALUE_MISMATCH", "nativeValue");
  if (
    candidate.recipient !== transfer.recipient ||
    actualDecoded.recipient !== transfer.recipient
  ) {
    return fail("RECIPIENT_MISMATCH", "recipient");
  }
  if (
    candidate.amountAtomic !== transfer.amount.atomic ||
    actualDecoded.amountAtomic !== transfer.amount.atomic
  ) {
    return fail("AMOUNT_MISMATCH", "amountAtomic");
  }
  if (candidate.nonceStrategy !== STATIC_NONCE_STRATEGY) {
    return fail("NONCE_STRATEGY_MISMATCH", "nonceStrategy");
  }
  if (candidate.fixtureInstanceId !== trusted.fixtureInstanceId) {
    return fail("FIXTURE_MISMATCH", "fixtureInstanceId");
  }

  return { ok: true, verified: candidate };
};
