import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const compose = readFileSync("compose.yaml", "utf8");
const ignore = readFileSync(".gitignore", "utf8");

assert.equal(manifest.private, true, "root package must be private");
assert.match(manifest.packageManager, /^npm@\d+\.\d+\.\d+$/);
assert.match(compose, /postgres:17-alpine@sha256:[a-f0-9]{64}/);
assert.match(compose, /foundry:stable@sha256:[a-f0-9]{64}/);
assert.match(compose, /127\.0\.0\.1:\$\{CRIP_POSTGRES_PORT:-55432\}:5432/);
assert.match(compose, /127\.0\.0\.1:\$\{CRIP_ANVIL_PORT:-8545\}:8545/);
assert.match(ignore, /^\.local\/$/m);

process.stdout.write(
  "Repository checks passed (local-only pinned foundation).\n",
);
