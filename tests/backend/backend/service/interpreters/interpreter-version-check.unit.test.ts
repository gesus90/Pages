import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { checkInterpreterVersion } from "@/backend/service/interpreters/InterpreterVersionCheck";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

function child(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
}

describe("interpreter version check", () => {
  it("extracts a cleaned version from simulated process output", async () => {
    const process = child();
    spawn.mockReturnValue(process);
    const result = checkInterpreterVersion("/virtual/node");
    process.stdout.emit("data", Buffer.from("node\n v22.4.1\u0000"));
    process.emit("close", 0);
    await expect(result).resolves.toEqual({
      path: "/virtual/node",
      status: "ok",
      version: "22.4.1",
    });
  });

  it("distinguishes missing, non-executable and other launch failures", async () => {
    for (const [code, expected] of [
      ["ENOENT", "missing"],
      ["ENOTDIR", "missing"],
      ["EACCES", "notExecutable"],
      ["ENOEXEC", "notExecutable"],
      ["OTHER", "failed"],
    ]) {
      const process = child();
      spawn.mockReturnValue(process);
      const result = checkInterpreterVersion("/virtual/interpreter");
      process.emit("error", Object.assign(new Error("failed"), { code }));
      await expect(result).resolves.toMatchObject({
        status: "error",
        error: expected,
      });
    }
  });

  it("handles exit, missing version, output limits and timeout", async () => {
    for (const [output, exit, expected] of [
      ["bad", 1, "exit"],
      ["no version", 0, "noVersion"],
      ["x".repeat(8193), 0, "outputLimit"],
    ] as const) {
      const process = child();
      spawn.mockReturnValue(process);
      const result = checkInterpreterVersion("/virtual/interpreter");
      process.stderr.emit("data", Buffer.from(output));
      process.emit("close", exit);
      await expect(result).resolves.toMatchObject({
        status: "error",
        error: expected,
      });
    }
    vi.useFakeTimers();
    spawn.mockReturnValue(child());
    const result = checkInterpreterVersion("/virtual/interpreter");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(result).resolves.toMatchObject({
      status: "error",
      error: "timeout",
    });
  });
});
