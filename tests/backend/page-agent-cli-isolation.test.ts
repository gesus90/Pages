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
import { isolateCliPlan } from "@/backend/agents/cli/CliPlanIsolation";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";

import { createCliSpawn } from "../helpers/agent-cli";

import type { CliRunRequest } from "@/backend/agents/cli/CliContracts";
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

function installBubblewrap(isInstalled: boolean): void {
  vi.mocked(access).mockImplementation(async (filename, mode) => {
    if (filename !== BUBBLEWRAP) return actualAccess(filename, mode);
    if (!isInstalled) throw new Error("Not installed");
  });
}

function request(overrides: Partial<CliRunRequest> = {}): CliRunRequest {
  const home = path.join(root, "instance", "credentials", "connection");
  return {
    file: "/usr/bin/agent-cli",
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

describe("PAGE-20 CLI filesystem isolation", () => {
  it("leaves only the working copy and the credential home writable and empties the instance folders", async () => {
    installBubblewrap(true);
    await mkdir(path.join(root, "Agents"));
    const proposed = request();
    const isolated = await isolateCliPlan(proposed, [
      path.join(root, "instance"),
      path.join(root, "Agents"),
    ]);
    const home = path.join(root, "instance", "credentials", "connection");
    expect(isolated?.file).toBe(BUBBLEWRAP);
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
      "/usr/bin/agent-cli",
      "exec",
      "-",
    ]);
    expect(isolated?.input).toBe(proposed.input);
    expect(isolated?.arguments).not.toContain(proposed.input);
  });

  it("reports that no isolation is possible without bubblewrap, and skips folders that do not exist yet", async () => {
    installBubblewrap(false);
    await expect(
      isolateCliPlan(request(), [path.join(root, "instance")]),
    ).resolves.toBeNull();
    installBubblewrap(true);
    const isolated = await isolateCliPlan(request(), [
      path.join(root, "Agents"),
      path.join(root, "instance"),
    ]);
    expect(isolated?.arguments.filter((entry) => entry === "--tmpfs")).toEqual([
      "--tmpfs",
      "--tmpfs",
    ]);
    expect(isolated?.arguments).toContain(path.join(root, "instance"));
    expect(isolated?.arguments).not.toContain(path.join(root, "Agents"));
  });

  it("starts in the work folder of the credential home when no working directory is given", async () => {
    installBubblewrap(true);
    const proposed = request({ workingDirectory: undefined });
    await mkdir(proposed.home.work);
    const isolated = await isolateCliPlan(proposed, [
      path.join(root, "Agents"),
    ]);
    expect(isolated?.arguments).toEqual(
      expect.arrayContaining(["--chdir", proposed.home.work]),
    );
  });

  it("refuses a working directory inside an instance folder but accepts one around it, which is emptied as well", async () => {
    installBubblewrap(true);
    await mkdir(path.join(root, "instance", "work"));
    for (const workingDirectory of [
      path.join(root, "instance"),
      path.join(root, "instance", "work"),
    ])
      await expect(
        isolateCliPlan(request({ workingDirectory }), [
          path.join(root, "instance"),
        ]),
      ).rejects.toMatchObject({ code: "workspace_path_outside_roots" });
    const around = await isolateCliPlan(request({ workingDirectory: root }), [
      path.join(root, "instance"),
    ]);
    expect(around?.arguments).toContain("--tmpfs");
  });
});

describe("PAGE-20 CLI plan execution inside the instance folders", () => {
  function setup(protectedDirectories?: readonly string[]) {
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
        protectedDirectories,
      }),
    };
  }

  it("starts the process in bubblewrap when it is installed", async () => {
    installBubblewrap(true);
    const current = setup([path.join(root, "instance")]);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await current.execution.run(current.input, new AbortController().signal);
    expect(current.started.mock.calls[0]?.[0]).toMatchObject({
      file: BUBBLEWRAP,
      input: "Edit the selected task",
    });
    expect(warning).not.toHaveBeenCalled();
  });

  it("starts the unchanged process and warns once when bubblewrap is missing", async () => {
    installBubblewrap(false);
    const current = setup([path.join(root, "instance")]);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await current.execution.run(current.input, new AbortController().signal);
    await current.execution.run(current.input, new AbortController().signal);
    expect(current.started).toHaveBeenCalledTimes(2);
    expect(current.started.mock.calls[1]?.[0]).toMatchObject({
      file: "/synthetic/binary",
    });
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("neither looks for bubblewrap nor warns without protected folders", async () => {
    const current = setup();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await current.execution.run(current.input, new AbortController().signal);
    expect(
      vi
        .mocked(access)
        .mock.calls.some(([filename]) => filename === BUBBLEWRAP),
    ).toBe(false);
    expect(warning).not.toHaveBeenCalled();
  });
});
