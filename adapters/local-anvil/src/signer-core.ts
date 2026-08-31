import { authorizedTransferRequestSchema } from "@crip/adapter-sdk";
import {
  canonicalExecutionEnvelopeV2Schema,
  hashExecutionEnvelope,
  type ExecutionEnvelopeV2,
} from "@crip/schemas";
import type { ComponentAuthorization } from "@crip/trust-boundary";
import {
  checkSimulationFreshness,
  decodeTransferIndependent,
  hashSimulationEvidence,
  verifyExecutableTransfer,
  type ActiveFeeAndExecutionConstraints,
  type ExecutableTransferCandidate,
  type FreshnessFailureCode,
  type LocalReadRpc,
  type SimulationEvidence,
  type SuccessfulFreshSimulation,
  type TransferCoreCandidate,
  type VerifiedTransferCore,
} from "@crip/transaction-pipeline";

/** Default bounded simulation age accepted immediately before signing. */
export const SIGNER_DEFAULT_MAX_BLOCK_AGE = 10n;

export type Hash = `0x${string}`;
export type Address = `0x${string}`;

export type SignerRefusalCode =
  | "INVALID_REQUEST"
  | "OPERATION_NOT_FOUND"
  | "AUTHORIZATION_NOT_FOUND"
  | "OPERATION_NOT_AUTHORIZED"
  | "ENVELOPE_NOT_FOUND"
  | "ENVELOPE_UNSUPPORTED_VERSION"
  | "ENVELOPE_INVALID"
  | "ENVELOPE_SUPERSEDED"
  | "ENVELOPE_EXPIRED"
  | "AUTHORIZATION_INVALID"
  | "AUTHORIZATION_EXPIRED"
  | "AUTHORIZATION_INVALIDATED"
  | "RESERVATION_INVALID"
  | "FENCE_INVALID"
  | "FIXTURE_INVALID"
  | "SIMULATION_NOT_FOUND"
  | "SIMULATION_MISMATCH"
  | "EXECUTABLE_MISMATCH"
  | "FEE_CONSTRAINTS_INVALID"
  | "SIMULATION_STALE"
  | "SENDER_INVALID"
  | "SIGNER_CREDENTIAL_INVALID"
  | "PERSISTENCE_FAILED"
  | "INTERNAL";

export interface SignerRefusal {
  ok: false;
  code: SignerRefusalCode;
  /** Freshness failure detail for SIMULATION_STALE refusals; never secret. */
  freshnessCode?: FreshnessFailureCode;
}

export interface SignerSuccess {
  ok: true;
  transactionHash: Hash;
  /** True when the hash came from durable evidence without re-signing. */
  fromDurableEvidence: boolean;
  /** Signer component authentication over the result payload. */
  authorization: ComponentAuthorization;
}

export type SignerOutcome = SignerRefusal | SignerSuccess;

export interface SignAuthorizedTransferIds {
  operationId: string;
  authorizationId: string;
  adapterRequestId: string;
}

/** The exact unsigned type-2 fields the signer is allowed to sign. */
export interface ExactTransactionFields {
  chainId: 31337;
  from: Address;
  to: Address;
  value: 0n;
  nonce: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  accessList: readonly [];
  data: string;
}

export interface SignerCredentialIdentity {
  credentialId: string;
  componentId: string;
  role: "ADAPTER";
}

/** Normalized `transaction_simulations` row (numerics arrive as strings). */
export interface SimulationRecord {
  simulationId: string;
  transferCoreCandidateHash: string;
  fixtureInstanceId: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  senderAddress: string;
  senderNonce: string;
  tokenBalanceAtomic: string;
  nativeBalanceWei: string;
  gasEstimate: string;
  gasLimit: string;
  baseFeePerGas: string;
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
  outcome: string;
  expectedAssetDeltas: unknown;
  maximumNativeFeeAtomic: string;
  simulatorVersion: string;
  evidenceHash: string;
}

export interface FenceRecord {
  scope: "SYSTEM" | "OWNER" | "AGENT" | "POLICY";
  state: string;
  version: string;
}

export interface SigningContext {
  operation: {
    state: string;
    intentId: string;
    agentId: string;
    walletId: string;
    ownerId: string;
    policyId: string;
    policyVersion: number;
    intentPayload: unknown;
    policyDocument: unknown;
  };
  authorization: {
    authorizationKind: "OWNER_APPROVAL" | "AUTONOMOUS_POLICY";
    approvalId: string | null;
    ownerAuthenticationId: string | null;
    approvalStatus: string | null;
    approvalApproverId: string | null;
    approvalConsumedAt: string | null;
    policyDecisionId: string;
    policyDecisionHash: string;
    policyDecisionStatus: string;
    decisionPolicyId: string;
    decisionPolicyVersion: number;
    reservationId: string;
    envelopeId: string;
    envelopeRevision: number;
    envelopeHash: string;
    expiresAt: string | null;
    invalidated: boolean;
    fences: {
      systemVersion: string;
      systemState: string;
      ownerVersion: string;
      ownerState: string;
      agentVersion: string;
      agentState: string;
      policyVersion: string;
      policyState: string;
    };
  } | null;
  envelope: { payload: unknown; envelopeHash: string; revision: number } | null;
  latestEnvelopeRevision: number | null;
  reservation: { status: string; expiresAt: string | null } | null;
  fences: readonly FenceRecord[];
  signerCredential: {
    componentId: string;
    role: string;
    status: string;
  } | null;
  currentFixture: { fixtureInstanceId: string; tokenAddress: string } | null;
  simulations: readonly SimulationRecord[];
}

export interface DurableSignedEvidence {
  transactionHash: Hash;
  signedAt: string;
}

export interface PersistSignedEvidenceInput {
  signedTransactionId: string;
  ids: SignAuthorizedTransferIds;
  reservationId: string;
  envelopeId: string;
  envelopeRevision: number;
  envelopeHash: string;
  simulationId: string;
  fixtureInstanceId: string;
  expectedTransactionHash: Hash;
  signedAt: string;
  /** Trusted-component credential that produced the signature. */
  signerCredentialId: string;
}

export interface SigningAuditTrail {
  eventIdBase: string;
  traceId: string;
  actorId: string;
  credentialId: string;
}

/** Trusted-state access required by the signer; implemented over PostgreSQL. */
export interface SignerStore {
  loadSigningContext(
    ids: SignAuthorizedTransferIds,
    credentialId: string,
  ): Promise<SigningContext | null>;
  findDurableSignedEvidence(
    ids: SignAuthorizedTransferIds,
  ): Promise<DurableSignedEvidence | null>;
  beginSigning(
    ids: SignAuthorizedTransferIds,
    audit: SigningAuditTrail,
  ): Promise<void>;
  persistSignedEvidence(
    input: PersistSignedEvidenceInput,
    audit: SigningAuditTrail,
  ): Promise<void>;
  /** Best-effort refusal trail; failures here never mask the refusal. */
  recordSigningRefusal(
    operationId: string,
    reasonCode: SignerRefusalCode,
    audit: SigningAuditTrail,
  ): Promise<void>;
}

export type SignerPhase =
  "signing-started" | "evidence-persisted" | "broadcast-started";

export interface SignerCoreOptions {
  /** Permit exact, hash-gated rematerialization of proven pre-send evidence. */
  rematerializeExistingEvidence?: boolean;
  /** Internal same-child handoff; never serialize this material to a parent. */
  onSignedMaterial?(material: {
    signedTransactionId: string;
    expectedTransactionHash: Hash;
    rawTransaction?: string;
    fromDurableEvidence: boolean;
  }): void;
}

export interface SignerDeps {
  store: SignerStore;
  credential: SignerCredentialIdentity;
  /** Loopback Anvil RPC URL for the current runtime. */
  rpcUrl: string;
  /** Loads the disposable local Anvil account; the key never leaves the signer. */
  loadDisposableAccount(): { address: Address };
  /** Bound to the current runtime RPC and the supplied fixture instance. */
  makeRpc(fixtureInstanceId: string): LocalReadRpc;
  /**
   * Signs exactly the supplied type-2 fields and returns only the expected
   * transaction hash. Raw signed bytes stay inside the signer boundary.
   */
  signTransaction(fields: ExactTransactionFields): Promise<{
    transactionHash: Hash;
    /** Private child-local bytes; never part of SignerOutcome or parent IPC. */
    rawTransaction?: string;
  }>;
  /** Signs only the result reference; the component key remains signer-local. */
  authorizeResult(payload: Record<string, unknown>): ComponentAuthorization;
  now(): Date;
  maxBlockAge?: bigint;
  /** Progress notices for the parent process; never carry secret material. */
  onPhase?(phase: SignerPhase): void;
}

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const HEX_PATTERN = /^0x[0-9a-f]*$/;

/** Schema-validated address to the canonical typed form. */
const asAddress = (value: string): Address =>
  ADDRESS_PATTERN.test(value) ? (value as Address) : ("0x" as Address);

/** Schema-validated hex payload to the canonical typed form. */
const asHex = (value: string): `0x${string}` =>
  HEX_PATTERN.test(value) ? (value as `0x${string}`) : ("0x" as `0x${string}`);

const refuse = (
  code: SignerRefusalCode,
  freshnessCode?: FreshnessFailureCode,
): SignerRefusal => ({
  ok: false,
  code,
  ...(freshnessCode === undefined ? {} : { freshnessCode }),
});

const isAtomic = (value: unknown): value is string =>
  typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value);

const constraintsFrom = (
  intentPayload: unknown,
  policyDocument: unknown,
): ActiveFeeAndExecutionConstraints | null => {
  const intent = intentPayload as { maximumNetworkFee?: unknown } | null;
  const policy = policyDocument as {
    maximumNetworkFeeAtomic?: unknown;
    networkFees?: { maximumPerTransactionAtomic?: unknown };
  } | null;
  if (
    !intent ||
    typeof intent !== "object" ||
    !policy ||
    typeof policy !== "object"
  )
    return null;
  const fee = intent.maximumNetworkFee as
    { asset?: unknown; atomic?: unknown } | undefined;
  if (
    !fee ||
    typeof fee !== "object" ||
    fee.asset !== "native" ||
    !isAtomic(fee.atomic)
  )
    return null;
  const policyMaximumNetworkFeeAtomic =
    policy.maximumNetworkFeeAtomic ??
    policy.networkFees?.maximumPerTransactionAtomic;
  if (!isAtomic(policyMaximumNetworkFeeAtomic)) return null;
  return {
    intentMaximumNetworkFeeAtomic: fee.atomic,
    policyMaximumNetworkFeeAtomic,
  };
};

/**
 * Rebuild the executable transfer the envelope must bind. Every field comes
 * from the validated envelope, the current fixture, or the request IDs.
 */
const executableFromEnvelope = (
  envelope: ExecutionEnvelopeV2,
  ids: SignAuthorizedTransferIds,
  fixtureInstanceId: string,
): ExecutableTransferCandidate => {
  const provenance = {
    intentId: envelope.intentId,
    agentId: envelope.agentId,
    walletId: envelope.walletId,
    operationId: ids.operationId,
    policyId: envelope.policyId,
    policyVersion: envelope.policyVersion,
    policyDecisionHash: envelope.policyDecisionHash,
  };
  const core: TransferCoreCandidate = {
    action: "asset.transfer",
    chainId: "eip155:31337",
    from: asAddress(envelope.from),
    target: asAddress(envelope.to),
    nativeValue: "0",
    calldata: asHex(envelope.calldata),
    selector: "0xa9059cbb",
    recipient: asAddress(envelope.decodedArguments.recipient),
    amountAtomic: envelope.decodedArguments.amountAtomic,
    nonceStrategy: "pending",
    fixtureInstanceId,
    provenance,
  };
  return {
    ...core,
    nonce: envelope.nonce,
    transactionType: "eip1559",
    gasLimit: envelope.gasLimit,
    maxPriorityFeePerGas: envelope.maxPriorityFeePerGas,
    maxFeePerGas: envelope.maximumFeeConstraints.maxFeePerGas,
    accessList: [],
  };
};

/**
 * Rebuild the normalized simulation evidence from the persisted row plus the
 * envelope-bound execution fields (`to`, `calldata`, `value`). The evidence
 * hash re-derivation binds the two together: any drift on either side fails.
 */
const simulationEvidenceFromRecord = (
  record: SimulationRecord,
  envelope: ExecutionEnvelopeV2,
): SimulationEvidence => ({
  schemaVersion: "1.0",
  fixtureInstanceId: record.fixtureInstanceId,
  chainId: "eip155:31337",
  blockNumber: record.blockNumber,
  blockHash: record.blockHash as Hash,
  candidateHash: record.transferCoreCandidateHash as Hash,
  from: record.senderAddress as Address,
  to: asAddress(envelope.to),
  value: "0",
  calldata: asHex(envelope.calldata),
  senderNonce: record.senderNonce,
  tokenBalance: record.tokenBalanceAtomic,
  nativeBalance: record.nativeBalanceWei,
  gasEstimate: record.gasEstimate,
  gasLimit: record.gasLimit,
  baseFeePerGas: record.baseFeePerGas,
  maxPriorityFeePerGas: record.maxPriorityFeePerGas,
  maxFeePerGas: record.maxFeePerGas,
  accessList: [],
  outcome: record.outcome === "SUCCESS" ? "success" : "revert",
  expectedAssetDeltas:
    record.expectedAssetDeltas as SimulationEvidence["expectedAssetDeltas"],
  maximumNativeFeeAtomic: record.maximumNativeFeeAtomic,
  simulatorVersion: "viem@2.56.0",
  evidenceHash: record.evidenceHash as Hash,
});

const resultPayload = (
  ids: SignAuthorizedTransferIds,
  transactionHash: Hash,
): Record<string, unknown> => ({
  operationId: ids.operationId,
  authorizationId: ids.authorizationId,
  adapterRequestId: ids.adapterRequestId,
  transactionHash,
});

const traceIdFor = (ids: SignAuthorizedTransferIds): string => {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(
    `${ids.operationId}:${ids.authorizationId}:${ids.adapterRequestId}`,
    "utf8",
  )) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const part = hash.toString(16).padStart(8, "0");
  return `${part}${part}${part}${part}`;
};

const asTraceId = (traceId: string): string =>
  /^[0-9a-f]{32}$/.test(traceId)
    ? traceId
    : traceIdFor({
        operationId: "op_invalid",
        authorizationId: "auth_invalid",
        adapterRequestId: "req_invalid",
      });

/**
 * Orchestrate one restricted local signing: reload trusted state, revalidate
 * canonical authorization, fences, expiry, fixture, simulation, nonce, token
 * and native balances, and the fee ceiling immediately before signing, sign
 * exactly the envelope-v2 type-2 fields, and durably persist the allowed
 * signed evidence. Caller input is IDs only.
 */
export const signAuthorizedTransferCore = async (
  deps: SignerDeps,
  requestInput: unknown,
  options: SignerCoreOptions = {},
): Promise<SignerOutcome> => {
  const parsedRequest = authorizedTransferRequestSchema.safeParse(requestInput);
  if (!parsedRequest.success) return refuse("INVALID_REQUEST");
  const ids = parsedRequest.data;

  const context = await deps.store.loadSigningContext(
    ids,
    deps.credential.credentialId,
  );
  if (!context) return refuse("OPERATION_NOT_FOUND");

  const audit: SigningAuditTrail = {
    eventIdBase: `evt:${ids.operationId}:signing`,
    traceId: asTraceId(traceIdFor(ids)),
    actorId: deps.credential.componentId,
    credentialId: deps.credential.credentialId,
  };
  const auditRefusal = async (
    outcome: SignerRefusal,
  ): Promise<SignerRefusal> => {
    try {
      await deps.store.recordSigningRefusal(
        ids.operationId,
        outcome.code,
        audit,
      );
    } catch {
      // The refusal itself is the security answer; the trail is best-effort.
    }
    return outcome;
  };

  if (
    !context.signerCredential ||
    context.signerCredential.role !== "ADAPTER" ||
    context.signerCredential.status !== "ACTIVE" ||
    context.signerCredential.componentId !== deps.credential.componentId
  )
    return auditRefusal(refuse("SIGNER_CREDENTIAL_INVALID"));

  const existing = await deps.store.findDurableSignedEvidence(ids);

  const { authorization } = context;
  if (!authorization) return auditRefusal(refuse("AUTHORIZATION_NOT_FOUND"));

  const authorizationEvidenceOk =
    (authorization.authorizationKind === "OWNER_APPROVAL" &&
      authorization.policyDecisionStatus === "REQUIRE_APPROVAL" &&
      authorization.approvalId !== null &&
      authorization.ownerAuthenticationId !== null &&
      authorization.approvalStatus === "CONSUMED" &&
      authorization.approvalApproverId !== null &&
      authorization.approvalConsumedAt !== null) ||
    (authorization.authorizationKind === "AUTONOMOUS_POLICY" &&
      authorization.policyDecisionStatus === "ALLOW_AUTONOMOUS" &&
      authorization.approvalId === null &&
      authorization.ownerAuthenticationId === null &&
      authorization.approvalStatus === null &&
      authorization.approvalApproverId === null &&
      authorization.approvalConsumedAt === null);
  if (
    !authorizationEvidenceOk ||
    authorization.decisionPolicyId !== context.operation.policyId ||
    authorization.decisionPolicyVersion !== context.operation.policyVersion
  )
    return auditRefusal(refuse("AUTHORIZATION_INVALID"));

  if (!context.envelope) return auditRefusal(refuse("ENVELOPE_NOT_FOUND"));
  const payload = context.envelope.payload as Record<string, unknown> | null;
  const schemaVersion =
    payload && typeof payload === "object" ? payload.schemaVersion : undefined;
  if (schemaVersion === "1.0")
    return auditRefusal(refuse("ENVELOPE_UNSUPPORTED_VERSION"));
  if (schemaVersion !== "2.0") return auditRefusal(refuse("ENVELOPE_INVALID"));

  const parsedEnvelope = canonicalExecutionEnvelopeV2Schema.safeParse(payload);
  if (!parsedEnvelope.success) return auditRefusal(refuse("ENVELOPE_INVALID"));
  const envelope = parsedEnvelope.data;
  if (context.envelope.envelopeHash !== hashExecutionEnvelope(envelope))
    return auditRefusal(refuse("ENVELOPE_INVALID"));
  if (authorization.policyDecisionHash !== envelope.policyDecisionHash)
    return auditRefusal(refuse("AUTHORIZATION_INVALID"));
  if (
    authorization.envelopeId !== envelope.envelopeId ||
    authorization.envelopeRevision !== envelope.revision ||
    authorization.envelopeHash !== envelope.envelopeHash
  )
    return auditRefusal(refuse("AUTHORIZATION_INVALID"));
  if (
    context.operation.intentId !== envelope.intentId ||
    context.operation.agentId !== envelope.agentId ||
    context.operation.walletId !== envelope.walletId ||
    context.operation.policyId !== envelope.policyId ||
    context.operation.policyVersion !== envelope.policyVersion
  )
    return auditRefusal(refuse("AUTHORIZATION_INVALID"));
  if (
    context.latestEnvelopeRevision !== null &&
    context.latestEnvelopeRevision > envelope.revision
  )
    return auditRefusal(refuse("ENVELOPE_SUPERSEDED"));
  if (authorization.reservationId !== envelope.budgetReservationId)
    return auditRefusal(refuse("AUTHORIZATION_INVALID"));

  const now = deps.now();
  if (authorization.invalidated)
    return auditRefusal(refuse("AUTHORIZATION_INVALIDATED"));
  if (
    authorization.expiresAt !== null &&
    Date.parse(authorization.expiresAt) <= now.getTime()
  )
    return auditRefusal(refuse("AUTHORIZATION_EXPIRED"));
  if (Date.parse(envelope.expiresAt) <= now.getTime())
    return auditRefusal(refuse("ENVELOPE_EXPIRED"));
  if (
    !context.reservation ||
    context.reservation.status !== "AUTHORIZED" ||
    (context.reservation.expiresAt !== null &&
      Date.parse(context.reservation.expiresAt) <= now.getTime())
  )
    return auditRefusal(refuse("RESERVATION_INVALID"));
  if (
    !["AUTHORIZED", "SIGNING"].includes(context.operation.state) &&
    !(existing && context.operation.state === "SIGNED")
  )
    return auditRefusal(refuse("OPERATION_NOT_AUTHORIZED"));

  const fenceByScope = new Map(
    context.fences.map((fence) => [fence.scope, fence]),
  );
  const fenceOk =
    fenceByScope.size === 4 &&
    fenceByScope.get("SYSTEM")?.state === "ACTIVE" &&
    fenceByScope.get("OWNER")?.state === "ACTIVE" &&
    fenceByScope.get("AGENT")?.state === "ACTIVE" &&
    fenceByScope.get("POLICY")?.state === "ACTIVE" &&
    fenceByScope.get("SYSTEM")?.version ===
      authorization.fences.systemVersion &&
    fenceByScope.get("OWNER")?.version === authorization.fences.ownerVersion &&
    fenceByScope.get("AGENT")?.version === authorization.fences.agentVersion &&
    fenceByScope.get("POLICY")?.version === authorization.fences.policyVersion;
  if (!fenceOk) return auditRefusal(refuse("FENCE_INVALID"));

  if (
    !context.currentFixture ||
    context.currentFixture.tokenAddress !== envelope.to
  )
    return auditRefusal(refuse("FIXTURE_INVALID"));
  const fixtureInstanceId = context.currentFixture.fixtureInstanceId;

  const executable = executableFromEnvelope(envelope, ids, fixtureInstanceId);
  const decoded = decodeTransferIndependent(envelope.calldata);
  const envelopeShapeOk =
    envelope.value === "0" &&
    envelope.nonceStrategy === "pending" &&
    envelope.transactionType === "eip1559" &&
    envelope.accessList.length === 0 &&
    envelope.decodedFunction === "erc20.transfer" &&
    envelope.chainId === "eip155:31337" &&
    decoded.ok === true &&
    decoded.ok &&
    decoded.recipient === envelope.decodedArguments.recipient &&
    decoded.amountAtomic === envelope.decodedArguments.amountAtomic &&
    envelope.decodedArguments.assetAddress === envelope.to &&
    envelope.expectedAssetDeltas.length === 1 &&
    envelope.expectedAssetDeltas[0]?.assetAddress === envelope.to &&
    envelope.expectedAssetDeltas[0]?.from === envelope.from &&
    envelope.expectedAssetDeltas[0]?.to ===
      envelope.decodedArguments.recipient &&
    envelope.expectedAssetDeltas[0]?.amountAtomic ===
      envelope.decodedArguments.amountAtomic &&
    ((authorization.authorizationKind === "OWNER_APPROVAL" &&
      envelope.approvalRequirement === "owner") ||
      (authorization.authorizationKind === "AUTONOMOUS_POLICY" &&
        envelope.approvalRequirement === "none" &&
        envelope.riskDecision === "ALLOW"));
  if (!envelopeShapeOk) return auditRefusal(refuse("ENVELOPE_INVALID"));

  const constraints = constraintsFrom(
    context.operation.intentPayload,
    context.operation.policyDocument,
  );
  if (!constraints) return auditRefusal(refuse("FEE_CONSTRAINTS_INVALID"));

  const candidate = context.simulations.find(
    (simulation) =>
      simulation.evidenceHash === envelope.simulationResultHash &&
      simulation.blockNumber === envelope.simulationBlockNumber &&
      simulation.blockHash === envelope.simulationBlockHash &&
      simulation.fixtureInstanceId === fixtureInstanceId,
  );
  if (!candidate) return auditRefusal(refuse("SIMULATION_NOT_FOUND"));

  const simulation = simulationEvidenceFromRecord(candidate, envelope);
  if (simulation.outcome !== "success")
    return auditRefusal(refuse("SIMULATION_MISMATCH"));
  if (simulation.evidenceHash !== hashSimulationEvidence(simulation))
    return auditRefusal(refuse("SIMULATION_MISMATCH"));
  if (candidate.simulatorVersion !== "viem@2.56.0")
    return auditRefusal(refuse("SIMULATION_MISMATCH"));

  const verifiedCore: VerifiedTransferCore = {
    ok: true,
    verified: {
      action: executable.action,
      chainId: executable.chainId,
      from: executable.from,
      target: executable.target,
      nativeValue: executable.nativeValue,
      calldata: executable.calldata,
      selector: executable.selector,
      recipient: executable.recipient,
      amountAtomic: executable.amountAtomic,
      nonceStrategy: executable.nonceStrategy,
      fixtureInstanceId: executable.fixtureInstanceId,
      provenance: executable.provenance,
    },
  };
  const exact = verifyExecutableTransfer(
    verifiedCore,
    executable,
    simulation as SuccessfulFreshSimulation,
    constraints,
  );
  if (!exact.ok) return auditRefusal(refuse("EXECUTABLE_MISMATCH"));

  const disposable = deps.loadDisposableAccount();
  if (disposable.address !== envelope.from)
    return auditRefusal(refuse("SENDER_INVALID"));

  const freshness = await checkSimulationFreshness({
    verifiedCore,
    executable,
    simulation: simulation as SuccessfulFreshSimulation,
    rpc: deps.makeRpc(fixtureInstanceId),
    fixture: {
      fixtureInstanceId,
      chainId: "eip155:31337",
      walletAddress: asAddress(envelope.from),
      tokenAddress: asAddress(envelope.to),
      rpcUrl: deps.rpcUrl,
    },
    constraints,
    maxBlockAge: deps.maxBlockAge ?? SIGNER_DEFAULT_MAX_BLOCK_AGE,
  });
  if (!freshness.ok)
    return auditRefusal(refuse("SIMULATION_STALE", freshness.code));

  if (existing && !options.rematerializeExistingEvidence)
    return {
      ok: true,
      transactionHash: existing.transactionHash,
      fromDurableEvidence: true,
      authorization: deps.authorizeResult(
        resultPayload(ids, existing.transactionHash),
      ),
    };

  if (!existing) {
    try {
      await deps.store.beginSigning(ids, audit);
    } catch {
      return auditRefusal(refuse("OPERATION_NOT_AUTHORIZED"));
    }
    deps.onPhase?.("signing-started");
  }

  let signature: { transactionHash: Hash; rawTransaction?: string };
  try {
    signature = await deps.signTransaction({
      chainId: 31337,
      from: asAddress(envelope.from),
      to: asAddress(envelope.to),
      value: 0n,
      nonce: BigInt(envelope.nonce),
      gas: BigInt(envelope.gasLimit),
      maxFeePerGas: BigInt(envelope.maximumFeeConstraints.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas),
      accessList: [],
      data: envelope.calldata,
    });
  } catch {
    return auditRefusal(refuse("INTERNAL"));
  }
  if (!HASH_PATTERN.test(signature.transactionHash))
    return auditRefusal(refuse("INTERNAL"));

  const signedTransactionId = `signed:${ids.operationId}:${envelope.revision}`;
  if (existing) {
    if (signature.transactionHash !== existing.transactionHash)
      return auditRefusal(refuse("INTERNAL"));
    options.onSignedMaterial?.({
      signedTransactionId,
      expectedTransactionHash: existing.transactionHash,
      ...(signature.rawTransaction === undefined
        ? {}
        : { rawTransaction: signature.rawTransaction }),
      fromDurableEvidence: true,
    });
    return {
      ok: true,
      transactionHash: existing.transactionHash,
      fromDurableEvidence: true,
      authorization: deps.authorizeResult(
        resultPayload(ids, existing.transactionHash),
      ),
    };
  }

  const signedAt = deps
    .now()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  try {
    await deps.store.persistSignedEvidence(
      {
        signedTransactionId,
        ids,
        reservationId: envelope.budgetReservationId,
        envelopeId: envelope.envelopeId,
        envelopeRevision: envelope.revision,
        envelopeHash: envelope.envelopeHash,
        simulationId: candidate.simulationId,
        fixtureInstanceId,
        expectedTransactionHash: signature.transactionHash,
        signedAt,
        signerCredentialId: deps.credential.credentialId,
      },
      audit,
    );
  } catch {
    // A concurrent signer may have persisted the same evidence first.
    const raced = await deps.store.findDurableSignedEvidence(ids);
    if (raced && raced.transactionHash === signature.transactionHash)
      return {
        ok: true,
        transactionHash: raced.transactionHash,
        fromDurableEvidence: true,
        authorization: deps.authorizeResult(
          resultPayload(ids, raced.transactionHash),
        ),
      };
    return auditRefusal(refuse("PERSISTENCE_FAILED"));
  }
  deps.onPhase?.("evidence-persisted");
  options.onSignedMaterial?.({
    signedTransactionId,
    expectedTransactionHash: signature.transactionHash,
    ...(signature.rawTransaction === undefined
      ? {}
      : { rawTransaction: signature.rawTransaction }),
    fromDurableEvidence: false,
  });

  return {
    ok: true,
    transactionHash: signature.transactionHash,
    fromDurableEvidence: false,
    authorization: deps.authorizeResult(
      resultPayload(ids, signature.transactionHash),
    ),
  };
};

export const signerTraceIdFor = traceIdFor;
