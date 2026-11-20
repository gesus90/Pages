import { expect, it, vi } from "vitest";

import { emitRunLog, registerRunLogSink } from "./RunLogSink";

import type { RunLogRecord } from "./RunLogSink";

const record: RunLogRecord = {
  runId: "run-1",
  stepId: "step-1",
  attemptId: "attempt-1",
  at: "2026-11-20T10:00:00.000Z",
  level: "info",
  source: "server",
  message: "Runner: started",
};

it("delivers a run line to every registered store", () => {
  const firstStore = vi.fn();
  const secondStore = vi.fn();
  const unregisterFirst = registerRunLogSink(firstStore);
  const unregisterSecond = registerRunLogSink(secondStore);

  emitRunLog(record);

  expect(firstStore).toHaveBeenCalledWith(record);
  expect(secondStore).toHaveBeenCalledWith(record);
  unregisterFirst();
  unregisterSecond();
});

it("keeps delivering to the other stores when one store fails", () => {
  const failingStore = vi.fn(() => {
    throw new Error("database unavailable");
  });
  const healthyStore = vi.fn();
  const unregisterFailing = registerRunLogSink(failingStore);
  const unregisterHealthy = registerRunLogSink(healthyStore);

  expect(() => {
    emitRunLog(record);
  }).not.toThrow();
  expect(healthyStore).toHaveBeenCalledWith(record);
  unregisterFailing();
  unregisterHealthy();
});

it("stops delivering to a store after its unregister function ran", () => {
  const store = vi.fn();
  const unregister = registerRunLogSink(store);

  unregister();
  emitRunLog(record);

  expect(store).not.toHaveBeenCalled();
});
