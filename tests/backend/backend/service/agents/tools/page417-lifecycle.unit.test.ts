import { beforeEach, expect, it, vi } from "vitest";

import { AgentToolFiles } from "@/backend/service/agents/tools/AgentToolFiles";
import { AgentToolInstaller } from "@/backend/service/agents/tools/AgentToolInstaller";
import { AgentToolHealthService } from "@/backend/service/agents/tools/AgentToolHealthService";
import { agentToolDefinition } from "@/backend/service/agents/tools/AgentToolRegistry";
import { installAntigravityRelease } from "@/backend/service/agents/tools/AntigravityRelease";

import { environmentFiles as memory } from "../page352-files";
import { deferred } from "../page81-resource-fixture";

import type { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import type { AgentToolProtocolProbe } from "@/backend/service/agents/tools/AgentToolProtocolProbe";

const protocol = vi.hoisted(() => ({
  check: vi.fn<AgentToolProtocolProbe["check"]>(),
}));
vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("../page352-files");
  return environmentFiles.module();
});
vi.mock("@/backend/service/agents/tools/AgentToolProtocolProbe", () => ({
  AgentToolProtocolProbe: class {
    public readonly check = protocol.check;
  },
}));
vi.mock("@/backend/service/agents/tools/AntigravityRelease", () => ({
  installAntigravityRelease: vi.fn(async () => undefined),
}));
vi.mock("@/backend/agents/cli/CliPlanIsolation", () => ({
  probeBubblewrap: async (
    run: (file: string, args: readonly string[]) => Promise<unknown>,
  ) => {
    await run("/usr/bin/bwrap", ["--", "/usr/bin/true"]);
    return true;
  },
}));

const ROOT = "/memory/tools";
const CACHE = `${ROOT}/npm-cache`;
const TEMP_PATTERN = /^\/memory\/tools\/probe\/tmp\/[\da-f-]{36}$/u;

beforeEach(() => {
  memory.reset();
  protocol.check.mockReset();
  vi.mocked(installAntigravityRelease).mockReset();
  if (process.getuid) vi.spyOn(process, "getuid").mockReturnValue(1000);
});

function runnerWorld(): {
  readonly run: ReturnType<typeof vi.fn<CliProcessRunner["run"]>>;
  readonly startSession: CliProcessRunner["startSession"];
} {
  return {
    run: vi.fn<CliProcessRunner["run"]>(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      errorCode: null,
    })),
    startSession: () => {
      throw new Error("Unexpected protocol process");
    },
  };
}

it.each(["success", "failure", "throw", "abort", "postinstall failure"])(
  "cleans npm cache and install TMPDIR after %s, including package postinstall",
  async (outcome) => {
    const files = new AgentToolFiles(ROOT);
    const tool = agentToolDefinition("claude");
    const candidate = await files.candidate(tool);
    const runner = runnerWorld();
    const controller = new AbortController();
    const directories: string[] = [];
    runner.run.mockImplementation(async (request) => {
      const directory = request.environment?.TMPDIR ?? "";
      expect(directory).toMatch(TEMP_PATTERN);
      expect(memory.entries.has(directory)).toBe(true);
      directories.push(directory);
      memory.seed(`${directory}/nested/log`, "file");
      memory.seed(`${CACHE}/package`, "file");
      if (outcome === "throw") throw new Error("synthetic runner failure");
      if (outcome === "abort") {
        controller.abort();
        controller.signal.throwIfAborted();
      }
      return {
        exitCode:
          outcome === "failure" ||
          (outcome === "postinstall failure" &&
            request.file === process.execPath)
            ? 1
            : 0,
        stdout: "",
        stderr: "",
        errorCode: null,
      };
    });
    const installer = new AgentToolInstaller({
      files,
      runner,
      resolve: async () => null,
      locator: { locate: async () => ({ found: true, path: "/bin/npm" }) },
    });
    const installation = installer.install(tool, candidate, controller.signal);
    if (outcome === "success")
      await expect(installation).resolves.toBeUndefined();
    else await expect(installation).rejects.toThrow();
    expect(memory.entries.has(CACHE)).toBe(false);
    expect(new Set(directories).size).toBe(1);
    for (const directory of directories)
      expect(memory.entries.has(directory)).toBe(false);
    if (outcome === "success" || outcome === "postinstall failure")
      expect(runner.run).toHaveBeenCalledTimes(2);
  },
);

it("supplies Antigravity installation with a private temporary directory and removes it", async () => {
  const files = new AgentToolFiles(ROOT);
  const tool = agentToolDefinition("antigravity_acp");
  let temporaryDirectory = "";
  vi.mocked(installAntigravityRelease).mockImplementation(async (input) => {
    temporaryDirectory = input.temporaryDirectory;
    expect(temporaryDirectory).toMatch(TEMP_PATTERN);
    expect(memory.entries.has(temporaryDirectory)).toBe(true);
    memory.seed(`${temporaryDirectory}/extract-output`, "file");
  });
  await new AgentToolInstaller({
    files,
    runner: runnerWorld(),
    resolve: async () => null,
    locator: { locate: async () => ({ found: false, path: null }) },
  }).install(tool, await files.candidate(tool), new AbortController().signal);
  expect(memory.entries.has(temporaryDirectory)).toBe(false);
});

it.each(["codex", "antigravity_acp", "chromium", "bubblewrap"] as const)(
  "supplies %s health checks with a private TMPDIR and deletes output",
  async (id) => {
    const files = new AgentToolFiles(ROOT);
    const tool = agentToolDefinition(id);
    const location = await files.candidate(tool);
    memory.seed(location.file, "file");
    const runner = runnerWorld();
    const capture = (
      environment: Readonly<Record<string, string>> | undefined,
    ): void => {
      const directory = environment?.TMPDIR ?? "";
      expect(directory).toMatch(TEMP_PATTERN);
      expect(memory.entries.has(directory)).toBe(true);
      memory.seed(`${directory}/probe.log`, "file");
    };
    if (id === "antigravity_acp")
      memory.seed(`${location.release}/localharness_external`, "file");
    protocol.check.mockImplementation(async (request) => {
      capture(request.environment);
      return tool.version;
    });
    runner.run.mockImplementation(async (request) => {
      capture(request.environment);
      return {
        exitCode: 0,
        stdout:
          id === "chromium"
            ? JSON.stringify({
                version: "145.0.0.0",
                playwrightVersion: tool.version,
              })
            : `${id} ${tool.version}`,
        stderr: "",
        errorCode: null,
      };
    });
    const health = new AgentToolHealthService({
      files,
      runner,
      resolve: async () => location,
    });
    await expect(
      health.check(tool, location, new AbortController().signal),
    ).resolves.toMatchObject({ status: "ready" });
    const environment =
      id === "antigravity_acp"
        ? protocol.check.mock.calls[0]?.[0].environment
        : runner.run.mock.calls[0]?.[0].environment;
    const directory = environment?.TMPDIR ?? "";
    expect(directory).toMatch(TEMP_PATTERN);
    expect(memory.entries.has(directory)).toBe(false);
    expect(memory.entries.has(`${directory}/probe.log`)).toBe(false);
  },
);

it("uses distinct TMPDIRs for simultaneous health checks and cleans a failed check", async () => {
  const files = new AgentToolFiles(ROOT);
  const tool = agentToolDefinition("codex");
  const location = await files.candidate(tool);
  memory.seed(location.file, "file");
  const runner = runnerWorld();
  const entered = deferred<void>();
  const finish = deferred<void>();
  const directories: string[] = [];
  runner.run.mockImplementation(async (request) => {
    directories.push(request.environment?.TMPDIR ?? "");
    if (directories.length === 2) entered.resolve();
    await finish.promise;
    throw new Error("synthetic probe failure");
  });
  const health = new AgentToolHealthService({
    files,
    runner,
    resolve: async () => null,
  });
  const checks = [
    health.check(tool, location, new AbortController().signal),
    health.check(tool, location, new AbortController().signal),
  ];
  await entered.promise;
  expect(new Set(directories).size).toBe(2);
  for (const directory of directories)
    expect(memory.entries.has(directory)).toBe(true);
  finish.resolve();
  expect(await Promise.all(checks)).toEqual([
    expect.objectContaining({
      status: "failed",
      diagnostic: "execution_failed",
    }),
    expect.objectContaining({
      status: "failed",
      diagnostic: "execution_failed",
    }),
  ]);
  for (const directory of directories)
    expect(memory.entries.has(directory)).toBe(false);
});

it("waits for another tool installation before using and clearing the shared npm cache", async () => {
  const files = new AgentToolFiles(ROOT);
  const runner = runnerWorld();
  const firstTool = agentToolDefinition("codex");
  const secondTool = agentToolDefinition("codex_acp");
  const firstCandidate = await files.candidate(firstTool);
  const secondCandidate = await files.candidate(secondTool);
  const entered = deferred<void>();
  const finish = deferred<void>();
  const completed: string[] = [];
  runner.run.mockImplementation(async (request) => {
    const release = request.environment?.npm_config_prefix ?? "";
    if (release === firstCandidate.release) {
      memory.seed(`${CACHE}/first`, "file");
      entered.resolve();
      await finish.promise;
    } else {
      expect(memory.entries.has(CACHE)).toBe(false);
      memory.seed(`${CACHE}/second`, "file");
    }
    completed.push(release);
    return { exitCode: 0, stdout: "", stderr: "", errorCode: null };
  });
  const createInstaller = (): AgentToolInstaller =>
    new AgentToolInstaller({
      files,
      runner,
      locator: { locate: async () => ({ found: true, path: "/bin/npm" }) },
      resolve: async () => null,
    });
  const first = createInstaller().install(
    firstTool,
    firstCandidate,
    new AbortController().signal,
  );
  await entered.promise;
  const second = createInstaller().install(
    secondTool,
    secondCandidate,
    new AbortController().signal,
  );
  await Promise.resolve();
  expect(runner.run).toHaveBeenCalledOnce();
  expect(memory.entries.has(`${CACHE}/first`)).toBe(true);
  finish.resolve();
  await Promise.all([first, second]);
  expect(completed).toEqual([firstCandidate.release, secondCandidate.release]);
  expect(memory.entries.has(CACHE)).toBe(false);
});
