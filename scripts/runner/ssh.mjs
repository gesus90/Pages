import { constants } from "node:fs";
import { mkdir, open, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SSH_CONFIG_DIRECTORY = "/etc/ssh/ssh_config.d";
const MAXIMUM_DROP_IN_BYTES = 1048576;
// Open failures that `ssh` skips silently, so skipping the file in the copy changes nothing.
const SKIPPED_BY_SSH = new Set(["ENOENT", "EACCES", "ELOOP", "ENOTDIR"]);

/** The test `ssh` applies to an included file: root or the caller owns it and nobody else may write. */
function isTrustedFile(metadata) {
  return (
    metadata.isFile() &&
    (metadata.uid === 0 || metadata.uid === process.getuid()) &&
    (metadata.mode & 0o022) === 0 &&
    metadata.size <= MAXIMUM_DROP_IN_BYTES
  );
}

/** Reads through the checked handle, as `ssh` does with `fstat` on its opened file; a link is followed. */
async function readDropIn(file) {
  let handle;
  try {
    // Non-blocking, so a pipe named `*.conf` is rejected instead of waiting for a writer.
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (SKIPPED_BY_SSH.has(error.code)) return null;
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (!isTrustedFile(metadata)) throw new Error(`${file} is not trusted`);
    const buffer = Buffer.alloc(metadata.size + 1);
    let total = 0;
    while (total <= metadata.size) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        metadata.size + 1 - total,
        total,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total !== metadata.size) throw new Error(`${file} changed while read`);
    return buffer.subarray(0, total);
  } finally {
    await handle.close();
  }
}

/** The shell pattern `*.conf` of `ssh` matches no name with a leading dot. */
async function trustedDropIns(systemDirectory) {
  let names;
  try {
    names = await readdir(systemDirectory);
  } catch (error) {
    if (SKIPPED_BY_SSH.has(error.code)) return [];
    throw error;
  }
  const dropIns = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".conf") || name.startsWith(".")) continue;
    const content = await readDropIn(join(systemDirectory, name));
    if (content !== null) dropIns.push({ name, content });
  }
  return dropIns;
}

/**
 * Makes the system SSH drop-ins readable for `ssh` inside the job boundary.
 * Unprivileged bubblewrap maps only the account into its user namespace, so
 * root-owned files belong to the overflow user there and `ssh` rejects an
 * included configuration file with "Bad owner or permissions". Every drop-in is
 * first judged by `ssh`'s own test on the handle it is read through; then
 * account-owned copies of the same content are mounted read-only over the
 * folder. A drop-in that fails the test, or any failure while copying, leaves
 * the whole mount out, so `ssh` fails inside the job as it does without this
 * and the copies never make a rejected file acceptable. The folder is new for
 * this job and no other job mounts it. Only the standard system folder is
 * covered. Where nothing can be copied the job starts anyway, because most jobs
 * do not use SSH.
 */
export async function sshConfigOverlay(
  copies,
  systemDirectory = SSH_CONFIG_DIRECTORY,
) {
  let isCreated = false;
  try {
    const dropIns = await trustedDropIns(systemDirectory);
    if (dropIns.length === 0) return [];
    await mkdir(copies, { mode: 0o700 });
    isCreated = true;
    for (const { name, content } of dropIns)
      await writeFile(join(copies, name), content, {
        mode: 0o444,
        flag: "wx",
      });
    return ["--ro-bind", copies, SSH_CONFIG_DIRECTORY];
  } catch {
    if (isCreated) await rm(copies, { recursive: true, force: true });
    return [];
  }
}
