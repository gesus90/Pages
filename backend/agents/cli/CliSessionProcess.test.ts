import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLI_LINE_LIMIT_BYTES,
  CliSessionProcess,
} from "@/backend/agents/cli/CliSessionProcess";

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
  stdin: PassThrough | undefined;
  stdout: PassThrough | undefined;
  stderr: PassThrough | undefined;
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

interface Started {
  readonly child: FakeChild;
  readonly session: CliSessionProcess;
  readonly signalGroup: ReturnType<typeof vi.fn>;
  readonly lines: string[];
  readonly controller: AbortController;
}

function start(
  options: {
    child?: FakeChild;
    callbacks?: Partial<CliSessionCallbacks>;
    controller?: AbortController;
  } = {},
): Started {
  const child = options.child ?? fakeChild();
  const controller = options.controller ?? new AbortController();
  const signalGroup = vi.fn();
  const lines: string[] = [];
  const session = new CliSessionProcess(
    child as unknown as ChildProcess,
    {
      timeoutMs: 60_000,
      signal: controller.signal,
      onLine: (line) => {
        lines.push(line);
      },
      ...options.callbacks,
    },
    signalGroup,
  );
  return { child, session, signalGroup, lines, controller };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function emitData(child: FakeChild, chunk: string): void {
  child.stdout?.emit("data", chunk);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("construction", () => {
  it("logs the start and exposes the process id", () => {
    const { session } = start();
    expect(session.processId).toBe(4242);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "cli.process.started" }),
    );
  });

  it("reports no process id without a pid", () => {
    const { session } = start({ child: fakeChild({ pid: undefined }) });
    expect(session.processId).toBeNull();
  });

  it("works for a child without standard streams", async () => {
    const { session, child } = start({
      child: fakeChild({
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
      }),
    });
    expect(session.write("x")).toBe(false);
    await expect(session.writeAsync("x")).resolves.toBe(false);
    session.endInput();
    child.emit("close", 0, null);
    await expect(session.exited).resolves.toMatchObject({ code: 0 });
  });

  it("cancels at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { session, signalGroup } = start({ controller });
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(session.processId).toBe(4242);
  });

  it("maps a timeout abort to check_timeout", async () => {
    const controller = new AbortController();
    const { session, child, signalGroup } = start({ controller });
    controller.abort(new DOMException("late", "TimeoutError"));
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGKILL");
    child.emit("close", null, "SIGKILL");
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "check_timeout",
    });
  });

  it("maps another abort reason to login_cancelled", async () => {
    const controller = new AbortController();
    const { session, child } = start({ controller });
    controller.abort(new DOMException("other", "AbortError"));
    child.emit("close", null, "SIGTERM");
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "login_cancelled",
    });
  });

  it("maps a non-exception abort reason to login_cancelled", async () => {
    const controller = new AbortController();
    const { session, child } = start({ controller });
    controller.abort("because");
    child.emit("close", null, null);
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "login_cancelled",
    });
  });
});

describe("process end", () => {
  it("reports a spawn error as cli_not_executable", async () => {
    const { session, child } = start();
    child.emit("error", new Error("ENOENT"));
    await expect(session.completed).resolves.toEqual({
      exitCode: null,
      stdout: "",
      stderr: "",
      errorCode: "cli_not_executable",
    });
  });

  it("keeps an earlier error code on a later spawn error", async () => {
    const { session, child } = start();
    session.cancel("login_cancelled");
    child.emit("error", new Error("late"));
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "login_cancelled",
    });
  });

  it("finishes after the grace period when only the exit arrives", async () => {
    const { session, child } = start();
    child.emit("exit", 3, null);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(session.exited).resolves.toMatchObject({ code: 3 });
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", event: "cli.process.exited" }),
    );
  });

  it("falls back to the exit values when close reports none", async () => {
    const { session, child } = start();
    child.emit("exit", 7, "SIGTERM");
    child.emit("close", null, null);
    await expect(session.exited).resolves.toMatchObject({
      code: 7,
      signal: "SIGTERM",
    });
  });

  it("prefers the close values and logs a clean exit as info", async () => {
    const { session, child } = start();
    child.emit("exit", 7, "SIGTERM");
    child.emit("close", 0, "SIGINT");
    await expect(session.exited).resolves.toMatchObject({
      code: 0,
      signal: "SIGINT",
    });
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", event: "cli.process.exited" }),
    );
  });

  it("finishes only once and clears the escalation timer", async () => {
    const { session, child, signalGroup } = start();
    session.cancel("login_cancelled");
    child.emit("close", 0, null);
    child.emit("error", new Error("late"));
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signalGroup).toHaveBeenCalledTimes(1);
    await expect(session.exited).resolves.toMatchObject({ code: 0 });
  });

  it("keeps the stderr tail of the last 16 KiB and reports it", async () => {
    const onStderr = vi.fn();
    const { session, child } = start({ callbacks: { onStderr } });
    child.stderr?.emit("data", "a".repeat(20_000));
    child.stderr?.emit("data", "tail");
    child.emit("close", 1, null);
    const exit = await session.exited;
    expect(exit.stderrTail).toHaveLength(16 * 1024);
    expect(exit.stderrTail.endsWith("tail")).toBe(true);
    expect(onStderr).toHaveBeenCalledTimes(2);
  });

  it("collects stderr without a listener", async () => {
    const { session, child } = start();
    child.stderr?.emit("data", "oops");
    child.emit("close", 1, null);
    await expect(session.exited).resolves.toMatchObject({
      stderrTail: "oops",
    });
  });

  it("ignores an input error of the runner", () => {
    const { child } = start();
    expect(() => child.stdin?.emit("error", new Error("EPIPE"))).not.toThrow();
  });
});

describe("output", () => {
  it("delivers complete lines in order and skips blank ones", async () => {
    const unit = unitHandle();
    const { child, lines } = start({ callbacks: { unit } });
    emitData(child, "one\n\n  \ntwo\nthr");
    await flush();
    emitData(child, "ee\n");
    await flush();
    expect(lines).toEqual(["one", "two", "three"]);
    expect(unit.started).toHaveBeenCalledTimes(2);
  });

  it("delivers the unterminated rest when the process ends", async () => {
    const { session, child, lines } = start();
    emitData(child, "first\nrest");
    await flush();
    child.emit("close", 0, null);
    await session.exited;
    expect(lines).toEqual(["first", "rest"]);
  });

  it("does not resume the output after the process finished", async () => {
    const { session, child } = start();
    const resume = vi.spyOn(child.stdout as PassThrough, "resume");
    emitData(child, "line\n");
    child.emit("close", 0, null);
    await session.exited;
    expect(resume).not.toHaveBeenCalled();
  });

  it("resumes the output after a delivered chunk", async () => {
    const { child } = start();
    const resume = vi.spyOn(child.stdout as PassThrough, "resume");
    emitData(child, "line\n");
    await flush();
    expect(resume).toHaveBeenCalled();
  });

  it("cancels with plan_history_unavailable when the line handler fails", async () => {
    const { session, child, signalGroup } = start({
      callbacks: {
        onLine: () => Promise.reject(new Error("history")),
      },
    });
    emitData(child, "line\n");
    await flush();
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGTERM");
    child.emit("close", null, "SIGTERM");
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "plan_history_unavailable",
    });
  });

  it("records plan_history_unavailable when the final line fails", async () => {
    let isFirst = true;
    const { session, child } = start({
      callbacks: {
        onLine: () => {
          if (isFirst) {
            isFirst = false;
            return;
          }
          throw new Error("history");
        },
      },
    });
    emitData(child, "ok\nrest");
    await flush();
    child.emit("close", 0, null);
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "plan_history_unavailable",
    });
  });

  it("keeps an earlier code when the final line fails", async () => {
    const { session, child } = start({
      callbacks: {
        onLine: () => {
          throw new Error("history");
        },
      },
    });
    session.cancel("login_cancelled");
    emitData(child, "rest");
    await flush();
    child.emit("close", 0, null);
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "login_cancelled",
    });
  });
});

describe("output limits", () => {
  it("ends the session on an oversized terminated line", async () => {
    const { session, child, lines } = start();
    emitData(child, `${"x".repeat(CLI_LINE_LIMIT_BYTES + 1)}\nafter\n`);
    await flush();
    emitData(child, "ignored\n");
    await flush();
    child.emit("close", null, "SIGTERM");
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "acp_output_overflow",
    });
    expect(lines).toEqual([]);
  });

  it("ends the session on an oversized unterminated line", async () => {
    const { session, child } = start();
    emitData(child, "x".repeat(CLI_LINE_LIMIT_BYTES + 1));
    await flush();
    child.emit("close", null, "SIGTERM");
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "acp_output_overflow",
    });
  });
});

describe("input", () => {
  it("writes lines to an open input", () => {
    const { session, child } = start();
    const write = vi.spyOn(child.stdin as PassThrough, "write");
    expect(session.write("hello")).toBe(true);
    expect(write).toHaveBeenCalledWith("hello\n");
  });

  it("refuses to write to a closed input or after the end", async () => {
    const { session, child } = start();
    child.stdin?.end();
    expect(session.write("x")).toBe(false);
    child.emit("close", 0, null);
    await session.exited;
    expect(session.write("x")).toBe(false);
    await expect(session.writeAsync("x")).resolves.toBe(false);
  });

  it("confirms an asynchronous write", async () => {
    const { session } = start();
    await expect(session.writeAsync("hello")).resolves.toBe(true);
  });

  it("reports a failed asynchronous write", async () => {
    const { session, child } = start();
    vi.spyOn(child.stdin as PassThrough, "write").mockImplementation(((
      line: string,
      callback: (error: Error | null) => void,
    ) => {
      callback(new Error("EPIPE"));
      return true;
    }) as never);
    await expect(session.writeAsync("hello")).resolves.toBe(false);
  });

  it("cancels on an oversized input line", async () => {
    const { session, child, signalGroup } = start();
    await expect(
      session.writeAsync("x".repeat(CLI_LINE_LIMIT_BYTES + 1)),
    ).resolves.toBe(false);
    expect(signalGroup).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "cli.process.input_overflow" }),
    );
    child.emit("close", null, "SIGTERM");
    await expect(session.exited).resolves.toMatchObject({
      errorCode: "acp_input_too_large",
    });
  });

  it("ends a writable input only", () => {
    const { session, child } = start();
    const end = vi.spyOn(child.stdin as PassThrough, "end");
    session.endInput();
    session.endInput();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
