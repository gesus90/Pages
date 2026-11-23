import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";

import type { ChildProcess } from "node:child_process";
import type { CliSessionCallbacks } from "@/backend/agents/cli/CliSessionProcess";
import type {
  CliWorkerUnitHandle,
  CliWorkerUnitResult,
} from "@/backend/agents/cli/CliContracts";

const h = vi.hoisted(() => ({
  logEvent: vi.fn(),
  logCaught: vi.fn(),
  capture: vi.fn(),
  setPaused: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logEvent: h.logEvent,
  logCaughtError: h.logCaught,
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  captureOwnedNamespace: h.capture,
}));
vi.mock("@/backend/agents/cli/CliNamespacePause", () => ({
  setNamespacePaused: h.setPaused,
}));

interface FakeChild extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(parts: Partial<FakeChild> = {}): FakeChild {
  return Object.assign(
    new EventEmitter(),
    {
      pid: 4242,
      exitCode: null,
      signalCode: null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    },
    parts,
  );
}

function unitHandle(
  result: CliWorkerUnitResult | Error = "success",
): CliWorkerUnitHandle {
  return {
    name: "unit-1",
    signal: vi.fn(),
    started: vi.fn(),
    settle: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

function start(
  options: {
    child?: FakeChild;
    callbacks?: Partial<CliSessionCallbacks>;
  } = {},
): {
  readonly child: FakeChild;
  readonly session: CliSessionProcess;
  readonly signalGroup: ReturnType<typeof vi.fn>;
} {
  const child = options.child ?? fakeChild();
  const signalGroup = vi.fn();
  const session = new CliSessionProcess(
    child as unknown as ChildProcess,
    {
      timeoutMs: 60_000,
      signal: new AbortController().signal,
      onLine: () => {},
      ...options.callbacks,
    },
    signalGroup,
  );
  return { child, session, signalGroup };
}

beforeEach(() => {
  vi.useFakeTimers();
  h.capture.mockResolvedValue({ pid: 4242 });
  h.setPaused.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cancel", () => {
  it("terminates with SIGTERM and kills after the grace period", async () => {
    const { session, child, signalGroup } = start();
    session.cancel("login_cancelled");
    session.cancel("login_cancelled");
    expect(signalGroup).toHaveBeenCalledTimes(1);
    expect(signalGroup).toHaveBeenLastCalledWith(-4242, "SIGTERM");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(signalGroup).toHaveBeenLastCalledWith(-4242, "SIGKILL");
    child.emit("close", null, "SIGKILL");
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "login_cancelled",
    });
  });

  it("kills at once for a timeout", () => {
    const { session, signalGroup } = start();
    session.cancel("check_timeout");
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("kills at once for a Codex session", () => {
    const { session, signalGroup } = start({
      callbacks: { provider: "codex_cli" },
    });
    session.cancel("login_cancelled");
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("terminates a session of another provider", () => {
    const { session, signalGroup } = start({
      callbacks: { provider: "claude_code" },
    });
    session.cancel("login_cancelled");
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGTERM");
  });

  it("does nothing after the process finished", async () => {
    const { session, child, signalGroup } = start();
    child.emit("close", 0, null);
    await session.exited;
    session.cancel("login_cancelled");
    expect(signalGroup).not.toHaveBeenCalled();
  });

  it("expires through the deadline", async () => {
    const { signalGroup } = start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("resumes a suspended group before it ends it", () => {
    const { session, signalGroup } = start();
    expect(session.suspend()).toBe(true);
    session.cancel("login_cancelled");
    expect(signalGroup.mock.calls.map((call) => call[1])).toEqual([
      "SIGSTOP",
      "SIGCONT",
      "SIGTERM",
    ]);
  });

  it("kills a paused session", async () => {
    const { session, signalGroup } = start();
    await session.setPaused(true);
    session.cancel("login_cancelled");
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGKILL");
  });
});

describe("signals", () => {
  it("also signals through the unit", () => {
    const unit = unitHandle();
    const { session } = start({ callbacks: { unit } });
    session.cancel("login_cancelled");
    expect(unit.signal).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not signal a child that already exited", () => {
    const { session, signalGroup } = start({
      child: fakeChild({ exitCode: 0 }),
    });
    expect(session.suspend()).toBe(false);
    session.cancel("login_cancelled");
    expect(signalGroup).not.toHaveBeenCalled();
  });

  it("does not signal a child that ended by a signal", () => {
    const { session, signalGroup } = start({
      child: fakeChild({ signalCode: "SIGTERM" }),
    });
    expect(session.suspend()).toBe(false);
    expect(signalGroup).not.toHaveBeenCalled();
  });

  it("does not suspend a child without pid", () => {
    const { session } = start({ child: fakeChild({ pid: undefined }) });
    expect(session.suspend()).toBe(false);
    session.cancel("login_cancelled");
  });

  it("signals the child directly when the group is gone", () => {
    const { session, signalGroup, child } = start();
    signalGroup.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(session.suspend()).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGSTOP");
    expect(h.logCaught).toHaveBeenCalled();
  });

  it("does not suspend when no signal could be sent", () => {
    const { session, signalGroup, child } = start();
    signalGroup.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    child.kill.mockReturnValue(false);
    expect(session.suspend()).toBe(false);
  });
});

describe("suspend and resume", () => {
  it("suspends once and resumes once", () => {
    const { session, signalGroup } = start();
    expect(session.resume()).toBe(false);
    expect(session.suspend()).toBe(true);
    expect(session.suspend()).toBe(false);
    expect(session.resume()).toBe(true);
    expect(session.resume()).toBe(false);
    expect(signalGroup.mock.calls.map((call) => call[1])).toEqual([
      "SIGSTOP",
      "SIGCONT",
    ]);
  });

  it("keeps the session suspended when SIGCONT cannot be sent", () => {
    const { session, signalGroup, child } = start();
    session.suspend();
    signalGroup.mockImplementation(() => {
      throw new Error("ESRCH");
    });
    child.kill.mockReturnValue(false);
    expect(session.resume()).toBe(false);
  });

  it("does not resume a finished session", async () => {
    const { session, child } = start();
    session.suspend();
    child.emit("close", 0, null);
    await session.exited;
    expect(session.resume()).toBe(false);
  });

  it("pauses the deadline while suspended", async () => {
    const { session, signalGroup } = start();
    session.suspend();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(signalGroup).toHaveBeenCalledTimes(1);
    session.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signalGroup).toHaveBeenLastCalledWith(-4242, "SIGKILL");
  });
});

describe("setPaused", () => {
  it("pauses and resumes the namespace with the unit name", async () => {
    const unit = unitHandle();
    const { session } = start({ callbacks: { unit } });
    await session.setPaused(true);
    await session.setPaused(true);
    await session.setPaused(false);
    expect(h.capture).toHaveBeenCalledTimes(2);
    expect(h.setPaused).toHaveBeenNthCalledWith(
      1,
      { pid: 4242, unit: "unit-1" },
      true,
    );
    expect(h.setPaused).toHaveBeenNthCalledWith(
      2,
      { pid: 4242, unit: "unit-1" },
      false,
    );
  });

  it("omits the unit name without a unit", async () => {
    const { session } = start();
    await session.setPaused(true);
    expect(h.setPaused).toHaveBeenCalledWith({ pid: 4242 }, true);
  });

  it("does nothing for a finished or cancelled session", async () => {
    const first = start();
    first.child.emit("close", 0, null);
    await first.session.exited;
    await first.session.setPaused(true);
    const second = start();
    second.session.cancel("login_cancelled");
    await second.session.setPaused(true);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("fails without a process id", async () => {
    const { session } = start({ child: fakeChild({ pid: undefined }) });
    await expect(session.setPaused(true)).rejects.toThrow(
      "Session process unavailable",
    );
  });

  it("restores the deadline when pausing fails", async () => {
    h.setPaused.mockRejectedValue(new Error("freeze failed"));
    const { session, signalGroup } = start();
    await expect(session.setPaused(true)).rejects.toThrow("freeze failed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("keeps the pause state when resuming fails", async () => {
    const { session } = start();
    await session.setPaused(true);
    h.setPaused.mockRejectedValue(new Error("thaw failed"));
    await expect(session.setPaused(false)).rejects.toThrow("thaw failed");
    h.setPaused.mockResolvedValue(undefined);
    await session.setPaused(false);
    expect(h.setPaused).toHaveBeenCalledTimes(3);
  });
});

describe("unit settlement", () => {
  it.each([
    ["oom-kill", "acp_worker_limit"],
    ["resources", "acp_worker_limit"],
    ["timeout", "check_timeout"],
    ["success", null],
  ] as const)("maps the unit result %s to %s", async (result, code) => {
    const unit = unitHandle(result);
    const { session, child } = start({ callbacks: { unit } });
    child.emit("close", 0, null);
    await expect(session.exited).resolves.toMatchObject({ errorCode: code });
    expect(unit.settle).toHaveBeenCalledTimes(1);
  });

  it("keeps the decided error code over the unit result", async () => {
    const unit = unitHandle("oom-kill");
    const { session, child } = start({ callbacks: { unit } });
    session.cancel("login_cancelled");
    child.emit("close", null, "SIGTERM");
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "login_cancelled",
    });
  });

  it("reports credential_cleanup_failed when the unit cannot settle", async () => {
    const unit = unitHandle(new Error("settle failed"));
    const { session, child } = start({ callbacks: { unit } });
    child.emit("close", 0, null);
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "credential_cleanup_failed",
    });
    expect(h.logCaught).toHaveBeenCalled();
  });
});
