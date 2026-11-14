import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, expect, it, vi } from "vitest";

import { executeScriptProcess } from "@/backend/service/agents/AgentPlanScriptProcess";
import { scriptEnvironment } from "@/backend/service/agents/AgentPlanScriptResources";
import { readPlanScriptRun } from "@/backend/agents/AgentPlanScriptRunInput";

import { SCRIPT_RUN, UUID } from "../../agents/agent-plan-record-fixture";

import type * as ChildProcess from "node:child_process";
import type * as OperatingSystem from "node:os";

const boundary = vi.hoisted(() => ({
  spawn:
    vi.fn<
      (
        command: string,
        args: readonly string[],
        options: { readonly env?: NodeJS.ProcessEnv },
      ) => unknown
    >(),
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  spawn: boundary.spawn,
}));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof OperatingSystem>()),
  homedir: () => "/disk/account",
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  captureOwnedNamespace: async () => ({
    pid: 42,
    uid: 1000,
    start: 1,
    boot: "00000000-0000-4000-8000-000000000001",
  }),
}));
vi.mock("@/backend/agents/cli/CliSshConfigOverlay", () => ({
  sshConfigOverlayArguments: async () => [],
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("binds script scratch over /tmp and waits for the owned supervisor to close", async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 42,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdio: [null, null, null, new PassThrough()],
    kill: vi.fn(),
  });
  boundary.spawn.mockReturnValue(child);
  child.stdin.on("finish", () => {
    child.emit("exit", 0, null);
    child.emit("close");
  });
  const record = readPlanScriptRun({
    ...SCRIPT_RUN,
    temporaryScope: { runId: UUID, stepId: "checks" },
  });
  const result = await executeScriptProcess({
    record,
    program: "/usr/bin/node",
    resources: "/disk/resources",
    input: "{}",
    timeoutSeconds: 60,
    signal: new AbortController().signal,
    claimStart: () => {},
    save: async () => {},
  });
  expect(result.closeout).toBe("confirmed");
  const [, args, options] = boundary.spawn.mock.calls[0] ?? [];
  expect(args).toEqual(
    expect.arrayContaining([
      "--bind",
      `/disk/account/.pages/data/run-tmp/${UUID}/checks/tmp`,
      "/tmp",
    ]),
  );
  expect(options?.env).toMatchObject({
    TMPDIR: "/tmp",
    TMP: "/tmp",
    TEMP: "/tmp",
    NODE_COMPILE_CACHE: "/tmp/node-compile-cache",
  });
});

it("gives checks launched by scripts all temporary variables without inheriting host secrets", () => {
  expect(
    scriptEnvironment({
      directory: "/disk/resources",
      interpreter: "/usr/bin/node",
      instanceId: UUID,
      temporaryDirectory: "/tmp",
    }),
  ).toMatchObject({ TMPDIR: "/tmp", TMP: "/tmp", TEMP: "/tmp" });
});
