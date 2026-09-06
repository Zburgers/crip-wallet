import { describe, expect, it } from "vitest";

import {
  checkSimulationFreshness,
  constructTransferCore,
  decodeTransferIndependent,
  hashSimulationEvidence,
  simulateAndResolveTransfer,
  verifyExecutableTransfer,
  type ActiveFeeAndExecutionConstraints,
  type CanonicalBlock,
  type LocalFixtureIdentity,
  type LocalReadRpc,
  type SimulationRequest,
} from "../src/index.js";

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const token = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const blockHash = `0x${"ab".repeat(32)}` as const;
const blockHash2 = `0x${"cd".repeat(32)}` as const;

const intent = {
  schemaVersion: "1.0",
  intentId: "int_local_003",
  idempotencyKey: "transfer-003",
  agentId: "agent_local_01",
  walletId: "wallet_local_01",
  chainId: "eip155:31337",
  action: "asset.transfer",
  objective: "Pay the local fake merchant",
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
  fixtureInstanceId: "fixture-local-003",
  provenance: {
    operationId: "op_local_003",
    policyId: "policy_local_01",
    policyVersion: 1,
    policyDecisionHash: `0x${"11".repeat(32)}`,
  },
} as const;

const fixture: LocalFixtureIdentity = {
  fixtureInstanceId: trusted.fixtureInstanceId,
  chainId: "eip155:31337",
  walletAddress: wallet,
  tokenAddress: token,
  rpcUrl: "http://127.0.0.1:8545",
};

const constraints: ActiveFeeAndExecutionConstraints = {
  intentMaximumNetworkFeeAtomic: "2000000",
  policyMaximumNetworkFeeAtomic: "2000000",
};

const core = constructTransferCore(intent, trusted);
const decoded = decodeTransferIndependent(core.calldata);
if (!decoded.ok) throw new Error("test transfer did not decode");

class FakeRpc implements LocalReadRpc {
  chainId = 31337n;
  currentBlockNumber = 100n;
  pendingNonce = 3n;
  nativeBalance = 100_000_000n;
  tokenBalance = 1_000_000n;
  baseFeePerGas = 10n;
  maxPriorityFeePerGas = 2n;
  estimatedGas = 50_000n;
  missingHashes = new Set<string>();
  blocks = new Map<bigint, CanonicalBlock>([
    [
      100n,
      {
        number: 100n,
        hash: blockHash,
        baseFeePerGas: 10n,
      },
    ],
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
    if (this.missingHashes.has(hash)) return null;
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
    expect(request.blockNumber).toBe(100n);
    expect(request.nonce).toBe(3n);
    expect(request.from).toBe(wallet);
    expect(request.to).toBe(token);
    expect(request.value).toBe(0n);
    if (this.tokenBalance < 500_000n) {
      return { outcome: "revert" as const, revertData: "0xdeadbeef" as const };
    }
    return { outcome: "success" as const };
  }

  async estimateGas(request: SimulationRequest) {
    expect(request.blockNumber).toBe(100n);
    expect(request.nonce).toBe(3n);
    return this.estimatedGas;
  }

  async getFeeData() {
    return {
      baseFeePerGas: this.baseFeePerGas,
      maxPriorityFeePerGas: this.maxPriorityFeePerGas,
    };
  }
}

const resolve = async (rpc = new FakeRpc()) =>
  simulateAndResolveTransfer(
    { ok: true, verified: core },
    rpc,
    fixture,
    constraints,
  );

describe("P2-03 canonical simulation and executable resolution", () => {
  it("resolves one exact type-2 candidate and hashes normalized evidence", async () => {
    const result = await resolve();

    expect(result.executable).toMatchObject({
      ...core,
      nonce: "3",
      transactionType: "eip1559",
      gasLimit: "55000",
      maxPriorityFeePerGas: "2",
      maxFeePerGas: "22",
      accessList: [],
    });
    expect(result.simulation).toMatchObject({
      outcome: "success",
      fixtureInstanceId: fixture.fixtureInstanceId,
      chainId: fixture.chainId,
      blockNumber: "100",
      blockHash,
      senderNonce: "3",
      tokenBalance: "1000000",
      nativeBalance: "100000000",
      gasEstimate: "50000",
      gasLimit: "55000",
      baseFeePerGas: "10",
      maxPriorityFeePerGas: "2",
      maxFeePerGas: "22",
      expectedAssetDeltas: [
        {
          assetAddress: token,
          from: wallet,
          to: recipient,
          amountAtomic: "500000",
        },
      ],
      maximumNativeFeeAtomic: "1210000",
    });
    expect(result.simulation.evidenceHash).toBe(
      hashSimulationEvidence(result.simulation),
    );
    expect(
      verifyExecutableTransfer(
        { ok: true, verified: core },
        result.executable,
        result.simulation,
        constraints,
      ),
    ).toEqual({ ok: true, verified: result.executable });
  });

  it("normalizes a token simulation revert and retains no economic mutation", async () => {
    const rpc = new FakeRpc();
    rpc.tokenBalance = 1n;

    await expect(resolve(rpc)).rejects.toMatchObject({
      code: "INSUFFICIENT_TOKEN_BALANCE",
      simulation: expect.objectContaining({
        outcome: "revert",
        revert: { code: "EXECUTION_REVERT", data: "0xdeadbeef" },
        expectedAssetDeltas: [
          expect.objectContaining({ amountAtomic: "500000" }),
        ],
      }),
    });
  });

  it("rejects insufficient native balance without changing token accounting", async () => {
    const rpc = new FakeRpc();
    rpc.nativeBalance = 1_000_000n;

    await expect(resolve(rpc)).rejects.toMatchObject({
      code: "INSUFFICIENT_NATIVE_BALANCE",
      simulation: expect.objectContaining({
        outcome: "success",
        maximumNativeFeeAtomic: "1210000",
        expectedAssetDeltas: [
          expect.objectContaining({ amountAtomic: "500000" }),
        ],
      }),
    });
  });

  const boundaryCases: ReadonlyArray<
    readonly [string, (rpc: FakeRpc) => void, string]
  > = [
    ["wrong chain", (rpc: FakeRpc) => (rpc.chainId = 1n), "WRONG_CHAIN"],
    ["wrong fixture", () => undefined, "FIXTURE_MISMATCH"],
  ];
  it.each(boundaryCases)("fails closed for %s", async (_name, mutate, code) => {
    void _name;
    const rpc = new FakeRpc();
    mutate(rpc);
    const actualFixture =
      code === "FIXTURE_MISMATCH"
        ? { ...fixture, fixtureInstanceId: "fixture-other" }
        : fixture;
    await expect(
      simulateAndResolveTransfer(
        { ok: true, verified: core },
        rpc,
        actualFixture,
        constraints,
      ),
    ).rejects.toMatchObject({ code });
  });

  it("rejects a non-loopback fixture endpoint", async () => {
    await expect(
      simulateAndResolveTransfer(
        { ok: true, verified: core },
        new FakeRpc(),
        { ...fixture, rpcUrl: "https://public.example" },
        constraints,
      ),
    ).rejects.toMatchObject({ code: "PUBLIC_RPC_FORBIDDEN" });
  });

  it("requires the selected block to be canonical", async () => {
    const rpc = new FakeRpc();
    rpc.blocks.set(100n, {
      number: 100n,
      hash: blockHash2,
      baseFeePerGas: 10n,
    });
    rpc.missingHashes.add(blockHash2);

    await expect(resolve(rpc)).rejects.toMatchObject({
      code: "NONCANONICAL_BLOCK",
    });
  });

  it("keeps an otherwise canonical simulation fresh across an unrelated newer head", async () => {
    const rpc = new FakeRpc();
    const result = await resolve(rpc);
    rpc.currentBlockNumber = 101n;
    rpc.blocks.set(101n, {
      number: 101n,
      hash: blockHash2,
      baseFeePerGas: 10n,
    });

    expect(
      await checkSimulationFreshness({
        verifiedCore: { ok: true, verified: core },
        executable: result.executable,
        simulation: result.simulation,
        rpc,
        fixture,
        constraints,
        maxBlockAge: 2n,
      }),
    ).toEqual({ ok: true, reason: "FRESH" });
  });

  const staleCases: ReadonlyArray<
    readonly [string, (rpc: FakeRpc) => void, string]
  > = [
    [
      "age expiry",
      (rpc: FakeRpc) => (rpc.currentBlockNumber = 103n),
      "BLOCK_TOO_OLD",
    ],
    [
      "nonce consume",
      (rpc: FakeRpc) => (rpc.pendingNonce = 4n),
      "NONCE_CHANGED",
    ],
    [
      "token drain",
      (rpc: FakeRpc) => (rpc.tokenBalance = 1n),
      "TOKEN_BALANCE_CHANGED",
    ],
    [
      "native drain",
      (rpc: FakeRpc) => (rpc.nativeBalance = 1_000_000n),
      "NATIVE_BALANCE_CHANGED",
    ],
    [
      "fee escalation",
      (rpc: FakeRpc) => (rpc.baseFeePerGas = 100n),
      "FEE_CEILING_CONFLICT",
    ],
  ];
  it.each(staleCases)(
    "reports stale freshness for %s",
    async (_name, mutate, code) => {
      const rpc = new FakeRpc();
      const result = await resolve(rpc);
      mutate(rpc);
      rpc.blocks.set(100n, {
        number: 100n,
        hash: blockHash,
        baseFeePerGas: rpc.baseFeePerGas,
      });

      await expect(
        checkSimulationFreshness({
          verifiedCore: { ok: true, verified: core },
          executable: result.executable,
          simulation: result.simulation,
          rpc,
          fixture,
          constraints,
          maxBlockAge: 2n,
        }),
      ).resolves.toEqual({ ok: false, code });
    },
  );

  it("rejects every dynamic type-2 field mutation and non-empty access list", async () => {
    const rpc = new FakeRpc();
    const result = await resolve(rpc);
    const mutations = [
      ["nonce", { nonce: "4" }],
      ["transaction type", { transactionType: "legacy" }],
      ["gas limit", { gasLimit: "55001" }],
      ["priority fee", { maxPriorityFeePerGas: "3" }],
      ["max fee", { maxFeePerGas: "23" }],
      ["access list", { accessList: [{ address: token, storageKeys: [] }] }],
    ] as const;

    for (const [name, change] of mutations) {
      void name;
      expect(
        verifyExecutableTransfer(
          { ok: true, verified: core },
          { ...result.executable, ...change } as never,
          result.simulation,
          constraints,
        ),
      ).toMatchObject({ ok: false });
    }
  });

  it("uses checked integer fee arithmetic and keeps native gas separate from token deltas", async () => {
    const result = await resolve();
    expect(BigInt(result.simulation.maximumNativeFeeAtomic)).toBe(
      BigInt(result.executable.gasLimit) *
        BigInt(result.executable.maxFeePerGas),
    );
    expect(result.simulation.expectedAssetDeltas).toHaveLength(1);
    expect(result.simulation.expectedAssetDeltas[0]?.assetAddress).toBe(token);
    expect(result.simulation.expectedAssetDeltas[0]?.amountAtomic).toBe(
      "500000",
    );
    expect(result.simulation.maximumNativeFeeAtomic).not.toBe("500000");
  });
});
