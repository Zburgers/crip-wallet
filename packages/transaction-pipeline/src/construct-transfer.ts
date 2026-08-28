import { canonicalIntentSchema } from "@crip/schemas";
import { encodeFunctionData } from "viem";

import {
  LOCAL_CHAIN_ID,
  STATIC_NONCE_STRATEGY,
  TRANSFER_SELECTOR,
  type Address,
  type TrustedExecutionContext,
  type TransferCoreCandidate,
  type TransferCoreProvenance,
  type TransferIntent,
} from "./candidate.js";

const transferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

const canonicalAddress = (value: unknown): value is Address =>
  typeof value === "string" && /^0x[a-f0-9]{40}$/.test(value);

const canonicalIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

function validateTrusted(
  trusted: unknown,
): asserts trusted is TrustedExecutionContext {
  if (
    typeof trusted !== "object" ||
    trusted === null ||
    Array.isArray(trusted)
  ) {
    throw new TypeError("invalid trusted local execution context");
  }
  const context = trusted as TrustedExecutionContext;
  if (
    context.chainId !== LOCAL_CHAIN_ID ||
    !canonicalAddress(context.walletAddress) ||
    !canonicalAddress(context.tokenAddress) ||
    !canonicalIdentifier(context.fixtureInstanceId)
  ) {
    throw new TypeError("invalid trusted local execution context");
  }

  const provenance = context.provenance;
  if (provenance === undefined) return;
  if (
    (provenance.operationId !== undefined &&
      !canonicalIdentifier(provenance.operationId)) ||
    (provenance.policyId !== undefined &&
      !canonicalIdentifier(provenance.policyId)) ||
    (provenance.policyVersion !== undefined &&
      (!Number.isSafeInteger(provenance.policyVersion) ||
        provenance.policyVersion <= 0)) ||
    (provenance.policyDecisionHash !== undefined &&
      !/^0x[0-9a-f]{64}$/.test(provenance.policyDecisionHash))
  ) {
    throw new TypeError("invalid transfer provenance");
  }
}

const buildProvenance = (
  intent: TransferIntent,
  trusted: TrustedExecutionContext,
): TransferCoreProvenance => ({
  intentId: intent.intentId,
  agentId: intent.agentId,
  walletId: intent.walletId,
  ...(trusted.provenance ?? {}),
});

/** Construct only the static local fake-ERC-20 transfer core. */
export const constructTransferCore = (
  intent: unknown,
  trusted: TrustedExecutionContext,
): TransferCoreCandidate => {
  const parsed = canonicalIntentSchema.safeParse(intent);
  if (!parsed.success || parsed.data.action !== "asset.transfer") {
    throw new TypeError(
      "transfer construction requires a canonical transfer intent",
    );
  }
  validateTrusted(trusted);

  const transfer = parsed.data;
  if (
    transfer.chainId !== LOCAL_CHAIN_ID ||
    transfer.asset.address !== trusted.tokenAddress
  ) {
    throw new TypeError(
      "intent does not match the trusted local transfer context",
    );
  }

  const calldata = encodeFunctionData({
    abi: transferAbi,
    functionName: "transfer",
    args: [transfer.recipient as Address, BigInt(transfer.amount.atomic)],
  });

  return {
    action: "asset.transfer",
    chainId: LOCAL_CHAIN_ID,
    from: trusted.walletAddress,
    target: trusted.tokenAddress,
    nativeValue: "0",
    calldata,
    selector: TRANSFER_SELECTOR,
    recipient: transfer.recipient as Address,
    amountAtomic: transfer.amount.atomic,
    nonceStrategy: STATIC_NONCE_STRATEGY,
    fixtureInstanceId: trusted.fixtureInstanceId,
    provenance: buildProvenance(transfer, trusted),
  };
};
