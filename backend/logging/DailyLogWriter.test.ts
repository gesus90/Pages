import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { DailyLogWriter } from "./DailyLogWriter";
import { openDailyLog } from "./LogFiles";
import type * as LogFallbackModule from "./LogFallback";
import type * as LogFilesModule from "./LogFiles";

const TODAY = new Date(2026, 10, 20, 10, 0, 0);
const TODAY_DATE = "2026-11-20";

const lock = vi.hoisted(() => {
  const state: {
    held: boolean;
    recovery: string;
    failure: Error | null;
    gate: Promise<void> | null;
    acquireCalls: number;
    releaseCalls: number;
  } = {
    held: false,
    recovery: "none",
    failure: null,
    gate: null,
    acquireCalls: 0,
    releaseCalls: 0,
  };
  return state;
});

const fallback = vi.hoisted(() => {
  const state: { lines: string[] } = { lines: [] };
  return state;
});

vi.mock("./LogWriterLock", () => ({
  LogWriterLock: class {
    /** Reports whether the test lock is held. */
    public isHeld(): boolean {
      return lock.held;
    }

    /** Acquires the test lock. */
    public async acquire(): Promise<string> {
      lock.acquireCalls += 1;
      if (lock.gate !== null) await lock.gate;
      if (lock.failure !== null) throw lock.failure;
      lock.held = true;
      return lock.recovery;
    }

    /** Releases the test lock. */
    public async release(): Promise<void> {
      lock.releaseCalls += 1;
      lock.held = false;
    }
  },
}));

vi.mock("./LogFallback", async (importOriginal) => {
  const actual = await importOriginal<typeof LogFallbackModule>();
  return {
    ...actual,
    writeLogFallback: (line: string) => {
      fallback.lines.push(line);
    },
  };
});

vi.mock("./LogFiles", async (importOriginal) => {
  const actual = await importOriginal<typeof LogFilesModule>();
  return { ...actual, openDailyLog: vi.fn(actual.openDailyLog) };
});

const createdRoots: string[] = [];

/** Creates an isolated log directory below the Pages temporary directory. */
async function createLogDirectory(): Promise<string> {
  const root = pagesTempDirectory("logging-tests", randomUUID());
  createdRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

/** Reads one daily file, or returns an empty text when it does not exist. */
async function readDaily(directory: string, date: string): Promise<string> {
  return readFile(path.join(directory, `pages-${date}.jsonl`), "utf8").catch(
    () => "",
  );
}

/** Returns the notices written to stderr for one event name. */
function noticesFor(event: string): unknown[] {
  return fallback.lines
    .map((line): unknown => JSON.parse(line))
    .filter(
      (record): boolean =>
        typeof record === "object" &&
        record !== null &&
        "event" in record &&
        record.event === event,
    );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(TODAY);
});

afterEach(async () => {
  vi.useRealTimers();
  lock.held = false;
  lock.recovery = "none";
  lock.failure = null;
  lock.gate = null;
  lock.acquireCalls = 0;
  lock.releaseCalls = 0;
  fallback.lines.length = 0;
  await Promise.all(
    createdRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("writes accepted lines in order into the file of their capture date", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);

  writer.append('{"n":1}\n', TODAY_DATE);
  writer.append('{"n":2}\n', TODAY_DATE);
  await writer.flush();

  expect(await readDaily(directory, TODAY_DATE)).toBe('{"n":1}\n{"n":2}\n');
  expect(writer.status()).toEqual({
    state: "healthy",
    queuedEntries: 0,
    lostEntries: 0,
    failureCode: null,
  });
  expect(fallback.lines).toEqual([]);
  await writer.close();
});

it("keeps a line in the file of its capture date even when it is written later", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);

  writer.append('{"late":true}\n', "2026-11-19");
  await writer.flush();

  expect(await readDaily(directory, "2026-11-19")).toBe('{"late":true}\n');
  await writer.close();
});

it("sends lines accepted before the directory is known to stderr once and writes them later", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");

  writer.append('{"early":1}\n', TODAY_DATE);
  expect(fallback.lines).toEqual(['{"early":1}\n']);

  await writer.start(directory);
  await writer.flush();

  expect(await readDaily(directory, TODAY_DATE)).toBe('{"early":1}\n');
  expect(fallback.lines).toEqual(['{"early":1}\n']);
  await writer.close();
});

it("uses the first directory of a writer and ignores later starts", async () => {
  const first = await createLogDirectory();
  const second = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");

  await writer.start(first);
  await writer.start(second);
  writer.append("{}\n", TODAY_DATE);
  await writer.flush();

  expect(await readDaily(first, TODAY_DATE)).toBe("{}\n");
  expect(await readDaily(second, TODAY_DATE)).toBe("");
  await writer.close();
});

it("writes a recovery notice before the first record when a stale lock was recovered", async () => {
  const directory = await createLogDirectory();
  lock.recovery = "stale_owner";
  const writer = new DailyLogWriter("instance-a");

  await writer.start(directory);
  writer.append('{"after":true}\n', TODAY_DATE);
  await writer.flush();

  const [recovery, record] = (await readDaily(directory, TODAY_DATE))
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  expect(recovery).toMatchObject({
    severity: "warn",
    event: "logging.ownership.recovered",
    component: "DailyLogWriter",
    instanceId: "instance-a",
    metadata: { reason: "stale_owner" },
  });
  expect(record).toEqual({ after: true });
  await writer.close();
});

it("reports unavailable storage, mirrors lines to stderr and recovers after the retry", async () => {
  const directory = await createLogDirectory();
  lock.failure = Object.assign(new Error("busy"), {
    code: "LOG_WRITER_BUSY",
  });
  const writer = new DailyLogWriter("instance-a");

  await writer.start(directory);
  writer.append('{"kept":1}\n', TODAY_DATE);
  await writer.flush();

  expect(writer.status()).toMatchObject({
    state: "degraded",
    failureCode: "LOG_WRITER_BUSY",
  });
  expect(noticesFor("logging.write.failed")).toEqual([
    expect.objectContaining({ code: "LOG_WRITER_BUSY", severity: "warn" }),
  ]);
  expect(fallback.lines).toContain('{"kept":1}\n');

  lock.failure = null;
  await vi.advanceTimersByTimeAsync(5_000);
  await writer.flush();

  expect(await readDaily(directory, TODAY_DATE)).toBe('{"kept":1}\n');
  expect(writer.status()).toMatchObject({
    state: "healthy",
    failureCode: null,
  });
  expect(noticesFor("logging.write.recovered")).toHaveLength(1);
  await writer.close();
});

it("reports one notice and keeps one retry for two attempts that fail together", async () => {
  const directory = await createLogDirectory();
  lock.failure = Object.assign(new Error("busy"), {
    code: "LOG_WRITER_BUSY",
  });
  let openGate: () => void = () => undefined;
  lock.gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const writer = new DailyLogWriter("instance-a");

  const starting = writer.start(directory);
  writer.append("{}\n", TODAY_DATE);
  openGate();
  await starting;
  await vi.waitFor(() => expect(lock.acquireCalls).toBe(2));
  await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));

  expect(noticesFor("logging.write.failed")).toHaveLength(1);
  lock.failure = null;
  lock.gate = null;
  await writer.close();
});

it("keeps retrying storage that cannot create its directory and recovers when it can", async () => {
  const root = await createLogDirectory();
  const directory = path.join(root, "log");
  await writeFile(directory, "not a directory");
  const writer = new DailyLogWriter("instance-a");

  await writer.start(directory);

  expect(writer.status()).toMatchObject({
    state: "degraded",
    failureCode: "EEXIST",
  });
  writer.append('{"waiting":1}\n', TODAY_DATE);

  await rm(directory);
  await mkdir(directory);
  await vi.advanceTimersByTimeAsync(5_000);
  await writer.flush();

  expect(await readDaily(directory, TODAY_DATE)).toBe('{"waiting":1}\n');
  await writer.close();
});

it("reports a daily file that cannot be opened and keeps its lines on stderr", async () => {
  const directory = await createLogDirectory();
  await mkdir(path.join(directory, `pages-${TODAY_DATE}.jsonl`));
  const writer = new DailyLogWriter("instance-a");

  await writer.start(directory);
  writer.append('{"blocked":1}\n', TODAY_DATE);
  await writer.flush();

  expect(writer.status()).toMatchObject({
    state: "degraded",
    failureCode: "EISDIR",
  });
  expect(fallback.lines).toContain('{"blocked":1}\n');
  await writer.close();
});

it("treats a write that accepts zero bytes as an I/O failure", async () => {
  const directory = await createLogDirectory();
  const actualFiles =
    await vi.importActual<typeof LogFilesModule>("./LogFiles");
  vi.mocked(openDailyLog).mockImplementationOnce(async (root, date) => {
    const handle = await actualFiles.openDailyLog(root, date);
    vi.spyOn(handle, "write").mockResolvedValueOnce({
      bytesWritten: 0,
      buffer: "",
    });
    return handle;
  });
  const writer = new DailyLogWriter("instance-a");

  await writer.start(directory);
  writer.append("{}\n", TODAY_DATE);
  await writer.flush();

  expect(writer.status()).toMatchObject({
    state: "degraded",
    failureCode: "LOG_IO_ERROR",
  });
  await writer.close();
});

it("discards lines beyond 2048 queued entries and reports the overflow once", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);

  for (let index = 0; index < 2_050; index += 1) {
    writer.append(`{"n":${index}}\n`, TODAY_DATE);
  }
  await writer.flush();

  const written = (await readDaily(directory, TODAY_DATE)).trim().split("\n");
  expect(written).toHaveLength(2_048);
  expect(written[0]).toBe('{"n":0}');
  expect(writer.status()).toMatchObject({ state: "degraded", lostEntries: 2 });
  expect(noticesFor("logging.queue.overflow")).toHaveLength(1);
  expect(fallback.lines).toContain(`{"n":2049}\n`);
  await writer.close();
});

it("discards lines that would exceed 8 MiB of queued bytes", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);
  const megabyteLine = `${"m".repeat(1024 * 1024 - 1)}\n`;

  for (let index = 0; index < 9; index += 1) {
    writer.append(megabyteLine, TODAY_DATE);
  }
  await writer.flush();

  expect(
    (await stat(path.join(directory, `pages-${TODAY_DATE}.jsonl`))).size,
  ).toBe(8 * 1024 * 1024);
  expect(writer.status()).toMatchObject({ lostEntries: 1 });
  await writer.close();
});

it("refuses the file-level work until the writer owns its directory", async () => {
  const writer = new DailyLogWriter("instance-a");

  await expect(writer.withFiles(async () => "unused")).rejects.toThrow(
    "Log writer is unavailable",
  );
});

it("closes a file of an earlier date before work that protects open dates", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);
  writer.append("{}\n", "2026-11-19");
  await writer.flush();

  const protectedDates = await writer.withFiles(async (dates) => [...dates]);

  expect(protectedDates).toEqual([]);
  await writer.close();
});

it("protects the file of today while it stays open", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);
  writer.append("{}\n", TODAY_DATE);
  await writer.flush();

  const protectedDates = await writer.withFiles(async (dates) => [...dates]);

  expect(protectedDates).toEqual([TODAY_DATE]);
  await writer.close();
});

it("passes the failure of file-level work to its caller", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);

  await expect(
    writer.withFiles(async () => {
      throw new Error("cleanup failed");
    }),
  ).rejects.toThrow("cleanup failed");
  await writer.close();
});

it("reports starting, healthy and degraded states with their counters", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  expect(writer.status()).toEqual({
    state: "starting",
    queuedEntries: 0,
    lostEntries: 0,
    failureCode: null,
  });

  await writer.start(directory);
  expect(writer.status().state).toBe("healthy");

  writer.recordSerializationLoss();
  expect(writer.status()).toEqual({
    state: "degraded",
    queuedEntries: 0,
    lostEntries: 1,
    failureCode: "LOG_SERIALIZATION_ERROR",
  });
  await writer.close();
});

it("flushes successfully before any file exists", async () => {
  const writer = new DailyLogWriter("instance-a");

  await expect(writer.flush()).resolves.toBeUndefined();
});

it("releases ownership and refuses new lines after an orderly close", async () => {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);
  writer.append('{"last":1}\n', TODAY_DATE);

  await writer.close();
  writer.append('{"after-close":1}\n', TODAY_DATE);

  expect(await readDaily(directory, TODAY_DATE)).toBe('{"last":1}\n');
  expect(lock.releaseCalls).toBe(1);
  expect(lock.held).toBe(false);
  expect(noticesFor("logging.queue.overflow")).toHaveLength(1);
});

it("reports lines still queued at shutdown without writing them twice", async () => {
  const directory = await createLogDirectory();
  lock.failure = Object.assign(new Error("busy"), {
    code: "LOG_WRITER_BUSY",
  });
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);
  writer.append('{"queued":1}\n', TODAY_DATE);
  writer.append('{"queued":2}\n', TODAY_DATE);

  await writer.close();

  expect(
    fallback.lines.filter((line) => line === '{"queued":1}\n'),
  ).toHaveLength(1);
  expect(noticesFor("logging.shutdown.loss")).toEqual([
    expect.objectContaining({ code: "LOG_WRITER_BUSY", pending: 2 }),
  ]);
  expect(writer.status().lostEntries).toBe(2);
});

it("reports a final sync failure during close and still releases ownership", async () => {
  const directory = await createLogDirectory();
  const actualFiles =
    await vi.importActual<typeof LogFilesModule>("./LogFiles");
  vi.mocked(openDailyLog).mockImplementationOnce(async (root, date) => {
    const handle = await actualFiles.openDailyLog(root, date);
    vi.spyOn(handle, "datasync")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error("fsync failed"), { code: "EIO" }),
      );
    return handle;
  });
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);
  writer.append("{}\n", TODAY_DATE);

  await writer.close();

  expect(lock.releaseCalls).toBe(1);
  expect(lock.held).toBe(false);
  expect(noticesFor("logging.write.failed")).toEqual([
    expect.objectContaining({ code: "EIO" }),
  ]);
});

it("reports the write failure even when closing the damaged file fails", async () => {
  const directory = await createLogDirectory();
  const actualFiles =
    await vi.importActual<typeof LogFilesModule>("./LogFiles");
  vi.mocked(openDailyLog).mockImplementationOnce(async (root, date) => {
    const handle = await actualFiles.openDailyLog(root, date);
    const originalClose = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockResolvedValueOnce({
      bytesWritten: 0,
      buffer: "",
    });
    vi.spyOn(handle, "close").mockImplementationOnce(async () => {
      await originalClose();
      throw new Error("close failed");
    });
    return handle;
  });
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);
  writer.append("{}\n", TODAY_DATE);
  await writer.flush();

  expect(writer.status()).toMatchObject({
    state: "degraded",
    failureCode: "LOG_IO_ERROR",
  });
  await writer.close();
});

it("keeps an earlier day's file protected while a line for it is still queued", async () => {
  const directory = await createLogDirectory();
  const actualFiles =
    await vi.importActual<typeof LogFilesModule>("./LogFiles");
  const syncState = { reached: false };
  let releaseSync: () => void = () => undefined;
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  vi.mocked(openDailyLog).mockImplementationOnce(async (root, date) => {
    const handle = await actualFiles.openDailyLog(root, date);
    vi.spyOn(handle, "datasync").mockImplementationOnce(async () => {
      syncState.reached = true;
      await syncGate;
    });
    return handle;
  });
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);
  writer.append("{}\n", "2026-11-19");
  await vi.waitFor(() => expect(syncState.reached).toBe(true));
  writer.append('{"queued":true}\n', "2026-11-19");

  const protectedDates = writer.withFiles(async (dates) => [...dates]);
  releaseSync();

  expect(await protectedDates).toEqual(["2026-11-19"]);
  await writer.close();
});

it("sends a line accepted while shutdown persists the queue to stderr instead of the file", async () => {
  const directory = await createLogDirectory();
  const actualFiles =
    await vi.importActual<typeof LogFilesModule>("./LogFiles");
  let releaseQueue: () => void = () => undefined;
  const queueGate = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const writer = new DailyLogWriter("instance-a");
  vi.mocked(openDailyLog).mockImplementationOnce(async (root, date) => {
    const handle = await actualFiles.openDailyLog(root, date);
    const originalSync = handle.datasync.bind(handle);
    vi.spyOn(handle, "datasync")
      .mockImplementationOnce(originalSync)
      .mockImplementationOnce(async () => {
        void writer.withFiles(async () => {
          await queueGate;
        });
        writer.append('{"late":1}\n', TODAY_DATE);
        await originalSync();
      });
    return handle;
  });
  await writer.start(directory);
  writer.append('{"first":1}\n', TODAY_DATE);

  const closing = writer.close();
  await vi.waitFor(() => expect(fallback.lines).toContain('{"late":1}\n'));
  releaseQueue();
  await closing;

  expect(await readDaily(directory, TODAY_DATE)).toBe('{"first":1}\n');
  expect(writer.status().lostEntries).toBe(1);
  expect(noticesFor("logging.shutdown.loss")).toEqual([
    expect.objectContaining({ code: "LOG_IO_ERROR", pending: 1 }),
  ]);
});
