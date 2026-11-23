import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliChildProcess } from "@/backend/agents/cli/CliChildProcess";

import type { ChildProcess } from "node:child_process";
import type { Mock } from "vitest";
import type {
  CliGroupSignal,
  CliRunRequest,
} from "@/backend/agents/cli/CliContracts";

const logging = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => logging);

class FakeChild extends EventEmitter {
  public pid: number | undefined = 4321;
  public stdin: PassThrough | null = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly kill = vi.fn();
}

function requestOf(overrides: Partial<CliRunRequest> = {}): CliRunRequest {
  return {
    file: "/synthetic/tool",
    arguments: [],
    provider: "codex_cli",
    home: { root: "/r", home: "/r/h", config: "/r/c", work: "/r/w" },
    timeoutMs: 10_000,
    stdin: "pipe",
    ...overrides,
  };
}

function start(
  request: CliRunRequest = requestOf(),
  child: FakeChild = new FakeChild(),
): {
  child: FakeChild;
  process: CliChildProcess;
  signalGroup: Mock<CliGroupSignal>;
} {
  const signalGroup = vi.fn();
  const process = new CliChildProcess(
    child as unknown as ChildProcess,
    request,
    signalGroup,
  );
  return { child, process, signalGroup };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("collects output and the exit code of a finished child", async () => {
  const onOutput = vi.fn();
  const child = new FakeChild();
  const written: string[] = [];
  child.stdin?.on("data", (chunk: Buffer) => written.push(String(chunk)));
  const { process } = start(requestOf({ onOutput, input: "hello" }), child);

  child.stdout.write("out");
  child.stderr.write("err");
  child.emit("close", 0);

  expect(await process.completed).toEqual({
    exitCode: 0,
    stdout: "out",
    stderr: "err",
    errorCode: null,
  });
  expect(onOutput).toHaveBeenLastCalledWith("out", "err");
  expect(written).toEqual(["hello"]);
  expect(process.processId).toBe(4321);
});

it("reports a missing process id", () => {
  const child = new FakeChild();
  child.pid = undefined;
  const { process } = start(requestOf(), child);

  expect(process.processId).toBeNull();
  process.cancel("check_timeout");
  expect(child.kill).not.toHaveBeenCalled();
});

it("works without pipes and ignores a missing input target", async () => {
  const child = new FakeChild();
  child.stdin = null;
  const { process } = start(requestOf({ input: "ignored" }), child);

  expect(process.write("code")).toBe(false);
  child.emit("close", null);
  expect((await process.completed).exitCode).toBeNull();
});

it("reports a spawn error as not executable", async () => {
  const { child, process } = start();

  child.emit("error", new Error("spawn failed"));

  expect(await process.completed).toMatchObject({
    errorCode: "cli_not_executable",
    exitCode: null,
  });
  expect(logging.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: "cli.command.failed" }),
  );
});

it("finishes only once when an error follows the close", async () => {
  const { child, process } = start();

  child.emit("close", 0);
  child.emit("error", new Error("late"));

  expect(await process.completed).toMatchObject({ exitCode: 0 });
});

it("keeps the cancellation code when an error follows a cancel", async () => {
  const { child, process } = start();

  process.cancel("login_code_rejected");
  child.emit("error", new Error("late"));
  child.emit("close", 1);
  vi.advanceTimersByTime(3_000);

  expect(await process.completed).toMatchObject({
    errorCode: "login_code_rejected",
  });
});

it("times out, terminates the group and then kills it", async () => {
  const { process, signalGroup } = start(requestOf({ timeoutMs: 50 }));

  vi.advanceTimersByTime(50);
  expect(signalGroup).toHaveBeenCalledWith(-4321, "SIGTERM");
  process.cancel("login_code_rejected");
  vi.advanceTimersByTime(3_000);

  expect(signalGroup).toHaveBeenCalledWith(-4321, "SIGKILL");
  expect(await process.completed).toMatchObject({ errorCode: "check_timeout" });
  process.cancel("check_timeout");
  expect(signalGroup).toHaveBeenCalledTimes(2);
});

it("cancels at once for an already aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  const { child, process, signalGroup } = start(
    requestOf({ signal: controller.signal }),
  );

  expect(signalGroup).toHaveBeenCalledWith(-4321, "SIGTERM");
  child.emit("close", null);
  vi.advanceTimersByTime(3_000);
  expect(await process.completed).toMatchObject({ errorCode: "check_timeout" });
});

it("cancels on a later abort and removes the listener at the end", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const { child, process, signalGroup } = start(
    requestOf({ signal: controller.signal }),
  );

  controller.abort();
  expect(signalGroup).toHaveBeenCalledWith(-4321, "SIGTERM");
  vi.advanceTimersByTime(3_000);
  child.emit("close", 143);

  await process.completed;
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

it("falls back to a direct signal when the group signal throws", () => {
  const { child, process, signalGroup } = start();
  signalGroup.mockImplementation(() => {
    throw new Error("no group");
  });

  process.cancel("check_timeout");

  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(logging.logCaughtError).toHaveBeenCalled();
});

it("cancels when the input pipe fails", () => {
  const { child, signalGroup } = start();

  child.stdin?.emit("error", new Error("EPIPE"));

  expect(signalGroup).toHaveBeenCalledWith(-4321, "SIGTERM");
});

it("writes a login code only to a live pipe", async () => {
  const { child, process } = start();
  const written: string[] = [];
  child.stdin?.on("data", (chunk: Buffer) => written.push(String(chunk)));

  expect(process.write("123")).toBe(true);
  expect(written).toEqual(["123\n"]);

  child.stdin?.destroy();
  expect(process.write("456")).toBe(false);
  child.emit("close", 0);
  await process.completed;
  expect(process.write("789")).toBe(false);
});

it("refuses a code while a cancellation is pending", () => {
  const { process } = start();

  process.cancel("check_timeout");

  expect(process.write("123")).toBe(false);
});

it("cancels when the pipe write throws", () => {
  const { child, process, signalGroup } = start();
  vi.spyOn(child.stdin as PassThrough, "write").mockImplementation(() => {
    throw new Error("closed");
  });

  expect(process.write("123")).toBe(false);
  expect(signalGroup).toHaveBeenCalledWith(-4321, "SIGTERM");
});

it("cancels a child whose output exceeds the limit", () => {
  const { child, signalGroup } = start(requestOf({ maxStdoutBytes: 4 }));

  child.stdout.write("12345");

  expect(signalGroup).toHaveBeenCalledWith(-4321, "SIGTERM");
});

it("applies the default limits and drops output after a cancellation", async () => {
  const onOutput = vi.fn();
  const { child, process } = start(requestOf({ onOutput }));

  child.stdout.write("x".repeat(256 * 1024));
  child.stderr.write("y".repeat(64 * 1024 + 1));
  child.stdout.write("late");
  vi.advanceTimersByTime(3_000);

  const result = await process.completed;
  expect(result.errorCode).toBe("cli_unexpected_output");
  expect(result.stdout).toHaveLength(256 * 1024);
  expect(result.stderr).toBe("");
});

it("cancels when the output observer throws", () => {
  const { child, signalGroup } = start(
    requestOf({
      onOutput: () => {
        throw new Error("observer");
      },
    }),
  );

  child.stdout.write("data");

  expect(signalGroup).toHaveBeenCalledWith(-4321, "SIGTERM");
});
