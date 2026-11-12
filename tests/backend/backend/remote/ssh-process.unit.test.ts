import { EventEmitter } from "node:events";

import { afterEach, expect, it, vi } from "vitest";

import { SshChildProcess, runSshProcess } from "@/backend/remote/SshProcess";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), log: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: mocks.log }));

const REQUEST = {
  file: "ssh",
  arguments: ["host"],
  environment: { PATH: "/bin" },
  timeoutMs: null,
};

function child(pid: number | undefined = 123): EventEmitter & {
  pid: number | undefined;
  exitCode: null;
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  mocks.spawn.mockReset();
  mocks.log.mockReset();
});

it("runs with an isolated process group and bounds captured output", async () => {
  const process = child();
  mocks.spawn.mockReturnValue(process);
  const result = runSshProcess(REQUEST);
  process.stdout.emit("data", Buffer.from("a".repeat(70_000)));
  process.stdout.emit("data", Buffer.from("ignored"));
  process.stderr.emit("data", Buffer.from("failure"));
  process.emit("close", 2);
  expect(await result).toEqual({
    exitCode: 2,
    stdout: "a".repeat(65_536),
    stderr: "failure",
    isTimedOut: false,
    isUnavailable: false,
  });
  expect(mocks.spawn).toHaveBeenCalledWith("ssh", ["host"], {
    shell: false,
    detached: true,
    env: { PATH: "/bin" },
    stdio: ["ignore", "pipe", "pipe"],
  });
});

it("kills a timed out process group and reports the timeout", async () => {
  vi.useFakeTimers();
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const fake = child();
  mocks.spawn.mockReturnValue(fake);
  const running = new SshChildProcess({ ...REQUEST, timeoutMs: 50 });
  await vi.advanceTimersByTimeAsync(50);
  expect(kill).toHaveBeenCalledWith(-123, "SIGKILL");
  fake.emit("close", null);
  expect(await running.exited).toMatchObject({
    exitCode: null,
    isTimedOut: true,
    isUnavailable: false,
  });
});

it("terminates then escalates a stubborn process", async () => {
  vi.useFakeTimers();
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const fake = child();
  mocks.spawn.mockReturnValue(fake);
  const running = new SshChildProcess(REQUEST);
  running.stop();
  expect(kill).toHaveBeenCalledWith(-123, "SIGTERM");
  await vi.advanceTimersByTimeAsync(2_000);
  expect(kill).toHaveBeenCalledWith(-123, "SIGKILL");
  fake.emit("close", null);
  await running.exited;
});

it("reports spawn failures without starting a process", async () => {
  mocks.spawn.mockImplementation(() => {
    throw new Error("spawn failed");
  });
  const running = new SshChildProcess(REQUEST);
  running.stop();
  expect(await running.exited).toMatchObject({
    exitCode: null,
    isUnavailable: true,
  });
  expect(mocks.log).toHaveBeenCalledOnce();
});

it("reports an asynchronous start failure", async () => {
  const fake = child();
  Object.defineProperty(fake, "pid", { value: undefined });
  mocks.spawn.mockReturnValue(fake);
  const running = new SshChildProcess(REQUEST);
  fake.emit("error", new Error("not found"));
  expect(await running.exited).toMatchObject({
    exitCode: null,
    isUnavailable: true,
  });
});
