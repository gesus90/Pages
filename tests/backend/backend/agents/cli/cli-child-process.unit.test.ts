import { ChildProcess } from "node:child_process";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CliChildProcess } from "@/backend/agents/cli/CliChildProcess";

import { fakeChild } from "./fake-child-process";

import type { CliRunRequest } from "@/backend/agents/cli/CliContracts";
import type { FakeChild } from "./fake-child-process";

const logging = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => logging);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  logging.logCaughtError.mockReset();
  logging.logEvent.mockReset();
});

const REQUEST: CliRunRequest = {
  file: "/bin/codex",
  arguments: [],
  provider: "codex_cli",
  home: { root: "/r", home: "/r/home", config: "/r/config", work: "/r/work" },
  timeoutMs: 10_000,
  stdin: "pipe",
};

function start(
  fake: FakeChild,
  request: Partial<CliRunRequest> = {},
  signalGroup = vi.fn(),
): CliChildProcess {
  return new CliChildProcess(
    fake.child,
    { ...REQUEST, ...request },
    signalGroup,
  );
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

it("collects output, reports it and completes with the exit code", async () => {
  const fake = fakeChild();
  const onOutput = vi.fn();
  const running = start(fake, { onOutput });

  fake.stdout.write("out");
  fake.stderr.write("err");
  await flush();
  fake.child.emit("close", 0);

  await expect(running.completed).resolves.toEqual({
    exitCode: 0,
    stdout: "out",
    stderr: "err",
    errorCode: null,
  });
  expect(onOutput).toHaveBeenLastCalledWith("out", "err");
  expect(running.processId).toBe(77);
});

it("sends the input once through stdin and closes it", async () => {
  const fake = fakeChild();
  const received: string[] = [];
  fake.stdin.on("data", (chunk: Buffer) => received.push(chunk.toString()));

  start(fake, { input: "prompt" });
  await flush();

  expect(received).toEqual(["prompt"]);
  expect(fake.stdin.writableEnded).toBe(true);
});

it("ends the process group at the deadline and kills it after the grace time", async () => {
  const fake = fakeChild();
  const signalGroup = vi.fn();
  const running = start(fake, {}, signalGroup);

  await vi.advanceTimersByTimeAsync(10_000);
  expect(signalGroup).toHaveBeenCalledWith(-77, "SIGTERM");
  fake.child.emit("close", null);
  fake.stdout.write("late");
  await vi.advanceTimersByTimeAsync(3_000);

  expect(signalGroup).toHaveBeenLastCalledWith(-77, "SIGKILL");
  await expect(running.completed).resolves.toEqual({
    exitCode: null,
    stdout: "",
    stderr: "",
    errorCode: "check_timeout",
  });
});

it("stops at once when the request signal is already aborted", async () => {
  const signalGroup = vi.fn();
  start(fakeChild(), { signal: AbortSignal.abort() }, signalGroup);

  expect(signalGroup).toHaveBeenCalledWith(-77, "SIGTERM");
});

it("stops when the request signal aborts later and detaches after completion", async () => {
  const fake = fakeChild();
  const controller = new AbortController();
  const signalGroup = vi.fn();
  const running = start(fake, { signal: controller.signal }, signalGroup);

  controller.abort();
  expect(signalGroup).toHaveBeenCalledTimes(1);
  running.cancel("login_cancelled");
  expect(signalGroup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3_000);

  await expect(running.completed).resolves.toMatchObject({
    errorCode: "check_timeout",
  });
  running.cancel("login_cancelled");
  expect(signalGroup).toHaveBeenCalledTimes(2);
});

it("signals the child directly when its group is gone", async () => {
  const fake = fakeChild();
  const signalGroup = vi.fn(() => {
    throw new Error("ESRCH");
  });
  const running = start(fake, {}, signalGroup);

  running.cancel("login_cancelled");

  expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "CliChildProcess",
    expect.any(Error),
  );
});

it("sends no signal to a child without a process ID", async () => {
  const fake = fakeChild(null);
  const signalGroup = vi.fn();
  const running = start(fake, {}, signalGroup);

  running.cancel("login_cancelled");
  await vi.advanceTimersByTimeAsync(3_000);

  expect(signalGroup).not.toHaveBeenCalled();
  expect(running.processId).toBeNull();
  await expect(running.completed).resolves.toMatchObject({
    errorCode: "login_cancelled",
  });
});

it("reports a child that cannot be executed", async () => {
  const fake = fakeChild();
  const running = start(fake);

  fake.child.emit("error", new Error("ENOENT"));
  fake.child.emit("close", -2);

  await expect(running.completed).resolves.toMatchObject({
    exitCode: null,
    errorCode: "cli_not_executable",
  });
  expect(logging.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: "cli.command.failed" }),
  );
});

it("keeps the cancellation code when the child fails while it stops", async () => {
  const fake = fakeChild();
  const running = start(fake);

  running.cancel("login_cancelled");
  fake.child.emit("error", new Error("EPIPE"));
  await vi.advanceTimersByTimeAsync(3_000);

  await expect(running.completed).resolves.toMatchObject({
    errorCode: "login_cancelled",
  });
});

it("cancels when the input pipe fails", async () => {
  const fake = fakeChild();
  const signalGroup = vi.fn();
  start(fake, {}, signalGroup);

  fake.stdin.emit("error", new Error("EPIPE"));

  expect(signalGroup).toHaveBeenCalledWith(-77, "SIGTERM");
});

it("cancels output beyond the requested stdout limit", async () => {
  const fake = fakeChild();
  const running = start(fake, { maxStdoutBytes: 4 });

  fake.stdout.write("12345");
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);

  await expect(running.completed).resolves.toMatchObject({
    stdout: "",
    errorCode: "cli_unexpected_output",
  });
});

it("cancels diagnostics beyond the stderr limit", async () => {
  const fake = fakeChild();
  const running = start(fake);

  fake.stderr.write("e".repeat(64 * 1024 + 1));
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);

  await expect(running.completed).resolves.toMatchObject({
    errorCode: "cli_unexpected_output",
  });
});

it("cancels when the output callback fails", async () => {
  const fake = fakeChild();
  const running = start(fake, {
    onOutput: () => {
      throw new Error("observer failed");
    },
  });

  fake.stdout.write("x");
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);

  await expect(running.completed).resolves.toMatchObject({
    stdout: "x",
    errorCode: "cli_unexpected_output",
  });
});

it("writes a login code only to a live input", async () => {
  const fake = fakeChild();
  const received: string[] = [];
  fake.stdin.on("data", (chunk: Buffer) => received.push(chunk.toString()));
  const running = start(fake);

  expect(running.write("ABCD")).toBe(true);
  await flush();
  expect(received).toEqual(["ABCD\n"]);
  running.cancel("login_cancelled");
  expect(running.write("EFGH")).toBe(false);
});

it("refuses a login code after completion or without an input pipe", async () => {
  const fake = fakeChild();
  const running = start(fake);
  fake.child.emit("close", 0);
  await running.completed;

  expect(running.write("ABCD")).toBe(false);

  const closedInput = fakeChild();
  closedInput.stdin.destroy();
  expect(start(closedInput).write("ABCD")).toBe(false);
});

it("cancels when writing the login code throws", () => {
  const fake = fakeChild();
  const signalGroup = vi.fn();
  const running = start(fake, {}, signalGroup);
  vi.spyOn(fake.stdin, "write").mockImplementation(() => {
    throw new Error("EPIPE");
  });

  expect(running.write("ABCD")).toBe(false);
  expect(signalGroup).toHaveBeenCalledWith(-77, "SIGTERM");
});

it("works with a child that has no pipes", async () => {
  const child = new ChildProcess();
  const running = new CliChildProcess(
    child,
    { ...REQUEST, input: "x" },
    vi.fn(),
  );

  expect(running.write("ABCD")).toBe(false);
  child.emit("close", 1);

  await expect(running.completed).resolves.toMatchObject({ exitCode: 1 });
});
