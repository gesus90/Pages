import { beforeEach, expect, it, vi } from "vitest";

import { DailyLogWriter } from "@/backend/logging/DailyLogWriter";

const boundary = vi.hoisted(() => ({
  held: false,
  acquire: vi.fn(async () => "none"),
  release: vi.fn(async () => undefined),
  prepare: vi.fn(async () => undefined),
  open: vi.fn<(directory: string, date: string) => Promise<object>>(),
  fallback: vi.fn(),
  write: vi.fn(async (bytes: Buffer, offset: number, length: number) => ({
    bytesWritten: length,
  })),
  sync: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
}));

vi.mock("@/backend/logging/LogWriterLock", () => ({
  LogWriterLock: class {
    /** Returns the current test ownership state. */
    public isHeld(): boolean {
      return boundary.held;
    }
    /** Acquires the simulated lock. */
    public async acquire(): Promise<string> {
      const result = await boundary.acquire();
      boundary.held = true;
      return result;
    }
    /** Releases the simulated lock. */
    public async release(): Promise<void> {
      boundary.held = false;
      await boundary.release();
    }
  },
}));
vi.mock("@/backend/logging/LogFiles", () => ({
  prepareLogDirectory: boundary.prepare,
  openDailyLog: boundary.open,
}));
vi.mock("@/backend/logging/LogFallback", async (original) => ({
  ...(await original<object>()),
  writeLogFallback: boundary.fallback,
}));

beforeEach(() => {
  vi.clearAllMocks();
  boundary.held = false;
  boundary.acquire.mockResolvedValue("none");
  boundary.open.mockResolvedValue({
    write: boundary.write,
    datasync: boundary.sync,
    close: boundary.close,
  });
});

it("buffers early messages, rotates on their captured dates, and releases ownership", async () => {
  const writer = new DailyLogWriter("instance");
  writer.append("before\n", "2026-01-01");
  expect(writer.status()).toMatchObject({
    state: "starting",
    queuedEntries: 1,
  });
  await writer.start("/logs");
  writer.append("after\n", "2026-01-02");
  await writer.flush();
  expect(boundary.open.mock.calls.map((call) => call[1])).toEqual([
    "2026-01-01",
    "2026-01-02",
  ]);
  expect(boundary.write).toHaveBeenCalledTimes(2);
  expect(writer.status()).toMatchObject({ state: "healthy", queuedEntries: 0 });
  await writer.close();
  expect(boundary.release).toHaveBeenCalledOnce();
  writer.append("late\n", "2026-01-02");
  expect(writer.status()).toMatchObject({
    state: "degraded",
    lostEntries: 1,
    failureCode: "LOG_QUEUE_OVERFLOW",
  });
});

it("reports failed ownership and mirrors buffered output without leaking the error", async () => {
  boundary.acquire.mockRejectedValueOnce(
    Object.assign(new Error("private path"), { code: "EACCES" }),
  );
  const writer = new DailyLogWriter("instance");
  await writer.start("/logs");
  writer.append("event\n", "2026-01-01");
  expect(writer.status()).toMatchObject({
    state: "degraded",
    failureCode: "EACCES",
    queuedEntries: 1,
  });
  expect(boundary.fallback).toHaveBeenCalledWith("event\n");
  await writer.flush();
  expect(writer.status()).toMatchObject({ state: "healthy", queuedEntries: 0 });
  expect(boundary.write).toHaveBeenCalledOnce();
  await writer.close();
});
