import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { closeCliSession } from "@/backend/agents/cli/CliSessionCloseout";

import { deferred } from "../../service/agents/page81-resource-fixture";

import type { CliSessionExit } from "@/backend/agents/cli/CliSessionProcess";

const scan = vi.hoisted(() => ({
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
  readServerScope: vi.fn(async () => ({ earliestStart: 4_200 })),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => scan);
const units = vi.hoisted(() => ({
  settleWorkerUnits: vi.fn(async () => 0),
}));
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => units);

beforeEach(() => {
  vi.useFakeTimers();
  scan.endTaggedProcesses
    .mockReset()
    .mockResolvedValue({ found: 0, remaining: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

it("waits for actual exit and descendant cleanup before confirming closeout", async () => {
  const exited = deferred<CliSessionExit>();
  const process = {
    exited: exited.promise,
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  const cleanup = deferred<{ found: number; remaining: number }>();
  scan.endTaggedProcesses.mockReturnValueOnce(cleanup.promise);
  const pending = closeCliSession(process, "session");
  await vi.advanceTimersByTimeAsync(15000);
  expect(process.cancel).toHaveBeenCalledExactlyOnceWith("login_cancelled");
  exited.resolve({ code: 0, signal: null, errorCode: null, stderrTail: "" });
  await vi.advanceTimersByTimeAsync(0);
  let hasClosed = false;
  void pending.then(() => {
    hasClosed = true;
  });
  expect(hasClosed).toBe(false);
  cleanup.resolve({ found: 2, remaining: 0 });
  expect(await pending).toMatchObject({ isConfirmed: true, leftovers: 2 });
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds an unresponsive exit and keeps it unconfirmed even when no tagged helpers were found", async () => {
  const process = {
    exited: new Promise<CliSessionExit>(() => {}),
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  const pending = closeCliSession(process, "session");
  await vi.advanceTimersByTimeAsync(25000);
  expect(await pending).toMatchObject({ exit: null, isConfirmed: false });
  // The server started the session, so no process older than the server can carry its tag.
  expect(scan.endTaggedProcesses).toHaveBeenCalledExactlyOnceWith("session", {
    earliestStart: 4_200,
  });
  expect(vi.getTimerCount()).toBe(0);
});

it("never confirms a closeout when the start of the server is unknown", async () => {
  scan.readServerScope.mockRejectedValueOnce(new Error("no start time"));
  const process = {
    exited: Promise.resolve({
      code: 0,
      signal: null,
      errorCode: null,
      stderrTail: "",
    }),
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  await expect(closeCliSession(process, "session")).rejects.toThrow(
    "no start time",
  );
  expect(scan.endTaggedProcesses).not.toHaveBeenCalled();
});

it("never treats a failed process scan as confirmed cleanup", async () => {
  scan.endTaggedProcesses.mockRejectedValueOnce(new Error("unreadable proc"));
  const process = {
    exited: Promise.resolve({
      code: 0,
      signal: null,
      errorCode: null,
      stderrTail: "",
    }),
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  await expect(closeCliSession(process, "session")).rejects.toThrow(
    "unreadable proc",
  );
});

it("confirms an owned PID namespace without inspecting unrelated process environments", async () => {
  const process = {
    exited: Promise.resolve({
      code: 0,
      signal: null,
      errorCode: null,
      stderrTail: "",
    }),
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  await expect(
    closeCliSession(process, "session", undefined, "pid_namespace"),
  ).resolves.toMatchObject({
    isConfirmed: true,
    leftovers: 0,
    containment: "pid_namespace",
  });
  expect(scan.endTaggedProcesses).not.toHaveBeenCalled();
});

it("does not confirm namespace cleanup when its worker unit could not settle", async () => {
  const process = {
    exited: Promise.resolve({
      code: 0,
      signal: null,
      errorCode: "credential_cleanup_failed" as const,
      stderrTail: "",
    }),
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  const closed = await closeCliSession(
    process,
    "session",
    undefined,
    "pid_namespace",
  );
  expect(closed.isConfirmed).toBe(false);
  expect(closed.containment).toBeUndefined();
  expect(scan.endTaggedProcesses).not.toHaveBeenCalled();
});

it("confirms an unisolated YOLO session through its settled worker unit instead of the legacy scan (PAGE-340)", async () => {
  const process = {
    exited: Promise.resolve({
      code: 0,
      signal: null,
      errorCode: null,
      stderrTail: "",
    }),
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  scan.endTaggedProcesses.mockRejectedValue(
    new Error("Process ownership is unverified for legacy session session"),
  );

  const closed = await closeCliSession(
    process,
    "session",
    undefined,
    "worker_unit",
  );

  expect(closed).toMatchObject({ isConfirmed: true, leftovers: 0 });
  // Only a PID namespace is recorded as such; the unit frame is not one.
  expect(closed.containment).toBeUndefined();
  expect(scan.endTaggedProcesses).not.toHaveBeenCalled();
});

it.each([
  ["a unit that did not settle", "credential_cleanup_failed" as const, 0],
  ["no exit within the grace periods", null, null],
])(
  "keeps a worker-unit closeout unconfirmed for %s",
  async (caseText, errorCode, code) => {
    const process = {
      exited:
        code === null
          ? new Promise<CliSessionExit>(() => {})
          : Promise.resolve({ code, signal: null, errorCode, stderrTail: "" }),
      endInput: vi.fn(),
      cancel: vi.fn(),
    };
    const pending = closeCliSession(
      process,
      "session",
      undefined,
      "worker_unit",
    );
    await vi.advanceTimersByTimeAsync(25000);

    expect((await pending).isConfirmed).toBe(false);
    expect(scan.endTaggedProcesses).not.toHaveBeenCalled();
  },
);

it("confirms a unit-contained chat once its exit is known and none of its units runs (PAGE-335)", async () => {
  const process = {
    exited: Promise.resolve({
      code: 0,
      signal: null,
      errorCode: null,
      stderrTail: "",
    }),
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  units.settleWorkerUnits.mockResolvedValueOnce(0);
  const closed = await closeCliSession(
    process,
    "chat-session",
    undefined,
    "worker_unit",
  );
  expect(closed).toMatchObject({ isConfirmed: true, leftovers: 0 });
  expect(closed.containment).toBeUndefined();
  expect(units.settleWorkerUnits).toHaveBeenCalledWith("chat-session");
  expect(scan.endTaggedProcesses).not.toHaveBeenCalled();
});

it("keeps a unit-contained chat unconfirmed while one of its units still runs (PAGE-335)", async () => {
  const process = {
    exited: Promise.resolve({
      code: 0,
      signal: null,
      errorCode: null,
      stderrTail: "",
    }),
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  units.settleWorkerUnits.mockResolvedValueOnce(1);
  const closed = await closeCliSession(
    process,
    "chat-session",
    undefined,
    "worker_unit",
  );
  expect(closed).toMatchObject({ isConfirmed: false, leftovers: 1 });
});
