import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LocalFinishedSessions } from "@/backend/agents/local/LocalFinishedSessions";

import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";

const logging = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => logging);

function entry(instanceId: string): LocalSessionEntry {
  return {
    instanceId,
    instanceKey: "key",
    runId: "run",
    stepId: "step",
    attemptId: "attempt",
    manifestDigest: "digest",
    proof: null,
    acknowledgedSequence: 0,
    acknowledgedDigest: "",
    checkpointFile: null,
    releasedAt: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  logging.logCaughtError.mockClear();
  logging.logEvent.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

it("waits for settlement and releases ownership afterwards", async () => {
  const settle = vi.fn(async () => undefined);
  const finished = new LocalFinishedSessions(settle);
  await finished.start([entry("a"), entry("b")]);
  expect(settle).toHaveBeenCalledTimes(2);
  expect(finished.has("a")).toBe(false);
  expect(logging.logEvent).not.toHaveBeenCalled();
});

it("logs a failed settlement and still releases it", async () => {
  const failure = new Error("cleanup");
  const finished = new LocalFinishedSessions(async () => {
    throw failure;
  });
  await finished.start([entry("a")]);
  expect(logging.logCaughtError).toHaveBeenCalledWith("LocalSessions", failure);
  expect(finished.has("a")).toBe(false);
});

it("stops waiting after the startup budget but keeps ownership", async () => {
  let release: () => void = () => undefined;
  const settle = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const finished = new LocalFinishedSessions(settle);
  const started = finished.start([entry("a")]);
  await vi.advanceTimersByTimeAsync(5_000);
  await started;
  expect(logging.logEvent).toHaveBeenCalledOnce();
  expect(finished.has("a")).toBe(true);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(finished.has("a")).toBe(false);
});

it("reuses a settlement that is still running", async () => {
  let release: () => void = () => undefined;
  const settle = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const finished = new LocalFinishedSessions(settle);
  const first = finished.start([entry("a")]);
  const second = finished.start([entry("a")]);
  release();
  await Promise.all([first, second]);
  expect(settle).toHaveBeenCalledOnce();
});
