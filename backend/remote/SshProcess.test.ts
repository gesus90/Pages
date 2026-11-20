import { EventEmitter } from "node:events";

import { afterEach, expect, it, vi } from "vitest";

const processBoundary = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: processBoundary.spawn }));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

import { runSshProcess, SshChildProcess } from "./SshProcess";

class FakeChild extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public pid: number | undefined = 123;
  public exitCode: number | null = null;
}

const request = {
  file: "ssh",
  arguments: ["host"],
  environment: { PATH: "/bin" },
  timeoutMs: null,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  processBoundary.spawn.mockReset();
});

it("collects bounded output and passes a minimal detached process configuration", async () => {
  const child = new FakeChild();
  processBoundary.spawn.mockReturnValue(child);
  const result = runSshProcess(request);
  child.stdout.emit("data", Buffer.from("a".repeat(70000)));
  child.stdout.emit("data", Buffer.from("ignored"));
  child.stderr.emit("data", Buffer.from("warning"));
  child.emit("close", 2);
  await expect(result).resolves.toEqual({
    exitCode: 2,
    stdout: "a".repeat(65536),
    stderr: "warning",
    isTimedOut: false,
    isUnavailable: false,
  });
  expect(processBoundary.spawn).toHaveBeenCalledWith("ssh", ["host"], {
    shell: false,
    detached: true,
    env: { PATH: "/bin" },
    stdio: ["ignore", "pipe", "pipe"],
  });
});

it("reports synchronous and asynchronous start failures", async () => {
  processBoundary.spawn.mockImplementationOnce(() => {
    throw new Error("spawn");
  });
  const failed = new SshChildProcess(request);
  failed.stop();
  await expect(failed.exited).resolves.toMatchObject({ isUnavailable: true });
  const child = new FakeChild();
  child.pid = undefined;
  processBoundary.spawn.mockReturnValue(child);
  vi.useFakeTimers();
  const pending = runSshProcess({ ...request, timeoutMs: 100 });
  child.emit("error", new Error("missing"));
  await expect(pending).resolves.toMatchObject({ isUnavailable: true });
  expect(vi.getTimerCount()).toBe(0);
  const withoutTimeout = runSshProcess(request);
  child.emit("error", new Error("missing again"));
  await expect(withoutTimeout).resolves.toMatchObject({ isUnavailable: true });
});

it("kills the process group on timeout and reports the timeout", async () => {
  vi.useFakeTimers();
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const child = new FakeChild();
  processBoundary.spawn.mockReturnValue(child);
  const result = runSshProcess({ ...request, timeoutMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  expect(kill).toHaveBeenCalledWith(-123, "SIGKILL");
  child.emit("close", null);
  await expect(result).resolves.toMatchObject({ isTimedOut: true });
});

it("stops the process group and escalates if it does not exit", async () => {
  vi.useFakeTimers();
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const child = new FakeChild();
  processBoundary.spawn.mockReturnValue(child);
  const running = new SshChildProcess(request);
  running.stop();
  expect(kill).toHaveBeenCalledWith(-123, "SIGTERM");
  await vi.advanceTimersByTimeAsync(2000);
  expect(kill).toHaveBeenCalledWith(-123, "SIGKILL");
  child.emit("close", 0);
  await running.exited;
});

it("handles errors after startup and already exited processes", async () => {
  vi.useFakeTimers();
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    throw new Error("gone");
  });
  const child = new FakeChild();
  processBoundary.spawn.mockReturnValue(child);
  const running = new SshChildProcess(request);
  child.emit("error", new Error("runtime"));
  running.stop();
  expect(kill).toHaveBeenCalledOnce();
  child.exitCode = 1;
  await vi.advanceTimersByTimeAsync(2000);
  expect(kill).toHaveBeenCalledOnce();
  child.emit("close", 1);
  await expect(running.exited).resolves.toMatchObject({
    exitCode: 1,
    isUnavailable: false,
  });
});
