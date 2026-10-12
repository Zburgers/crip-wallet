import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { withChainMutationLease } from "../src/chain-mutation-lease.mjs";

describe("Anvil chain mutation lease", () => {
  it("holds an exclusive cross-process lock for the whole callback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "crip-chain-lease-"));
    const lockPath = join(directory, "anvil.lock");
    await writeFile(lockPath, "", { mode: 0o600 });
    let enterFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      enterFirst = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withChainMutationLease(lockPath, async () => {
      enterFirst();
      await firstRelease;
    });

    try {
      await firstEntered;
      expect(
        spawnSync("flock", ["--exclusive", "--nonblock", lockPath, "true"])
          .status,
      ).not.toBe(0);
      releaseFirst();
      await first;
      expect(
        spawnSync("flock", ["--exclusive", "--nonblock", lockPath, "true"])
          .status,
      ).toBe(0);
    } finally {
      releaseFirst();
      await Promise.allSettled([first]);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a directory in place of the shared lock file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "crip-chain-lease-"));
    const lockPath = join(directory, "anvil.lock");
    await mkdir(lockPath);

    try {
      await expect(
        withChainMutationLease(lockPath, async () => {}),
      ).rejects.toMatchObject({ code: "ANVIL_MUTATION_LEASE_UNAVAILABLE" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
