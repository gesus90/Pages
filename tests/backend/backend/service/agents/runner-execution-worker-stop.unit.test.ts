import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  installWorkerHooks,
  mocks,
  state,
  runWorker,
  storedResult,
} from "./runner-execution-worker-harness";

installWorkerHooks();

it.each([
  [
    "an event limit",
    Object.assign(new Error("e"), { reason: "event_limit" }),
    {
      reason: "event_limit",
    },
  ],
  [
    "a protocol violation",
    Object.assign(new Error("p"), { reason: "protocol" }),
    {
      reason: "protocol",
    },
  ],
  [
    "an output limit",
    Object.assign(new Error("o"), { reason: "output_limit" }),
    {
      reason: "output_limit",
    },
  ],
  [
    "a result limit",
    Object.assign(new Error("r"), { reason: "result_limit" }),
    {
      reason: "result_limit",
    },
  ],
  ["a type error", new TypeError("bad"), { reason: "protocol" }],
  [
    "a full disk",
    Object.assign(new Error("d"), { code: "ENOSPC" }),
    {
      reason: "storage",
      storageError: "ENOSPC",
    },
  ],
  [
    "an unknown storage error",
    new Error("x"),
    {
      reason: "storage",
      storageError: "journal_write_failed",
    },
  ],
])(
  "stops the process tree on %s of the output",
  async (label, error, expected) => {
    await runWorker({
      exit: null,
      closeOnStop: true,
      onInput: ({ output }) => output.emit("error", error),
    });

    const children0 = state.children[0];
    expect(children0.stdout.destroy).toHaveBeenCalled();
    expect(children0.stderr.destroy).toHaveBeenCalled();
    expect(await storedResult()).toMatchObject({
      status: "failed",
      result: { ...expected, closeout: "confirmed" },
    });
  },
);

it("reports a process that could not be spawned", async () => {
  await runWorker({
    exit: null,
    onInput: ({ child }) => child.emit("error", new Error("EAGAIN")),
  });

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { exitCode: null, signal: null, reason: "spawn" },
  });
});

it("stops the process when its input pipe breaks", async () => {
  await runWorker({
    exit: null,
    closeOnStop: true,
    onInput: ({ child }) => child.stdin.emit("error", new Error("EPIPE")),
  });

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { reason: "spawn" },
  });
});

it("remembers a failing closeout of the stop and still ends the job", async () => {
  let calls = 0;
  mocks.cleanup.mockImplementation(async () => {
    calls += 1;
    for (const child of state.children) child.emit("close", null, "SIGTERM");
    if (calls === 1) throw new Error("kill failed");
    return "confirmed";
  });

  await runWorker({
    exit: null,
    onInput: ({ output }) => output.emit("error", new Error("boom")),
  });

  expect((await storedResult()).status).toBe("failed");
});

it("does not record a child identity when the process has no id", async () => {
  await runWorker({ pid: null });

  await expect(
    readFile(path.join(state.folder, "child.json")),
  ).rejects.toThrow();
  expect((await storedResult()).status).toBe("completed");
});

it("ends the job as cancelled when a stop was recorded before the launch", async () => {
  mocks.cancellationFor.mockResolvedValue({ reason: "stop" });

  await runWorker();

  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(await storedResult()).toMatchObject({
    status: "interrupted",
    result: { reason: "cancelled", output: null, closeout: "confirmed" },
  });
});

it("ends the job as cancelled when the execution lease is gone", async () => {
  mocks.hasExecutionLease.mockResolvedValue(false);

  await runWorker();

  expect(mocks.spawn).not.toHaveBeenCalled();
  expect((await storedResult()).status).toBe("interrupted");
});

it("stops a running script when the timeout elapses", async () => {
  // The clock is polled so that paused time does not count; it needs a faked Date.
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
  });

  await runWorker({
    exit: null,
    closeOnStop: true,
    onInput: () => vi.advanceTimersByTime(5100),
  });

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { reason: "timeout", closeout: "confirmed" },
  });
});

it("stops a running script when a stop is recorded while it runs", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  mocks.cancellationFor
    .mockResolvedValueOnce(null)
    .mockResolvedValue({ reason: "stop" });

  await runWorker({
    exit: null,
    closeOnStop: true,
    onInput: () => {
      // The second tick finds the first read still busy and does nothing.
      vi.advanceTimersByTime(250);
      vi.advanceTimersByTime(250);
    },
  });

  expect(await storedResult()).toMatchObject({
    status: "interrupted",
    result: { reason: "cancelled" },
  });
});

it("stops a running script when the lease expires or cannot be read", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  mocks.hasExecutionLease.mockResolvedValueOnce(true).mockResolvedValue(false);

  await runWorker({
    exit: null,
    closeOnStop: true,
    onInput: () => vi.advanceTimersByTime(250),
  });

  expect((await storedResult()).status).toBe("interrupted");
});

it("stops a running script when reading the stop record fails", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  mocks.cancellationFor
    .mockResolvedValueOnce(null)
    .mockRejectedValue(new Error("mismatch"));

  await runWorker({
    exit: null,
    closeOnStop: true,
    onInput: () => vi.advanceTimersByTime(250),
  });

  expect((await storedResult()).result.reason).toBe("cancelled");
});

it("records progress while a script runs and fails when it cannot be stored", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await mkdir(path.join(state.folder, "progress.json"));

  await runWorker({
    exit: null,
    closeOnStop: true,
    // The progress timer starts after the input was written.
    onInput: () => setImmediate(() => vi.advanceTimersByTime(1000)),
  });

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { reason: "storage", storageError: "journal_write_failed" },
  });
});

it("writes the progress marker of a running job", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

  await runWorker({
    onInput: () => setImmediate(() => vi.advanceTimersByTime(1000)),
  });

  expect(
    JSON.parse(
      await readFile(path.join(state.folder, "progress.json"), "utf8"),
    ),
  ).toEqual({ output: null, closeout: "pending" });
  expect((await storedResult()).status).toBe("completed");
});
