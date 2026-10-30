import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";

/** The folder that the system `ssh_config` pulls in with `Include /etc/ssh/ssh_config.d/*.conf`. */
const SYSTEM_SSH_CONFIG_DIRECTORY = "/etc/ssh/ssh_config.d";
/** A drop-in is a few lines; a larger file is not a configuration worth copying. */
const MAXIMUM_DROP_IN_BYTES = 1_048_576;
/** What `fopen` failures `ssh` skips silently, so a copy that skips the file as well changes nothing. */
const SKIPPED_BY_SSH = new Set(["ENOENT", "EACCES", "ELOOP", "ENOTDIR"]);

interface DropIn {
  readonly name: string;
  readonly content: Buffer;
}

/** A drop-in that `ssh` itself would reject; the copies must not make it acceptable. */
class UnsafeDropInError extends Error {}

function errorCode(caughtError: unknown): string | null {
  return caughtError instanceof Error &&
    "code" in caughtError &&
    typeof caughtError.code === "string"
    ? caughtError.code
    : null;
}

/** The test `ssh` applies to an included file: root or the caller owns it and nobody else may write. */
function isTrustedFile(metadata: Stats): boolean {
  return (
    metadata.isFile() &&
    (metadata.uid === 0 || metadata.uid === process.getuid?.()) &&
    (metadata.mode & 0o022) === 0 &&
    metadata.size <= MAXIMUM_DROP_IN_BYTES
  );
}

async function readBounded(handle: FileHandle, size: number): Promise<Buffer> {
  const buffer = Buffer.alloc(size + 1);
  let total = 0;
  while (total <= size) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      size + 1 - total,
      total,
    );
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  if (total !== size) throw new UnsafeDropInError("changed while it was read");
  return buffer.subarray(0, size);
}

/**
 * Reads one drop-in through the handle that was checked, as `ssh` does with `fstat` on its opened file.
 * A link is followed; a file that cannot be opened is skipped like `ssh` skips it.
 */
async function readDropIn(file: string): Promise<Buffer | null> {
  let handle: FileHandle;
  try {
    // Non-blocking, so a pipe named `*.conf` is rejected below instead of waiting for a writer.
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (caughtError: unknown) {
    if (SKIPPED_BY_SSH.has(errorCode(caughtError) ?? "")) return null;
    throw caughtError;
  }
  try {
    const metadata = await handle.stat();
    if (!isTrustedFile(metadata))
      throw new UnsafeDropInError("is not a plain file of root or the account");
    return await readBounded(handle, metadata.size);
  } finally {
    await handle.close();
  }
}

/** The files the shell pattern `*.conf` of `ssh` matches: no name with a leading dot. */
async function trustedDropIns(systemDirectory: string): Promise<DropIn[]> {
  let names: string[];
  try {
    names = await readdir(systemDirectory);
  } catch (caughtError: unknown) {
    if (SKIPPED_BY_SSH.has(errorCode(caughtError) ?? "")) return [];
    throw caughtError;
  }
  const dropIns: DropIn[] = [];
  for (const name of names.filter(
    (entry) => entry.endsWith(".conf") && !entry.startsWith("."),
  ))
    try {
      const content = await readDropIn(path.join(systemDirectory, name));
      if (content !== null) dropIns.push({ name, content });
    } catch (caughtError: unknown) {
      if (!(caughtError instanceof UnsafeDropInError)) throw caughtError;
      throw new UnsafeDropInError(`${name} ${caughtError.message}`);
    }
  return dropIns.sort((first, second) => first.name.localeCompare(second.name));
}

async function requirePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o022) !== 0
  )
    throw new Error("SSH configuration copy is not a private directory");
}

function snapshotName(dropIns: readonly DropIn[]): string {
  const digest = createHash("sha256");
  for (const { name, content } of dropIns)
    digest.update(`${name}\0${content.length}\0`).update(content);
  return digest.digest("hex");
}

/** Whether the folder holds exactly these copies, owned by the account and not writable by others. */
async function isSnapshot(
  directory: string,
  dropIns: readonly DropIn[],
): Promise<boolean> {
  try {
    const names = (await readdir(directory)).sort();
    if (names.join("\0") !== dropIns.map((entry) => entry.name).join("\0"))
      return false;
    for (const { name, content } of dropIns) {
      const file = path.join(directory, name);
      const metadata = await lstat(file);
      if (
        !metadata.isFile() ||
        metadata.uid !== process.getuid?.() ||
        (metadata.mode & 0o022) !== 0 ||
        !content.equals(await readFile(file))
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Publishes the copies as a folder that is named after its content and never changes afterwards.
 * The folder is written under another name and renamed in one step, so no job sees half of it.
 */
async function publishSnapshot(
  parent: string,
  dropIns: readonly DropIn[],
): Promise<string> {
  await requirePrivateDirectory(parent);
  const target = path.join(parent, snapshotName(dropIns));
  if (await isSnapshot(target, dropIns)) return target;
  const staging = await mkdtemp(path.join(parent, `.staging-${randomUUID()}-`));
  try {
    for (const { name, content } of dropIns)
      await writeFile(path.join(staging, name), content, {
        mode: 0o444,
        flag: "wx",
      });
    await rename(staging, target);
  } catch (caughtError: unknown) {
    await rm(staging, { recursive: true, force: true });
    // A concurrent start may have published the same content first.
    if (!(await isSnapshot(target, dropIns))) throw caughtError;
  }
  return target;
}

/**
 * Makes the system SSH drop-ins readable for `ssh` inside a bubblewrap job.
 *
 * @param parent - A folder of the caller that holds the copies; it is created private and checked on every use.
 * @param systemDirectory - The folder that is copied; defaults to the system drop-in folder.
 * @returns Bubblewrap arguments that mount the copies over the system folder, or none.
 *
 * @remarks
 * Unprivileged bubblewrap runs in a user namespace that maps only the account
 * itself. Every root-owned file then belongs to the overflow user, and `ssh`
 * refuses an included configuration file that is owned by neither root nor the
 * caller, so any Git over SSH inside the job fails with "Bad owner or
 * permissions".
 *
 * Each drop-in is opened once and judged by `ssh`'s own test on that handle: a
 * plain file of root or the account that no one else may write. The copies keep
 * the content, belong to the account and are mounted read-only; the system
 * files and their modes stay as they are. A drop-in that fails the test, or any
 * failure while copying, leaves the whole mount out, so the job fails in `ssh`
 * as it does today and the copies never make a rejected file acceptable. A
 * drop-in that `ssh` cannot open is skipped by `ssh` too and is not copied.
 *
 * The copies are a snapshot named after their content: starting jobs never
 * rewrite a folder another job has mounted. Only the standard system folder is
 * covered, not a configuration reached through another path or `-F`.
 */
export async function sshConfigOverlayArguments(
  parent: string,
  systemDirectory: string = SYSTEM_SSH_CONFIG_DIRECTORY,
): Promise<readonly string[]> {
  try {
    const dropIns = await trustedDropIns(systemDirectory);
    if (dropIns.length === 0) return [];
    const copies = await publishSnapshot(parent, dropIns);
    return ["--ro-bind", copies, SYSTEM_SSH_CONFIG_DIRECTORY];
  } catch (caughtError: unknown) {
    if (caughtError instanceof UnsafeDropInError)
      logDiagnostic(
        "CliSshConfigOverlay",
        "warn",
        `Git over SSH stays unavailable inside the job boundary: ${caughtError.message}.`,
      );
    else logCaughtError("CliSshConfigOverlay", caughtError);
    return [];
  }
}
