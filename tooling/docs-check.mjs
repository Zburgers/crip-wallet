import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const required = [
  "docs/PRODUCT_SPEC.md",
  "docs/LEAD_ORCHESTRATOR_PROMPT.md",
  "docs/ARCHITECTURE.md",
  "docs/THREAT_MODEL.md",
  "docs/SECURITY.md",
  "docs/TESTING.md",
  "docs/ROADMAP.md",
  "docs/PROJECT_STATE.md",
  "docs/CHANGELOG.md",
  "docs/RISK_REGISTER.md",
  "docs/TEST_MATRIX.md",
  "docs/decisions/README.md",
  "docs/plans/MVP_MASTER_PLAN.md",
  "docs/plans/PHASE-0.md",
  "docs/workstreams/README.md",
];

for (const path of required) {
  assert.equal(existsSync(path), true, `missing required document: ${path}`);
}

assert.equal(existsSync("docs/CRIP_WALLET_GOVERNING_PRODUCT_SPEC.md"), false);
assert.equal(existsSync("docs/CRIP_WALLET_LEAD_ORCHESTRATOR_PROMPT.md"), false);

for (const path of [
  "docs/ARCHITECTURE.md",
  "docs/THREAT_MODEL.md",
  "docs/SECURITY.md",
  "docs/TESTING.md",
  "docs/ROADMAP.md",
  "docs/PROJECT_STATE.md",
  "docs/CHANGELOG.md",
  "docs/RISK_REGISTER.md",
  "docs/TEST_MATRIX.md",
]) {
  const contents = readFileSync(path, "utf8");
  assert.match(contents, /Owner:/, `${path} has no owner`);
  assert.match(contents, /Update rule:/, `${path} has no update rule`);
}

process.stdout.write(
  `Documentation checks passed (${required.length} required files).\n`,
);
