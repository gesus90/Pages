import * as childProcess from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CLI_HOME, completeCli, createCliSpawn } from "../helpers/agent-cli";

import type { CliRunRequest } from "@/backend/agents/cli/CliContracts";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawn: vi.fn() };
});

const REQUEST: CliRunRequest = {
  file: "/fake/codex",
  arguments: ["login", "status"],
  provider: "codex_cli",
  home: CLI_HOME,
  timeoutMs: 15_000,
  stdin: "ignore",
};
afterEach(() => {
  vi.useRealTimers();
});

describe("bounded CLI process runner", () => {
  it("uses shell:false, detached groups, ignored stdin and private file creation modes", async () => {
    const fake = createCliSpawn();
    const originalMask = process.umask();
    const runner = new CliProcessRunner(fake);
    fake.spawn.mockImplementationOnce((...args) => {
      expect(process.umask()).toBe(0o077);
      return createCliSpawn().spawn(...args);
    });
    const running = runner.start(REQUEST);
    expect(process.umask()).toBe(originalMask);
    expect(fake.spawn).toHaveBeenCalledWith(
      REQUEST.file,
      REQUEST.arguments,
      expect.objectContaining({
        shell: false,
        detached: true,
        cwd: CLI_HOME.work,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const child = fake.spawn.mock.results[0].value;
    if (!(child instanceof childProcess.ChildProcess))
      throw new Error("Missing fake process");
    completeCli(child, "status", 0, "diagnostic");
    expect(await running.completed).toEqual({
      stdout: "status",
      stderr: "diagnostic",
      exitCode: 0,
      errorCode: null,
    });
    expect(running.write("code")).toBe(false);
    running.cancel("login_cancelled");
    child.emit("close", 0);
    child.emit("error", new Error("late child error"));
    child.stdout?.emit("data", "late");
  });

  it("terminates the whole group after timeout even if the wrapper exits first", async () => {
    vi.useFakeTimers();
    const fake = createCliSpawn();
    const pending = new CliProcessRunner(fake).run(REQUEST);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fake.signalGroup).toHaveBeenCalledWith(-42000, "SIGTERM");
    completeCli(fake.children[0]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fake.signalGroup).toHaveBeenCalledWith(-42000, "SIGKILL");
    expect(await pending).toMatchObject({ errorCode: "check_timeout" });
  });

  it("enforces the stdout and stderr byte limits", async () => {
    vi.useFakeTimers();
    for (const stream of ["stdout", "stderr"] as const) {
      const fake = createCliSpawn();
      const running = new CliProcessRunner(fake).start(REQUEST);
      fake.children[0][stream]?.emit(
        "data",
        "x".repeat(stream === "stdout" ? 256 * 1024 + 1 : 64 * 1024 + 1),
      );
      fake.children[0][stream]?.emit("data", "ignored");
      running.cancel("login_cancelled");
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await running.completed).toMatchObject({
        errorCode: "cli_unexpected_output",
        stdout: "",
        stderr: "",
      });
    }
  });

  it("rejects a fifth process, drains children on shutdown, and refuses further work", async () => {
    vi.useFakeTimers();
    const fake = createCliSpawn();
    const runner = new CliProcessRunner(fake);
    const children = Array.from({ length: 4 }, () => runner.start(REQUEST));
    expect(() => runner.start(REQUEST)).toThrow(
      expect.objectContaining({ code: "login_limit_reached" }),
    );
    const shutdown = runner.shutdown();
    await vi.advanceTimersByTimeAsync(3_000);
    await shutdown;
    expect(await children[0].completed).toMatchObject({
      errorCode: "login_cancelled",
    });
    expect(() => runner.start(REQUEST)).toThrow();
    expect(fake.signalGroup).toHaveBeenCalledTimes(8);
  });

  it("supports login pipes and treats write or parse failures as safe outcomes", async () => {
    vi.useFakeTimers();
    const fake = createCliSpawn();
    const runner = new CliProcessRunner(fake);
    const running = runner.start({ ...REQUEST, stdin: "pipe" });
    const input = fake.children[0].stdin;
    if (!input) throw new Error("missing fake pipe");
    const write = vi.spyOn(input, "write");
    expect(running.write("synthetic-code")).toBe(true);
    expect(write).toHaveBeenCalledWith("synthetic-code\n");
    write.mockImplementationOnce(() => {
      throw new Error("pipe error");
    });
    expect(running.write("other-code")).toBe(false);
    expect(running.write("other-code")).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await running.completed).toMatchObject({
      errorCode: "login_code_rejected",
    });
    const invalid = runner.start({
      ...REQUEST,
      onOutput: () => {
        throw new Error("invalid parser");
      },
    });
    fake.children[1].stdout?.emit("data", "invalid");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await invalid.completed).toMatchObject({
      errorCode: "cli_unexpected_output",
    });
    const failedPipe = runner.start({ ...REQUEST, stdin: "pipe" });
    fake.children[2].stdin?.emit("error", new Error("EPIPE"));
    fake.children[2].emit("error", new Error("child error"));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await failedPipe.completed).toMatchObject({
      errorCode: "login_code_rejected",
    });
  });

  it("handles spawn failures, cancellation and disappearing process groups", async () => {
    vi.useFakeTimers();
    const fake = createCliSpawn();
    const runner = new CliProcessRunner(fake);
    fake.spawn.mockImplementationOnce(() => {
      throw new Error("native private error");
    });
    expect(await runner.run(REQUEST)).toMatchObject({
      errorCode: "cli_not_executable",
      stdout: "",
      stderr: "",
    });
    const failed = runner.run(REQUEST);
    fake.children[0].emit("error", new Error("native private error"));
    expect(await failed).toMatchObject({ errorCode: "cli_not_executable" });
    expect(
      await runner.run({ ...REQUEST, signal: AbortSignal.abort() }),
    ).toMatchObject({ errorCode: "check_timeout" });
    const controller = new AbortController();
    const cancelled = runner.start({ ...REQUEST, signal: controller.signal });
    fake.signalGroup.mockImplementation(() => {
      throw new Error("group gone");
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fake.children[1].kill).toHaveBeenCalledWith("SIGKILL");
    expect(await cancelled.completed).toMatchObject({
      errorCode: "check_timeout",
    });
    const missingPid = runner.start(REQUEST);
    Object.defineProperty(fake.children[2], "pid", { value: undefined });
    missingPid.cancel("login_cancelled");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await missingPid.completed).toMatchObject({
      errorCode: "login_cancelled",
    });
    vi.spyOn(runner, "start").mockImplementationOnce(() => {
      throw new Error("unexpected failure");
    });
    expect(await runner.run(REQUEST)).toMatchObject({
      errorCode: "cli_not_executable",
    });
  });

  it("wires native spawn and signaling defaults without executing a real binary", async () => {
    vi.useFakeTimers();
    const fake = createCliSpawn();
    vi.mocked(childProcess.spawn).mockImplementation(fake.spawn);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const running = new CliProcessRunner().start(REQUEST);
    running.cancel("login_cancelled");
    await vi.advanceTimersByTimeAsync(3_000);
    await running.completed;
    expect(kill).toHaveBeenCalledWith(-42000, "SIGKILL");
  });

  it("catches an abort occurring during synchronous spawn setup", async () => {
    vi.useFakeTimers();
    const fake = createCliSpawn();
    const controller = new AbortController();
    const spawn = vi.fn((...args: Parameters<typeof fake.spawn>) => {
      const child = fake.spawn(...args);
      controller.abort();
      return child;
    });
    const running = new CliProcessRunner({
      spawn,
      signalGroup: fake.signalGroup,
    }).start({ ...REQUEST, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await running.completed).toMatchObject({
      errorCode: "check_timeout",
    });
  });
});
