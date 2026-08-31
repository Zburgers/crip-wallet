import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { generateComponentCredential } from "@crip/trust-boundary";
import { applyMigrations } from "@crip/budget-ledger";
import { Pool } from "pg";

import { loadLocalRuntime } from "./local-runtime.mjs";

const repositoryRoot = fileURLToPath(new globalThis.URL("..", import.meta.url));
const CREDENTIAL_PATH = ".local/signer/credential.json";
const CREDENTIAL_ID = "credential_local_signer";
const COMPONENT_ID = "local-anvil-signer";
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{59}$/;
const PRIVATE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** @param {string} path */
const requireMode600 = (path) => {
  if ((statSync(path).mode & 0o777) !== 0o600) {
    throw new Error(`sensitive local state must be mode 0600: ${path}`);
  }
};

/** @param {string} path */
const readExistingCredential = (path) => {
  try {
    requireMode600(path);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (
      parsed?.credentialId === CREDENTIAL_ID &&
      parsed?.componentId === COMPONENT_ID &&
      parsed?.role === "ADAPTER" &&
      PUBLIC_KEY_PATTERN.test(parsed.publicKey ?? "") &&
      PRIVATE_KEY_PATTERN.test(parsed.privateKey ?? "")
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * Provision the disposable local signer ADAPTER credential: register the
 * public key in trusted component credentials and write the private key to
 * mode-0600 local state. Nothing here ever touches production key material.
 */
export const provisionPhase2SignerCredential = async ({
  root = repositoryRoot,
} = {}) => {
  const runtime = loadLocalRuntime({ root });
  const credentialPath = join(root, CREDENTIAL_PATH);
  const existing = readExistingCredential(credentialPath);
  const material =
    existing ??
    generateComponentCredential({
      credentialId: CREDENTIAL_ID,
      componentId: COMPONENT_ID,
      role: "ADAPTER",
    });

  const pool = new Pool({
    host: runtime.postgres.host,
    port: runtime.postgres.port,
    database: runtime.postgres.database,
    user: runtime.postgres.user,
    password: runtime.postgres.password,
    max: 1,
  });
  try {
    await applyMigrations(pool);
    await pool.query(
      `INSERT INTO trusted_component_credentials
         (credential_id, component_id, component_role, public_key)
       VALUES ($1, $2, 'ADAPTER', $3)
       ON CONFLICT (credential_id) DO NOTHING`,
      [material.credentialId, material.componentId, material.publicKey],
    );
    const row = await pool.query(
      `SELECT component_id, public_key, status FROM trusted_component_credentials
       WHERE credential_id = $1`,
      [material.credentialId],
    );
    const registered = row.rows[0];
    if (
      !registered ||
      registered.component_id !== material.componentId ||
      registered.public_key !== material.publicKey
    ) {
      throw new Error(
        "registered signer credential does not match local secret state; remove the stale local credential file or reset the local database",
      );
    }
    if (registered.status !== "ACTIVE") {
      await pool.query(
        `UPDATE trusted_component_credentials
         SET status = 'ACTIVE', revoked_at = NULL
         WHERE credential_id = $1`,
        [material.credentialId],
      );
    }
  } finally {
    await pool.end();
  }

  mkdirSync(dirname(credentialPath), { recursive: true });
  writeFileSync(credentialPath, JSON.stringify(material, null, 2) + "\n", {
    mode: 0o600,
  });
  requireMode600(credentialPath);

  process.stdout.write(
    `provisioned local signer credential ${material.credentialId} for component ${material.componentId}\n`,
  );
  return {
    credentialId: material.credentialId,
    componentId: material.componentId,
  };
};

if (
  process.argv[1] &&
  process.argv[1].endsWith("phase2-signer-credential.mjs")
) {
  provisionPhase2SignerCredential().catch((error) => {
    process.stderr.write(
      `ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
