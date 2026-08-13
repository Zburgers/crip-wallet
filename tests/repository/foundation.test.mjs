import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import process from "node:process";
import { test } from "node:test";
import { URL } from "node:url";

/** @param {string} path */
const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("uses one canonical product specification", () => {
  assert.equal(
    existsSync(new URL("../../docs/PRODUCT_SPEC.md", import.meta.url)),
    true,
  );
  assert.equal(
    existsSync(
      new URL(
        "../../docs/CRIP_WALLET_GOVERNING_PRODUCT_SPEC.md",
        import.meta.url,
      ),
    ),
    false,
  );
});

test("ignores generated credentials and local runtime state", () => {
  const ignore = read(".gitignore");

  for (const required of [
    ".env",
    ".local/",
    "*.pem",
    "*.key",
    "*.db",
    "*.sqlite*",
    "*.tsbuildinfo",
  ]) {
    assert.match(
      ignore,
      new RegExp(`^${required.replaceAll("*", "\\*")}$`, "m"),
    );
  }
});

test("defines local-only PostgreSQL and Anvil services with immutable images", () => {
  const compose = read("compose.yaml");

  assert.match(compose, /postgres:17-alpine@sha256:[a-f0-9]{64}/);
  assert.match(
    compose,
    /ghcr\.io\/foundry-rs\/foundry:stable@sha256:[a-f0-9]{64}/,
  );
  assert.match(compose, /127\.0\.0\.1:\$\{CRIP_POSTGRES_PORT:-55432\}:5432/);
  assert.match(compose, /127\.0\.0\.1:\$\{CRIP_ANVIL_PORT:-8545\}:8545/);
  assert.match(compose, /--chain-id[\s\S]*31337/);
  assert.match(compose, /--mnemonic-seed-unsafe[\s\S]*31337/);
  assert.match(compose, /--quiet/);
  assert.doesNotMatch(compose, /^name:/m);
  assert.doesNotMatch(compose, /mainnet|sepolia|testnet/i);
});

test("root scripts expose reproducible validation and safe local lifecycle commands", () => {
  const manifest = JSON.parse(read("package.json"));

  for (const script of [
    "check",
    "check:static",
    "docs:check",
    "repo:check",
    "test:unit",
    "test:db",
    "test:concurrency",
    "test:invariants",
    "dev:up",
    "dev:status",
    "dev:down",
  ]) {
    assert.equal(
      typeof manifest.scripts[script],
      "string",
      `missing ${script}`,
    );
  }
  assert.match(manifest.packageManager, /^npm@\d+\.\d+\.\d+$/);
  assert.equal(manifest.devDependencies["fast-check"], "4.9.0");
  assert.match(read("tooling/phase1-test-gate.mjs"), /fail-closed/);
  assert.match(read("tooling/phase1-test-parameters.mjs"), /workers: 4/);
});

test("local lifecycle scripts use defensive Bash and never embed wallet material", () => {
  for (const path of [
    "scripts/dev-up.sh",
    "scripts/dev-status.sh",
    "scripts/dev-down.sh",
    "scripts/local-context.sh",
    "scripts/validate-local-env.sh",
  ]) {
    const script = read(path);
    assert.match(script, /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail\n/);
    assert.doesNotMatch(script, /private.?key|seed phrase|mnemonic/i);
  }

  assert.match(read("scripts/dev-up.sh"), /chmod 600 "\$ANVIL_CONFIG"/);
  assert.match(
    read("scripts/dev-up.sh"),
    /install --mode 600 \/dev\/null "\$ANVIL_CONFIG"/,
  );
});

test("derives an isolated Compose project for each checkout", () => {
  const context = read("scripts/local-context.sh");

  assert.match(context, /sha256sum/);
  assert.match(context, /shasum --algorithm 256/);
  assert.match(context, /openssl dgst -sha256/);
  assert.match(context, /CRIP_COMPOSE_PROJECT/);
  for (const path of [
    "scripts/dev-up.sh",
    "scripts/dev-status.sh",
    "scripts/dev-down.sh",
  ]) {
    const script = read(path);
    assert.match(script, /source .*local-context\.sh/);
    assert.match(script, /--project-name "\$CRIP_COMPOSE_PROJECT"/);
  }
});

test("validates the deterministic public Anvil account fixture", () => {
  const status = read("scripts/dev-status.sh");

  assert.match(status, /available_accounts/);
  for (const address of [
    "0x1c253b59dc67f513975c444654632151314abbc5",
    "0x6f784a4efcf99d56ef5d6d97b70f93da5c1b372f",
    "0xa447c77278c88f6548c93a49ac34845141facee5",
  ]) {
    assert.match(status, new RegExp(address));
  }
});

/** @param {Record<string, string>} overrides */
const validateEnvironment = (overrides) =>
  spawnSync("bash", ["scripts/validate-local-env.sh"], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...overrides },
  });

/** @type {Array<[string, Record<string, string>]>} */
const unsafeConfigurations = [
  ["non-local environment", { CRIP_ENVIRONMENT: "production" }],
  ["public chain", { CRIP_CHAIN_ID: "eip155:1" }],
  ["non-loopback RPC", { CRIP_RPC_URL: "https://rpc.example.invalid" }],
  [
    "non-loopback PostgreSQL host",
    { CRIP_POSTGRES_HOST: "db.example.invalid" },
  ],
  ["invalid host port", { CRIP_POSTGRES_PORT: "not-a-port" }],
];

for (const [name, overrides] of unsafeConfigurations) {
  test(`refuses ${name} before startup`, () => {
    const result = validateEnvironment(overrides);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ERROR: refusing unsafe local configuration/);
  });
}

test("example environment is local-only and contains no assigned secret", () => {
  const example = read(".env.example");

  assert.match(example, /^CRIP_ENVIRONMENT=local$/m);
  assert.match(example, /^CRIP_CHAIN_ID=eip155:31337$/m);
  assert.match(example, /^CRIP_RPC_URL=http:\/\/127\.0\.0\.1:8545$/m);
  assert.match(example, /^CRIP_ANVIL_PORT=8545$/m);
  assert.match(example, /^CRIP_POSTGRES_PORT=55432$/m);
  assert.doesNotMatch(example, /(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY)=\S+/);
});

test("defines least-privilege CI and secret-scanning controls", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/secret-scan.yml",
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    ".gitleaks.toml",
  ]) {
    assert.equal(
      existsSync(new URL(`../../${path}`, import.meta.url)),
      true,
      `missing ${path}`,
    );
  }

  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/secret-scan.yml",
  ]) {
    const workflow = read(path);
    assert.match(workflow, /^permissions:\n {2}contents: read$/m);
    assert.doesNotMatch(workflow, /pull_request_target/);
    assert.doesNotMatch(
      workflow,
      /^\s*uses: [^\n]+@(?![a-f0-9]{40}(?:\s|#|$))/m,
    );
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /timeout-minutes:/);
  }

  assert.match(read(".github/workflows/secret-scan.yml"), /fetch-depth: 0/);
  assert.match(read(".gitleaks.toml"), /useDefault = true/);
});

test("imports the built schemas workspace through its package boundary", async () => {
  const schemas = await import("@crip/schemas");

  assert.deepEqual(schemas.ENFORCEMENT_GRADES, [
    "ONCHAIN",
    "SIGNER",
    "CONTROL_PLANE",
    "ADVISORY",
    "UNSUPPORTED",
  ]);
  assert.equal(
    schemas.meetsMinimumEnforcementGrade("SIGNER", "CONTROL_PLANE"),
    true,
  );
  assert.equal(schemas.atomicUnitSchema.parse("500000"), "500000");
  assert.equal(typeof schemas.canonicalIntentSchema.safeParse, "function");
  assert.equal(typeof schemas.createCanonicalIntentSchema, "function");
  assert.equal(typeof schemas.hashIdempotencyPayload, "function");
  assert.equal(
    schemas.canonicalizeIdempotencyPayload({ b: 2, a: 1 }),
    '{"a":1,"b":2}',
  );
});

test("imports the built policy engine workspace through its package boundary", async () => {
  const policyEngine = await import("@crip/policy-engine");

  assert.equal(typeof policyEngine.evaluatePolicy, "function");
  assert.equal(
    typeof policyEngine.policyEvaluationContextSchema.safeParse,
    "function",
  );
});
