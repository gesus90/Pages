import { afterEach, expect, it, vi } from "vitest";

import { LocalJournalCompaction } from "./LocalJournalCompaction";
import { LocalJournalGarbage } from "./LocalJournalGarbage";

import type { Mock } from "vitest";

const database = { query: vi.fn(async () => []) };

function fixture(): {
  garbage: LocalJournalGarbage;
  run: Mock<LocalJournalCompaction["run"]>;
} {
  const compaction = new LocalJournalCompaction("unused", async () => {});
  const run = vi.spyOn(compaction, "run").mockResolvedValue();
  return { garbage: new LocalJournalGarbage(compaction), run };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("coalesces requests and periodically sweeps until closed", async () => {
  vi.useFakeTimers();
  const { garbage, run } = fixture();
  garbage.schedule(database);
  garbage.schedule(database);
  await vi.advanceTimersByTimeAsync(999);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(database);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run).toHaveBeenCalledTimes(2);
  await garbage.close();
  garbage.schedule(database);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(run).toHaveBeenCalledTimes(2);
});

it("flushes a request immediately and repeats requests made during a sweep", async () => {
  vi.useFakeTimers();
  const { garbage, run } = fixture();
  let release: () => void = () => {};
  run.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  garbage.schedule(database);
  const idle = garbage.idle();
  expect(run).toHaveBeenCalledTimes(1);
  garbage.schedule(database);
  garbage.schedule(database);
  release();
  await idle;
  expect(run).toHaveBeenCalledTimes(2);
  await garbage.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps sweeping after an error and waits for in-flight work on close", async () => {
  vi.useFakeTimers();
  const { garbage, run } = fixture();
  run.mockRejectedValueOnce(new Error("failed"));
  garbage.schedule(database);
  await garbage.idle();
  expect(run).toHaveBeenCalledTimes(1);
  let release: () => void = () => {};
  run.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  garbage.schedule(database);
  const idle = garbage.idle();
  garbage.schedule(database);
  const closing = garbage.close();
  release();
  await Promise.all([idle, closing]);
  expect(vi.getTimerCount()).toBe(0);
});

it("uses the newest database for a request made during an active sweep", async () => {
  vi.useFakeTimers();
  const { garbage, run } = fixture();
  const replacement = { query: vi.fn(async () => []) };
  let release: () => void = () => {};
  run.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    garbage.schedule(database);
    const idle = garbage.idle();
    expect(run).toHaveBeenCalledExactlyOnceWith(database);
    garbage.schedule(replacement);
    release();
    await idle;
    expect(run.mock.calls).toEqual([[database], [replacement]]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenLastCalledWith(replacement);
  } finally {
    await garbage.close();
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("continues periodic sweeps after a failed compaction", async () => {
  vi.useFakeTimers();
  const { garbage, run } = fixture();
  run.mockRejectedValueOnce(new Error("temporary failure"));
  try {
    garbage.schedule(database);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(database);
  } finally {
    await garbage.close();
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("resolves at once when nothing was requested", async () => {
  const { garbage, run } = fixture();
  await garbage.idle();
  await garbage.close();
  expect(run).not.toHaveBeenCalled();
});

it("does not restart a request that was left over when the sweep ended after closing", async () => {
  vi.useFakeTimers();
  const { garbage, run } = fixture();
  let release: () => void = () => {};
  run.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  garbage.schedule(database);
  await vi.advanceTimersByTimeAsync(1000);
  garbage.schedule(database);
  const closing = garbage.close();
  release();
  await closing;
  await garbage.idle();
  expect(run).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
