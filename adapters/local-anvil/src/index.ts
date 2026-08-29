import {
  adapterStatusRequestSchema,
  authorizedTransferRequestSchema,
  authorizedTransferResultSchema,
  normalizedChainEvidenceSchema,
  normalizedRecoveryRequestSchema,
  normalizedStatusSchema,
  type AdapterCapabilitySurface,
  type AdapterStatusRequest,
  type AuthorizedTransferResult,
  type NormalizedChainEvidence,
  type NormalizedRecoveryRequest,
  type NormalizedStatus,
  type SignAuthorizedTransferRequest,
} from "@crip/adapter-sdk";
import { adapterCapabilityManifestSchema } from "@crip/schemas";

export const LOCAL_ANVIL_CHAIN_ID = "eip155:31337" as const;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
};

/** Truthful local-only capability declaration; no production custody claim. */
export const localAnvilCapabilityManifest = deepFreeze(
  adapterCapabilityManifestSchema.parse({
    adapter: { id: "local-anvil", version: "0.0.0" },
    chains: [LOCAL_ANVIL_CHAIN_ID],
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
  }),
);

export type LocalAnvilExecutionAdapter = AdapterCapabilitySurface & {
  signAuthorizedTransfer(
    request: SignAuthorizedTransferRequest,
  ): Promise<AuthorizedTransferResult>;
};

export type LocalAnvilCapability = LocalAnvilExecutionAdapter;

export interface LocalAnvilReferenceHandlers {
  signAuthorizedTransfer: (
    request: SignAuthorizedTransferRequest,
  ) => Promise<AuthorizedTransferResult>;
  getStatus: (request: AdapterStatusRequest) => Promise<NormalizedStatus>;
  recoverTransaction: (
    request: NormalizedRecoveryRequest,
  ) => Promise<NormalizedChainEvidence>;
}

/**
 * Build the local reference shape without implementing signing, RPC, or state
 * loading. P2-04C supplies the isolated execution handler behind this facade.
 */
export const createLocalAnvilReferenceAdapter = (
  handlers: LocalAnvilReferenceHandlers,
): LocalAnvilExecutionAdapter =>
  Object.freeze({
    manifest: () => localAnvilCapabilityManifest,
    signAuthorizedTransfer: async (request: SignAuthorizedTransferRequest) =>
      authorizedTransferResultSchema.parse(
        await handlers.signAuthorizedTransfer(
          authorizedTransferRequestSchema.parse(request),
        ),
      ),
    getStatus: async (request: AdapterStatusRequest) =>
      normalizedStatusSchema.parse(
        await handlers.getStatus(adapterStatusRequestSchema.parse(request)),
      ),
    recoverTransaction: async (request: NormalizedRecoveryRequest) =>
      normalizedChainEvidenceSchema.parse(
        await handlers.recoverTransaction(
          normalizedRecoveryRequestSchema.parse(request),
        ),
      ),
  });

export type {
  AdapterCapabilitySurface,
  AdapterStatusRequest,
  AuthorizedTransferResult,
  NormalizedChainEvidence,
  NormalizedRecoveryRequest,
  NormalizedStatus,
  SignAuthorizedTransferRequest,
} from "@crip/adapter-sdk";

export {
  SIGNER_DEFAULT_MAX_BLOCK_AGE,
  signAuthorizedTransferCore,
  signerTraceIdFor,
  type Address,
  type DurableSignedEvidence,
  type ExactTransactionFields,
  type FenceRecord,
  type Hash,
  type PersistSignedEvidenceInput,
  type SignAuthorizedTransferIds,
  type SignerCredentialIdentity,
  type SignerDeps,
  type SignerOutcome,
  type SignerPhase,
  type SignerRefusal,
  type SignerRefusalCode,
  type SignerStore,
  type SignerSuccess,
  type SigningAuditTrail,
  type SigningContext,
  type SimulationRecord,
} from "./signer-core.js";
export { createSignerStore } from "./signer-store.js";
export { createLocalSignerDeps } from "./signer-keys.js";
export {
  createFaultProxy,
  FAULT_PROXY_MODES,
  LOCAL_CHAIN_ID as FAULT_PROXY_CHAIN_ID,
  type FaultProxy,
  type FaultProxyMode,
  type FaultProxyModeOptions,
  type FaultProxyOptions,
  type FaultProxyRequest,
} from "./fault-proxy.js";
export {
  spawnSignerProcess,
  type SignerClientResult,
  type SpawnSignerOptions,
} from "./signer-client.js";

import { Pool } from "pg";
import { verifyComponentAction } from "@crip/trust-boundary";

import { spawnSignerProcess as spawnSigner } from "./signer-client.js";

/**
 * Parent-side signer wiring for the reference adapter. Each signing request
 * spawns the isolated signer child; the child loads its own secrets from
 * mode-0600 local state and returns only IDs, hashes, and component auth.
 * The returned authorization is verified against the credential's registered
 * public key before the result is accepted.
 */
export const createLocalAnvilSignerHandler = (input: {
  root: string;
  pool: Pool;
  timeoutMs?: number;
}): LocalAnvilReferenceHandlers => ({
  signAuthorizedTransfer: async (request) => {
    const result = await spawnSigner({
      root: input.root,
      ids: request,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
    if (!result.ok || !result.transactionHash || !result.authorization)
      throw new Error(
        `local signer refused the authorized transfer: ${result.code ?? "INTERNAL"}`,
      );
    const publicKey = await input.pool
      .query<{ public_key: string }>(
        "SELECT public_key FROM trusted_component_credentials WHERE credential_id = $1",
        [result.authorization.credentialId],
      )
      .then((query) => query.rows[0]?.public_key);
    if (!publicKey)
      throw new Error("signer credential is not registered in trusted state");
    const payload = {
      operationId: request.operationId,
      authorizationId: request.authorizationId,
      adapterRequestId: request.adapterRequestId,
      transactionHash: result.transactionHash,
    };
    const verified = verifyComponentAction(
      result.authorization,
      publicKey,
      "sign-authorized-transfer",
      payload,
    );
    if (!verified) throw new Error("signer component authorization is invalid");
    return { transactionHash: result.transactionHash };
  },
  getStatus: async (request) => ({
    operationId: request.operationId,
    adapterRequestId: request.adapterRequestId,
    state: "UNKNOWN",
    evidence: "UNTRUSTED",
  }),
  recoverTransaction: async (request) => ({
    operationId: request.operationId,
    adapterRequestId: request.adapterRequestId,
    outcome: "UNKNOWN",
    evidence: "UNTRUSTED",
  }),
});
