import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, access: vi.fn(actual.access) };
});

import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliPlanExecution } from "@/backend/agents/cli/CliPlanExecution";
import {
  CliPlanIsolation,
  probeBubblewrap,
} from "@/backend/agents/cli/CliPlanIsolation";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";

import { completeCli, createCliSpawn } from "../helpers/agent-cli";

import type { CliRunRequest } from "@/backend/agents/cli/CliContracts";
import type { CliIsolationOptions } from "@/backend/agents/cli/CliPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";

const BUBBLEWRAP = "/usr/bin/bwrap";
const FINAL = [
  { type: "item.completed", item: { type: "agent_message", text: "Finished" } },
  { type: "turn.completed" },
]
  .map((entry) => JSON.stringify(entry))
  .join("\n");
const actualAccess = (
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
).access;

let root = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "pages-isolation-")));
  await mkdir(path.join(root, "copy"));
  await mkdir(path.join(root, "credentials"));
  await mkdir(path.join(root, "instance", "credentials", "connection"), {
    recursive: true,
  });
});

afterEach(async () => {
  vi.mocked(access).mockImplementation(actualAccess);
  vi.restoreAllMocks();
  await rm(root, { force: true, recursive: true });
});

function request(overrides: Partial<CliRunRequest> = {}): CliRunRequest {
  const home = path.join(root, "instance", "credentials", "connection");
  return {
    file: "/opt/tools/bin/agent-cli",
    arguments: ["exec", "-"],
    provider: "codex_cli",
    home: {
      root: home,
      home: path.join(home, "home"),
      config: path.join(home, "config"),
      work: path.join(home, "work"),
    },
    workingDirectory: path.join(root, "copy"),
    timeoutMs: 600000,
    stdin: "pipe",
    input: "Try to change or delete the AGENT.md of every agent",
    ...overrides,
  };
}

describe("PAGE-20 probe of bubblewrap", () => {
  it("proves that a namespace starts and reports every other case as unavailable", async () => {
    const run = vi.fn(async () => undefined);
    vi.mocked(access).mockImplementation(async (filename, mode) => {
      if (filename !== BUBBLEWRAP) return actualAccess(filename, mode);
    });
    await expect(probeBubblewrap(run)).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith(
      BUBBLEWRAP,
      expect.arrayContaining(["--ro-bind", "--unshare-pid", "--proc"]),
    );
    // Installed, but the host refuses namespaces to this account.
    await expect(
      probeBubblewrap(async () => {
        throw new Error("No permissions to create a new namespace");
      }),
    ).resolves.toBe(false);
    // The default start of a program runs for real; its result depends on the host.
    await expect(probeBubblewrap()).resolves.toEqual(expect.any(Boolean));
    // Not installed: nothing is started.
    const unused = vi.fn(async () => undefined);
    vi.mocked(access).mockRejectedValue(new Error("Not installed"));
    await expect(probeBubblewrap(unused)).resolves.toBe(false);
    expect(unused).not.toHaveBeenCalled();
  });
});

describe("PAGE-20 CLI filesystem isolation", () => {
  it("leaves only the working copy and the credential home writable, empties the instance folders and keeps the tool on the path", async () => {
    const probe = vi.fn(async () => true);
    await mkdir(path.join(root, "Agents"));
    const isolation = new CliPlanIsolation(
      [path.join(root, "instance"), path.join(root, "Agents")],
      probe,
    );
    const proposed = request();
    const isolated = await isolation.isolate(proposed);
    const home = path.join(root, "instance", "credentials", "connection");
    expect(isolated?.file).toBe(BUBBLEWRAP);
    expect(isolated?.toolFile).toBe("/opt/tools/bin/agent-cli");
    expect(isolated?.arguments).toEqual([
      "--die-with-parent",
      "--unshare-pid",
      "--new-session",
      "--ro-bind",
      "/",
      "/",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--bind",
      path.join(root, "copy"),
      path.join(root, "copy"),
      "--tmpfs",
      path.join(root, "instance"),
      "--tmpfs",
      path.join(root, "Agents"),
      "--bind",
      home,
      home,
      "--chdir",
      path.join(root, "copy"),
      "--",
      "/opt/tools/bin/agent-cli",
      "exec",
      "-",
    ]);
    expect(isolated?.input).toBe(proposed.input);
    expect(isolated?.arguments).not.toContain(proposed.input);
    await isolation.isolate(proposed);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("reports that no isolation is possible, and skips folders that do not exist yet", async () => {
    await expect(
      new CliPlanIsolation(
        [path.join(root, "instance")],
        async () => false,
      ).isolate(request()),
    ).resolves.toBeNull();
    const isolated = await new CliPlanIsolation(
      [path.join(root, "Agents"), path.join(root, "instance")],
      async () => true,
    ).isolate(request());
    expect(isolated?.arguments.filter((entry) => entry === "--tmpfs")).toEqual([
      "--tmpfs",
      "--tmpfs",
    ]);
    expect(isolated?.arguments).toContain(path.join(root, "instance"));
    expect(isolated?.arguments).not.toContain(path.join(root, "Agents"));
  });

  it("starts in the work folder of the credential home when no working directory is given", async () => {
    const proposed = request({ workingDirectory: undefined });
    await mkdir(proposed.home.work);
    const isolated = await new CliPlanIsolation(
      [path.join(root, "Agents")],
      async () => true,
    ).isolate(proposed);
    expect(isolated?.arguments).toEqual(
      expect.arrayContaining(["--chdir", proposed.home.work]),
    );
  });

  it("refuses a working directory inside an instance folder but accepts one around it, which is emptied as well", async () => {
    await mkdir(path.join(root, "instance", "work"));
    const isolation = new CliPlanIsolation(
      [path.join(root, "instance")],
      async () => true,
    );
    for (const workingDirectory of [
      path.join(root, "instance"),
      path.join(root, "instance", "work"),
    ])
      await expect(
        isolation.isolate(request({ workingDirectory })),
      ).rejects.toMatchObject({ code: "workspace_path_outside_roots" });
    const around = await isolation.isolate(request({ workingDirectory: root }));
    expect(around?.arguments).toContain("--tmpfs");
  });

  it("keeps the folder of the tool on the path of the process when a wrapper starts it", async () => {
    const fake = createCliSpawn();
    const runner = new CliProcessRunner(fake);
    const isolated = await new CliPlanIsolation(
      [path.join(root, "instance")],
      async () => true,
    ).isolate(request());
    if (!isolated) throw new Error("Isolation expected");
    const running = runner.start(isolated);
    const child = fake.children[0];
    if (!child) throw new Error("Missing child");
    completeCli(child);
    await running.completed;
    const [file, , options] = fake.spawn.mock.calls[0] ?? [];
    expect(file).toBe(BUBBLEWRAP);
    const environment = options?.env as Record<string, string>;
    expect(environment.PATH.split(path.delimiter)).toContain("/opt/tools/bin");
  });
});

describe("PAGE-20 CLI plan execution inside the instance folders", () => {
  function setup(isolation?: CliIsolationOptions) {
    const store = new AgentCredentialStore(path.join(root, "credentials"));
    const locator = new CliLocator(
      "/synthetic/not-installed",
      "/synthetic/node",
    );
    vi.spyOn(locator, "find").mockResolvedValue({
      found: true,
      path: "/synthetic/binary",
    });
    const runner = new CliProcessRunner(createCliSpawn());
    const runtime = new AgentCliRuntime({ store, locator, runner });
    vi.spyOn(runtime, "adapter").mockResolvedValue({
      provider: "codex_cli",
      readStatus: vi.fn().mockResolvedValue({
        outcome: { ok: true, detail: {} },
        accountLabel: null,
      }),
      version: vi.fn(),
      startLogin: vi.fn(),
      loginError: vi.fn(),
      runTest: vi.fn(),
      listModels: vi.fn(),
      logout: vi.fn(),
    });
    const started = vi.spyOn(runner, "run").mockResolvedValue({
      stdout: FINAL,
      stderr: "",
      exitCode: 0,
      errorCode: null,
    });
    const input: AgentPlanExecutionInput = {
      userId: "person",
      prompt: "Edit the selected task",
      directory: path.join(root, "copy"),
      agent: {
        model: "listed-model",
        reasoningEffort: "medium",
        connection: {
          isActive: true,
          id: randomUUID(),
          name: "CLI",
          provider: "codex_cli",
          hasApiKey: false,
          testModel: "diagnostic-default",
          reasoningEffort: null,
          cliLoggedInAt: "now",
          cliAccountLabel: null,
          updatedAt: "now",
        },
      },
    };
    return {
      started,
      input,
      execution: new CliPlanExecution({
        store,
        locator,
        runner,
        runtime,
        isolation,
      }),
    };
  }

  it("starts the process in bubblewrap where it works", async () => {
    const current = setup({
      protectedDirectories: [path.join(root, "instance")],
      isRequired: false,
      probe: async () => true,
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await current.execution.run(current.input, new AbortController().signal);
    expect(current.started.mock.calls[0]?.[0]).toMatchObject({
      file: BUBBLEWRAP,
      toolFile: "/synthetic/binary",
      input: "Edit the selected task",
    });
    expect(warning).not.toHaveBeenCalled();
  });

  it("starts the unchanged process and warns once where bubblewrap does not work", async () => {
    const current = setup({
      protectedDirectories: [path.join(root, "instance")],
      isRequired: false,
      probe: async () => false,
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await current.execution.run(current.input, new AbortController().signal);
    await current.execution.run(current.input, new AbortController().signal);
    expect(current.started).toHaveBeenCalledTimes(2);
    expect(current.started.mock.calls[1]?.[0]).toMatchObject({
      file: "/synthetic/binary",
    });
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("refuses the step before any process when the operator demands isolation", async () => {
    const current = setup({
      protectedDirectories: [path.join(root, "instance")],
      isRequired: true,
      probe: async () => false,
    });
    await expect(
      current.execution.run(current.input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "cli_isolation_unavailable" });
    expect(current.started).not.toHaveBeenCalled();
  });

  it("neither probes nor warns without an isolation setting", async () => {
    const current = setup();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await current.execution.run(current.input, new AbortController().signal);
    expect(current.started.mock.calls[0]?.[0]).toMatchObject({
      file: "/synthetic/binary",
    });
    expect(warning).not.toHaveBeenCalled();
  });
});
