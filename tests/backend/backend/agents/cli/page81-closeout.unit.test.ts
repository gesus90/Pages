import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { closeCliSession } from "@/backend/agents/cli/CliSessionCloseout";

import { deferred } from "../../service/agents/page81-resource-fixture";

import type { CliSessionExit } from "@/backend/agents/cli/CliSessionProcess";

const scan = vi.hoisted(() => ({
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => scan);

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
  expect(scan.endTaggedProcesses).toHaveBeenCalledExactlyOnceWith("session");
  expect(vi.getTimerCount()).toBe(0);
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
