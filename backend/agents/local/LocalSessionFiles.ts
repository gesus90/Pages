import { constants } from "node:fs";
import { lstat, mkdir, open, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAXIMUM_CONTROL_BYTES = 2 * 1024 * 1024;

/** Creates a private directory without accepting a symlink or another owner. */
export async function requireLocalDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await lstat(directory);
  if (
    !stats.isDirectory() ||
    stats.uid !== process.getuid?.() ||
    (stats.mode & 0o077) !== 0
  )
    throw new Error("Local session directory is not private");
  const parent = await open(
    path.dirname(directory),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

/** Synchronizes a private control record before atomically publishing its name. */
export async function writeLocalRecord(
  file: string,
  input: unknown,
): Promise<void> {
  const directory = path.dirname(file);
  await requireLocalDirectory(directory);
  const pending = `${file}.${randomUUID()}.pending`;
  const handle = await open(pending, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(input));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(pending, file);
  const parent = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

/** Reads a bounded private regular file without following its final symlink. */
export async function readLocalRecord(file: string): Promise<unknown> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      stats.uid !== process.getuid?.() ||
      (stats.mode & 0o077) !== 0 ||
      stats.size > MAXIMUM_CONTROL_BYTES
    )
      throw new Error("Invalid local session control file");
    const text = await handle.readFile("utf8");
    if (Buffer.byteLength(text) > MAXIMUM_CONTROL_BYTES)
      throw new Error("Local control record is too large");
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } finally {
    await handle.close();
  }
}
