import { readFile } from "node:fs/promises";

import { beforeEach, expect, it, vi } from "vitest";

import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { endTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";
import { probeBubblewrap } from "@/backend/agents/cli/CliPlanIsolation";
import {
  AgentToolHealthService,
  BROWSER_PROBE_SCRIPT,
} from "@/backend/service/agents/tools/AgentToolHealthService";
import { agentToolDefinition } from "@/backend/service/agents/tools/AgentToolRegistry";

import { fakeCliSpawn } from "../../../agents/cli/fake-cli-spawn";
import { toolMcpSpawn } from "./page69-mcp-spawn";
import { toolLocation, toolWorld } from "./page69-tool-world";

vi.mock("node:fs/promises", () => ({
  access: vi.fn(async () => undefined),
  realpath: vi.fn(async (file: string) => file),
  readFile: vi.fn(),
}));
vi.mock("@/backend/agents/cli/CliPlanIsolation", () => ({
  probeBubblewrap: vi.fn(async () => true),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  readServerScope: async () => ({ earliestStart: 0 }),
  readSpawnScope: async () => ({ earliestStart: 0 }),
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));

beforeEach(() => {
  vi.mocked(endTaggedProcesses).mockClear();
  vi.mocked(probeBubblewrap).mockResolvedValue(true);
  vi.mocked(readFile).mockResolvedValue(
    JSON.stringify({ name: "@playwright/mcp", version: "0.0.83" }),
  );
});

it("contains the Antigravity probe in its own PID namespace", async () => {
  const world = toolWorld();
  const fake = fakeCliSpawn({
    agentInfo: { name: "antigravity-acp", version: "1.4.4" },
  });
  const health = new AgentToolHealthService({
    files: world.storage,
    runner: new CliProcessRunner({
      spawn: fake.spawn,
      signalGroup: fake.signalGroup,
    }),
    resolve: async () => null,
  });
  const location = toolLocation("antigravity_acp", "1.4.4");
  await expect(
    health.check(
      agentToolDefinition("antigravity_acp"),
      location,
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ status: "ready", version: "1.4.4" });
  const launched = fake.spawned[0];
  expect(launched?.file).toBe("/usr/bin/bwrap");
  expect(launched?.arguments).toContain("--die-with-parent");
  expect(launched?.arguments).toContain("--unshare-pid");
  expect(launched?.arguments).toContain(location.file);
  expect(launched?.arguments).toContain("--uid=");
  expect(endTaggedProcesses).not.toHaveBeenCalled();
});

it("contains the Pages MCP readiness probe in its own PID namespace", async () => {
  const world = toolWorld();
  const fake = toolMcpSpawn();
  const spawn = vi.fn(fake.spawn);
  const health = new AgentToolHealthService({
    files: world.storage,
    runner: new CliProcessRunner({
      spawn,
      signalGroup: () => undefined,
    }),
    resolve: async () => null,
  });
  await expect(
    health.check(
      agentToolDefinition("pages_mcp"),
      toolLocation("pages_mcp"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ status: "ready" });
  expect(fake.methods).toEqual(["initialize"]);
  const [file, args] = spawn.mock.calls[0] ?? [];
  expect(file).toBe("/usr/bin/bwrap");
  expect(args).toContain("--unshare-pid");
  expect(args).toContain("health-check");
  expect(endTaggedProcesses).not.toHaveBeenCalled();
});

it("initializes the real ACP client contract with a fake process without a session or model prompt", async () => {
  const world = toolWorld();
  const fake = fakeCliSpawn();
  const runner = new CliProcessRunner({
    spawn: fake.spawn,
    signalGroup: fake.signalGroup,
  });
  const health = new AgentToolHealthService({
    files: world.storage,
    runner,
    resolve: async () => toolLocation("codex", "0.160.0"),
  });
  await expect(
    health.check(
      agentToolDefinition("codex_acp"),
      toolLocation("codex_acp", "2.2.2"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ status: "ready", version: "2.2.2" });
  expect(fake.calls.map((call) => call.method)).toEqual(["initialize"]);
});

it("refuses an incompatible ACP handshake and cleans the probe process", async () => {
  const world = toolWorld();
  const fake = fakeCliSpawn({
    agentInfo: { name: "other-agent", version: "9.0.0" },
  });
  const runner = new CliProcessRunner({
    spawn: fake.spawn,
    signalGroup: fake.signalGroup,
  });
  const health = new AgentToolHealthService({
    files: world.storage,
    runner,
    resolve: async () => null,
  });
  await expect(
    health.check(
      agentToolDefinition("codex_acp"),
      toolLocation("codex_acp"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({
    status: "failed",
    diagnostic: "handshake_failed",
  });
});

it("starts a mocked MCP server, initializes it and confirms its advertised tools", async () => {
  const world = toolWorld();
  const fake = toolMcpSpawn();
  const runner = new CliProcessRunner({
    spawn: fake.spawn,
    signalGroup: () => undefined,
  });
  const health = new AgentToolHealthService({
    files: world.storage,
    runner,
    resolve: async () => null,
  });
  await expect(
    health.check(
      agentToolDefinition("playwright_mcp"),
      toolLocation("playwright_mcp"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ status: "ready", version: "0.0.83" });
  expect(fake.methods).toEqual([
    "initialize",
    "notifications/initialized",
    "tools/list",
  ]);
  expect(fake.environments[0]?.OPENAI_API_KEY).toBeUndefined();
  vi.mocked(readFile).mockResolvedValueOnce(
    JSON.stringify({ name: "@playwright/mcp", version: "99.0.0" }),
  );
  await expect(
    health.check(
      agentToolDefinition("playwright_mcp"),
      toolLocation("playwright_mcp"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ status: "unsupported", version: "99.0.0" });
});

it("checks a browser with a real launch/close script through a mocked process boundary", async () => {
  const world = toolWorld();
  const run = vi.fn<CliProcessRunner["run"]>(async () => ({
    exitCode: 0,
    stdout: JSON.stringify({
      version: "145.0.0.0",
      playwrightVersion: "1.64.0-alpha-1790635538000",
    }),
    stderr: "",
    errorCode: null,
  }));
  const health = new AgentToolHealthService({
    files: world.storage,
    runner: {
      run,
      startSession: () => {
        throw new Error("Unexpected protocol launch");
      },
    },
    resolve: async () => toolLocation("playwright_mcp"),
  });
  await expect(
    health.check(
      agentToolDefinition("chromium"),
      toolLocation("chromium"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ status: "ready", runtimeVersion: "145.0.0.0" });
  expect(run.mock.calls[0]?.[0]).toMatchObject({
    file: "/usr/bin/bwrap",
    arguments: [
      "--die-with-parent",
      "--unshare-pid",
      "--bind",
      "/",
      "/",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--",
      process.execPath,
      "-e",
      BROWSER_PROBE_SCRIPT,
    ],
    environment: {
      TMPDIR: "/memory/tools/probe",
      PAGES_BROWSER: "chromium",
      PLAYWRIGHT_BROWSERS_PATH: "/memory/tools/chromium/synthetic/browsers",
    },
  });
  expect(BROWSER_PROBE_SCRIPT).toContain("chromiumSandbox: true");
  expect(BROWSER_PROBE_SCRIPT).toContain("await browser.close()");
  run.mockResolvedValueOnce({
    exitCode: 1,
    stdout: "",
    stderr: "missing synthetic library",
    errorCode: null,
  });
  await expect(
    health.check(
      agentToolDefinition("chromium"),
      toolLocation("chromium"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ diagnostic: "browser_failed" });
  run.mockResolvedValueOnce({
    exitCode: 1,
    stdout: "browser_sandbox_unavailable",
    stderr: "",
    errorCode: null,
  });
  await expect(
    health.check(
      agentToolDefinition("chromium"),
      toolLocation("chromium"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({
    status: "missing_dependency",
    diagnostic: "browser_sandbox_unavailable",
  });
});

it("uses the actual bubblewrap functionality boundary instead of executable presence", async () => {
  const world = toolWorld();
  const health = new AgentToolHealthService({
    files: world.storage,
    runner: new CliProcessRunner({
      spawn: () => {
        throw new Error("Unexpected spawn");
      },
    }),
    resolve: async () => null,
  });
  vi.mocked(probeBubblewrap).mockResolvedValueOnce(false);
  await expect(
    health.check(
      agentToolDefinition("bubblewrap"),
      toolLocation("bubblewrap"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({
    status: "missing_dependency",
    diagnostic: "sandbox_unavailable",
  });
  expect(probeBubblewrap).toHaveBeenCalledOnce();
});

it("diagnoses unsupported CLI versions and does not confuse a successful exit with readiness", async () => {
  const world = toolWorld();
  const run = vi.fn<CliProcessRunner["run"]>(async () => ({
    exitCode: 0,
    stdout: "codex 99.0.0",
    stderr: "",
    errorCode: null,
  }));
  const health = new AgentToolHealthService({
    files: world.storage,
    runner: {
      run,
      startSession: () => {
        throw new Error("Unexpected protocol launch");
      },
    },
    resolve: async () => null,
  });
  await expect(
    health.check(
      agentToolDefinition("codex"),
      toolLocation("codex"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ status: "unsupported", version: "99.0.0" });
});

it("recognizes the leading v of the running Node version and verifies the MCP runtime minimum", async () => {
  const world = toolWorld();
  const run = vi.fn<CliProcessRunner["run"]>(async () => ({
    exitCode: 0,
    stdout: "v24.19.0\n",
    stderr: "",
    errorCode: null,
  }));
  const health = new AgentToolHealthService({
    files: world.storage,
    runner: {
      run,
      startSession: () => {
        throw new Error("Unexpected protocol launch");
      },
    },
    resolve: async () => null,
  });
  await expect(
    health.check(
      agentToolDefinition("node"),
      toolLocation("node"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ status: "ready", version: "24.19.0" });
  run.mockResolvedValueOnce({
    exitCode: 0,
    stdout: "v22.22.0",
    stderr: "",
    errorCode: null,
  });
  await expect(
    health.check(
      agentToolDefinition("node"),
      toolLocation("node"),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({
    status: "unsupported",
    diagnostic: "version_unsupported",
  });
});
