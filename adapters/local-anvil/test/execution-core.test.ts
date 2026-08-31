import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { hashExecutionEnvelope } from "@crip/schemas";
import {
  constructTransferCore,
  decodeTransferIndependent,
  simulateAndResolveTransfer,
  verifyTransferCore,
  type ActiveFeeAndExecutionConstraints,
  type CanonicalBlock,
  type LocalReadRpc,
  type SimulationRequest,
} from "@crip/transaction-pipeline";
import {
  generateComponentCredential,
  signComponentAction,
} from "@crip/trust-boundary";

import {
  executeAuthorizedTransferCore,
  type Address,
  type DurableSignedEvidence,
  type ExactTransactionFields,
  type ExecutionSerializationStore,
  type SignAuthorizedTransferIds,
  type SignerDeps,
  type SignerStore,
  type SigningContext,
  type SimulationRecord,
} from "../src/execution-core.js";
import type {
  BroadcastAttempt,
  BroadcastStore,
  DurableSignedTransaction,
  RawTransactionSender,
} from "../src/broadcast-core.js";

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const token = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const blockHash = `0x${"ab".repeat(32)}` as const;
const fixtureInstanceId = "fixture-execution-core";
const rpcUrl = "http://127.0.0.1:8545";
const ids: SignAuthorizedTransferIds = {
  operationId: "op_execution_core",
  authorizationId: "approval_execution_core:authorization",
  adapterRequestId: "req_execution_core",
};
const reservationId = "res_execution_core";
const envelopeId = "env_execution_core_1";
const policyDecisionHash = `0x${"11".repeat(32)}`;
const now = new Date("2026-08-31T12:05:00Z");
const farFuture = "2030-01-01T00:00:00Z";
const credential = generateComponentCredential({
  credentialId: "credential_execution_core",
  componentId: "local-anvil-execution",
  role: "ADAPTER",
});

const intent = {
  schemaVersion: "1.0",
  intentId: "int_execution_core",
  idempotencyKey: "execution-core-transfer",
  agentId: "agent_execution_01",
  walletId: "wallet_execution_01",
  chainId: "eip155:31337",
  action: "asset.transfer",
  objective: "Exercise the signer-local execution composition",
  asset: { type: "erc20", address: token },
  amount: { atomic: "500000" },
  recipient,
  maximumNetworkFee: { asset: "native", atomic: "2000000" },
  notBefore: "2026-08-31T12:00:00Z",
  expiresAt: "2026-08-31T12:10:00Z",
  metadata: {},
} as const;
const trusted = {
  walletAddress: wallet,
  tokenAddress: token,
  chainId: "eip155:31337",
  fixtureInstanceId,
  provenance: {
    operationId: ids.operationId,
    policyId: "policy_execution_01",
    policyVersion: 1,
    policyDecisionHash,
  },
} as const;
const constraints: ActiveFeeAndExecutionConstraints = {
  intentMaximumNetworkFeeAtomic: "2000000",
  policyMaximumNetworkFeeAtomic: "2000000",
};
const fixture = {
  fixtureInstanceId,
  chainId: "eip155:31337" as const,
  walletAddress: wallet,
  tokenAddress: token,
  rpcUrl,
};
const core = constructTransferCore(intent, trusted);
const decoded = decodeTransferIndependent(core.calldata);
if (!decoded.ok) throw new Error("execution test transfer did not decode");
const verifiedCore = verifyTransferCore(intent, core, decoded, {
  ...fixture,
  provenance: core.provenance,
});
if (!verifiedCore.ok) throw new Error("execution test transfer did not verify");

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
    return (
      [...this.blocks.values()].find((block) => block.hash === hash) ?? null
    );
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
    void request;
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
  policyId: "policy_execution_01",
  policyVersion: 1,
  policyDecisionHash,
  budgetReservationId: reservationId,
  createdAt: "2026-08-31T12:00:00Z",
  expiresAt: "2026-08-31T12:10:00Z",
  riskDecision: "ALLOW",
  approvalRequirement: "owner",
  envelopeHash: "0x" + "0".repeat(64),
};
const envelope = { ...payload, envelopeHash: hashExecutionEnvelope(payload) };
const simulationRecord: SimulationRecord = {
  simulationId: "sim_execution_core",
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
  expectedAssetDeltas: envelope.expectedAssetDeltas,
  maximumNativeFeeAtomic: resolved.simulation.maximumNativeFeeAtomic,
  simulatorVersion: "viem@2.56.0",
  evidenceHash: resolved.simulation.evidenceHash,
};

const context: SigningContext = {
  operation: {
    state: "AUTHORIZED",
    intentId: intent.intentId,
    agentId: intent.agentId,
    walletId: intent.walletId,
    ownerId: "owner_execution_1",
    policyId: "policy_execution_01",
    policyVersion: 1,
    intentPayload: structuredClone(intent),
    policyDocument: { maximumNetworkFeeAtomic: "2000000" },
  },
  authorization: {
    authorizationKind: "OWNER_APPROVAL",
    approvalId: "approval_execution_core",
    ownerAuthenticationId: "owner-auth-execution-core",
    approvalStatus: "CONSUMED",
    approvalApproverId: "owner_approver",
    approvalConsumedAt: farFuture,
    policyDecisionId: "decision_execution_core",
    policyDecisionHash,
    policyDecisionStatus: "REQUIRE_APPROVAL",
    decisionPolicyId: "policy_execution_01",
    decisionPolicyVersion: 1,
    reservationId,
    envelopeId,
    envelopeRevision: 1,
    envelopeHash: envelope.envelopeHash,
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
  envelope: {
    payload: envelope,
    envelopeHash: envelope.envelopeHash,
    revision: 1,
  },
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
  simulations: [simulationRecord],
};

class MemorySignerStore implements SignerStore {
  readonly signingContext: SigningContext;
  durable: DurableSignedEvidence | null = null;
  signed: DurableSignedTransaction | null = null;
  attempts = new Map<string, BroadcastAttempt>();
  phases: string[] = [];
  constructor(input: SigningContext | null = context) {
    this.signingContext = input
      ? structuredClone(input)
      : (null as unknown as SigningContext);
  }
  async loadSigningContext() {
    return this.signingContext;
  }
  async findDurableSignedEvidence() {
    return this.durable;
  }
  async beginSigning() {
    this.phases.push("signing-started");
  }
  async persistSignedEvidence(input: {
    signedTransactionId: string;
    expectedTransactionHash: `0x${string}`;
    reservationId: string;
    envelopeId: string;
    envelopeRevision: number;
    envelopeHash: string;
    ids: SignAuthorizedTransferIds;
    simulationId: string;
    fixtureInstanceId: string;
    signerCredentialId: string;
    signedAt: string;
  }) {
    this.durable = {
      transactionHash: input.expectedTransactionHash,
      signedAt: input.signedAt,
    };
    this.signed = {
      signedTransactionId: input.signedTransactionId,
      operationId: input.ids.operationId,
      reservationId: input.reservationId,
      envelopeId: input.envelopeId,
      envelopeRevision: input.envelopeRevision,
      envelopeHash: input.envelopeHash,
      authorizationId: input.ids.authorizationId,
      fixtureInstanceId: input.fixtureInstanceId,
      expectedTransactionHash: input.expectedTransactionHash,
    };
    this.phases.push("evidence-persisted");
    this.signingContext.operation.state = "SIGNED";
  }
  async recordSigningRefusal() {}
}

const makeBroadcastStore = (store: MemorySignerStore): BroadcastStore => ({
  findSignedTransaction: async () => store.signed,
  startBroadcastAttempt: async (signed, attemptId) => {
    const attempt: BroadcastAttempt = {
      attemptId,
      ...signed,
      status: "STARTED",
      responseTransactionHash: null,
      classificationReason: null,
    };
    store.attempts.set(attemptId, attempt);
    store.phases.push("STARTED");
    return attempt;
  },
  finishBroadcastAttempt: async (input) => {
    const existing = store.attempts.get(input.attemptId);
    if (!existing) throw new Error("missing attempt");
    const complete = { ...existing, ...input };
    store.attempts.set(input.attemptId, complete);
    return complete;
  },
});

const makeSignerDeps = (
  store: SignerStore,
  rpc: FakeRpc,
  rawTransaction: string,
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
    void fields;
    return {
      transactionHash: keccak256(
        rawTransaction as `0x${string}`,
      ) as `0x${string}`,
      rawTransaction,
    };
  },
  authorizeResult: (result) =>
    signComponentAction(credential, "sign-authorized-transfer", result),
  now: () => now,
});

const noAttemptStore = (): ExecutionSerializationStore => ({
  withExecutionLock: async (_operationId, work) => work(),
  findBroadcastAttempt: async () => null,
});

const rawTransaction = await privateKeyToAccount(
  `0x${"1".repeat(64)}`,
).signTransaction({
  chainId: 31337,
  type: "eip1559",
  to: token,
  value: 0n,
  nonce: Number(resolved.executable.nonce),
  gas: BigInt(resolved.executable.gasLimit),
  maxFeePerGas: BigInt(resolved.executable.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(resolved.executable.maxPriorityFeePerGas),
  data: resolved.executable.calldata,
  accessList: [],
});
const FROZEN_SIGNED_TRANSACTION =
  "0x02f8a9827a6903021682d6d894111111111111111111111111111111111111111180b844a9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000007a120c001a0521038d73bbbe7f02eefc71f7d7b76b62622d7442db293560595e7122f81af84a0454f9fb57c2e2b6551cde553aa2030ae7543f90997c8d7cb57c970af9c471e81";
const FROZEN_SIGNED_TRANSACTION_HASH =
  "0xb243997d19ee84693e4aa152c5358dcb82bb9d4fb3ea5f9f9a031e2f0112f50a";

describe("signer-local execution handoff", () => {
  it("freezes the locked viem signed-byte/hash regression vector", () => {
    expect(rawTransaction).toBe(FROZEN_SIGNED_TRANSACTION);
    expect(keccak256(rawTransaction)).toBe(FROZEN_SIGNED_TRANSACTION_HASH);
  });

  it("signs, persists safe evidence, enters STARTED, and sends the exact bytes", async () => {
    const store = new MemorySignerStore();
    const rpc = new FakeRpc();
    const phases: string[] = [];
    const executionStore: ExecutionSerializationStore = {
      withExecutionLock: async (_operationId, work) => {
        phases.push("LOCKED");
        return work();
      },
      findBroadcastAttempt: async () => null,
    };
    const sender: RawTransactionSender = {
      sendRawTransaction: async (raw) => {
        phases.push(`SEND:${raw}`);
        return keccak256(raw as `0x${string}`);
      },
    };

    const outcome = await executeAuthorizedTransferCore(
      {
        ...makeSignerDeps(store, rpc, rawTransaction),
        onPhase: (phase) => phases.push(phase),
        broadcastStore: makeBroadcastStore(store),
        sender,
        executionStore,
      },
      ids,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.broadcastStatus).toBe("ACCEPTED");
    expect(outcome.fromDurableEvidence).toBe(false);
    expect(outcome.rematerializedBeforeSend).toBe(false);
    expect(phases).toEqual([
      "LOCKED",
      "signing-started",
      "evidence-persisted",
      "broadcast-started",
      `SEND:${rawTransaction}`,
    ]);
    expect(outcome.expectedTransactionHash).toBe(keccak256(rawTransaction));
    expect(outcome.signedTransactionId).toBe(
      `${"signed:" + ids.operationId}:1`,
    );
    expect(outcome.broadcastAttemptId).toBe(
      `${"attempt:" + ids.operationId}:1`,
    );
    expect(store.durable).toEqual({
      transactionHash: keccak256(rawTransaction),
      signedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
  });

  it("rematerializes only proven pre-send evidence and gates it to the exact hash", async () => {
    const rematerialized = structuredClone(context);
    rematerialized.operation.state = "SIGNED";
    const store = new MemorySignerStore(rematerialized);
    store.durable = {
      transactionHash: keccak256(rawTransaction),
      signedAt: farFuture,
    };
    store.signed = {
      signedTransactionId: "signed:op_execution_core:1",
      operationId: ids.operationId,
      reservationId,
      envelopeId,
      envelopeRevision: 1,
      envelopeHash: envelope.envelopeHash,
      authorizationId: ids.authorizationId,
      fixtureInstanceId,
      expectedTransactionHash: keccak256(rawTransaction),
    };
    let signs = 0;
    let sends = 0;
    const outcome = await executeAuthorizedTransferCore(
      {
        ...makeSignerDeps(store, new FakeRpc(), rawTransaction),
        signTransaction: async (fields) => {
          void fields;
          signs += 1;
          return {
            transactionHash: keccak256(rawTransaction),
            rawTransaction,
          };
        },
        broadcastStore: makeBroadcastStore(store),
        executionStore: noAttemptStore(),
        sender: {
          sendRawTransaction: async () => {
            sends += 1;
            return keccak256(rawTransaction);
          },
        },
      },
      ids,
    );
    expect(outcome).toMatchObject({
      ok: true,
      fromDurableEvidence: true,
      rematerializedBeforeSend: true,
      expectedTransactionHash: keccak256(rawTransaction),
    });
    expect(signs).toBe(1);
    expect(sends).toBe(1);
    expect(store.phases).not.toContain("evidence-persisted");
  });

  it("fails the rematerialization hash gate before STARTED when durable evidence disagrees", async () => {
    const rematerialized = structuredClone(context);
    rematerialized.operation.state = "SIGNED";
    const store = new MemorySignerStore(rematerialized);
    const durableHash = `0x${"d".repeat(64)}` as `0x${string}`;
    store.durable = { transactionHash: durableHash, signedAt: farFuture };
    store.signed = {
      signedTransactionId: "signed:op_execution_core:1",
      operationId: ids.operationId,
      reservationId,
      envelopeId,
      envelopeRevision: 1,
      envelopeHash: envelope.envelopeHash,
      authorizationId: ids.authorizationId,
      fixtureInstanceId,
      expectedTransactionHash: durableHash,
    };
    let sends = 0;
    const outcome = await executeAuthorizedTransferCore(
      {
        ...makeSignerDeps(store, new FakeRpc(), rawTransaction),
        broadcastStore: makeBroadcastStore(store),
        executionStore: noAttemptStore(),
        sender: {
          sendRawTransaction: async () => {
            sends += 1;
            return durableHash;
          },
        },
      },
      ids,
    );
    expect(outcome).toEqual({ ok: false, code: "INTERNAL" });
    expect(sends).toBe(0);
    expect(store.attempts.size).toBe(0);
  });

  it.each([
    [
      "authorization invalidation",
      (value: SigningContext) => {
        value.authorization!.invalidated = true;
      },
      undefined,
    ],
    [
      "stale nonce",
      () => undefined,
      (rpc: FakeRpc) => {
        rpc.pendingNonce = 4n;
      },
    ],
    [
      "stale fixture",
      (value: SigningContext) => {
        value.currentFixture!.fixtureInstanceId = "fixture-reset";
      },
      undefined,
    ],
    [
      "fence change",
      (value: SigningContext) => {
        value.fences[1]!.version = "2";
      },
      undefined,
    ],
    [
      "policy version change",
      (value: SigningContext) => {
        value.operation.policyVersion = 2;
      },
      undefined,
    ],
  ] as const)(
    "rejects %s before rematerialization or STARTED",
    async (_label, mutateContext, mutateRpc) => {
      const rematerialized = structuredClone(context);
      rematerialized.operation.state = "SIGNED";
      mutateContext?.(rematerialized);
      const rpc = new FakeRpc();
      mutateRpc?.(rpc);
      const store = new MemorySignerStore(rematerialized);
      store.durable = {
        transactionHash: keccak256(rawTransaction),
        signedAt: farFuture,
      };
      store.signed = {
        signedTransactionId: "signed:op_execution_core:1",
        operationId: ids.operationId,
        reservationId,
        envelopeId,
        envelopeRevision: 1,
        envelopeHash: envelope.envelopeHash,
        authorizationId: ids.authorizationId,
        fixtureInstanceId,
        expectedTransactionHash: keccak256(rawTransaction),
      };
      let signs = 0;
      let sends = 0;
      const outcome = await executeAuthorizedTransferCore(
        {
          ...makeSignerDeps(store, rpc, rawTransaction),
          signTransaction: async () => {
            signs += 1;
            return {
              transactionHash: keccak256(rawTransaction),
              rawTransaction,
            };
          },
          broadcastStore: makeBroadcastStore(store),
          executionStore: noAttemptStore(),
          sender: {
            sendRawTransaction: async () => {
              sends += 1;
              return keccak256(rawTransaction);
            },
          },
        },
        ids,
      );
      expect(outcome.ok).toBe(false);
      expect(signs).toBe(0);
      expect(sends).toBe(0);
      expect(store.attempts.size).toBe(0);
    },
  );

  it.each(["STARTED", "ACCEPTED", "UNKNOWN", "CONFLICT", "REJECTED"] as const)(
    "%s attempt prohibits re-signing and automatic retry",
    async (status) => {
      const store = new MemorySignerStore();
      const attempt: BroadcastAttempt = {
        attemptId: "attempt:op_execution_core:1",
        signedTransactionId: "signed:op_execution_core:1",
        operationId: ids.operationId,
        reservationId,
        envelopeId,
        envelopeRevision: 1,
        envelopeHash: envelope.envelopeHash,
        authorizationId: ids.authorizationId,
        fixtureInstanceId,
        expectedTransactionHash: keccak256(rawTransaction),
        status,
        responseTransactionHash:
          status === "CONFLICT" ? `0x${"c".repeat(64)}` : null,
        classificationReason: status === "STARTED" ? null : "test-state",
      };
      const executionStore: ExecutionSerializationStore = {
        withExecutionLock: async (_operationId, work) => work(),
        findBroadcastAttempt: async () => attempt,
      };
      let signs = 0;
      const outcome = await executeAuthorizedTransferCore(
        {
          ...makeSignerDeps(store, new FakeRpc(), rawTransaction),
          signTransaction: async () => {
            signs += 1;
            return {
              transactionHash: keccak256(rawTransaction),
              rawTransaction,
            };
          },
          broadcastStore: makeBroadcastStore(store),
          executionStore,
          sender: { sendRawTransaction: async () => keccak256(rawTransaction) },
        },
        ids,
      );
      expect(outcome.broadcastStatus).toBe(status);
      expect(signs).toBe(0);
    },
  );

  it("allows a fresh execution after a pre-evidence crash and rematerializes after the evidence barrier", async () => {
    const store = new MemorySignerStore();
    let crashBeforeEvidence = true;
    let signs = 0;
    const first = await executeAuthorizedTransferCore(
      {
        ...makeSignerDeps(store, new FakeRpc(), rawTransaction),
        signTransaction: async () => {
          signs += 1;
          if (crashBeforeEvidence) throw new Error("simulated child crash");
          return { transactionHash: keccak256(rawTransaction), rawTransaction };
        },
        broadcastStore: makeBroadcastStore(store),
        executionStore: noAttemptStore(),
        sender: { sendRawTransaction: async () => keccak256(rawTransaction) },
      },
      ids,
    );
    expect(first).toEqual({ ok: false, code: "INTERNAL" });
    expect(store.durable).toBeNull();
    crashBeforeEvidence = false;
    const second = await executeAuthorizedTransferCore(
      {
        ...makeSignerDeps(store, new FakeRpc(), rawTransaction),
        signTransaction: async () => {
          signs += 1;
          return { transactionHash: keccak256(rawTransaction), rawTransaction };
        },
        broadcastStore: makeBroadcastStore(store),
        executionStore: noAttemptStore(),
        sender: { sendRawTransaction: async () => keccak256(rawTransaction) },
      },
      ids,
    );
    expect(second).toMatchObject({ ok: true, fromDurableEvidence: false });
    expect(signs).toBe(2);
  });

  it("recovers a crash after signed evidence but before STARTED only through hash-gated rematerialization", async () => {
    const crashContext = structuredClone(context);
    const store = new MemorySignerStore(crashContext);
    let crashAfterEvidence = true;
    let signs = 0;
    const deps = () => ({
      ...makeSignerDeps(store, new FakeRpc(), rawTransaction),
      signTransaction: async () => {
        signs += 1;
        return { transactionHash: keccak256(rawTransaction), rawTransaction };
      },
      onPhase: (phase: string) => {
        if (crashAfterEvidence && phase === "evidence-persisted")
          throw new Error("simulated child crash after evidence");
      },
      broadcastStore: makeBroadcastStore(store),
      executionStore: noAttemptStore(),
      sender: { sendRawTransaction: async () => keccak256(rawTransaction) },
    });
    await expect(executeAuthorizedTransferCore(deps(), ids)).rejects.toThrow(
      "simulated child crash after evidence",
    );
    expect(store.durable).not.toBeNull();
    expect(store.attempts.size).toBe(0);
    crashAfterEvidence = false;
    const recovered = await executeAuthorizedTransferCore(deps(), ids);
    expect(recovered).toMatchObject({
      ok: true,
      fromDurableEvidence: true,
      rematerializedBeforeSend: true,
    });
    expect(signs).toBe(2);
  });

  it("does not expose raw bytes, key material, or caller executable fields", async () => {
    const store = new MemorySignerStore();
    const key = "0x" + "1".repeat(64);
    const outcome = await executeAuthorizedTransferCore(
      {
        ...makeSignerDeps(store, new FakeRpc(), rawTransaction),
        broadcastStore: makeBroadcastStore(store),
        executionStore: noAttemptStore(),
        sender: { sendRawTransaction: async () => keccak256(rawTransaction) },
      },
      { ...ids, rawTransaction, privateKey: key, nonce: "3", gas: "55000" },
    );
    expect(outcome).toEqual({ ok: false, code: "INVALID_REQUEST" });
    expect(JSON.stringify(outcome)).not.toContain(rawTransaction);
    expect(JSON.stringify(outcome)).not.toContain(key);
    expect(JSON.stringify(store.signed)).not.toContain(rawTransaction);
    expect(JSON.stringify(store.signed)).not.toContain(key);
  });

  it("serializes competing executors so only one crosses sign and STARTED", async () => {
    const store = new MemorySignerStore();
    const broadcastStore = makeBroadcastStore(store);
    let tail = Promise.resolve();
    const executionStore: ExecutionSerializationStore = {
      withExecutionLock: async (_operationId, work) => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await work();
        } finally {
          release();
        }
      },
      findBroadcastAttempt: async () => [...store.attempts.values()][0] ?? null,
    };
    let signs = 0;
    let sends = 0;
    const deps = () => ({
      ...makeSignerDeps(store, new FakeRpc(), rawTransaction),
      signTransaction: async () => {
        signs += 1;
        return { transactionHash: keccak256(rawTransaction), rawTransaction };
      },
      broadcastStore,
      executionStore,
      sender: {
        sendRawTransaction: async () => {
          sends += 1;
          return keccak256(rawTransaction);
        },
      },
    });
    const outcomes = await Promise.all([
      executeAuthorizedTransferCore(deps(), ids),
      executeAuthorizedTransferCore(deps(), ids),
    ]);
    expect(outcomes.filter((value) => value.ok)).toHaveLength(2);
    expect(signs).toBe(1);
    expect(sends).toBe(1);
  });
});
