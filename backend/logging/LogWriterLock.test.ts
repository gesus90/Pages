import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile, open } from "node:fs/promises";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { LogWriterLock } from "./LogWriterLock";

import type { FileHandle } from "node:fs/promises";
import type * as NodeChildProcess from "node:child_process";
import type * as NodeFsPromises from "node:fs/promises";

const lockProcess = vi.hoisted(() => {
  const state: {
    exitCode: number;
    spawnFails: boolean;
    commands: { command: string; args: readonly string[] }[];
  } = { exitCode: 0, spawnFails: false, commands: [] };
  return state;
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>();
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: vi.fn((command: string, args: readonly string[]) => {
      lockProcess.commands.push({ command, args });
      const child = new EventEmitter();
      queueMicrotask(() => {
        if (lockProcess.spawnFails)
          child.emit("error", new Error("spawn flock ENOENT"));
        else child.emit("close", lockProcess.exitCode);
      });
      return child;
    }),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    readFile: vi.fn(actual.readFile),
  };
});

const LOCK_NAME = ".writer.lock";
const createdRoots: string[] = [];

/** Creates one isolated log directory below the Pages temporary directory. */
async function createLogDirectory(): Promise<string> {
  const root = pagesTempDirectory("logging-tests", randomUUID());
  createdRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

afterEach(async () => {
  lockProcess.exitCode = 0;
  lockProcess.spawnFails = false;
  lockProcess.commands.length = 0;
  await Promise.all(
    createdRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Replaces the process platform for one call and restores it afterwards. */
async function withPlatform<Result>(
  platform: NodeJS.Platform,
  work: () => Promise<Result>,
): Promise<Result> {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return await work();
  } finally {
    if (original) Object.defineProperty(process, "platform", original);
  }
}

/** Makes the next lock-file handle reject every identity write with zero bytes. */
async function failNextIdentityWrite(captured: {
  handle: FileHandle | null;
}): Promise<void> {
  const actualFs =
    await vi.importActual<typeof NodeFsPromises>("node:fs/promises");
  vi.mocked(open).mockImplementationOnce(async (filePath, flags, mode) => {
    const handle = await actualFs.open(filePath, flags, mode);
    captured.handle = handle;
    vi.spyOn(handle, "write").mockResolvedValueOnce({
      bytesWritten: 0,
      buffer: "",
    });
    return handle;
  });
}

it("acquires the kernel lock and records this process identity", async () => {
  const directory = await createLogDirectory();
  const lock = new LogWriterLock("instance-a");

  const recovery = await lock.acquire(directory);

  expect(recovery).toBe("none");
  expect(lock.isHeld()).toBe(true);
  expect(lockProcess.commands).toEqual([
    {
      command: "flock",
      args: ["--exclusive", "--nonblock", "--conflict-exit-code", "75", "3"],
    },
  ]);
  const record = JSON.parse(
    await readFile(path.join(directory, LOCK_NAME), "utf8"),
  ) as unknown;
  expect(record).toMatchObject({
    schemaVersion: 2,
    pid: process.pid,
    instanceId: "instance-a",
    released: false,
  });
  expect(record).toHaveProperty(
    "processStart",
    expect.stringMatching(/^[^:]+:\d+$/u),
  );
  await lock.release();
});

it("returns without a second lock attempt while the lock is held", async () => {
  const directory = await createLogDirectory();
  const lock = new LogWriterLock("instance-a");
  await lock.acquire(directory);

  await expect(lock.acquire(directory)).resolves.toBe("none");

  expect(lockProcess.commands).toHaveLength(1);
  await lock.release();
});

it("marks an orderly release and clears ownership", async () => {
  const directory = await createLogDirectory();
  const lock = new LogWriterLock("instance-a");
  await lock.acquire(directory);

  await lock.release();
  await lock.release();

  expect(lock.isHeld()).toBe(false);
  expect(
    JSON.parse(await readFile(path.join(directory, LOCK_NAME), "utf8")),
  ).toMatchObject({ released: true });
});

it("can acquire again after an orderly release with the same process identity", async () => {
  const directory = await createLogDirectory();
  const lock = new LogWriterLock("instance-a");
  await lock.acquire(directory);
  const firstIdentity = JSON.parse(
    await readFile(path.join(directory, LOCK_NAME), "utf8"),
  ) as { readonly processStart: string };
  await lock.release();

  await expect(lock.acquire(directory)).resolves.toBe("none");

  const secondIdentity = JSON.parse(
    await readFile(path.join(directory, LOCK_NAME), "utf8"),
  ) as { readonly processStart: string };
  expect(secondIdentity.processStart).toBe(firstIdentity.processStart);
  await lock.release();
});

it("refuses platforms without the Linux lock primitives before touching files", async () => {
  const directory = await createLogDirectory();
  const lock = new LogWriterLock("instance-a");

  await withPlatform("darwin", async () => {
    await expect(lock.acquire(directory)).rejects.toMatchObject({
      code: "LOG_LOCK_UNSUPPORTED",
    });
  });

  expect(lockProcess.commands).toHaveLength(0);
  expect(lock.isHeld()).toBe(false);
});

it.each([
  [75, "LOG_WRITER_BUSY"],
  [1, "LOG_LOCK_UNAVAILABLE"],
])(
  "maps flock exit code %i to %s and keeps ownership clear",
  async (exitCode, code) => {
    const directory = await createLogDirectory();
    const lock = new LogWriterLock("instance-a");
    lockProcess.exitCode = exitCode;

    await expect(lock.acquire(directory)).rejects.toMatchObject({ code });
    expect(lock.isHeld()).toBe(false);
  },
);

it("reports a flock process that cannot start", async () => {
  const directory = await createLogDirectory();
  const lock = new LogWriterLock("instance-a");
  lockProcess.spawnFails = true;

  await expect(lock.acquire(directory)).rejects.toThrow("spawn flock ENOENT");
  expect(lock.isHeld()).toBe(false);
});

it("treats a record of an orderly release as a clean start", async () => {
  const directory = await createLogDirectory();
  await writeFile(
    path.join(directory, LOCK_NAME),
    JSON.stringify({ schemaVersion: 2, pid: 1, released: true }),
  );
  const lock = new LogWriterLock("instance-b");

  await expect(lock.acquire(directory)).resolves.toBe("none");
  await lock.release();
});

it("reports a record of a crashed owner as a stale owner", async () => {
  const directory = await createLogDirectory();
  await writeFile(
    path.join(directory, LOCK_NAME),
    JSON.stringify({
      schemaVersion: 2,
      pid: 999_999,
      instanceId: "old",
      processStart: "boot:1",
      released: false,
    }),
  );
  const lock = new LogWriterLock("instance-b");

  await expect(lock.acquire(directory)).resolves.toBe("stale_owner");
  await lock.release();
});

it.each([
  ["an empty file", ""],
  ["text that is not JSON", "not json"],
  ["a bare primitive", "5"],
  ["a record without a process", '{"schemaVersion":2,"released":false}'],
  ["a record whose process is not a number", '{"pid":"12"}'],
])("reports %s as an incomplete record", async (description, content) => {
  const directory = await createLogDirectory();
  await writeFile(path.join(directory, LOCK_NAME), content);
  const lock = new LogWriterLock("instance-b");

  await expect(lock.acquire(directory)).resolves.toBe("incomplete_record");
  await lock.release();
});

it("blocks when a legacy record names a process that is still alive", async () => {
  const directory = await createLogDirectory();
  await writeFile(
    path.join(directory, LOCK_NAME),
    JSON.stringify({ pid: process.pid }),
  );
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  const lock = new LogWriterLock("instance-b");

  await expect(lock.acquire(directory)).rejects.toMatchObject({
    code: "LOG_WRITER_BUSY",
  });
  expect(kill).toHaveBeenCalledWith(process.pid, 0);
  expect(lock.isHeld()).toBe(false);
});

it("treats a legacy record of a missing process as stale", async () => {
  const directory = await createLogDirectory();
  await writeFile(
    path.join(directory, LOCK_NAME),
    JSON.stringify({ pid: 999_999 }),
  );
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("no such process"), { code: "ESRCH" });
  });
  const lock = new LogWriterLock("instance-b");

  await expect(lock.acquire(directory)).resolves.toBe("stale_owner");
  await lock.release();
});

it("blocks when the owner exists but cannot be signalled", async () => {
  const directory = await createLogDirectory();
  await writeFile(path.join(directory, LOCK_NAME), JSON.stringify({ pid: 1 }));
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("denied"), { code: "EPERM" });
  });
  const lock = new LogWriterLock("instance-b");

  await expect(lock.acquire(directory)).rejects.toMatchObject({
    code: "LOG_WRITER_BUSY",
  });
});

it.each([
  ["a zero process identifier", { pid: 0 }],
  ["a fractional process identifier", { pid: 1.5 }],
  ["a negative process identifier", { pid: -3 }],
  [
    "a current-schema record of this process",
    { schemaVersion: 2, pid: process.pid },
  ],
])(
  "does not signal %s and reports it as stale",
  async (description, record) => {
    const directory = await createLogDirectory();
    await writeFile(path.join(directory, LOCK_NAME), JSON.stringify(record));
    const kill = vi.spyOn(process, "kill");
    const lock = new LogWriterLock("instance-b");

    await expect(lock.acquire(directory)).resolves.toBe("stale_owner");
    expect(kill).not.toHaveBeenCalled();
    await lock.release();
  },
);

it("refuses a lock file that is also reachable through another name", async () => {
  const directory = await createLogDirectory();
  const first = new LogWriterLock("instance-a");
  await first.acquire(directory);
  await first.release();
  await link(
    path.join(directory, LOCK_NAME),
    path.join(directory, "other.lock"),
  );
  const second = new LogWriterLock("instance-b");

  await expect(second.acquire(directory)).rejects.toMatchObject({
    code: "LOG_LOCK_INVALID_FILE",
  });
});

it("reports an unavailable process identity before opening the lock", async () => {
  const directory = await createLogDirectory();
  const readAttempts = vi.mocked(readFile);
  readAttempts
    .mockResolvedValueOnce("boot-id\n")
    .mockResolvedValueOnce("1 (pages) S 0");
  const lock = new LogWriterLock("instance-b");

  await expect(lock.acquire(directory)).rejects.toMatchObject({
    code: "LOG_LOCK_IDENTITY_UNAVAILABLE",
  });
  expect(lockProcess.commands).toHaveLength(0);
});

it("propagates a lock-file failure other than an existing file", async () => {
  const missing = path.join(await createLogDirectory(), "absent");
  const lock = new LogWriterLock("instance-b");

  await expect(lock.acquire(missing)).rejects.toMatchObject({ code: "ENOENT" });
  expect(lock.isHeld()).toBe(false);
});

it("closes the lock file and reports a failed identity write", async () => {
  const directory = await createLogDirectory();
  const captured = { handle: null as FileHandle | null };
  await failNextIdentityWrite(captured);
  const lock = new LogWriterLock("instance-b");

  await expect(lock.acquire(directory)).rejects.toMatchObject({
    code: "LOG_LOCK_WRITE_FAILED",
  });
  expect(lock.isHeld()).toBe(false);
});

it("clears ownership even when the release write fails", async () => {
  const directory = await createLogDirectory();
  const captured = { handle: null as FileHandle | null };
  const actualFs =
    await vi.importActual<typeof NodeFsPromises>("node:fs/promises");
  vi.mocked(open).mockImplementationOnce(async (filePath, flags, mode) => {
    const handle = await actualFs.open(filePath, flags, mode);
    captured.handle = handle;
    return handle;
  });
  const lock = new LogWriterLock("instance-b");
  await lock.acquire(directory);
  const acquiredHandle = captured.handle;
  if (acquiredHandle === null) throw new Error("lock handle was not captured");
  vi.spyOn(acquiredHandle, "write").mockResolvedValueOnce({
    bytesWritten: 0,
    buffer: "",
  });

  await expect(lock.release()).rejects.toMatchObject({
    code: "LOG_LOCK_WRITE_FAILED",
  });
  expect(lock.isHeld()).toBe(false);
});
