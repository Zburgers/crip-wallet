import { describe, expect, it } from "vitest";

import { hashExecutionEnvelope } from "@crip/schemas";
import {
  constructTransferCore,
  decodeTransferIndependent,
  simulateAndResolveTransfer,
  verifyTransferCore,
  type ActiveFeeAndExecutionConstraints,
  type CanonicalBlock,
  type LocalFixtureIdentity,
  type LocalReadRpc,
  type SimulationRequest,
} from "@crip/transaction-pipeline";
import {
  generateComponentCredential,
  signComponentAction,
  verifyComponentAction,
} from "@crip/trust-boundary";

import {
  SIGNER_DEFAULT_MAX_BLOCK_AGE,
  signAuthorizedTransferCore,
  type Address,
  type DurableSignedEvidence,
  type ExactTransactionFields,
  type PersistSignedEvidenceInput,
  type SignAuthorizedTransferIds,
  type SigningAuditTrail,
  type SignerDeps,
  type SignerStore,
  type SigningContext,
  type SimulationRecord,
} from "../src/signer-core.js";

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const token = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const blockHash = `0x${"ab".repeat(32)}` as const;
const fixtureInstanceId = "fixture-local-signer";
const rpcUrl = "http://127.0.0.1:8545";
const operationId = "op_local_signer";
const envelopeId = "env_local_signer_1";
const reservationId = "res_local_signer";
const authorizationId = "approval_local_signer:authorization";
const adapterRequestId = "req_local_signer";
const policyDecisionHash = `0x${"11".repeat(32)}`;
const now = new Date("2026-08-28T12:05:00Z");
const farFuture = "2030-01-01T00:00:00Z";

const ids: SignAuthorizedTransferIds = {
  operationId,
  authorizationId,
  adapterRequestId,
};

const credential = generateComponentCredential({
  credentialId: "credential_local_signer",
  componentId: "local-anvil-signer",
  role: "ADAPTER",
});

const intent = {
  schemaVersion: "1.0",
  intentId: "int_local_signer",
  idempotencyKey: "transfer-signer",
  agentId: "agent_local_01",
  walletId: "wallet_local_01",
  chainId: "eip155:31337",
  action: "asset.transfer",
  objective: "Exercise the restricted local signer",
  asset: { type: "erc20", address: token },
  amount: { atomic: "500000" },
  recipient,
  maximumNetworkFee: { asset: "native", atomic: "2000000" },
  notBefore: "2026-08-28T12:00:00Z",
  expiresAt: "2026-08-28T12:10:00Z",
  metadata: {},
} as const;

const trusted = {
  walletAddress: wallet,
  tokenAddress: token,
  chainId: "eip155:31337",
  fixtureInstanceId,
  provenance: {
    operationId,
    policyId: "policy_local_01",
    policyVersion: 1,
    policyDecisionHash,
  },
} as const;

const constraints: ActiveFeeAndExecutionConstraints = {
  intentMaximumNetworkFeeAtomic: "2000000",
  policyMaximumNetworkFeeAtomic: "2000000",
};

const fixture: LocalFixtureIdentity = {
  fixtureInstanceId,
  chainId: "eip155:31337",
  walletAddress: wallet,
  tokenAddress: token,
  rpcUrl,
};

const core = constructTransferCore(intent, trusted);
const decoded = decodeTransferIndependent(core.calldata);
if (!decoded.ok) throw new Error("test transfer did not decode");
const verifiedCore = verifyTransferCore(intent, core, decoded, {
  walletAddress: wallet,
  tokenAddress: token,
  chainId: "eip155:31337",
  fixtureInstanceId,
  provenance: core.provenance,
});
if (!verifiedCore.ok) throw new Error("test transfer core did not verify");

class FakeRpc implements LocalReadRpc {
  chainId = 31337n;
  currentBlockNumber = 100n;
  pendingNonce = 3n;
  nativeBalance = 100_000_000n;
  tokenBalance = 1_000_000n;
  baseFeePerGas = 10n;
  maxPriorityFeePerGas = 2n;
  estimatedGas = 50_000n;
  blocks = new Map<bigint, CanonicalBlock>([
    [100n, { number: 100n, hash: blockHash, baseFeePerGas: 10n }],
  ]);

  async getChainId() {
    return this.chainId;
  }

  async getBlockNumber() {
    return this.currentBlockNumber;
  }

  async getBlockByNumber(number: bigint) {
    return this.blocks.get(number) ?? null;
  }

  async getBlockByHash(hash: string) {
    return [...this.blocks.values()].find((b) => b.hash === hash) ?? null;
  }

  async getPendingNonce() {
    return this.pendingNonce;
  }

  async getNativeBalance() {
    return this.nativeBalance;
  }

  async getTokenBalance() {
    return this.tokenBalance;
  }

  async simulateTransfer(request: SimulationRequest) {
    expect(request.value).toBe(0n);
    return { outcome: "success" as const };
  }

  async estimateGas(request: SimulationRequest) {
    void request;
    return this.estimatedGas;
  }

  async getFeeData() {
    return {
      baseFeePerGas: this.baseFeePerGas,
      maxPriorityFeePerGas: this.maxPriorityFeePerGas,
    };
  }
}

const resolved = await simulateAndResolveTransfer(
  verifiedCore,
  new FakeRpc(),
  fixture,
  constraints,
);

/** Deterministic, consistently-hashed v2 envelope built from the simulation. */
const buildEnvelope = () => {
  const payload = {
    schemaVersion: "2.0",
    envelopeId,
    revision: 1,
    intentId: intent.intentId,
    intentHash: `sha256:${"33".repeat(32)}`,
    agentId: intent.agentId,
    walletId: intent.walletId,
    adapterId: "local-anvil",
    adapterVersion: "0.1.0",
    chainId: "eip155:31337",
    from: wallet,
    to: token,
    value: "0",
    calldata: resolved.executable.calldata,
    decodedFunction: "erc20.transfer",
    decodedArguments: {
      assetAddress: token,
      recipient,
      amountAtomic: intent.amount.atomic,
    },
    expectedAssetDeltas: [
      {
        assetAddress: token,
        from: wallet,
        to: recipient,
        amountAtomic: intent.amount.atomic,
      },
    ],
    simulationBlockNumber: resolved.simulation.blockNumber,
    simulationBlockHash: resolved.simulation.blockHash,
    simulationResultHash: resolved.simulation.evidenceHash,
    nonceStrategy: "pending",
    nonce: resolved.executable.nonce,
    transactionType: "eip1559",
    gasLimit: resolved.executable.gasLimit,
    maxPriorityFeePerGas: resolved.executable.maxPriorityFeePerGas,
    accessList: [],
    maximumFeeConstraints: {
      asset: "native",
      maxFeePerGas: resolved.executable.maxFeePerGas,
      maximumNetworkFeeAtomic: resolved.simulation.maximumNativeFeeAtomic,
    },
    policyId: "policy_local_01",
    policyVersion: 1,
    policyDecisionHash,
    budgetReservationId: reservationId,
    createdAt: "2026-08-28T12:00:00Z",
    expiresAt: "2026-08-28T12:10:00Z",
    riskDecision: "ALLOW",
    approvalRequirement: "owner",
    envelopeHash:
      "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
  return { ...payload, envelopeHash: hashExecutionEnvelope(payload) };
};

const simulationRecordFromEvidence = (): SimulationRecord => ({
  simulationId: "sim_local_signer",
  transferCoreCandidateHash: resolved.simulation.candidateHash,
  fixtureInstanceId,
  chainId: "eip155:31337",
  blockNumber: resolved.simulation.blockNumber,
  blockHash: resolved.simulation.blockHash,
  senderAddress: resolved.simulation.from,
  senderNonce: resolved.simulation.senderNonce,
  tokenBalanceAtomic: resolved.simulation.tokenBalance,
  nativeBalanceWei: resolved.simulation.nativeBalance,
  gasEstimate: resolved.simulation.gasEstimate,
  gasLimit: resolved.simulation.gasLimit,
  baseFeePerGas: resolved.simulation.baseFeePerGas,
  maxPriorityFeePerGas: resolved.simulation.maxPriorityFeePerGas,
  maxFeePerGas: resolved.simulation.maxFeePerGas,
  outcome: "SUCCESS",
  expectedAssetDeltas: [
    {
      assetAddress: token,
      from: wallet,
      to: recipient,
      amountAtomic: intent.amount.atomic,
    },
  ],
  maximumNativeFeeAtomic: resolved.simulation.maximumNativeFeeAtomic,
  simulatorVersion: "viem@2.56.0",
  evidenceHash: resolved.simulation.evidenceHash,
});

/** Fresh, fully valid signing context for every test. */
const buildContext = (): SigningContext => ({
  operation: {
    state: "AUTHORIZED",
    intentId: intent.intentId,
    agentId: intent.agentId,
    walletId: intent.walletId,
    ownerId: "owner_1",
    policyId: "policy_local_01",
    policyVersion: 1,
    intentPayload: structuredClone(intent),
    policyDocument: { maximumNetworkFeeAtomic: "2000000" },
  },
  authorization: {
    authorizationKind: "OWNER_APPROVAL",
    approvalId: "approval_local_signer",
    ownerAuthenticationId: "owner-auth-local-signer",
    approvalStatus: "CONSUMED",
    approvalApproverId: "owner_approver",
    approvalConsumedAt: farFuture,
    policyDecisionId: "decision_local_signer",
    policyDecisionHash,
    policyDecisionStatus: "REQUIRE_APPROVAL",
    decisionPolicyId: "policy_local_01",
    decisionPolicyVersion: 1,
    reservationId,
    envelopeId,
    envelopeRevision: 1,
    envelopeHash: "",
    expiresAt: farFuture,
    invalidated: false,
    fences: {
      systemVersion: "1",
      systemState: "ACTIVE",
      ownerVersion: "1",
      ownerState: "ACTIVE",
      agentVersion: "1",
      agentState: "ACTIVE",
      policyVersion: "1",
      policyState: "ACTIVE",
    },
  },
  envelope: null,
  latestEnvelopeRevision: 1,
  reservation: { status: "AUTHORIZED", expiresAt: farFuture },
  fences: [
    { scope: "SYSTEM", state: "ACTIVE", version: "1" },
    { scope: "OWNER", state: "ACTIVE", version: "1" },
    { scope: "AGENT", state: "ACTIVE", version: "1" },
    { scope: "POLICY", state: "ACTIVE", version: "1" },
  ],
  signerCredential: {
    componentId: credential.componentId,
    role: "ADAPTER",
    status: "ACTIVE",
  },
  currentFixture: { fixtureInstanceId, tokenAddress: token },
  simulations: [simulationRecordFromEvidence()],
});

const wireContext = (context: SigningContext, payload: object): void => {
  const candidate = structuredClone(payload) as Record<string, unknown>;
  let envelopeHash = "";
  try {
    envelopeHash = hashExecutionEnvelope(candidate);
    candidate.envelopeHash = envelopeHash;
  } catch {
    // Invalid-envelope cases must reach the signer's schema refusal path.
  }
  context.envelope = {
    payload: candidate,
    envelopeHash,
    revision: 1,
  };
  context.authorization!.envelopeHash = envelopeHash;
};

class FakeStore implements SignerStore {
  context: SigningContext | null;
  durable: DurableSignedEvidence | null = null;
  beginCalls = 0;
  persistCalls = 0;
  refusals: string[] = [];
  persisted: PersistSignedEvidenceInput[] = [];
  beginError: Error | null = null;
  persistError: Error | null = null;

  constructor(context: SigningContext | null) {
    this.context = context;
  }

  async loadSigningContext() {
    return this.context;
  }

  async findDurableSignedEvidence() {
    return this.durable;
  }

  async beginSigning() {
    this.beginCalls += 1;
    if (this.beginError) throw this.beginError;
  }

  async persistSignedEvidence(input: PersistSignedEvidenceInput) {
    this.persistCalls += 1;
    this.persisted.push(input);
    if (this.persistError) throw this.persistError;
  }

  async recordSigningRefusal(
    operationId: string,
    reasonCode: string,
    audit: SigningAuditTrail,
  ) {
    void operationId;
    void audit;
    this.refusals.push(reasonCode);
  }
}

const buildDeps = (
  store: SignerStore,
  rpc: FakeRpc,
  overrides: Partial<SignerDeps> = {},
): SignerDeps => ({
  store,
  credential: {
    credentialId: credential.credentialId,
    componentId: credential.componentId,
    role: "ADAPTER",
  },
  rpcUrl,
  loadDisposableAccount: () => ({ address: wallet as Address }),
  makeRpc: () => rpc,
  signTransaction: async (fields: ExactTransactionFields) => {
    if (fields.chainId !== 31337) throw new Error("wrong chain");
    return { transactionHash: `0x${"ee".repeat(32)}` };
  },
  authorizeResult: (payload) =>
    signComponentAction(credential, "sign-authorized-transfer", payload),
  now: () => now,
  maxBlockAge: SIGNER_DEFAULT_MAX_BLOCK_AGE,
  ...overrides,
});

const happyContext = (): { context: SigningContext; payload: object } => {
  const context = buildContext();
  const payload = buildEnvelope();
  wireContext(context, payload);
  return { context, payload };
};

describe("restricted local signer core", () => {
  it("does not reuse durable signed evidence without current canonical authorization", async () => {
    const { context } = happyContext();
    context.authorization = null;
    const store = new FakeStore(context);
    store.durable = {
      transactionHash: `0x${"ee".repeat(32)}`,
      signedAt: farFuture,
    };

    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc()),
      ids,
    );

    expect(outcome).toMatchObject({
      ok: false,
      code: "AUTHORIZATION_NOT_FOUND",
    });
  });

  it("rejects autonomous signer context unless persisted autonomous policy evidence is present", async () => {
    const { context } = happyContext();
    const authorization = context.authorization as NonNullable<
      SigningContext["authorization"]
    > & {
      authorizationKind: "AUTONOMOUS_POLICY";
      policyDecisionStatus: string;
    };
    authorization.authorizationKind = "AUTONOMOUS_POLICY";
    authorization.policyDecisionStatus = "REQUIRE_APPROVAL";
    const store = new FakeStore(context);

    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc()),
      ids,
    );

    expect(outcome).toMatchObject({
      ok: false,
      code: "AUTHORIZATION_INVALID",
    });
  });

  it("signs the exact envelope-v2 type-2 fields and returns verified evidence", async () => {
    const { context } = happyContext();
    const store = new FakeStore(context);
    const rpc = new FakeRpc();
    const signedFields: ExactTransactionFields[] = [];
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, rpc, {
        signTransaction: async (fields) => {
          signedFields.push(fields);
          return { transactionHash: `0x${"ee".repeat(32)}` };
        },
      }),
      ids,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.fromDurableEvidence).toBe(false);
    expect(outcome.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(signedFields).toHaveLength(1);
    expect(signedFields[0]).toEqual({
      chainId: 31337,
      from: wallet,
      to: token,
      value: 0n,
      nonce: BigInt(resolved.executable.nonce),
      gas: BigInt(resolved.executable.gasLimit),
      maxFeePerGas: BigInt(resolved.executable.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(resolved.executable.maxPriorityFeePerGas),
      accessList: [],
      data: resolved.executable.calldata,
    });
    expect(
      verifyComponentAction(
        outcome.authorization,
        credential.publicKey,
        "sign-authorized-transfer",
        {
          operationId,
          authorizationId,
          adapterRequestId,
          transactionHash: outcome.transactionHash,
        },
      ),
    ).toBe(true);
    expect(store.persisted[0]?.signedTransactionId).toBe(
      `signed:${operationId}:1`,
    );
    expect(store.persisted[0]?.signerCredentialId).toBe(
      credential.credentialId,
    );
    expect(store.refusals).toHaveLength(0);
  });

  it("rejects caller-supplied raw transaction fields and malformed requests", async () => {
    const { context } = happyContext();
    const store = new FakeStore(context);
    const deps = buildDeps(store, new FakeRpc());
    for (const request of [
      null,
      {},
      {
        operationId: "op",
        authorizationId: "auth",
        adapterRequestId: "req",
        from: wallet,
      },
      {
        operationId: "op",
        authorizationId: "auth",
        adapterRequestId: "req",
        calldata: "0x",
      },
      {
        operationId: "op",
        authorizationId: "auth",
        adapterRequestId: "req",
        rawTransaction: "0x02",
      },
      { operationId: "op!", authorizationId: "auth", adapterRequestId: "req" },
    ]) {
      const outcome = await signAuthorizedTransferCore(deps, request);
      expect(outcome).toEqual({ ok: false, code: "INVALID_REQUEST" });
    }
    expect(store.beginCalls).toBe(0);
  });

  it("returns durable evidence without re-signing", async () => {
    const { context } = happyContext();
    const store = new FakeStore(context);
    store.durable = {
      transactionHash: `0x${"dd".repeat(32)}`,
      signedAt: farFuture,
    };
    let signed = 0;
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc(), {
        signTransaction: async () => {
          signed += 1;
          throw new Error("must not re-sign durable evidence");
        },
      }),
      ids,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.fromDurableEvidence).toBe(true);
    expect(outcome.transactionHash).toBe(store.durable.transactionHash);
    expect(signed).toBe(0);
    expect(store.beginCalls).toBe(0);
  });

  it("refuses missing operation and authorization", async () => {
    const missing = new FakeStore(null);
    expect(
      await signAuthorizedTransferCore(buildDeps(missing, new FakeRpc()), ids),
    ).toEqual({ ok: false, code: "OPERATION_NOT_FOUND" });

    const { context } = happyContext();
    context.authorization = null;
    const store = new FakeStore(context);
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc()),
      ids,
    );
    expect(outcome).toEqual({ ok: false, code: "AUTHORIZATION_NOT_FOUND" });
    expect(store.refusals).toContain("AUTHORIZATION_NOT_FOUND");
    expect(store.beginCalls).toBe(0);
  });

  it("refuses inactive, mismatched, or wrong-role signer credentials", async () => {
    for (const mutate of [
      (context: SigningContext) => {
        context.signerCredential!.status = "REVOKED";
      },
      (context: SigningContext) => {
        context.signerCredential!.componentId = "other-component";
      },
      (context: SigningContext) => {
        context.signerCredential!.role = "RECONCILER";
      },
    ]) {
      const { context } = happyContext();
      mutate(context);
      const store = new FakeStore(context);
      const outcome = await signAuthorizedTransferCore(
        buildDeps(store, new FakeRpc()),
        ids,
      );
      expect(outcome).toEqual({ ok: false, code: "SIGNER_CREDENTIAL_INVALID" });
      expect(store.beginCalls).toBe(0);
    }
  });

  it("refuses v1 envelopes and unknown versions", async () => {
    const { context } = happyContext();
    (context.envelope!.payload as Record<string, unknown>).schemaVersion =
      "1.0";
    const store = new FakeStore(context);
    expect(
      await signAuthorizedTransferCore(buildDeps(store, new FakeRpc()), ids),
    ).toEqual({ ok: false, code: "ENVELOPE_UNSUPPORTED_VERSION" });

    const { context: unknown } = happyContext();
    (unknown.envelope!.payload as Record<string, unknown>).schemaVersion =
      "3.0";
    expect(
      await signAuthorizedTransferCore(
        buildDeps(new FakeStore(unknown), new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "ENVELOPE_INVALID" });
  });

  it("refuses envelopes whose hash does not match the persisted payload", async () => {
    const { context, payload } = happyContext();
    const mutated = {
      ...payload,
      calldata: "0xa9059cbb" + "ff".repeat(64),
    } as Record<string, unknown>;
    context.envelope = {
      payload: mutated,
      envelopeHash: hashExecutionEnvelope(payload),
      revision: 1,
    };
    const store = new FakeStore(context);
    expect(
      await signAuthorizedTransferCore(buildDeps(store, new FakeRpc()), ids),
    ).toEqual({ ok: false, code: "ENVELOPE_INVALID" });
    expect(store.beginCalls).toBe(0);
  });

  it("refuses superseded envelopes and authorization binding mismatches", async () => {
    const superseded = happyContext();
    superseded.context.latestEnvelopeRevision = 2;
    expect(
      await signAuthorizedTransferCore(
        buildDeps(new FakeStore(superseded.context), new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "ENVELOPE_SUPERSEDED" });

    const bound = happyContext();
    bound.context.authorization!.envelopeHash = `0x${"99".repeat(32)}`;
    expect(
      await signAuthorizedTransferCore(
        buildDeps(new FakeStore(bound.context), new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "AUTHORIZATION_INVALID" });

    const reservation = happyContext();
    reservation.context.authorization!.reservationId = "res_other";
    expect(
      await signAuthorizedTransferCore(
        buildDeps(new FakeStore(reservation.context), new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "AUTHORIZATION_INVALID" });
  });

  it("refuses an envelope whose canonical operation binding was substituted", async () => {
    const { context } = happyContext();
    context.operation.intentId = "other_intent";
    const store = new FakeStore(context);
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc()),
      ids,
    );
    expect(outcome).toEqual({ ok: false, code: "AUTHORIZATION_INVALID" });
    expect(store.beginCalls).toBe(0);
  });

  it("refuses invalidated, expired, and released authorizations", async () => {
    const cases: [string, (context: SigningContext) => void][] = [
      [
        "AUTHORIZATION_INVALIDATED",
        (context) => {
          context.authorization!.invalidated = true;
        },
      ],
      [
        "AUTHORIZATION_EXPIRED",
        (context) => {
          context.authorization!.expiresAt = "2020-01-01T00:00:00Z";
        },
      ],
      [
        "ENVELOPE_EXPIRED",
        (context) => {
          const payload = {
            ...(context.envelope!.payload as Record<string, unknown>),
            createdAt: "2019-01-01T00:00:00Z",
            expiresAt: "2020-01-01T00:00:00Z",
          } as Record<string, unknown>;
          wireContext(context, payload);
        },
      ],
      [
        "RESERVATION_INVALID",
        (context) => {
          context.reservation!.status = "RELEASED";
        },
      ],
      [
        "RESERVATION_INVALID",
        (context) => {
          context.reservation!.expiresAt = "2020-01-01T00:00:00Z";
        },
      ],
      [
        "OPERATION_NOT_AUTHORIZED",
        (context) => {
          context.operation.state = "BROADCAST";
        },
      ],
    ];
    for (const [code, mutate] of cases) {
      const { context } = happyContext();
      mutate(context);
      const store = new FakeStore(context);
      expect(
        await signAuthorizedTransferCore(buildDeps(store, new FakeRpc()), ids),
      ).toEqual({ ok: false, code });
      expect(store.beginCalls).toBe(0);
    }
  });

  it("refuses stale fences and revoked fence snapshots", async () => {
    for (const mutate of [
      (context: SigningContext) => {
        context.fences[1]!.state = "REVOKED";
      },
      (context: SigningContext) => {
        context.fences[1]!.version = "2";
      },
      (context: SigningContext) => {
        context.authorization!.fences.policyVersion = "2";
      },
      (context: SigningContext) => {
        context.fences = context.fences.slice(0, 3);
      },
    ]) {
      const { context } = happyContext();
      mutate(context);
      const store = new FakeStore(context);
      expect(
        await signAuthorizedTransferCore(buildDeps(store, new FakeRpc()), ids),
      ).toEqual({ ok: false, code: "FENCE_INVALID" });
      expect(store.beginCalls).toBe(0);
    }
  });

  it("refuses fixture mismatches and missing simulations", async () => {
    const fixtureCase = happyContext();
    fixtureCase.context.currentFixture!.tokenAddress =
      "0x9999999999999999999999999999999999999999";
    expect(
      await signAuthorizedTransferCore(
        buildDeps(new FakeStore(fixtureCase.context), new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "FIXTURE_INVALID" });

    const noSimulation = happyContext();
    noSimulation.context.simulations = [];
    expect(
      await signAuthorizedTransferCore(
        buildDeps(new FakeStore(noSimulation.context), new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "SIMULATION_NOT_FOUND" });

    const wrongSimulation = happyContext();
    wrongSimulation.context.simulations = [
      {
        ...wrongSimulation.context.simulations[0]!,
        blockHash: `0x${"77".repeat(32)}`,
      },
    ];
    expect(
      await signAuthorizedTransferCore(
        buildDeps(new FakeStore(wrongSimulation.context), new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "SIMULATION_NOT_FOUND" });
  });

  it("refuses simulation evidence that no longer hashes to its record", async () => {
    for (const mutate of [
      (record: SimulationRecord) => {
        record.tokenBalanceAtomic = "1";
      },
      (record: SimulationRecord) => {
        record.outcome = "REVERT";
      },
      (record: SimulationRecord) => {
        record.gasLimit = "1";
      },
      (record: SimulationRecord) => {
        record.simulatorVersion = "viem@9.9.9";
      },
    ]) {
      const { context } = happyContext();
      const record = { ...context.simulations[0]! };
      mutate(record);
      context.simulations = [
        {
          ...record,
          // keep the envelope binding pointing at the original evidence
          evidenceHash: resolved.simulation.evidenceHash,
          blockNumber: resolved.simulation.blockNumber,
          blockHash: resolved.simulation.blockHash,
        },
      ];
      const store = new FakeStore(context);
      expect(
        await signAuthorizedTransferCore(buildDeps(store, new FakeRpc()), ids),
      ).toEqual({ ok: false, code: "SIMULATION_MISMATCH" });
      expect(store.beginCalls).toBe(0);
    }
  });

  it("refuses envelopes whose executable fields drift from the simulation", async () => {
    for (const mutate of [
      (payload: Record<string, unknown>) => {
        payload.nonce = "4";
      },
      (payload: Record<string, unknown>) => {
        payload.gasLimit = "60000";
      },
      (payload: Record<string, unknown>) => {
        payload.maxPriorityFeePerGas = "1";
      },
      (payload: Record<string, unknown>) => {
        payload.calldata = "0xa9059cbb" + "ee".repeat(64);
      },
    ]) {
      const { context } = happyContext();
      const mutated = structuredClone(context.envelope!.payload) as Record<
        string,
        unknown
      >;
      mutate(mutated);
      wireContext(context, mutated);
      const store = new FakeStore(context);
      const outcome = await signAuthorizedTransferCore(
        buildDeps(store, new FakeRpc()),
        ids,
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect([
        "EXECUTABLE_MISMATCH",
        "SIMULATION_MISMATCH",
        "ENVELOPE_INVALID",
      ]).toContain(outcome.code);
      expect(store.beginCalls).toBe(0);
    }
  });

  it("refuses malformed envelope shapes even when consistently hashed", async () => {
    for (const mutate of [
      (payload: Record<string, unknown>) => {
        payload.value = "1";
      },
      (payload: Record<string, unknown>) => {
        payload.nonceStrategy = "latest";
      },
      (payload: Record<string, unknown>) => {
        payload.accessList = [{ address: token, storageKeys: [] }];
      },
      (payload: Record<string, unknown>) => {
        payload.decodedArguments = {
          ...(payload.decodedArguments as Record<string, unknown>),
          amountAtomic: "1",
        };
      },
      (payload: Record<string, unknown>) => {
        payload.expectedAssetDeltas = [
          {
            assetAddress: token,
            from: wallet,
            to: recipient,
            amountAtomic: "1",
          },
        ];
      },
    ]) {
      const { context } = happyContext();
      const mutated = structuredClone(context.envelope!.payload) as Record<
        string,
        unknown
      >;
      mutate(mutated);
      wireContext(context, mutated);
      const store = new FakeStore(context);
      expect(
        await signAuthorizedTransferCore(buildDeps(store, new FakeRpc()), ids),
      ).toEqual({ ok: false, code: "ENVELOPE_INVALID" });
      expect(store.beginCalls).toBe(0);
    }
  });

  it("refuses missing fee constraints and fee-ceiling conflicts", async () => {
    const noPolicy = happyContext();
    noPolicy.context.operation.policyDocument = {};
    expect(
      await signAuthorizedTransferCore(
        buildDeps(new FakeStore(noPolicy.context), new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "FEE_CONSTRAINTS_INVALID" });

    const noIntentFee = happyContext();
    noIntentFee.context.operation.intentPayload = {
      ...intent,
      maximumNetworkFee: undefined,
    };
    expect(
      await signAuthorizedTransferCore(
        buildDeps(new FakeStore(noIntentFee.context), new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "FEE_CONSTRAINTS_INVALID" });

    const cheapPolicy = happyContext();
    cheapPolicy.context.operation.policyDocument = {
      maximumNetworkFeeAtomic: "1",
    };
    const cheapStore = new FakeStore(cheapPolicy.context);
    expect(
      await signAuthorizedTransferCore(
        buildDeps(cheapStore, new FakeRpc()),
        ids,
      ),
    ).toEqual({ ok: false, code: "EXECUTABLE_MISMATCH" });
    expect(cheapStore.beginCalls).toBe(0);
  });

  it("refuses a disposable sender that is not the envelope sender", async () => {
    const { context } = happyContext();
    const store = new FakeStore(context);
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc(), {
        loadDisposableAccount: () => ({
          address: "0x000000000000000000000000000000000000c0de" as Address,
        }),
      }),
      ids,
    );
    expect(outcome).toEqual({ ok: false, code: "SENDER_INVALID" });
    expect(store.beginCalls).toBe(0);
  });

  it("refuses stale simulations immediately before signing", async () => {
    const cases: [
      string,
      (rpc: FakeRpc) => void,
      (context: SigningContext) => void,
    ][] = [
      [
        "NONCE_CHANGED",
        (rpc) => {
          rpc.pendingNonce = 4n;
        },
        () => undefined,
      ],
      [
        "BLOCK_TOO_OLD",
        (rpc) => {
          rpc.currentBlockNumber = 200n;
        },
        () => undefined,
      ],
      [
        "TOKEN_BALANCE_CHANGED",
        (rpc) => {
          rpc.tokenBalance = 1n;
        },
        () => undefined,
      ],
      [
        "NATIVE_BALANCE_CHANGED",
        (rpc) => {
          rpc.nativeBalance = 1n;
        },
        () => undefined,
      ],
      [
        "WRONG_CHAIN",
        (rpc) => {
          rpc.chainId = 31338n;
        },
        () => undefined,
      ],
    ];
    for (const [code, mutateRpc, mutateContext] of cases) {
      const { context } = happyContext();
      mutateContext(context);
      const rpc = new FakeRpc();
      mutateRpc(rpc);
      const store = new FakeStore(context);
      const outcome = await signAuthorizedTransferCore(
        buildDeps(store, rpc),
        ids,
      );
      expect(outcome).toEqual({
        ok: false,
        code: "SIMULATION_STALE",
        freshnessCode: code,
      });
      expect(store.beginCalls).toBe(0);
    }
  });

  it("never signs when persistence of the signing mark fails", async () => {
    const { context } = happyContext();
    const store = new FakeStore(context);
    store.beginError = new Error("operation left AUTHORIZED concurrently");
    let signed = 0;
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc(), {
        signTransaction: async () => {
          signed += 1;
          throw new Error("must not sign");
        },
      }),
      ids,
    );
    expect(outcome).toEqual({ ok: false, code: "OPERATION_NOT_AUTHORIZED" });
    expect(signed).toBe(0);
  });

  it("reports persistence failure without exposing internal errors", async () => {
    const { context } = happyContext();
    const store = new FakeStore(context);
    store.persistError = new Error(
      `db error with key ${credential.privateKey}`,
    );
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc()),
      ids,
    );
    expect(outcome).toEqual({ ok: false, code: "PERSISTENCE_FAILED" });
    expect(JSON.stringify(outcome)).not.toContain(credential.privateKey);
  });

  it("sanitizes signer exceptions after the signing barrier", async () => {
    const { context } = happyContext();
    const store = new FakeStore(context);
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc(), {
        signTransaction: async () => {
          throw new Error(`signer key failure ${credential.privateKey}`);
        },
      }),
      ids,
    );
    expect(outcome).toEqual({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(outcome)).not.toContain(credential.privateKey);
    expect(store.refusals).toContain("INTERNAL");
  });

  it("accepts a concurrent winner's identical durable evidence", async () => {
    const { context } = happyContext();
    const store = new FakeStore(context);
    store.persistError = new Error("duplicate key");
    const racedHash = `0x${"ee".repeat(32)}`;
    store.durable = {
      transactionHash: racedHash as `0x${string}`,
      signedAt: farFuture,
    };
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc()),
      ids,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.fromDurableEvidence).toBe(true);
    expect(outcome.transactionHash).toBe(racedHash);
  });

  it("emits phase notices at the two durability boundaries", async () => {
    const { context } = happyContext();
    const phases: string[] = [];
    const outcome = await signAuthorizedTransferCore(
      buildDeps(new FakeStore(context), new FakeRpc(), {
        onPhase: (phase) => phases.push(phase),
      }),
      ids,
    );
    expect(outcome.ok).toBe(true);
    expect(phases).toEqual(["signing-started", "evidence-persisted"]);
  });

  it("leaks no secret material through any refusal outcome", async () => {
    const { context } = happyContext();
    context.signerCredential!.status = "REVOKED";
    const store = new FakeStore(context);
    const outcome = await signAuthorizedTransferCore(
      buildDeps(store, new FakeRpc()),
      ids,
    );
    expect(outcome.ok).toBe(false);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(credential.privateKey);
    expect(serialized).not.toContain(credential.publicKey);
    expect(serialized).not.toContain("0x5b1770");
  });
});
