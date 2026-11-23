import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
  record: vi.fn(),
  threshold: vi.fn(() => 100),
}));
vi.mock("@/backend/logging/Logger", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/backend/logging/DatabaseLogMetrics", () => ({
  recordDatabaseLogMetrics: mocks.record,
}));
vi.mock("@/backend/logging/LogTiming", () => ({
  readSlowOperationThresholdMs: mocks.threshold,
}));

import {
  readDatabaseStats,
  recordDatabaseQuery,
  resetDatabaseStats,
} from "@/backend/database/DatabaseStats";

beforeEach(() => {
  resetDatabaseStats();
  mocks.threshold.mockReturnValue(100);
});

it("counts fast statements without a warning", () => {
  recordDatabaseQuery(" select 1", 5);
  expect(readDatabaseStats()).toEqual({ queries: 1, totalMs: 5 });
  expect(mocks.record).toHaveBeenCalledWith("SELECT", expect.any(String), 5);
  expect(mocks.logEvent).not.toHaveBeenCalled();
  resetDatabaseStats();
  expect(readDatabaseStats()).toEqual({ queries: 0, totalMs: 0 });
});

it("classifies unknown statements as OTHER", () => {
  recordDatabaseQuery("EXPLAIN x", 1);
  expect(mocks.record).toHaveBeenCalledWith("OTHER", expect.any(String), 1);
});

it("warns about a slow statement without a breakdown", () => {
  recordDatabaseQuery("DELETE FROM t", 150);
  const call = mocks.logEvent.mock.calls[0]?.[0] as {
    metadata: Record<string, unknown>;
  };
  expect(call.metadata).toMatchObject({ operation: "DELETE", durationMs: 150 });
  expect(call.metadata.statementId).toMatch(/^[0-9a-f]{16}$/u);
});

it.each([
  [null, null, null],
  [10, null, null],
  [10, 5, true],
  [10, 20, false],
])("describes a breakdown with wal %s -> %s", (before, after, checkpointed) => {
  recordDatabaseQuery("COMMIT", 150, {
    role: "writer",
    workerWaitMs: 1.4,
    ipcMs: 2.6,
    walBytesBefore: before,
    walBytesAfter: after,
  });
  const call = mocks.logEvent.mock.calls[0]?.[0] as {
    metadata: Record<string, unknown>;
  };
  expect(call.metadata).toMatchObject({
    role: "writer",
    workerWaitMs: 1,
    ipcMs: 3,
    checkpointed,
  });
});
