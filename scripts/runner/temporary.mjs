import { chmod, lstat, mkdir, rm, rmdir, statfs } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";

function segment(identifier) {
  if (
    typeof identifier !== "string" ||
    !identifier ||
    identifier === "." ||
    identifier === ".."
  )
    throw new Error("Invalid runner scratch owner");
  return encodeURIComponent(identifier);
}

/** Each remote attempt has its own directory, also when a host executes several nodes of one run. */
export function runnerTemporaryDirectory(job) {
  return join(
    userInfo().homedir,
    ".pages",
    "data",
    "run-tmp",
    segment(job.plan.runId),
    segment(job.plan.stepId),
    `remote-${segment(job.jobId)}`,
  );
}

/** Refuses RAM filesystems before the owned remote namespace can start. */
export async function prepareRunnerTemporaryDirectory(job) {
  const directory = runnerTemporaryDirectory(job);
  const root = dirname(dirname(dirname(directory)));
  for (const entry of [
    root,
    dirname(dirname(directory)),
    dirname(directory),
    directory,
  ]) {
    await mkdir(entry, { recursive: true, mode: 0o700 });
    const metadata = await lstat(entry);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid()
    )
      throw new Error("Runner scratch ownership could not be confirmed");
    await chmod(entry, 0o700);
  }
  const filesystem = await statfs(directory);
  if ([0x01021994, 0x858458f6].includes(filesystem.type))
    throw new Error("Runner scratch must reside on disk");
  return directory;
}

/** Called by the host only after the owned namespace ended; never from the live worker. */
export async function removeRunnerTemporaryDirectory(job) {
  if (!job?.plan?.runId || !job.plan.stepId) return;
  const directory = runnerTemporaryDirectory(job);
  await rm(directory, { recursive: true, force: true });
  for (const parent of [dirname(directory), dirname(dirname(directory))]) {
    try {
      await rmdir(parent);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  }
}
