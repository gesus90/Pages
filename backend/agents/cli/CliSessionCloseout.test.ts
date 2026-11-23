import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { closeCliSession } from "./CliSessionCloseout";

import type { CliSessionExit, CliSessionProcess } from "./CliSessionProcess";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
  endTaggedProcesses: vi.fn(),
  readServerScope: vi.fn(),
  settleWorkerUnits: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({ logEvent: mocks.logEvent }));
vi.mock("./CliProcessScan", () => ({
  endTaggedProcesses: mocks.endTaggedProcesses,
  readServerScope: mocks.readServerScope,
}));
vi.mock("./CliWorkerUnit", () => ({
  settleWorkerUnits: mocks.settleWorkerUnits,
}));

type Closable = Pick<CliSessionProcess, "endInput" | "exited" | "cancel">;

const exit: CliSessionExit = {
  code: 0,
  signal: null,
  errorCode: null,
  stderrTail: "",
};

function fake(exited: Promise<CliSessionExit>): Closable {
  return { endInput: vi.fn(), cancel: vi.fn(), exited };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

it("confirms a pid namespace after the runner ended by itself", async () => {
  const process = fake(Promise.resolve(exit));
  await expect(
    closeCliSession(process, "tag", undefined, "pid_namespace"),
  ).resolves.toEqual({
    exit: { code: 0, signal: null },
    endedAt: "2026-01-01T00:00:00.000Z",
    leftovers: 0,
    isConfirmed: true,
    containment: "pid_namespace",
  });
  expect(process.endInput).toHaveBeenCalled();
  expect(process.cancel).not.toHaveBeenCalled();
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: "info" }),
  );
});

it("reports the units left by a worker unit session", async () => {
  mocks.settleWorkerUnits.mockResolvedValue(2);
  const result = await closeCliSession(
    fake(Promise.resolve(exit)),
    "tag",
    undefined,
    "worker_unit",
  );
  expect(result).toMatchObject({ leftovers: 2, isConfirmed: false });
  expect(result).not.toHaveProperty("containment");
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: "warn" }),
  );
});

it("confirms a worker unit session without leftovers", async () => {
  mocks.settleWorkerUnits.mockResolvedValue(0);
  const result = await closeCliSession(
    fake(Promise.resolve(exit)),
    "tag",
    undefined,
    "worker_unit",
  );
  expect(result).toMatchObject({ leftovers: 0, isConfirmed: true });
  expect(result).not.toHaveProperty("containment");
});

it("passes a given scope to the tag cleanup", async () => {
  const scope = { earliestStart: 5 };
  mocks.endTaggedProcesses.mockResolvedValue({ found: 1, remaining: 0 });
  const result = await closeCliSession(
    fake(Promise.resolve(exit)),
    "tag",
    scope,
  );
  expect(mocks.endTaggedProcesses).toHaveBeenCalledWith("tag", scope);
  expect(mocks.readServerScope).not.toHaveBeenCalled();
  expect(result).toMatchObject({ leftovers: 1, isConfirmed: true });
});

it("reads the server scope when none is given", async () => {
  const scope = { earliestStart: 9 };
  mocks.readServerScope.mockResolvedValue(scope);
  mocks.endTaggedProcesses.mockResolvedValue({ found: 0, remaining: 3 });
  const result = await closeCliSession(fake(Promise.resolve(exit)), "tag");
  expect(mocks.endTaggedProcesses).toHaveBeenCalledWith("tag", scope);
  expect(result.isConfirmed).toBe(false);
});

it("rejects when the unverified tag cleanup throws", async () => {
  mocks.readServerScope.mockResolvedValue({ earliestStart: 1 });
  mocks.endTaggedProcesses.mockRejectedValue(new Error("unverified"));
  await expect(
    closeCliSession(fake(Promise.resolve(exit)), "tag"),
  ).rejects.toThrow("unverified");
});

it("cancels a runner that outlives the grace period and waits for it", async () => {
  let finish: (value: CliSessionExit) => void = () => undefined;
  const process = fake(
    new Promise<CliSessionExit>((resolve) => {
      finish = resolve;
    }),
  );
  const closing = closeCliSession(process, "tag", undefined, "pid_namespace");
  await vi.advanceTimersByTimeAsync(15_000);
  expect(process.cancel).toHaveBeenCalledWith("login_cancelled");
  finish({ code: null, signal: "SIGTERM", errorCode: null, stderrTail: "" });
  await expect(closing).resolves.toMatchObject({
    exit: { code: null, signal: "SIGTERM" },
    isConfirmed: true,
  });
});

it("reports no exit when the runner ignores termination", async () => {
  const process = fake(new Promise<CliSessionExit>(() => undefined));
  const closing = closeCliSession(process, "tag", undefined, "pid_namespace");
  await vi.advanceTimersByTimeAsync(25_000);
  const result = await closing;
  expect(result).toMatchObject({ exit: null, isConfirmed: false });
  expect(mocks.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: "warn" }),
  );
});

it("does not confirm a failed credential cleanup", async () => {
  const failed: CliSessionExit = {
    code: 0,
    signal: null,
    errorCode: "credential_cleanup_failed",
    stderrTail: "",
  };
  const result = await closeCliSession(
    fake(Promise.resolve(failed)),
    "tag",
    undefined,
    "pid_namespace",
  );
  expect(result).toMatchObject({ isConfirmed: false });
  expect(result).not.toHaveProperty("containment");
});
