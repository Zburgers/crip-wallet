import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "vitest";

import {
  checkoutHash,
  loadLocalRuntime,
} from "../../tooling/local-runtime.mjs";
import {
  assertLocalOnlyRuntime,
  computeFixtureFingerprint,
  createPhase2Fixture,
  parseAnvilConfig,
  readFixture,
  resetPhase2Anvil,
  runUnlockedTransfer,
  validateFixtureDocument,
  verifyFixtureOnChain,
} from "../../tooling/phase2-fixture.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

test("clean local fixture matches Anvil chain, artifact, metadata, and supply", async () => {
  const fixture = readFixture({ root: repositoryRoot });
  const verified = await verifyFixtureOnChain({
    root: repositoryRoot,
    fixture,
  });

  assert.equal(verified.chainId, "0x7a69");
  assert.equal(verified.codeHash, fixture.token.runtimeBytecodeHash);
  assert.equal(verified.metadata.name, "Crip Test USD");
  assert.equal(verified.metadata.symbol, "TEST_USDC");
  assert.equal(verified.metadata.decimals, 6);
  assert.equal(verified.metadata.totalSupply, "1000000000000");
  assert.equal(verified.deployerTokenBalance, "1000000000000");
});

test("ordinary fake-token transfer succeeds through the local unlocked Anvil test account", async () => {
  const fixture = readFixture({ root: repositoryRoot });
  const recipient = "0x000000000000000000000000000000000000c0de";
  const before = await verifyFixtureOnChain({ root: repositoryRoot, fixture });
  const result = await runUnlockedTransfer({
    root: repositoryRoot,
    fixture,
    recipient,
    amount: "1",
  });
  assert.match(result.transactionHash, /^0x[0-9a-f]{64}$/);
  assert.equal(
    BigInt(result.recipientTokenBalance) - BigInt(before.recipientTokenBalance),
    1n,
  );
  assert.equal(
    BigInt(before.deployerTokenBalance) - BigInt(result.deployerTokenBalance),
    1n,
  );
});

test("rejects a public RPC runtime before any chain operation", () => {
  assert.throws(
    () =>
      assertLocalOnlyRuntime({
        environment: "local",
        chainId: "eip155:31337",
        anvilHost: "0.0.0.0",
        anvilPort: 8545,
        rpcUrl: "http://0.0.0.0:8545",
      }),
    /loopback-only/,
  );
});

test("rejects a non-31337 chain before deployment", () => {
  assert.throws(
    () =>
      assertLocalOnlyRuntime({
        environment: "local",
        chainId: "eip155:1",
        anvilHost: "127.0.0.1",
        anvilPort: 8545,
        rpcUrl: "http://127.0.0.1:8545",
      }),
    /31337/,
  );
});

test("rejects a fixture belonging to another checkout", () => {
  const fixture = readFixture({ root: repositoryRoot });
  const expected = checkoutHash(repositoryRoot);

  assert.throws(
    () =>
      validateFixtureDocument(
        { ...fixture, checkoutHash: "different-checkout" },
        {
          expectedCheckoutHash: expected,
          expectedComposeProject: `crip-wallet-${expected}`,
        },
      ),
    /different checkout/,
  );
});

test("rejects malformed Anvil state without exposing key material", () => {
  assert.throws(
    () => parseAnvilConfig('{"available_accounts":[],"private_keys":[]}'),
    /disposable account fixture/,
  );
});

test("rejects a stale fixture fingerprint and modified deployment code hash", async () => {
  const fixture = readFixture({ root: repositoryRoot });
  const stale = {
    ...fixture,
    chain: { ...fixture.chain, genesisBlockHash: "0x" + "11".repeat(32) },
  };
  const staleWithFingerprint = {
    ...stale,
    fingerprint: computeFixtureFingerprint(stale),
  };
  const modifiedCode = {
    ...fixture,
    token: {
      ...fixture.token,
      runtimeBytecodeHash: "sha256:" + "00".repeat(32),
    },
  };
  const modifiedCodeWithFingerprint = {
    ...modifiedCode,
    fingerprint: computeFixtureFingerprint(modifiedCode),
  };

  await assert.rejects(
    () =>
      verifyFixtureOnChain({
        root: repositoryRoot,
        fixture: staleWithFingerprint,
      }),
    /stale fixture|genesis/i,
  );
  await assert.rejects(
    () =>
      verifyFixtureOnChain({
        root: repositoryRoot,
        fixture: modifiedCodeWithFingerprint,
      }),
    /code hash/i,
  );
});

test("fixture output contains no private key and is mode 0600", () => {
  const fixturePath = join(repositoryRoot, ".local/phase2-fixture.json");
  const fixtureText = readFileSync(fixturePath, "utf8");
  const runtime = loadLocalRuntime({ root: repositoryRoot, environment: {} });
  const anvilText = readFileSync(
    join(repositoryRoot, ".local/anvil/anvil.json"),
    "utf8",
  );
  const anvil = JSON.parse(anvilText) as { private_keys: string[] };

  assert.doesNotMatch(
    fixtureText,
    /private.?key|mnemonic|seed.?phrase|password|secret/i,
  );
  for (const privateKey of anvil.private_keys)
    assert.equal(fixtureText.includes(privateKey), false);
  assert.equal(statSync(fixturePath).mode & 0o777, 0o600);
  assert.equal(runtime.anvil.host, "127.0.0.1");
});

test("reset and redeploy creates a new fixture instance and stales the prior instance", async () => {
  const prior = readFixture({ root: repositoryRoot });

  await resetPhase2Anvil({ root: repositoryRoot });
  const current = await createPhase2Fixture({ root: repositoryRoot });

  assert.notEqual(current.fixtureInstanceId, prior.fixtureInstanceId);
  assert.equal(current.token.address, prior.token.address);
  assert.equal(
    current.deployment.transactionHash,
    prior.deployment.transactionHash,
  );
  assert.equal(
    current.token.runtimeBytecodeHash,
    prior.token.runtimeBytecodeHash,
  );
  assert.match(
    current.fixtureInstanceId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  await assert.rejects(
    () => verifyFixtureOnChain({ root: repositoryRoot, fixture: prior }),
    /stale fixture instance/i,
  );
  await verifyFixtureOnChain({ root: repositoryRoot, fixture: current });
}, 15_000);
