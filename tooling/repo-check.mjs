import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const compose = readFileSync("compose.yaml", "utf8");
const ignore = readFileSync(".gitignore", "utf8");
const workflows = [
  ".github/workflows/ci.yml",
  ".github/workflows/secret-scan.yml",
].map((path) => readFileSync(path, "utf8"));

assert.equal(manifest.private, true, "root package must be private");
assert.match(manifest.packageManager, /^npm@\d+\.\d+\.\d+$/);
assert.match(compose, /postgres:17-alpine@sha256:[a-f0-9]{64}/);
assert.match(compose, /foundry:stable@sha256:[a-f0-9]{64}/);
assert.match(compose, /127\.0\.0\.1:\$\{CRIP_POSTGRES_PORT:-0\}:5432/);
const postgresService = compose.match(
  /^ {2}postgres:\n([\s\S]*?)(?=^ {2}anvil:)/m,
)?.[1];
assert.ok(postgresService);
assert.match(postgresService, /networks:\n {6}- local-only/);
assert.doesNotMatch(postgresService, /anvil-private|gateway-host/);
const anvilService = compose.match(
  /^ {2}anvil:\n([\s\S]*?)(?=^ {2}anvil-gateway:)/m,
)?.[1];
assert.ok(anvilService);
assert.doesNotMatch(anvilService, /^\s+ports:/m);
const gatewayService = compose.match(
  /^ {2}anvil-gateway:\n([\s\S]*?)(?=^networks:)/m,
)?.[1];
assert.ok(gatewayService);
assert.match(gatewayService, /127\.0\.0\.1:\$\{CRIP_ANVIL_PORT:-0\}:8545/);
assert.match(
  gatewayService,
  /networks:\n {6}- anvil-private\n {6}- gateway-host/,
);
assert.match(compose, /anvil-private:[\s\S]*internal: true/);
assert.match(ignore, /^\.local\/$/m);

for (const workflow of workflows) {
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(workflow, /pull_request_target/);
  for (const reference of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
    const actionReference = reference[1];
    assert.ok(actionReference);
    assert.match(
      actionReference,
      /@[a-f0-9]{40}$/,
      `action is not commit-pinned: ${actionReference}`,
    );
  }
}

process.stdout.write(
  "Repository checks passed (local-only foundation and pinned CI).\n",
);
