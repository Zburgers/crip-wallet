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
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { createLocalSignerDeps } from "../src/signer-keys.js";

const privateKey = `0x${"1".repeat(64)}` as `0x${string}`;
const account = privateKeyToAccount(privateKey);
const rawTransaction =
  "0x02f8a9827a6903021682d6d894111111111111111111111111111111111111111180b844a9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000007a120c001a0521038d73bbbe7f02eefc71f7d7b76b62622d7442db293560595e7122f81af84a0454f9fb57c2e2b6551cde553aa2030ae7543f90997c8d7cb57c970af9c471e81";
const transactionHash =
  "0xb243997d19ee84693e4aa152c5358dcb82bb9d4fb3ea5f9f9a031e2f0112f50a";
const calldata =
  "0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000007a120";

const writeSecret = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
};

describe("locked local signing vector", () => {
  it("returns the frozen exact bytes and hash from the local signer factory", async () => {
    const root = mkdtempSync(join(tmpdir(), "crip-execution-vector-"));
    try {
      mkdirSync(join(root, ".local", "anvil"), { recursive: true });
      mkdirSync(join(root, ".local", "signer"), { recursive: true });
      writeSecret(join(root, ".local", "anvil", "anvil.json"), {
        available_accounts: [account.address.toLowerCase()],
        private_keys: [privateKey],
      });
      const credential = generateComponentCredential({
        credentialId: "credential_vector",
        componentId: "local-anvil-vector",
        role: "ADAPTER",
      });
      writeSecret(join(root, ".local", "signer", "credential.json"), {
        credentialId: credential.credentialId,
        componentId: credential.componentId,
        role: credential.role,
        privateKey: credential.privateKey,
      });

      const deps = createLocalSignerDeps({
        root,
        rpcUrl: "http://127.0.0.1:8545",
      });
      const signed = await deps.signTransaction({
        chainId: 31337,
        from: account.address,
        to: "0x1111111111111111111111111111111111111111",
        value: 0n,
        nonce: 3n,
        gas: 55000n,
        maxFeePerGas: 22n,
        maxPriorityFeePerGas: 2n,
        accessList: [],
        data: calldata,
      });
      expect(signed.rawTransaction).toBe(rawTransaction);
      expect(signed.transactionHash).toBe(transactionHash);
      expect(keccak256(signed.rawTransaction as `0x${string}`)).toBe(
        transactionHash,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
