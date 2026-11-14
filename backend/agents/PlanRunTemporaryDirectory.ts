import { chmod, lstat, mkdir, readdir, rm, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Stable disk location of one plan node, reused after a pause. */
export interface PlanTemporaryScope {
  readonly runId: string;
  readonly stepId: string;
}

/** The instance's run scratch root; independent of a worker's redirected HOME. */
export function planTemporaryRoot(): string {
  return path.join(homedir(), ".pages", "data", "run-tmp");
}

function pathSegment(identifier: string): string {
  if (!identifier || identifier === "." || identifier === "..")
    throw new Error("Invalid plan temporary directory identifier");
  return encodeURIComponent(identifier);
}

/** Resolves one node's private scratch directory without accepting path traversal. */
export function planTemporaryDirectory(scope: PlanTemporaryScope): string {
  return path.join(
    planTemporaryRoot(),
    pathSegment(scope.runId),
    pathSegment(scope.stepId),
  );
}

/** Writable mount kept separate from the source and immutable SSH snapshots of a step. */
export function planTemporaryMountDirectory(scope: PlanTemporaryScope): string {
  return path.join(planTemporaryDirectory(scope), "tmp");
}

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.()
  )
    throw new Error(
      "Plan temporary directory ownership could not be confirmed",
    );
  await chmod(directory, 0o700);
}

/** Creates private disk scratch; refuses tmpfs/ramfs rather than silently consuming RAM. */
export async function preparePlanTemporaryDirectory(
  scope: PlanTemporaryScope,
): Promise<string> {
  const root = planTemporaryRoot();
  await privateDirectory(root);
  const filesystem = await statfs(root);
  if (filesystem.type === 0x01021994 || filesystem.type === 0x858458f6)
    throw new Error("Plan temporary directory must reside on disk");
  await privateDirectory(path.join(root, pathSegment(scope.runId)));
  const directory = planTemporaryDirectory(scope);
  await privateDirectory(directory);
  const mountDirectory = planTemporaryMountDirectory(scope);
  await privateDirectory(mountDirectory);
  return mountDirectory;
}

/** Removes a node only after its caller confirmed process end; a pause never calls this. */
export async function removePlanTemporaryStep(
  scope: PlanTemporaryScope,
): Promise<void> {
  await rm(planTemporaryDirectory(scope), { recursive: true, force: true });
}

/** Removes all scratch after every process of the ended run has been confirmed stopped. */
export async function removePlanTemporaryRun(runId: string): Promise<void> {
  await rm(path.join(planTemporaryRoot(), pathSegment(runId)), {
    recursive: true,
    force: true,
  });
}

/** Lists scratch owners for startup reconciliation; missing roots require no cleanup. */
export async function temporaryPlanRunIds(): Promise<readonly string[]> {
  try {
    const entries = await readdir(planTemporaryRoot(), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => decodeURIComponent(entry.name));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}

/** Temp variables inside the step's mount namespace, including Node's explicit cache override. */
export function planTemporaryEnvironment(): Readonly<Record<string, string>> {
  return {
    TMPDIR: "/tmp",
    TEMP: "/tmp",
    TMP: "/tmp",
    NODE_COMPILE_CACHE: "/tmp/node-compile-cache",
  };
}
