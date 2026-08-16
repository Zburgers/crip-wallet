import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** @typedef {Record<string, string>} EnvValues */
/** @typedef {{root?: string, runtimePath?: string, environment?: NodeJS.ProcessEnv}} RuntimeOptions */

const LOOPBACK = "127.0.0.1";
const READY = "ready";

/** @param {string} contents @param {string} source @returns {EnvValues} */
const parseEnv = (contents, source) => {
  /** @type {EnvValues} */
  const values = {};
  for (const [index, line] of contents.split("\n").entries()) {
    if (line === "") continue;
    const match = /^(?<key>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$/.exec(line);
    if (!match?.groups) {
      throw new Error(`invalid local runtime entry at ${source}:${index + 1}`);
    }
    const key = match.groups.key;
    const value = match.groups.value;
    if (!key || value === undefined)
      throw new Error(`invalid local runtime entry at ${source}:${index + 1}`);
    if (key in values) throw new Error(`duplicate local runtime key: ${key}`);
    values[key] = value;
  }
  return values;
};

/** @param {EnvValues} values @param {string} key */
const required = (values, key) => {
  const value = values[key];
  if (!value) throw new Error(`local runtime key is missing: ${key}`);
  return value;
};

/** @param {EnvValues} values @param {string} key */
const port = (values, key) => {
  const value = required(values, key);
  if (!/^[1-9][0-9]{3,4}$/.test(value))
    throw new Error(`local runtime port is invalid: ${key}`);
  const number = Number(value);
  if (number < 1024 || number > 65535)
    throw new Error(`local runtime port is outside the safe range: ${key}`);
  return number;
};

/** @param {string} root */
export const checkoutHash = (root) =>
  createHash("sha256").update(resolve(root)).digest("hex").slice(0, 12);

/** @param {string} root */
export const runtimePathFor = (root) =>
  join(resolve(root), ".local", "runtime.env");

/** @param {RuntimeOptions} options */
export const loadLocalRuntime = ({
  root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  runtimePath = runtimePathFor(root),
  environment = process.env,
} = {}) => {
  let values;
  try {
    values = parseEnv(readFileSync(runtimePath, "utf8"), runtimePath);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code === "ENOENT")
      throw new Error(
        "local runtime is not initialized; run npm run dev:up first",
        { cause: error },
      );
    throw error;
  }

  const expectedHash = checkoutHash(root);
  if (required(values, "CRIP_RUNTIME_STATE") !== READY)
    throw new Error("local runtime is not ready; run npm run dev:up first");
  if (required(values, "CRIP_CHECKOUT_HASH") !== expectedHash)
    throw new Error("local runtime belongs to a different checkout");
  if (
    required(values, "CRIP_COMPOSE_PROJECT") !== `crip-wallet-${expectedHash}`
  )
    throw new Error(
      "local runtime Compose project does not match this checkout",
    );
  if (required(values, "CRIP_ENVIRONMENT") !== "local")
    throw new Error("refusing non-local runtime configuration");
  if (required(values, "CRIP_CHAIN_ID") !== "eip155:31337")
    throw new Error("refusing non-local chain configuration");
  if (required(values, "CRIP_POSTGRES_HOST") !== LOOPBACK)
    throw new Error("refusing non-loopback PostgreSQL runtime");
  if (required(values, "CRIP_ANVIL_HOST") !== LOOPBACK)
    throw new Error("refusing non-loopback Anvil runtime");

  const postgresPort = port(values, "CRIP_POSTGRES_PORT");
  const anvilPort = port(values, "CRIP_ANVIL_PORT");
  if (required(values, "CRIP_RPC_URL") !== `http://${LOOPBACK}:${anvilPort}`)
    throw new Error(
      "local runtime RPC URL does not match its effective Anvil port",
    );

  for (const key of [
    "CRIP_POSTGRES_HOST",
    "CRIP_POSTGRES_PORT",
    "CRIP_POSTGRES_DATABASE",
    "CRIP_POSTGRES_USER",
    "CRIP_POSTGRES_PASSWORD",
    "CRIP_ANVIL_HOST",
    "CRIP_ANVIL_PORT",
    "CRIP_RPC_URL",
  ]) {
    if (environment[key] !== undefined && environment[key] !== values[key])
      throw new Error(
        `environment override disagrees with local runtime: ${key}`,
      );
  }

  return {
    state: values.CRIP_RUNTIME_STATE,
    checkoutHash: expectedHash,
    composeProject: values.CRIP_COMPOSE_PROJECT,
    postgres: {
      host: values.CRIP_POSTGRES_HOST,
      port: postgresPort,
      database: required(values, "CRIP_POSTGRES_DATABASE"),
      user: required(values, "CRIP_POSTGRES_USER"),
      password: required(values, "CRIP_POSTGRES_PASSWORD"),
    },
    anvil: {
      host: values.CRIP_ANVIL_HOST,
      port: anvilPort,
      rpcUrl: values.CRIP_RPC_URL,
    },
    values: { ...values },
  };
};
