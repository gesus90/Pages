import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cliEnvironment, spawnCli } from "@/scripts/runner/cli.mjs";

import {
  bindBoundary,
  bridgeJob,
  command,
  restoreEnvironment,
  routeOf,
  spawned,
} from "./runner-cli-harness";

import type { Program } from "./runner-cli-harness";
import type { CommandOverrides } from "./runner-cli-harness";
import type * as ChildProcessModule from "node:child_process";

const boundary = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
  openCodeInventory: vi.fn(),
  openCodeResult: vi.fn(),
  openCodeCommand: vi.fn(),
  antigravityInventory: vi.fn(),
  antigravityCommand: vi.fn(),
}));

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  execFile: boundary.execFile,
  spawn: boundary.spawn,
}));
vi.mock("@/scripts/runner/opencode.mjs", () => ({
  openCodeInventory: boundary.openCodeInventory,
  openCodeResult: boundary.openCodeResult,
  openCodeCommand: boundary.openCodeCommand,
  remoteBanner: (workspace: string): string => `[banner ${workspace}]`,
}));
vi.mock("@/scripts/runner/antigravity.mjs", () => ({
  antigravityInventory: boundary.antigravityInventory,
  antigravityCommand: boundary.antigravityCommand,
}));

beforeEach(() => {
  bindBoundary(boundary);
});

afterEach(() => {
  restoreEnvironment();
});

interface Refusal {
  readonly label: string;
  readonly found: unknown;
  readonly program: Partial<Program>;
}

const folder = "/synthetic/jobs/x/y/folder";
const signal = (): AbortSignal => new AbortController().signal;

const openCodeInventory = {
  tool: "opencode",
  catalogRevision: "rev-1",
  acp: { status: "verified" },
  models: [{ id: "model-a", name: "A", reasoningEfforts: ["low"] }],
};

function openCodeCommand(
  overrides: Partial<Program> = {},
  rest: Omit<CommandOverrides, "program"> = {},
): ReturnType<typeof command> {
  return command({
    ...rest,
    program: {
      model: "model-a",
      access: "yolo",
      reasoningEffort: "low",
      route: routeOf("opencode", "rev-1"),
      ...overrides,
    },
  });
}

it("starts the OpenCode ACP adapter with the job description and the Pages bridge", async () => {
  boundary.openCodeInventory.mockResolvedValue(openCodeInventory);
  boundary.spawn.mockReturnValue({ pid: 1 });
  const controller = new AbortController();
  const child: unknown = await spawnCli(
    openCodeCommand(
      {},
      { pagesAccess: 1, continuation: { resumeSessionId: "acp-1" } },
    ),
    "job-3",
    controller.signal,
    folder,
  );
  expect(child).toEqual({ pid: 1 });
  expect(boundary.openCodeInventory).toHaveBeenCalledWith(cliEnvironment(), {
    signal: controller.signal,
  });
  const { tool, args, options } = spawned();
  expect(tool).toBe(process.execPath);
  expect(args).toEqual(["/synthetic/opencode.mjs", "--acp"]);
  expect(options).toMatchObject({
    cwd: "/synthetic/work",
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect(options.env.PAGES_REMOTE_JOB).toBe("job-3");
  const job = bridgeJob("PAGES_OPENCODE_JOB");
  expect(job).toMatchObject({
    workspace: "/synthetic/work",
    model: "model-a",
    reasoningEffort: "low",
    access: "yolo",
    resumeSessionId: "acp-1",
  });
  expect(job.mcpServers).toHaveLength(1);
  expect(job.mcpServers[0]).toMatchObject({
    name: "pages",
    command: process.execPath,
    env: [],
  });
  expect(job.mcpServers[0]?.args.slice(1)).toEqual([
    "--mcp",
    "/synthetic/jobs/x/pages.sock",
    "job-3",
  ]);
});

it("starts OpenCode without a bridge when Pages access is not granted", async () => {
  boundary.openCodeInventory.mockResolvedValue(openCodeInventory);
  boundary.spawn.mockReturnValue({});
  await spawnCli(
    openCodeCommand({ reasoningEffort: null, access: "read_only" }),
    "job",
    signal(),
    folder,
  );
  const job = bridgeJob("PAGES_OPENCODE_JOB");
  expect(job.mcpServers).toEqual([]);
  expect(job.reasoningEffort).toBeNull();
});

const openCodeRefusals: Refusal[] = [
  { label: "without an inventory", found: null, program: {} },
  {
    label: "with an incompatible ACP",
    found: { ...openCodeInventory, acp: { status: "incompatible" } },
    program: {},
  },
  {
    label: "with another catalog revision",
    found: openCodeInventory,
    program: { route: routeOf("opencode", "old") },
  },
  {
    label: "with an unknown model",
    found: openCodeInventory,
    program: { model: "other" },
  },
  {
    label: "with an unsupported effort",
    found: openCodeInventory,
    program: { reasoningEffort: "high" },
  },
  {
    label: "with an unsupported access",
    found: openCodeInventory,
    program: { access: "write" },
  },
];

it.each(openCodeRefusals)(
  "refuses OpenCode $label",
  async ({ found, program }) => {
    boundary.openCodeInventory.mockResolvedValue(found);
    await expect(
      spawnCli(openCodeCommand(program), "job", signal(), folder),
    ).rejects.toThrow("CLI selection unavailable");
    expect(boundary.spawn).not.toHaveBeenCalled();
  },
);

it("honours an abort after the OpenCode check", async () => {
  const controller = new AbortController();
  boundary.openCodeInventory.mockImplementation(() => {
    controller.abort(new Error("gone"));
    return Promise.resolve(openCodeInventory);
  });
  await expect(
    spawnCli(openCodeCommand(), "job", controller.signal, folder),
  ).rejects.toThrow("gone");
  expect(boundary.spawn).not.toHaveBeenCalled();
});

const antigravityInventory = {
  tool: "antigravity",
  catalogRevision: "rev-2",
  authentication: "authenticated",
  acp: { status: "verified" },
  models: [{ id: "gem", name: "Gem", reasoningEfforts: ["medium"] }],
};

function antigravityCommand(
  overrides: Partial<Program> = {},
  rest: Omit<CommandOverrides, "program"> = {},
): ReturnType<typeof command> {
  return command({
    ...rest,
    program: {
      model: "gem",
      access: "read_only",
      reasoningEffort: "medium",
      route: routeOf("antigravity", "rev-2"),
      ...overrides,
    },
  });
}

it("starts the Antigravity adapter with the context proof and the optional overrides", async () => {
  boundary.antigravityInventory.mockResolvedValue(antigravityInventory);
  boundary.spawn.mockReturnValue({ pid: 2 });
  process.env.PAGES_RUNNER_ANTIGRAVITY_HOME = "/synthetic/ag-home";
  process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT = "/synthetic/ag-root";
  process.env.PAGES_RUNNER_JOB_NAMESPACE = "namespace-1";
  process.env.PAGES_RUNNER_CONTEXT_PROOF = "proof-1";
  const controller = new AbortController();

  const child: unknown = await spawnCli(
    antigravityCommand(
      {},
      { pagesAccess: 1, continuation: { resumeSessionId: "ag-1" } },
    ),
    "job-4",
    controller.signal,
    folder,
  );

  expect(child).toEqual({ pid: 2 });
  expect(boundary.antigravityInventory).toHaveBeenCalledWith(cliEnvironment(), {
    signal: controller.signal,
  });
  const { tool, args, options } = spawned();
  expect(tool).toBe(process.execPath);
  expect(args).toEqual(["/synthetic/antigravity.mjs", "--acp"]);
  expect(options.env).toMatchObject({
    ...cliEnvironment(),
    PAGES_RUNNER_ANTIGRAVITY_HOME: "/synthetic/ag-home",
    PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT: "/synthetic/ag-root",
    PAGES_RUNNER_JOB_NAMESPACE: "namespace-1",
    PAGES_RUNNER_CONTEXT_PROOF: "proof-1",
    PAGES_REMOTE_JOB: "job-4",
  });
  const job = bridgeJob("PAGES_ANTIGRAVITY_JOB");
  expect(job).toMatchObject({
    workspace: "/synthetic/work",
    model: "gem",
    reasoningEffort: "medium",
    access: "read_only",
    resumeSessionId: "ag-1",
  });
  expect(job.mcpServers[0]?.args.slice(1)).toEqual([
    "--mcp",
    "/synthetic/jobs/x/pages.sock",
    "job-4",
  ]);
});

it("omits the Antigravity overrides and the bridge when they are not configured", async () => {
  boundary.antigravityInventory.mockResolvedValue(antigravityInventory);
  boundary.spawn.mockReturnValue({});
  delete process.env.PAGES_RUNNER_ANTIGRAVITY_HOME;
  delete process.env.PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT;
  await spawnCli(
    antigravityCommand({ reasoningEffort: null }),
    "job",
    signal(),
    folder,
  );
  const { options } = spawned();
  expect(options.env).not.toHaveProperty("PAGES_RUNNER_ANTIGRAVITY_HOME");
  expect(options.env).not.toHaveProperty(
    "PAGES_RUNNER_ANTIGRAVITY_CONTEXT_ROOT",
  );
  expect(bridgeJob("PAGES_ANTIGRAVITY_JOB").mcpServers).toEqual([]);
});

const antigravityRefusals: Refusal[] = [
  { label: "without an inventory", found: null, program: {} },
  {
    label: "with an unverified ACP",
    found: { ...antigravityInventory, acp: { status: "incompatible" } },
    program: {},
  },
  {
    label: "without a login",
    found: { ...antigravityInventory, authentication: "not_logged_in" },
    program: {},
  },
  {
    label: "with another catalog revision",
    found: antigravityInventory,
    program: { route: routeOf("antigravity", "old") },
  },
  {
    label: "with an unknown model",
    found: antigravityInventory,
    program: { model: "other" },
  },
  {
    label: "with an unsupported effort",
    found: antigravityInventory,
    program: { reasoningEffort: "high" },
  },
  {
    label: "with an unsupported access",
    found: antigravityInventory,
    program: { access: "write" },
  },
];

it.each(antigravityRefusals)(
  "refuses Antigravity $label",
  async ({ found, program }) => {
    boundary.antigravityInventory.mockResolvedValue(found);
    await expect(
      spawnCli(antigravityCommand(program), "job", signal(), folder),
    ).rejects.toThrow(/Antigravity selection unavailable/);
    expect(boundary.spawn).not.toHaveBeenCalled();
  },
);

it("honours an abort after the Antigravity check", async () => {
  const controller = new AbortController();
  boundary.antigravityInventory.mockImplementation(() => {
    controller.abort(new Error("gone"));
    return Promise.resolve(antigravityInventory);
  });
  await expect(
    spawnCli(antigravityCommand(), "job", controller.signal, folder),
  ).rejects.toThrow("gone");
  expect(boundary.spawn).not.toHaveBeenCalled();
});
