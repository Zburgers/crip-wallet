import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  checkoutHash,
  loadLocalRuntime,
} from "../../tooling/local-runtime.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** @param {string} root @param {number} postgresPort @param {number} anvilPort */
const runtimeText = (root, postgresPort, anvilPort) => {
  const hash = checkoutHash(root);
  return [
    "CRIP_RUNTIME_STATE=ready",
    `CRIP_CHECKOUT_HASH=${hash}`,
    `CRIP_COMPOSE_PROJECT=crip-wallet-${hash}`,
    "CRIP_ENVIRONMENT=local",
    "CRIP_CHAIN_ID=eip155:31337",
    "CRIP_POSTGRES_HOST=127.0.0.1",
    `CRIP_POSTGRES_PORT=${postgresPort}`,
    "CRIP_POSTGRES_DATABASE=crip_wallet",
    "CRIP_POSTGRES_USER=crip",
    "CRIP_POSTGRES_PASSWORD=test-password",
    "CRIP_ANVIL_HOST=127.0.0.1",
    `CRIP_ANVIL_PORT=${anvilPort}`,
    `CRIP_RPC_URL=http://127.0.0.1:${anvilPort}`,
    "",
  ].join("\n");
};

/** @param {(root: string) => unknown} callback */
const withRuntime = (callback) => {
  const root = mkdtempSync(join(tmpdir(), "crip-wallet-runtime-"));
  mkdirSync(join(root, ".local"));
  writeFileSync(
    join(root, ".local/runtime.env"),
    runtimeText(root, 55433, 18545),
    { mode: 0o600 },
  );
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("loads non-default effective ports from the checkout runtime state", () => {
  /** @param {string} root */
  withRuntime((root) => {
    const runtime = loadLocalRuntime({ root, environment: {} });
    assert.equal(runtime.postgres.port, 55433);
    assert.equal(runtime.anvil.port, 18545);
    assert.equal(runtime.anvil.rpcUrl, "http://127.0.0.1:18545");
  });
});

test("rejects a conflicting port override instead of targeting another checkout", () => {
  /** @param {string} root */
  withRuntime((root) => {
    assert.throws(
      () =>
        loadLocalRuntime({
          root,
          environment: { CRIP_POSTGRES_PORT: "55432" },
        }),
      /environment override disagrees with local runtime: CRIP_POSTGRES_PORT/,
    );
  });
});

test("binds runtime state to the checkout and separates two checkout projects", () => {
  const first = mkdtempSync(join(tmpdir(), "crip-wallet-first-"));
  const second = mkdtempSync(join(tmpdir(), "crip-wallet-second-"));
  try {
    assert.notEqual(checkoutHash(first), checkoutHash(second));
    assert.notEqual(
      `crip-wallet-${checkoutHash(first)}`,
      `crip-wallet-${checkoutHash(second)}`,
    );
    mkdirSync(join(second, ".local"));
    writeFileSync(
      join(second, ".local/runtime.env"),
      runtimeText(first, 55433, 18545),
      { mode: 0o600 },
    );
    assert.throws(
      () => loadLocalRuntime({ root: second, environment: {} }),
      /different checkout/,
    );
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test("keeps host port zero allocation, loopback bindings, and failed-start cleanup contractual", () => {
  const source = readFileSync(join(repositoryRoot, "compose.yaml"), "utf8");
  assert.match(source, /127\.0\.0\.1:\$\{CRIP_POSTGRES_PORT:-0\}:5432/);
  assert.match(source, /127\.0\.0\.1:\$\{CRIP_ANVIL_PORT:-0\}:8545/);
  const lifecycle = readFileSync(
    join(repositoryRoot, "scripts/dev-up.sh"),
    "utf8",
  );
  assert.match(lifecycle, /trap cleanup_on_failure EXIT/);
  assert.match(lifecycle, /down --remove-orphans/);
  assert.doesNotMatch(lifecycle, /down --remove-orphans --volumes|down -v/);
});
