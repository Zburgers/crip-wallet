import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { createLocalAnvilReadRpc } from "@crip/transaction-pipeline";
import type { LocalReadRpc } from "@crip/transaction-pipeline";
import { signComponentAction } from "@crip/trust-boundary";
import { createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type {
  Address,
  ExactTransactionFields,
  Hash,
  SignerCredentialIdentity,
} from "./signer-core.js";

const ANVIL_CONFIG_PATH = ".local/anvil/anvil.json";
const SIGNER_CREDENTIAL_PATH = ".local/signer/credential.json";
const KEY_PATTERN = /^0x[0-9a-f]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const assertLocalRpcUrl = (rpcUrl: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error("local signer RPC must be loopback-only");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("local signer RPC must be loopback-only");
  }
};

const requireMode600 = (path: string): void => {
  if ((statSync(path).mode & 0o777) !== 0o600)
    throw new Error(`sensitive local state must be mode 0600: ${path}`);
};

export interface DisposableAccount {
  address: Address;
  privateKey: string;
}

/** Load the disposable account 0 key from the mode-0600 Anvil state. */
export const loadDisposableAnvilAccount = (root: string): DisposableAccount => {
  const path = join(root, ANVIL_CONFIG_PATH);
  requireMode600(path);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    available_accounts?: unknown;
    private_keys?: unknown;
  };
  if (
    !Array.isArray(parsed.available_accounts) ||
    !Array.isArray(parsed.private_keys) ||
    parsed.available_accounts.length === 0 ||
    parsed.available_accounts.length !== parsed.private_keys.length
  )
    throw new Error("malformed anvil account state");
  const address = parsed.available_accounts[0];
  const key = parsed.private_keys[0];
  if (
    typeof address !== "string" ||
    !ADDRESS_PATTERN.test(address) ||
    typeof key !== "string" ||
    !KEY_PATTERN.test(key)
  )
    throw new Error("malformed disposable account material");
  return { address: address as Address, privateKey: key };
};

interface CredentialFile {
  credentialId: unknown;
  componentId: unknown;
  role: unknown;
  privateKey: unknown;
}

interface LoadedSignerCredential extends SignerCredentialIdentity {
  privateKey: string;
}

/** Load the signer ADAPTER credential from the mode-0600 local secret file. */
export const loadSignerCredential = (root: string): LoadedSignerCredential => {
  const path = join(root, SIGNER_CREDENTIAL_PATH);
  requireMode600(path);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as CredentialFile;
  if (
    typeof parsed.credentialId !== "string" ||
    !IDENTIFIER_PATTERN.test(parsed.credentialId) ||
    typeof parsed.componentId !== "string" ||
    !IDENTIFIER_PATTERN.test(parsed.componentId) ||
    parsed.role !== "ADAPTER" ||
    typeof parsed.privateKey !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(parsed.privateKey)
  )
    throw new Error("malformed signer credential file");
  return {
    credentialId: parsed.credentialId,
    componentId: parsed.componentId,
    role: "ADAPTER",
    privateKey: parsed.privateKey,
  };
};

export interface LocalSignerDeps {
  rpcUrl: string;
  root: string;
}

/** Build the production signer dependencies from local secret state. */
export const createLocalSignerDeps = (input: LocalSignerDeps) => {
  assertLocalRpcUrl(input.rpcUrl);
  const disposable = loadDisposableAnvilAccount(input.root);
  const credential = loadSignerCredential(input.root);
  const account = privateKeyToAccount(disposable.privateKey as `0x${string}`);
  if (account.address.toLowerCase() !== disposable.address.toLowerCase()) {
    throw new Error("disposable signer key does not match configured address");
  }
  const walletClient = createWalletClient({
    account,
    chain: {
      id: 31337,
      name: "Crip Wallet Local Anvil",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [input.rpcUrl] } },
    },
    transport: http(input.rpcUrl),
  });
  return {
    credential: {
      credentialId: credential.credentialId,
      componentId: credential.componentId,
      role: credential.role,
    },
    rpcUrl: input.rpcUrl,
    loadDisposableAccount: () => ({ address: disposable.address }),
    makeRpc: (fixtureInstanceId: string): LocalReadRpc =>
      createLocalAnvilReadRpc({
        rpcUrl: input.rpcUrl,
        fixtureInstanceId,
      }),
    signTransaction: async (
      fields: ExactTransactionFields,
    ): Promise<{ transactionHash: Hash; rawTransaction: string }> => {
      if (fields.nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("local signer nonce exceeds viem safe range");
      }
      const serialized = await account.signTransaction({
        chainId: fields.chainId,
        type: "eip1559",
        nonce: Number(fields.nonce),
        to: fields.to,
        value: fields.value,
        gas: fields.gas,
        maxFeePerGas: fields.maxFeePerGas,
        maxPriorityFeePerGas: fields.maxPriorityFeePerGas,
        accessList: [],
        data: fields.data,
      } as Parameters<typeof account.signTransaction>[0]);
      return {
        transactionHash: keccak256(toBytes(serialized)) as Hash,
        rawTransaction: serialized,
      };
    },
    sendRawTransaction: (rawTransaction: string) =>
      walletClient.sendRawTransaction({
        serializedTransaction: rawTransaction as `0x${string}`,
      }),
    authorizeResult: (payload: Record<string, unknown>) =>
      signComponentAction(credential, "sign-authorized-transfer", payload),
  };
};
