import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";

import type { FileHandle } from "node:fs/promises";

/** Establishes a private real directory, refusing a symlink at the managed root. */
export async function prepareLogDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("Log directory must be a real directory");
  await chmod(directory, 0o700);
}

/** Opens one private regular daily file without following a symlink. */
export async function openDailyLog(
  directory: string,
  date: string,
): Promise<FileHandle> {
  const handle = await open(
    path.join(directory, `pages-${date}.jsonl`),
    constants.O_RDWR |
      constants.O_CREAT |
      constants.O_APPEND |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    if (!(await handle.stat()).isFile())
      throw new Error("Daily log must be a regular file");
    await handle.chmod(0o600);
    await repairLogTail(handle);
    return handle;
  } catch (error: unknown) {
    await handle.close();
    throw error;
  }
}

/** Preserves complete records, including valid JSON without LF; discards only a torn suffix. */
async function repairLogTail(handle: FileHandle): Promise<void> {
  const { size } = await handle.stat();
  if (size === 0) return;
  let position = size;
  let suffix: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  while (position > 0) {
    const length = Math.min(position, 65_536);
    position -= length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, position);
    const newline = buffer.lastIndexOf(10);
    if (newline >= 0) {
      if (position + newline + 1 === size) return;
      suffix = Buffer.concat([buffer.subarray(newline + 1), suffix]);
      await finishTail(handle, suffix, position + newline + 1);
      return;
    }
    if (suffix.length < 65_536) suffix = Buffer.concat([buffer, suffix]);
  }
  await finishTail(handle, suffix, 0);
}

async function finishTail(
  handle: FileHandle,
  suffix: Buffer,
  boundary: number,
): Promise<void> {
  let isComplete = false;
  try {
    const parsed: unknown = JSON.parse(suffix.toString("utf8"));
    isComplete =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    isComplete = false;
  }
  if (isComplete) await handle.appendFile("\n");
  else await handle.truncate(boundary);
}
