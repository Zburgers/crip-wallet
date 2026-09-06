import type { CanonicalIntent } from "@crip/schemas";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type TransferIntent = Extract<
  CanonicalIntent,
  { action: "asset.transfer" }
>;
export type LocalChainId = "eip155:31337";
export type TransferSelector = "0xa9059cbb";
export type NonceStrategy = "pending";

/** Provenance that is available before simulation and must travel with the core. */
export interface TransferCoreProvenance {
  intentId: string;
  agentId: string;
  walletId: string;
  operationId?: string;
  policyId?: string;
  policyVersion?: number;
  policyDecisionHash?: string;
}

export interface TrustedExecutionContext {
  walletAddress: Address;
  tokenAddress: Address;
  chainId: LocalChainId;
  fixtureInstanceId: string;
  provenance?: Omit<
    TransferCoreProvenance,
    "intentId" | "agentId" | "walletId"
  >;
}

/** Static, pre-simulation transfer identity. It is not an executable envelope. */
export interface TransferCoreCandidate {
  action: "asset.transfer";
  chainId: LocalChainId;
  from: Address;
  target: Address;
  nativeValue: "0";
  calldata: Hex;
  selector: TransferSelector;
  recipient: Address;
  amountAtomic: string;
  nonceStrategy: NonceStrategy;
  fixtureInstanceId: string;
  provenance: TransferCoreProvenance;
}

export interface DecodedTransfer {
  ok: true;
  selector: TransferSelector;
  recipient: Address;
  amountAtomic: string;
}

export type DecodeFailureCode =
  | "MALFORMED_HEX"
  | "INVALID_LENGTH"
  | "TRAILING_DATA"
  | "UNKNOWN_SELECTOR"
  | "NON_CANONICAL_ADDRESS_PADDING"
  | "INVALID_UINT256";

export interface DecodeFailure {
  ok: false;
  code: DecodeFailureCode;
}

export type DecodeTransferResult = DecodedTransfer | DecodeFailure;

export type VerificationFailureCode =
  | "INVALID_INTENT"
  | "INVALID_TRUSTED_CONTEXT"
  | "INVALID_CANDIDATE"
  | "DECODE_FAILED"
  | "CALLDATA_MISMATCH"
  | "ACTION_MISMATCH"
  | "SELECTOR_MISMATCH"
  | "CHAIN_MISMATCH"
  | "SENDER_MISMATCH"
  | "TARGET_MISMATCH"
  | "NATIVE_VALUE_MISMATCH"
  | "RECIPIENT_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "NONCE_STRATEGY_MISMATCH"
  | "FIXTURE_MISMATCH"
  | "PROVENANCE_MISMATCH";

export interface TransferCoreVerificationFailure {
  ok: false;
  code: VerificationFailureCode;
  field?: string;
  decodeCode?: DecodeFailureCode;
}

export interface VerifiedTransferCore {
  ok: true;
  verified: TransferCoreCandidate;
}

export type TransferCoreVerificationResult =
  VerifiedTransferCore | TransferCoreVerificationFailure;

export const TRANSFER_SELECTOR: TransferSelector = "0xa9059cbb";
export const LOCAL_CHAIN_ID: LocalChainId = "eip155:31337";
export const STATIC_NONCE_STRATEGY: NonceStrategy = "pending";
