import { beforeEach, expect, it, vi } from "vitest";

import {
  prepareFullEnvironment,
  verifyFullEnvironmentStart,
} from "@/backend/agents/cli/CliFullEnvironment";
import { CliWorkerUnits } from "@/backend/agents/cli/CliWorkerUnit";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import { SYSTEMD_ENVIRONMENT } from "../page419-environment-fixture";
import { sessionInput } from "./cli-session-input";

import type { ExecFileOptions } from "node:child_process";
import type * as FileSystem from "node:fs/promises";
import type { Mock } from "vitest";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { CliLocator } from "@/backend/agents/cli/CliLocator";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { AgentToolLocation } from "@/backend/service/agents/tools/AgentToolContracts";
import type { AgentToolId } from "@/definition/AgentTools";

const RUNNERS = [
  ["codex_cli", "codex", "codex"],
  ["claude_code", "claude", "claude"],
  ["opencode", "opencode", "opencode"],
  ["antigravity", "agy", "antigravity_acp"],
] as const;

const boundary = vi.hoisted(() => ({
  shell:
    vi.fn<
      (
        file: string,
        arguments_: readonly string[],
        options: ExecFileOptions,
      ) => Promise<{ stdout: string; stderr: string }>
    >(),
  writeFile:
    vi.fn<(file: string, content: string, options: unknown) => Promise<void>>(),
  access: vi.fn<(file: string, mode: number) => Promise<void>>(),
}));

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return {
    execFile: Object.assign(vi.fn(), { [promisify.custom]: boundary.shell }),
  };
});
vi.mock("node:os", () => ({
  userInfo: () => ({
    uid: 1000,
    username: "owner",
    homedir: "/synthetic/home",
    shell: "/synthetic/zsh",
  }),
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  access: boundary.access,
  writeFile: boundary.writeFile,
  mkdir: vi.fn(),
  rm: vi.fn(),
}));

function fullInput(
  provider: CliProviderId = "codex_cli",
): AgentPlanSessionInput {
  return sessionInput(provider, acpRunOptions("full_environment", 0), {
    beforeStart: vi.fn(async () => undefined),
    fullEnvironment: { ownerId: "owner", ownerName: "Owner" },
  });
}

beforeEach(() => {
  boundary.shell.mockReset().mockResolvedValue({
    stdout: "PATH=/login/bin:/usr/bin\0LOGIN_SETTING=preserved\0",
    stderr: "",
  });
  boundary.writeFile.mockClear();
  boundary.access.mockReset().mockRejectedValue(new Error("not executable"));
  for (const [name, configured] of Object.entries(SYSTEMD_ENVIRONMENT))
    vi.stubEnv(name, configured);
  vi.stubEnv("PAGES_FULL_ENVIRONMENT_OWNER_ID", "owner");
  vi.stubEnv("HOST_LOGIN_SETTING", "preserved");
});

function locator(): {
  find: Mock<CliLocator["find"]>;
  locate: Mock<CliLocator["locate"]>;
} {
  return {
    find: vi
      .fn<CliLocator["find"]>()
      .mockResolvedValue({ found: true, path: "/managed/runner" }),
    locate: vi
      .fn<CliLocator["locate"]>()
      .mockResolvedValue({ found: true, path: "/managed/adapter" }),
  };
}

function managedLocation(file: string): AgentToolLocation {
  return { file, source: "managed", release: "/managed", version: "synthetic" };
}

it.each(RUNNERS)(
  "prefers the login PATH for %s",
  async (provider, binary, toolId) => {
    boundary.access.mockImplementation(async (file) => {
      if (file !== `/usr/bin/${binary}`) throw new Error("not executable");
    });
    const tools = locator();
    const locations = new Map<AgentToolId, AgentToolLocation>([
      [toolId, managedLocation("/managed/pinned")],
    ]);

    const verified = await verifyFullEnvironmentStart(
      fullInput(provider),
      new AbortController().signal,
      { locator: tools, locations },
    );

    expect(verified.file).toBe(`/usr/bin/${binary}`);
    expect(boundary.access.mock.calls.map(([file]) => file)).toEqual([
      `/login/bin/${binary}`,
      `/usr/bin/${binary}`,
    ]);
    expect(tools.find).not.toHaveBeenCalled();
  },
);

it.each(RUNNERS)(
  "falls back to the pinned Pages tool for %s",
  async (provider, binary, toolId) => {
    const tools = locator();
    const locations = new Map<AgentToolId, AgentToolLocation>([
      [toolId, managedLocation("/managed/pinned")],
    ]);

    const verified = await verifyFullEnvironmentStart(
      fullInput(provider),
      new AbortController().signal,
      { locator: tools, locations },
    );

    expect(verified.file).toBe("/managed/pinned");
    expect(boundary.access).toHaveBeenCalledWith(
      `/usr/bin/${binary}`,
      expect.any(Number),
    );
    expect(tools.find).not.toHaveBeenCalled();
  },
);

it.each(RUNNERS)(
  "uses the provider locator without a pinned tool for %s",
  async (provider) => {
    const tools = locator();

    const verified = await verifyFullEnvironmentStart(
      fullInput(provider),
      new AbortController().signal,
      { locator: tools },
    );

    expect(verified.file).toBe("/managed/runner");
    expect(tools.find).toHaveBeenCalledExactlyOnceWith(provider);
  },
);

it.each(RUNNERS)(
  "reports cli_not_executable only when both lookups fail for %s",
  async (provider) => {
    const tools = locator();
    tools.find.mockResolvedValue({ found: false, path: null });

    await expect(
      verifyFullEnvironmentStart(
        fullInput(provider),
        new AbortController().signal,
        { locator: tools },
      ),
    ).rejects.toMatchObject({ code: "cli_not_executable" });
    expect(tools.find).toHaveBeenCalledExactlyOnceWith(provider);
    expect(tools.locate).not.toHaveBeenCalled();
  },
);

it("removes parent systemd state before the login shell and from its returned environment", async () => {
  boundary.shell.mockResolvedValue({
    stdout: Object.entries({
      ...SYSTEMD_ENVIRONMENT,
      PATH: "/login/bin:/usr/bin",
      HOME: "/incorrect/home",
      LOGIN_SETTING: "preserved",
    })
      .map(([name, configured]) => `${name}=${configured}\0`)
      .join(""),
    stderr: "",
  });
  const input = fullInput();
  const signal = new AbortController().signal;

  const owner = await prepareFullEnvironment(input, signal);

  expect(input.beforeStart).toHaveBeenCalledOnce();
  expect(boundary.shell).toHaveBeenCalledOnce();
  const [shellFile, shellArguments, shellOptions] =
    boundary.shell.mock.calls[0] ?? [];
  expect(shellFile).toBe("/synthetic/zsh");
  expect(shellArguments).toEqual(["-lc", "exec /usr/bin/env -0"]);
  expect(shellOptions).toMatchObject({
    signal,
    cwd: input.directory,
  });
  const shellEnvironment = shellOptions?.env;
  expect(shellEnvironment).toMatchObject({
    HOME: "/synthetic/home",
    USER: "owner",
    LOGNAME: "owner",
    SHELL: "/synthetic/zsh",
    HOST_LOGIN_SETTING: "preserved",
  });
  for (const name of Object.keys(SYSTEMD_ENVIRONMENT)) {
    expect(shellEnvironment).not.toHaveProperty(name);
    expect(owner.environment).not.toHaveProperty(name);
  }
  expect(owner.environment).toEqual({
    PATH: "/login/bin:/usr/bin",
    HOME: "/synthetic/home",
    LOGIN_SETTING: "preserved",
    XDG_RUNTIME_DIR: "/run/user/1000",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
  });

  const command = vi.fn(async () => ({ stdout: "" }));
  const units = new CliWorkerUnits("/synthetic/units", command);
  await units.wrap(
    {
      file: "/synthetic/adapter",
      arguments: [],
      provider: "codex_cli",
      home: owner.home,
      fullEnvironment: owner.environment,
      workingDirectory: input.directory,
      environment: {},
      timeoutMs: 60000,
      signal,
      onLine: () => undefined,
    },
    "synthetic-instance",
  );
  const workerFile = boundary.writeFile.mock.calls[0]?.[1];
  expect(workerFile).toContain('LOGIN_SETTING="preserved"');
  for (const name of Object.keys(SYSTEMD_ENVIRONMENT))
    expect(workerFile).not.toContain(`${name}=`);
});
