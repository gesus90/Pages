import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Adds a shared Git branch resource to actual local write directories, never to mere plan references. */
export async function expandedPlanWriteResources(
  keys: readonly string[],
): Promise<readonly string[]> {
  const resources = new Set(keys);
  for (const key of keys) {
    if (!key.startsWith("local-directory:")) continue;
    const cwd = key.slice("local-directory:".length);
    const options = { cwd, timeout: 2000, maxBuffer: 8192 };
    try {
      const common = await execute(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        options,
      );
      const branch = await execute(
        "git",
        ["symbolic-ref", "--quiet", "HEAD"],
        options,
      );
      const identity = createHash("sha256")
        .update(JSON.stringify([common.stdout.trim(), branch.stdout.trim()]))
        .digest("hex");
      resources.add(`local-git-branch:${identity}`);
    } catch (error: unknown) {
      if (!isNonBranchDirectory(error))
        throw new Error("Local writer Git resource could not be verified");
    }
  }
  return [...resources];
}

function isNonBranchDirectory(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  // An absent old directory retains its path reservation; it cannot discover or run a Git branch there.
  if (error.code === "ENOENT") return true;
  if (error.code === 1 && "stderr" in error && error.stderr === "") return true;
  return (
    error.code === 128 &&
    "stderr" in error &&
    typeof error.stderr === "string" &&
    error.stderr.includes("not a git repository")
  );
}

/** Parent and child directories collide; unrelated directories and branch identities do not. */
export function planWriterResourcesCollide(
  first: string,
  second: string,
): boolean {
  if (first === second) return true;
  if (
    !first.startsWith("local-directory:") ||
    !second.startsWith("local-directory:")
  )
    return false;
  return (
    first.startsWith(`${second.replace(/\/$/u, "")}/`) ||
    second.startsWith(`${first.replace(/\/$/u, "")}/`)
  );
}

/** Legacy registration identifiers require snapshot attribution instead of comparison by registration. */
export function isConcretePlanWriterResource(key: string): boolean {
  return (
    key.startsWith("local-directory:") ||
    key.startsWith("local-git-branch:") ||
    key.startsWith("remote-workspace:")
  );
}
