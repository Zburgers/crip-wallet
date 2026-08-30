import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { generateComponentCredential } from "@crip/trust-boundary";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { createLocalSignerDeps } from "../src/signer-keys.js";

const writePrivateJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
};

describe("local signer key loading", () => {
  it("rejects Anvil state when the disposable key does not derive the configured sender", () => {
    const root = mkdtempSync(join(tmpdir(), "crip-local-signer-"));
    try {
      mkdirSync(join(root, ".local", "anvil"), { recursive: true });
      mkdirSync(join(root, ".local", "signer"), { recursive: true });
      const privateKey = generatePrivateKey();
      writePrivateJson(join(root, ".local", "anvil", "anvil.json"), {
        available_accounts: ["0x0000000000000000000000000000000000000001"],
        private_keys: [privateKey],
      });
      const credential = generateComponentCredential({
        credentialId: "credential_test",
        componentId: "component_test",
        role: "ADAPTER",
      });
      writePrivateJson(join(root, ".local", "signer", "credential.json"), {
        credentialId: credential.credentialId,
        componentId: credential.componentId,
        role: credential.role,
        privateKey: credential.privateKey,
      });

      expect(() =>
        createLocalSignerDeps({ root, rpcUrl: "http://127.0.0.1:8545" }),
      ).toThrow("disposable signer key does not match configured address");
      expect(privateKeyToAccount(privateKey).address).not.toBe(
        "0x0000000000000000000000000000000000000001",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a signer dependency bound to a non-loopback RPC URL", () => {
    const root = mkdtempSync(join(tmpdir(), "crip-local-signer-"));
    try {
      mkdirSync(join(root, ".local", "anvil"), { recursive: true });
      mkdirSync(join(root, ".local", "signer"), { recursive: true });
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      writePrivateJson(join(root, ".local", "anvil", "anvil.json"), {
        available_accounts: [account.address.toLowerCase()],
        private_keys: [privateKey],
      });
      const credential = generateComponentCredential({
        credentialId: "credential_test",
        componentId: "component_test",
        role: "ADAPTER",
      });
      writePrivateJson(join(root, ".local", "signer", "credential.json"), {
        credentialId: credential.credentialId,
        componentId: credential.componentId,
        role: credential.role,
        privateKey: credential.privateKey,
      });

      expect(() =>
        createLocalSignerDeps({ root, rpcUrl: "http://203.0.113.10:8545" }),
      ).toThrow("local signer RPC must be loopback-only");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
