import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

import { loggingFailureCode } from "./LogFallback";

import type { FileHandle } from "node:fs/promises";

type LockRecovery = "none" | "stale_owner" | "incomplete_record";

class LogLockError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super("Exclusive log ownership is unavailable");
    this.name = "LogLockError";
    this.code = code;
  }
}

function lockDescriptor(descriptor: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "flock",
      ["--exclusive", "--nonblock", "--conflict-exit-code", "75", "3"],
      {
        stdio: ["ignore", "ignore", "ignore", descriptor],
        timeout: 2_000,
      },
    );
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new LogLockError(
            code === 75 ? "LOG_WRITER_BUSY" : "LOG_LOCK_UNAVAILABLE",
          ),
        );
    });
  });
}

async function openLock(directory: string): Promise<{
  readonly handle: FileHandle;
  readonly isNew: boolean;
}> {
  const filename = path.join(directory, ".writer.lock");
  const flags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  try {
    const handle = await open(
      filename,
      flags | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    return { handle, isNew: true };
  } catch (error: unknown) {
    if (loggingFailureCode(error) !== "EEXIST") throw error;
    return { handle: await open(filename, flags), isNew: false };
  }
}

function isLiveLegacyOwner(record: unknown): boolean {
  if (
    typeof record !== "object" ||
    record === null ||
    !("pid" in record) ||
    typeof record.pid !== "number" ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0 ||
    ("schemaVersion" in record && record.schemaVersion === 2)
  )
    return false;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error: unknown) {
    return loggingFailureCode(error) !== "ESRCH";
  }
}

async function readRecovery(handle: FileHandle): Promise<LockRecovery> {
  const buffer = Buffer.alloc(4_096);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  let record: unknown;
  try {
    record = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return "incomplete_record";
  }
  if (isLiveLegacyOwner(record)) throw new LogLockError("LOG_WRITER_BUSY");
  if (
    typeof record !== "object" ||
    record === null ||
    !("pid" in record) ||
    typeof record.pid !== "number"
  )
    return "incomplete_record";
  return "released" in record && record.released === true
    ? "none"
    : "stale_owner";
}

async function processStartIdentity(): Promise<string> {
  const [boot, stat] = await Promise.all([
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
    readFile("/proc/self/stat", "utf8"),
  ]);
  const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  if (ticks === undefined || !/^\d+$/u.test(ticks))
    throw new LogLockError("LOG_LOCK_IDENTITY_UNAVAILABLE");
  return `${boot.trim()}:${ticks}`;
}

/** Kernel-owned Linux lock; descriptor closure, including SIGKILL, releases ownership. */
export class LogWriterLock {
  private readonly instanceId: string;
  private handle: FileHandle | null = null;
  private processStart: string | null = null;

  public constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  /** Whether this process holds the kernel lock, independently of the PID in its record. */
  public isHeld(): boolean {
    return this.handle !== null;
  }

  /** Acquires without waiting for another writer; never deletes or replaces the lock inode. */
  public async acquire(directory: string): Promise<LockRecovery> {
    if (this.handle !== null) return "none";
    if (process.platform !== "linux")
      throw new LogLockError("LOG_LOCK_UNSUPPORTED");
    this.processStart ??= await processStartIdentity();
    const { handle, isNew } = await openLock(directory);
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.nlink !== 1)
        throw new LogLockError("LOG_LOCK_INVALID_FILE");
      await handle.chmod(0o600);
      // The child's fd 3 duplicates our open file description. Its successful
      // flock survives the short-lived utility and stays held by this handle.
      await lockDescriptor(handle.fd);
      const recovery =
        isNew && (await handle.stat()).size === 0
          ? "none"
          : await readRecovery(handle);
      this.handle = handle;
      await this.writeIdentity(false);
      return recovery;
    } catch (error: unknown) {
      this.handle = null;
      await handle.close();
      throw error;
    }
  }

  /** Marks orderly release and closes the descriptor; the persistent inode must not be unlinked. */
  public async release(): Promise<void> {
    const handle = this.handle;
    if (handle === null) return;
    try {
      await this.writeIdentity(true);
    } finally {
      this.handle = null;
      await handle.close();
    }
  }

  private async writeIdentity(released: boolean): Promise<void> {
    if (this.handle === null) return;
    const identity = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        pid: process.pid,
        instanceId: this.instanceId,
        processStart: this.processStart,
        released,
      }),
    );
    let offset = 0;
    while (offset < identity.length) {
      const { bytesWritten } = await this.handle.write(
        identity,
        offset,
        identity.length - offset,
        offset,
      );
      if (bytesWritten === 0) throw new LogLockError("LOG_LOCK_WRITE_FAILED");
      offset += bytesWritten;
    }
    await this.handle.truncate(identity.length);
    await this.handle.datasync();
  }
}
