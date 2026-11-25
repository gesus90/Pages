import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkInterpreterVersion } from "./InterpreterVersionCheck";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
}

function fakeChild(pid = 4321): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  spawnMock.mockReturnValue(child);
  return child;
}

let kill: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spawnMock.mockReset();
  kill = vi.spyOn(process, "kill").mockImplementation(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("checkInterpreterVersion", () => {
  it("reports the version printed on stdout or stderr", async () => {
    const child = fakeChild();
    const check = checkInterpreterVersion("/bin/tool");
    child.stdout.emit("data", Buffer.from("Tool "));
    child.stderr.emit("data", Buffer.from("v1.22.3-beta\u0001"));
    child.emit("close", 0);
    expect(await check).toEqual({
      path: "/bin/tool",
      status: "ok",
      version: "1.22.3-beta",
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "/bin/tool",
      ["--version"],
      expect.objectContaining({ shell: false }),
    );
    expect(kill).toHaveBeenCalledWith(-4321, "SIGKILL");
  });

  it("reports missing versions and failing exits", async () => {
    const quiet = fakeChild();
    const noVersion = checkInterpreterVersion("/bin/tool");
    quiet.stdout.emit("data", Buffer.from("hello"));
    quiet.emit("close", 0);
    expect(await noVersion).toMatchObject({
      error: "noVersion",
      diagnostic: "hello",
    });
    const failing = fakeChild();
    const exit = checkInterpreterVersion("/bin/tool");
    failing.emit("close", 2);
    expect(await exit).toMatchObject({ error: "exit", diagnostic: "Exit 2: " });
    const signalled = fakeChild();
    const signal = checkInterpreterVersion("/bin/tool");
    signalled.emit("close", null);
    expect(await signal).toMatchObject({ diagnostic: "Exit signal: " });
  });

  it("classifies start errors", async () => {
    const outcomes: [Error, string][] = [
      [Object.assign(new Error("x"), { code: "ENOENT" }), "missing"],
      [Object.assign(new Error("x"), { code: "ENOTDIR" }), "missing"],
      [Object.assign(new Error("x"), { code: "EACCES" }), "notExecutable"],
      [Object.assign(new Error("x"), { code: "ENOEXEC" }), "notExecutable"],
      [Object.assign(new Error("x"), { code: "EIO" }), "failed"],
      [new Error("x"), "failed"],
    ];
    for (const [error, expected] of outcomes) {
      const child = fakeChild();
      const check = checkInterpreterVersion("/bin/tool");
      child.emit("error", error);
      expect(await check).toMatchObject({ status: "error", error: expected });
    }
  });

  it("stops at the output limit and ignores later events", async () => {
    const child = fakeChild();
    const check = checkInterpreterVersion("/bin/tool");
    child.stdout.emit("data", Buffer.alloc(9000));
    child.emit("close", 0);
    expect(await check).toMatchObject({ error: "outputLimit" });
  });

  it("times out", async () => {
    vi.useFakeTimers();
    fakeChild();
    const check = checkInterpreterVersion("/bin/tool");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await check).toMatchObject({ error: "timeout" });
  });

  it("tolerates a missing pid and kill failures", async () => {
    const detached = fakeChild(0);
    const first = checkInterpreterVersion("/bin/tool");
    detached.emit("close", 0);
    await first;
    expect(kill).not.toHaveBeenCalled();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    kill.mockImplementation(() => {
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    });
    const gone = fakeChild();
    const second = checkInterpreterVersion("/bin/tool");
    gone.emit("close", 0);
    await second;
    expect(warn).not.toHaveBeenCalled();
    for (const thrown of [
      Object.assign(new Error("no"), { code: "EPERM" }),
      new Error("plain"),
      "text",
    ]) {
      kill.mockImplementation(() => {
        throw thrown;
      });
      const child = fakeChild();
      const check = checkInterpreterVersion("/bin/tool");
      child.emit("close", 0);
      await check;
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
