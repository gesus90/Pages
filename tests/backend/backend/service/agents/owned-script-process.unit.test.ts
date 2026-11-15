import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import { beforeEach, expect, it, vi } from "vitest";

import {
  sharedAgentEnvironment,
  sharedPnpmBin,
} from "@/backend/agents/cli/AgentSharedEnvironment";
import { executeScriptProcess } from "@/backend/service/agents/AgentPlanScriptProcess";

import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";
import type * as ChildProcessModule from "node:child_process";

const boundary = vi.hoisted(() => ({
  spawn: vi.fn(),
  captureOwnedNamespace: vi.fn(),
  prepareSharedAgentEnvironment: vi.fn(),
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: boundary.spawn,
}));
vi.mock(
  import("@/backend/agents/cli/AgentSharedEnvironment"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    prepareSharedAgentEnvironment: boundary.prepareSharedAgentEnvironment,
  }),
);
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

function processFixture(): ChildProcess {
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
  boundary.prepareSharedAgentEnvironment
    .mockReset()
    .mockResolvedValue(undefined);
  boundary.spawn.mockReset().mockImplementation(processFixture);
  boundary.captureOwnedNamespace.mockReset().mockResolvedValue(NAMESPACE);
});

it("persists the namespace identity before delivering input to a contained script", async () => {
  boundary.prepareSharedAgentEnvironment.mockImplementation(
    async (root: string) => {
      expect(root).toBe("/synthetic/data/shared-env");
      expect(boundary.spawn).not.toHaveBeenCalled();
    },
  );
  const save = vi.fn(async () => {
    const child = boundary.spawn.mock.results[0]?.value as ChildProcess;
    expect((child.stdio[3] as PassThrough).writableEnded).toBe(false);
  });
  const result = await executeScriptProcess({
    record: record(),
    program: "/synthetic/node",
    resources: "/synthetic/resources",
    sharedEnvironment: "/synthetic/data/shared-env",
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
  expect(boundary.prepareSharedAgentEnvironment).toHaveBeenCalledOnce();
  const args = boundary.spawn.mock.calls[0]?.[1] as string[];
  expect(args.join(" ")).toContain(
    "--bind /synthetic/data/shared-env /synthetic/data/shared-env",
  );
  expect(boundary.spawn.mock.calls[0]?.[2]?.env).toMatchObject({
    ...sharedAgentEnvironment("/synthetic/data/shared-env"),
    HOME: "/synthetic/resources",
    XDG_CONFIG_HOME: "/synthetic/resources/config",
    XDG_DATA_HOME: "/synthetic/resources/data",
    XDG_STATE_HOME: "/synthetic/resources/state",
  });
  expect(boundary.spawn.mock.calls[0]?.[2]?.env.PATH.split(":")[0]).toBe(
    sharedPnpmBin("/synthetic/data/shared-env"),
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
    sharedEnvironment: "/synthetic/data/shared-env",
    input: "{}",
    timeoutSeconds: 5,
    signal: new AbortController().signal,
    claimStart: () => {},
    save,
  });
  expect(save).not.toHaveBeenCalled();
  expect(result.closeout).toBe("failed");
});

it("does not claim or spawn a script when shared pnpm preparation fails", async () => {
  boundary.prepareSharedAgentEnvironment.mockRejectedValue(
    new Error("setup failed"),
  );
  const claimStart = vi.fn();
  await expect(
    executeScriptProcess({
      record: record(),
      program: "/synthetic/node",
      resources: "/synthetic/resources",
      sharedEnvironment: "/synthetic/data/shared-env",
      input: "{}",
      timeoutSeconds: 5,
      signal: new AbortController().signal,
      claimStart,
      save: vi.fn(),
    }),
  ).rejects.toThrow("setup failed");
  expect(boundary.spawn).not.toHaveBeenCalled();
  expect(claimStart).not.toHaveBeenCalled();
});

it("does not start a script cancelled while shared pnpm is being prepared", async () => {
  const controller = new AbortController();
  boundary.prepareSharedAgentEnvironment.mockImplementation(async () => {
    controller.abort(new Error("cancelled during setup"));
  });
  const claimStart = vi.fn();
  await expect(
    executeScriptProcess({
      record: record(),
      program: "/synthetic/node",
      resources: "/synthetic/resources",
      sharedEnvironment: "/synthetic/data/shared-env",
      input: "{}",
      timeoutSeconds: 5,
      signal: controller.signal,
      claimStart,
      save: vi.fn(),
    }),
  ).rejects.toThrow("cancelled during setup");
  expect(boundary.spawn).not.toHaveBeenCalled();
  expect(claimStart).not.toHaveBeenCalled();
});
