import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import { DailyLogWriter } from "./DailyLogWriter";
import { LogRetention } from "./LogRetention";

import type { ServerLogEvent } from "./Logger";
import type * as NodeFsPromises from "node:fs/promises";

const TODAY = new Date(2026, 10, 20, 10, 0, 0);

const lock = vi.hoisted(() => {
  const state: { held: boolean } = { held: false };
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
      lock.held = true;
      return "none";
    }

    /** Releases the test lock. */
    public async release(): Promise<void> {
      lock.held = false;
    }
  },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    unlink: vi.fn(actual.unlink),
  };
});

/** Vitest object matcher typed as unknown, so that it can sit inside an expected object. */
function objectContaining(expected: Record<string, unknown>): unknown {
  return expect.objectContaining(expected);
}

/** Vitest type matcher typed as unknown, so that it can sit inside an expected object. */
function anyValue(constructor: unknown): unknown {
  return expect.any(constructor);
}

interface RetentionHarness {
  readonly directory: string;
  readonly writer: DailyLogWriter;
  readonly retention: LogRetention;
  readonly events: ServerLogEvent[];
}

const createdRoots: string[] = [];

/** Creates an isolated log directory below the Pages temporary directory. */
async function createLogDirectory(): Promise<string> {
  const root = pagesTempDirectory("logging-tests", randomUUID());
  createdRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

/** Starts a real writer on an isolated directory and a retention job that records its events. */
async function createHarness(): Promise<RetentionHarness> {
  const directory = await createLogDirectory();
  const writer = new DailyLogWriter("instance-a");
  await writer.start(directory);
  const events: ServerLogEvent[] = [];
  const retention = new LogRetention(directory, writer, (event) => {
    events.push(event);
  });
  return { directory, writer, retention, events };
}

/** Writes one file with a valid line into the log directory. */
async function createFiles(
  directory: string,
  names: readonly string[],
): Promise<void> {
  for (const name of names) {
    await writeFile(path.join(directory, name), "{}\n");
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(TODAY);
});

afterEach(async () => {
  vi.useRealTimers();
  lock.held = false;
  await Promise.all(
    createdRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("rejects retention outside the supported whole-day range", async () => {
  const { retention } = await createHarness();

  await expect(retention.update(366)).rejects.toThrow("Invalid log retention");
  await expect(retention.update(-1)).rejects.toThrow("Invalid log retention");
  await expect(retention.update(1.5)).rejects.toThrow("Invalid log retention");
});

it("deletes only daily files older than the retention window", async () => {
  const { directory, retention, events } = await createHarness();
  await createFiles(directory, [
    "pages-2026-10-21.jsonl",
    "pages-2026-10-22.jsonl",
    "pages-2026-11-20.jsonl",
    "pages-2026-11-21.jsonl",
    "pages-2026-01-01.jsonl",
    "notes.txt",
    "pages-2026-02-30.jsonl",
  ]);
  await mkdir(path.join(directory, "pages-2026-09-01.jsonl"));
  await symlink(
    path.join(directory, "notes.txt"),
    path.join(directory, "pages-2026-09-02.jsonl"),
  );

  await retention.cleanup("manual");

  expect((await readdir(directory)).sort()).toEqual([
    "notes.txt",
    "pages-2026-02-30.jsonl",
    "pages-2026-09-01.jsonl",
    "pages-2026-09-02.jsonl",
    "pages-2026-10-22.jsonl",
    "pages-2026-11-20.jsonl",
    "pages-2026-11-21.jsonl",
  ]);
  expect(events).toEqual([
    objectContaining({
      level: "info",
      event: "logging.cleanup.completed",
      metadata: {
        jobId: anyValue(String),
        reason: "manual",
        retentionDays: 30,
        deleted: 2,
        failed: 0,
      },
    }),
  ]);
  await retention.close();
});

it("keeps every file for a zero-day setting and still reports the run", async () => {
  const { directory, retention, events } = await createHarness();
  await createFiles(directory, ["pages-2026-01-01.jsonl"]);

  await retention.update(0, "settings");

  expect(await readdir(directory)).toEqual(["pages-2026-01-01.jsonl"]);
  expect(events).toEqual([
    objectContaining({
      level: "info",
      metadata: objectContaining({
        reason: "settings",
        retentionDays: 0,
        deleted: 0,
      }),
    }),
  ]);
  await retention.close();
});

it("counts a file that cannot be removed as failed and keeps it for the next run", async () => {
  const { directory, retention, events } = await createHarness();
  await createFiles(directory, [
    "pages-2026-01-01.jsonl",
    "pages-2026-01-02.jsonl",
  ]);
  vi.mocked(unlink).mockRejectedValueOnce(
    Object.assign(new Error("busy"), { code: "EBUSY" }),
  );

  await retention.cleanup("manual");

  expect(await readdir(directory)).toHaveLength(1);
  expect(events).toEqual([
    objectContaining({
      level: "error",
      event: "logging.cleanup.delete_failed",
      error: objectContaining({ code: "EBUSY" }),
    }),
    objectContaining({
      level: "warn",
      event: "logging.cleanup.completed",
      metadata: objectContaining({ deleted: 1, failed: 1 }),
    }),
  ]);
  await retention.close();
});

it("counts a file that disappears before its check as failed", async () => {
  const { directory, retention, events } = await createHarness();
  await createFiles(directory, ["pages-2026-01-01.jsonl"]);
  vi.mocked(lstat).mockRejectedValueOnce(
    Object.assign(new Error("gone"), { code: "ENOENT" }),
  );

  await retention.cleanup("manual");

  expect(events).toEqual([
    objectContaining({ event: "logging.cleanup.delete_failed" }),
    objectContaining({
      level: "warn",
      metadata: objectContaining({ deleted: 0, failed: 1 }),
    }),
  ]);
  expect(await readdir(directory)).toEqual(["pages-2026-01-01.jsonl"]);
  await retention.close();
});

it("stops the run when the setting changes while files are being removed", async () => {
  const { directory, retention, events } = await createHarness();
  await createFiles(directory, [
    "pages-2026-01-01.jsonl",
    "pages-2026-01-02.jsonl",
    "pages-2026-01-03.jsonl",
  ]);
  const actualFs =
    await vi.importActual<typeof NodeFsPromises>("node:fs/promises");
  const pendingUpdate: { value: Promise<void> | null } = { value: null };
  vi.mocked(unlink).mockImplementationOnce(async (target) => {
    pendingUpdate.value = retention.update(365, "settings");
    await actualFs.unlink(target);
  });

  await retention.cleanup("manual");
  await pendingUpdate.value;

  expect(events[0]).toMatchObject({
    event: "logging.cleanup.completed",
    metadata: objectContaining({ deleted: 1, reason: "manual" }),
  });
  expect(await readdir(directory)).toHaveLength(2);
  await retention.close();
});

it("reports a failed run with its error and keeps retention retryable", async () => {
  const { directory, retention, events } = await createHarness();
  await rm(directory, { recursive: true, force: true });

  await retention.cleanup("manual");

  expect(events).toEqual([
    objectContaining({
      level: "error",
      event: "logging.cleanup.failed",
      error: objectContaining({ code: "ENOENT" }),
      metadata: objectContaining({ deleted: 0, failed: 1 }),
    }),
  ]);
  await retention.close();
});

it("coalesces overlapping cleanup requests into one run", async () => {
  const { directory, retention, events } = await createHarness();
  await createFiles(directory, ["pages-2026-01-01.jsonl"]);

  await Promise.all([retention.cleanup("first"), retention.cleanup("second")]);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    metadata: objectContaining({ reason: "first" }),
  });
  await retention.close();
});

it("runs the cleanup at the next local midnight and then every following day", async () => {
  const { directory, retention, events } = await createHarness();
  await createFiles(directory, ["pages-2026-01-01.jsonl"]);
  await retention.update(30, "settings");
  const dayChanges = (): number =>
    events.filter((event) => event.metadata?.reason === "day_changed").length;

  await vi.advanceTimersByTimeAsync(14 * 60 * 60 * 1000);
  await vi.waitFor(() => expect(dayChanges()).toBe(1));
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  await vi.waitFor(() => expect(dayChanges()).toBe(2));

  await retention.close();
});

it("replaces an earlier schedule instead of running twice", async () => {
  const { directory, retention, events } = await createHarness();
  await createFiles(directory, ["pages-2026-01-01.jsonl"]);
  await retention.update(30);
  await retention.update(30);

  await vi.advanceTimersByTimeAsync(14 * 60 * 60 * 1000);
  await vi.waitFor(() =>
    expect(
      events.filter((event) => event.metadata?.reason === "day_changed"),
    ).toHaveLength(1),
  );
  await retention.close();
});

it("stops the scheduled cleanup when the job is closed", async () => {
  const { directory, retention, events } = await createHarness();
  await createFiles(directory, ["pages-2026-01-01.jsonl"]);
  await retention.update(30);

  await retention.close();
  await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);

  expect(
    events.filter((event) => event.metadata?.reason === "day_changed"),
  ).toHaveLength(0);
});
