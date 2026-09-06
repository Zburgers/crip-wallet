import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

import {
  constructTransferCore,
  createLocalAnvilReadRpc,
  decodeTransferIndependent,
  simulateAndResolveTransfer,
  verifyExecutableTransfer,
  verifyTransferCore,
  type LocalFixtureIdentity,
} from "@crip/transaction-pipeline";
import {
  readFixture,
  verifyFixtureOnChain,
} from "../../tooling/phase2-fixture.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

test("resolves and verifies the exact transfer against the current loopback fixture", async () => {
  const fixtureDocument = readFixture({ root: repositoryRoot });
  await verifyFixtureOnChain({
    root: repositoryRoot,
    fixture: fixtureDocument,
  });
  const fixture: LocalFixtureIdentity = {
    fixtureInstanceId: fixtureDocument.fixtureInstanceId,
    chainId: "eip155:31337",
    walletAddress: fixtureDocument.deployer.address as `0x${string}`,
    tokenAddress: fixtureDocument.token.address as `0x${string}`,
    rpcUrl: fixtureDocument.chain.rpcUrl,
  };
  const intent = {
    schemaVersion: "1.0",
    intentId: "int_chain_p203",
    idempotencyKey: "chain-p203",
    agentId: "agent_local_01",
    walletId: "wallet_local_01",
    chainId: "eip155:31337",
    action: "asset.transfer",
    objective: "Exercise the local canonical simulation",
    asset: { type: "erc20", address: fixture.tokenAddress },
    amount: { atomic: "1" },
    recipient: "0x000000000000000000000000000000000000c0de",
    maximumNetworkFee: { asset: "native", atomic: "1000000000000000000" },
    notBefore: "2026-08-28T12:00:00Z",
    expiresAt: "2026-08-28T12:10:00Z",
    metadata: {},
  } as const;
  const core = constructTransferCore(intent, {
    walletAddress: fixture.walletAddress,
    tokenAddress: fixture.tokenAddress,
    chainId: fixture.chainId,
    fixtureInstanceId: fixture.fixtureInstanceId,
    provenance: {
      operationId: "op_chain_p203",
      policyId: "policy_local_01",
      policyVersion: 1,
      policyDecisionHash: `0x${"22".repeat(32)}`,
    },
  });
  const decoded = decodeTransferIndependent(core.calldata);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  const verifiedCore = verifyTransferCore(intent, core, decoded, {
    walletAddress: fixture.walletAddress,
    tokenAddress: fixture.tokenAddress,
    chainId: fixture.chainId,
    fixtureInstanceId: fixture.fixtureInstanceId,
    provenance: core.provenance,
  });
  assert.equal(verifiedCore.ok, true);
  if (!verifiedCore.ok) return;

  const result = await simulateAndResolveTransfer(
    verifiedCore,
    createLocalAnvilReadRpc({
      rpcUrl: fixture.rpcUrl,
      fixtureInstanceId: fixture.fixtureInstanceId,
    }),
    fixture,
    {
      intentMaximumNetworkFeeAtomic: "1000000000000000000",
      policyMaximumNetworkFeeAtomic: "1000000000000000000",
    },
  );
  assert.equal(result.executable.chainId, "eip155:31337");
  assert.equal(result.executable.transactionType, "eip1559");
  assert.deepEqual(result.executable.accessList, []);
  assert.equal(result.simulation.outcome, "success");
  assert.equal(
    verifyExecutableTransfer(
      verifiedCore,
      result.executable,
      result.simulation,
      {
        intentMaximumNetworkFeeAtomic: "1000000000000000000",
        policyMaximumNetworkFeeAtomic: "1000000000000000000",
      },
    ).ok,
    true,
  );
});
