import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeAutomationScript } from "./AutomationScriptProcess";

import type * as Capture from "@/backend/service/agents/AgentPlanScriptCapture";
import type { AutomationScriptRequest } from "./AutomationScriptProcess";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  createScriptResources: vi.fn(),
  removeScriptResources: vi.fn(),
  scriptEnvironment: vi.fn(),
  logCaughtError: vi.fn(),
  isUnconfirmed: { value: false },
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));
vi.mock("@/backend/service/agents/AgentPlanScriptResources", () => ({
  createScriptResources: mocks.createScriptResources,
  removeScriptResources: mocks.removeScriptResources,
  scriptEnvironment: mocks.scriptEnvironment,
}));

vi.mock("@/backend/service/agents/AgentPlanScriptCapture", async () => {
  const actual = await vi.importActual<typeof Capture>(
    "@/backend/service/agents/AgentPlanScriptCapture",
  );
  return {
    AgentPlanScriptCapture: class extends actual.AgentPlanScriptCapture {
      /** Reports a script that never ended when asked to. */
      public override get isExited(): boolean {
        return mocks.isUnconfirmed.value ? false : super.isExited;
      }

      /** Reports an unconfirmed close when asked to. */
      public override async confirmClosed(): Promise<boolean> {
        return mocks.isUnconfirmed.value ? false : super.confirmClosed();
      }

      /** Drops the failure when asked to. */
      public override result(
        ...parameters: Parameters<
          typeof actual.AgentPlanScriptCapture.prototype.result
        >
      ): ReturnType<typeof actual.AgentPlanScriptCapture.prototype.result> {
        const record = super.result(...parameters);
        return mocks.isUnconfirmed.value
          ? { ...record, failure: null }
          : record;
      }
    },
  };
});

interface FakeChild extends EventEmitter {
  pid: number | undefined;
  stdin: PassThrough | null;
  stdout: PassThrough | null;
  stderr: PassThrough | null;
  stdio: unknown[];
  release: Writable | null;
}

interface ChildOptions {
  readonly pid?: number;
  readonly hasStreams?: boolean;
  readonly hasRelease?: boolean;
}

function fakeChild(options: ChildOptions = {}): FakeChild {
  const { pid = 4242, hasStreams = true, hasRelease = true } = options;
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdin = hasStreams ? new PassThrough() : null;
  child.stdout = hasStreams ? new PassThrough() : null;
  child.stderr = hasStreams ? new PassThrough() : null;
  child.release = hasRelease
    ? new Writable({ write: (...parameters) => parameters[2]() })
    : null;
  child.stdio = [child.stdin, child.stdout, child.stderr, child.release];
  return child;
}

function requestOf(
  overrides: Partial<AutomationScriptRequest> = {},
): AutomationScriptRequest {
  return {
    userId: "u1",
    program: "/usr/bin/node",
    directory: "/work",
    interpreterProfileId: "node",
    content: "console.log(1)",
    input: '{"a":1}',
    timeoutSeconds: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function useDeadGroup(): void {
  vi.spyOn(process, "kill").mockImplementation((...parameters) => {
    if (parameters[1] === 0) throw new Error("gone");
    return true;
  });
}

async function spawned(): Promise<void> {
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
}

function endNormally(child: FakeChild): void {
  child.emit("exit", 0, null);
  child.emit("close");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isUnconfirmed.value = false;
  mocks.createScriptResources.mockResolvedValue("/run/script");
  mocks.removeScriptResources.mockResolvedValue(undefined);
  mocks.scriptEnvironment.mockReturnValue({ BASE: "1" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("executeAutomationScript", () => {
  it("runs a script and returns its output", async () => {
    useDeadGroup();
    vi.stubEnv("XDG_RUNTIME_DIR", "/run/user/1");
    vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", "");
    const child = fakeChild();
    const stdinEnd = vi.spyOn(child.stdin as PassThrough, "end");
    const releaseEnd = vi.spyOn(child.release as Writable, "end");
    mocks.spawn.mockReturnValue(child);
    const pending = executeAutomationScript(requestOf());
    await spawned();
    child.stdout?.emit("data", Buffer.from("out"));
    child.stderr?.emit("data", Buffer.from("err"));
    endNormally(child);
    await expect(pending).resolves.toEqual({
      exitCode: 0,
      signal: null,
      failure: null,
      stdout: "out",
      stderr: "err",
    });
    expect(releaseEnd).toHaveBeenCalledWith("go\n");
    expect(stdinEnd).toHaveBeenCalledWith('{"a":1}', "utf8");
    const [program, args, options] = mocks.spawn.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string>; cwd: string; detached: boolean },
    ];
    expect(program).toBe("/bin/sh");
    expect(args.slice(-2)).toEqual(["/usr/bin/node", "/run/script/script.cjs"]);
    expect(options.cwd).toBe("/work");
    expect(options.detached).toBe(true);
    expect(options.env).toEqual({ BASE: "1", XDG_RUNTIME_DIR: "/run/user/1" });
    expect(mocks.removeScriptResources).toHaveBeenCalledOnce();
  });

  it("reports a failing exit code", async () => {
    useDeadGroup();
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = executeAutomationScript(requestOf());
    await spawned();
    child.emit("exit", 3, null);
    child.emit("close");
    await expect(pending).resolves.toMatchObject({
      exitCode: 3,
      failure: "exit",
    });
  });

  it("runs a child without standard streams", async () => {
    useDeadGroup();
    const child = fakeChild({ hasStreams: false });
    mocks.spawn.mockReturnValue(child);
    const pending = executeAutomationScript(requestOf());
    await spawned();
    endNormally(child);
    await expect(pending).resolves.toMatchObject({ failure: null });
  });

  it("refuses an aborted request before any work", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeAutomationScript(requestOf({ signal: controller.signal })),
    ).rejects.toThrow();
    expect(mocks.createScriptResources).not.toHaveBeenCalled();
  });
});

describe("executeAutomationScript endings", () => {
  it("cancels when the request is aborted while preparing", async () => {
    vi.useFakeTimers();
    useDeadGroup();
    const controller = new AbortController();
    mocks.createScriptResources.mockImplementation(async () => {
      controller.abort();
      return "/run/script";
    });
    mocks.spawn.mockReturnValue(fakeChild());
    const pending = executeAutomationScript(
      requestOf({ signal: controller.signal }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ failure: "cancelled" });
  });

  it("cancels when the request is aborted while running", async () => {
    vi.useFakeTimers();
    useDeadGroup();
    const controller = new AbortController();
    mocks.spawn.mockReturnValue(fakeChild());
    const pending = executeAutomationScript(
      requestOf({ signal: controller.signal }),
    );
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ failure: "cancelled" });
  });

  it("stops a script at its time limit and reports unconfirmed cleanup", async () => {
    vi.useFakeTimers();
    useDeadGroup();
    mocks.spawn.mockReturnValue(fakeChild());
    const pending = executeAutomationScript(requestOf());
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ failure: "timeout" });
  });

  it("reports an error of the release channel", async () => {
    vi.useFakeTimers();
    useDeadGroup();
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = executeAutomationScript(requestOf());
    await vi.advanceTimersByTimeAsync(10);
    child.release?.emit("error", new Error("pipe"));
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ failure: "io" });
  });

  it("fails when the child has no process id", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill");
    mocks.spawn.mockReturnValue(fakeChild({ pid: 0 }));
    const pending = executeAutomationScript(requestOf());
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ failure: "io" });
    expect(kill).not.toHaveBeenCalled();
  });

  it("fails when the release channel is missing", async () => {
    vi.useFakeTimers();
    useDeadGroup();
    mocks.spawn.mockReturnValue(fakeChild({ hasRelease: false }));
    const pending = executeAutomationScript(requestOf());
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ failure: "io" });
  });
});

describe("executeAutomationScript cleanup", () => {
  it("ignores a process group that already ended", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("gone");
    });
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = executeAutomationScript(requestOf());
    await spawned();
    endNormally(child);
    await expect(pending).resolves.toMatchObject({ failure: null });
  });

  it("kills a process group that outlives the grace period", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = executeAutomationScript(requestOf());
    await vi.advanceTimersByTimeAsync(10);
    endNormally(child);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ failure: null });
    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("logs a failed cleanup of the resources", async () => {
    useDeadGroup();
    const problem = new Error("cleanup");
    mocks.removeScriptResources.mockRejectedValue(problem);
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = executeAutomationScript(requestOf());
    await spawned();
    endNormally(child);
    await pending;
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "AutomationScriptProcess",
      problem,
    );
  });

  it("falls back to zero ids without user and group ids", async () => {
    useDeadGroup();
    const uid = Object.getOwnPropertyDescriptor(process, "getuid");
    const gid = Object.getOwnPropertyDescriptor(process, "getgid");
    Object.defineProperty(process, "getuid", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(process, "getgid", {
      value: undefined,
      configurable: true,
    });
    try {
      const child = fakeChild();
      mocks.spawn.mockReturnValue(child);
      const pending = executeAutomationScript(requestOf());
      await spawned();
      endNormally(child);
      await expect(pending).resolves.toMatchObject({ failure: null });
    } finally {
      if (uid) Object.defineProperty(process, "getuid", uid);
      if (gid) Object.defineProperty(process, "getgid", gid);
    }
  });

  it("reports unconfirmed cleanup when the script never ended", async () => {
    useDeadGroup();
    mocks.isUnconfirmed.value = true;
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    const pending = executeAutomationScript(requestOf());
    await spawned();
    endNormally(child);
    await expect(pending).resolves.toMatchObject({ failure: "cleanup" });
  });
});
