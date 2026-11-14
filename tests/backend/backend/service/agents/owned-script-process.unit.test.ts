import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import { beforeEach, expect, it, vi } from "vitest";

import {
  executeScriptProcess,
  resumePlanScripts,
  suspendPlanScripts,
} from "@/backend/service/agents/AgentPlanScriptProcess";

import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";
import type * as ChildProcessModule from "node:child_process";

const boundary = vi.hoisted(() => ({
  spawn: vi.fn(),
  captureOwnedNamespace: vi.fn(),
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: boundary.spawn,
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  captureOwnedNamespace: boundary.captureOwnedNamespace,
}));

vi.mock("@/backend/agents/cli/CliSshConfigOverlay", () => ({
  sshConfigOverlayArguments: async () => [
    "--ro-bind",
    "/synthetic/ssh-copies",
    "/etc/ssh/ssh_config.d",
  ],
}));

const NAMESPACE = {
  pid: 123,
  uid: 1000,
  start: 101,
  boot: "10000000-0000-4000-8000-000000000001",
};

function processFixture(exitOnInput = true): ChildProcess {
  const child = new ChildProcess();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const release = new PassThrough();
  Object.defineProperties(child, {
    pid: { value: 123 },
    stdin: { value: stdin },
    stdout: { value: stdout },
    stderr: { value: new PassThrough() },
    stdio: { value: [stdin, stdout, new PassThrough(), release] },
    kill: {
      value: vi.fn(() => {
        child.emit("exit", null, "SIGTERM");
        child.emit("close", null, "SIGTERM");
        return true;
      }),
    },
  });
  if (exitOnInput)
    stdin.once("finish", () => {
      stdout.write("result");
      child.emit("exit", 0, null);
      child.emit("close", 0, null);
    });
  return child;
}

function record(): AgentPlanScriptRun {
  return {
    attemptId: "10000000-0000-4000-8000-000000000001",
    instanceId: "20000000-0000-4000-8000-000000000002",
    interpreterProfileId: "node",
    directory: "/synthetic/work",
    userId: "owner",
    uid: 1000,
    gid: 1000,
    processId: null,
    startedAt: "2026-10-29T00:00:00.000Z",
    endedAt: null,
    exitCode: null,
    signal: null,
    failure: null,
    closeout: "pending",
    stdout: null,
    stderr: "",
  };
}

beforeEach(() => {
  boundary.spawn.mockReset().mockImplementation(processFixture);
  boundary.captureOwnedNamespace.mockReset().mockResolvedValue(NAMESPACE);
});

it("persists the namespace identity before delivering input to a contained script", async () => {
  const save = vi.fn(async () => {
    const child = boundary.spawn.mock.results[0]?.value as ChildProcess;
    expect((child.stdio[3] as PassThrough).writableEnded).toBe(false);
  });
  const result = await executeScriptProcess({
    record: record(),
    program: "/synthetic/node",
    resources: "/synthetic/resources",
    input: "{}",
    timeoutSeconds: 5,
    signal: new AbortController().signal,
    claimStart: () => {},
    save,
  });
  expect(boundary.spawn.mock.calls[0]?.[0]).toBe("/usr/bin/bwrap");
  expect(boundary.spawn.mock.calls[0]?.[1]).toContain("--unshare-pid");
  expect(boundary.spawn.mock.calls[0]?.[1]).toEqual(
    expect.arrayContaining(["--ro-bind", "/synthetic/ssh-copies"]),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ namespace: NAMESPACE }),
  );
  expect(boundary.spawn.mock.calls[0]?.[2]?.stdio).toEqual([
    "pipe",
    "pipe",
    "pipe",
    "pipe",
  ]);
  expect(result).toMatchObject({ closeout: "confirmed", stdout: "result" });
});

it("leaves cleanup unconfirmed when supervisor ownership cannot be recorded", async () => {
  boundary.captureOwnedNamespace.mockRejectedValue(new Error("unavailable"));
  const save = vi.fn(async () => {});
  const result = await executeScriptProcess({
    record: record(),
    program: "/synthetic/node",
    resources: "/synthetic/resources",
    input: "{}",
    timeoutSeconds: 5,
    signal: new AbortController().signal,
    claimStart: () => {},
    save,
  });
  expect(save).not.toHaveBeenCalled();
  expect(result.closeout).toBe("failed");
});

it("pauses a running script group immediately and resumes its remaining timeout", async () => {
  const child = processFixture(false);
  boundary.spawn.mockReturnValueOnce(child);
  const signal = vi.spyOn(process, "kill").mockImplementation(() => true);
  const save = vi.fn(async () => undefined);
  try {
    const execution = executeScriptProcess({
      record: record(),
      runId: "run-1",
      stepId: "prepare",
      program: "/synthetic/node",
      resources: "/synthetic/resources",
      input: "{}",
      timeoutSeconds: 0.2,
      signal: new AbortController().signal,
      claimStart: () => undefined,
      save,
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(suspendPlanScripts("run-1")).toEqual(new Set(["prepare"]));
    expect(signal).toHaveBeenCalledWith(123, "SIGSTOP");
    await new Promise((resolve) => setTimeout(resolve, 250));
    resumePlanScripts("run-1");
    expect(signal).toHaveBeenCalledWith(123, "SIGCONT");
    child.stdout?.emit("data", Buffer.from("result"));
    child.emit("exit", 0, null);
    child.emit("close", 0, null);
    const result = await execution;
    expect(result).toMatchObject({
      closeout: "confirmed",
      failure: null,
      stdout: "result",
    });
    expect(suspendPlanScripts("run-1").size).toBe(0);
  } finally {
    signal.mockRestore();
  }
});
