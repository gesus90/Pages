import { afterEach, expect, it, vi } from "vitest";

import { CliPausableDeadline } from "@/backend/agents/cli/CliPausableDeadline";
import { setNamespacePaused } from "@/backend/agents/cli/CliNamespacePause";
import { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";

import { fakeChild } from "./fake-child-process";

const boundary = vi.hoisted(() => ({
  pause: vi.fn(async () => undefined),
  capture: vi.fn(async () => ({
    pid: 42,
    start: 1,
    uid: 1000,
    boot: "test-boot",
  })),
}));
vi.mock("@/backend/agents/cli/CliNamespacePause", () => ({
  setNamespacePaused: boundary.pause,
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  captureOwnedNamespace: boundary.capture,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("retains the remaining timeout through repeated pauses and closes permanently", async () => {
  vi.useFakeTimers();
  const expire = vi.fn();
  const deadline = new CliPausableDeadline(1000, expire);
  await vi.advanceTimersByTimeAsync(250);
  deadline.pause();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(expire).not.toHaveBeenCalled();
  deadline.resume();
  await vi.advanceTimersByTimeAsync(250);
  deadline.pause();
  deadline.resume();
  await vi.advanceTimersByTimeAsync(499);
  expect(expire).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(expire).toHaveBeenCalledOnce();
  deadline.close();
  deadline.resume();
  await vi.advanceTimersByTimeAsync(1000);
  expect(expire).toHaveBeenCalledOnce();
});

it("stops a frozen adapter with SIGKILL on the first cancellation and retains its pipes during pause", async () => {
  vi.useFakeTimers();
  const fake = fakeChild();
  const signalGroup = vi.fn();
  const process = new CliSessionProcess(
    fake.child,
    {
      timeoutMs: 1000,
      signal: new AbortController().signal,
      onLine: () => undefined,
    },
    signalGroup,
  );
  await process.setPaused(true);
  expect(setNamespacePaused).toHaveBeenCalledWith(
    expect.objectContaining({ pid: 42 }),
    true,
  );
  expect(fake.stdin.writable).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(signalGroup).not.toHaveBeenCalled();
  process.cancel("login_cancelled");
  expect(signalGroup).toHaveBeenCalledWith(-77, "SIGKILL");
  fake.child.emit("close", null, "SIGKILL");
  await process.exited;
});

it("kills a running Codex process frame on the first Stop without a graceful wait", async () => {
  const fake = fakeChild();
  const signalGroup = vi.fn();
  const session = new CliSessionProcess(
    fake.child,
    {
      timeoutMs: 0,
      provider: "codex_cli",
      signal: new AbortController().signal,
      onLine: () => undefined,
    },
    signalGroup,
  );
  session.cancel("login_cancelled");
  expect(signalGroup).toHaveBeenCalledExactlyOnceWith(-77, "SIGKILL");
  fake.child.emit("close", null, "SIGKILL");
  await session.exited;
});
