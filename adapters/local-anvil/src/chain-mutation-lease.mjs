import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

export const withChainMutationLease = async (lockPath, work) => {
  let lockFile;
  try {
    lockFile = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await lockFile.stat()).isFile())
      throw new Error("local Anvil mutation lease is not a regular file");
    await new Promise((resolve, reject) => {
      const child = spawn("flock", ["--exclusive", "3"], {
        stdio: ["ignore", "ignore", "ignore", lockFile.fd],
      });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error("failed to acquire local Anvil mutation lease"));
      });
    });
  } catch (cause) {
    await lockFile?.close().catch(() => {});
    throw Object.assign(new Error("local Anvil mutation lease unavailable"), {
      code: "ANVIL_MUTATION_LEASE_UNAVAILABLE",
      cause,
    });
  }
  try {
    return await work();
  } finally {
    await lockFile.close();
  }
};
