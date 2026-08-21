import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const contractsRoot = resolve(repoRoot, "contracts");
const compose = readFileSync(resolve(repoRoot, "compose.yaml"), "utf8");
const imageMatch =
  /image:\s+(ghcr\.io\/foundry-rs\/foundry:stable@sha256:[a-f0-9]{64})/.exec(
    compose,
  );

if (!imageMatch?.[1]) {
  process.stderr.write(
    "ERROR: pinned Foundry image is missing from compose.yaml.\n",
  );
  process.exit(1);
}

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    ...(typeof process.getuid === "function" &&
    typeof process.getgid === "function"
      ? ["--user", `${process.getuid()}:${process.getgid()}`]
      : []),
    "--entrypoint",
    "forge",
    "--mount",
    `type=bind,src=${contractsRoot},dst=/workspace`,
    "--workdir",
    "/workspace",
    imageMatch[1],
    "test",
    ...process.argv.slice(2),
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

if (result.error) {
  process.stderr.write(
    `ERROR: unable to run pinned Forge container: ${result.error.message}\n`,
  );
}
process.exit(result.status ?? 1);
