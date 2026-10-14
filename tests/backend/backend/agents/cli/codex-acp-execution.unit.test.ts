import { beforeEach, expect, it, vi } from "vitest";

import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  DEFAULT_AGENT_RUN_OPTIONS,
  codexRunOptions,
} from "@/definition/AgentConfiguration";

import { fakeCliSpawn } from "./fake-cli-spawn";

import type { Mock } from "vitest";
import type {
  AgentPlanSessionInput,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { CliIsolationOptions } from "@/backend/agents/cli/CliSessionExecution";
import type {
  CliHome,
  CliToolAdapter,
} from "@/backend/agents/cli/CliContracts";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { FakeCliSpawn } from "./fake-cli-spawn";

const files = vi.hoisted(() => ({ existing: new Set<string>() }));
vi.mock("node:fs/promises", () => ({
  access: async (file: string) => {
    if (!files.existing.has(file)) throw new Error(`ENOENT ${file}`);
  },
  realpath: async (file: string) => file,
}));
const scan = vi.hoisted(() => ({
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  endTaggedProcesses: scan.endTaggedProcesses,
}));

const WORKSPACE = "/synthetic/workspace";
const HOME: CliHome = {
  root: "/synthetic/data/agents/connection",
  home: "/synthetic/data/agents/connection/home",
  config: "/synthetic/data/agents/connection/codex",
  work: "/synthetic/data/agents/connection/work",
};
const BINARIES: Readonly<Record<string, string>> = {
  codex_cli: "/synthetic/bin/codex",
  claude_code: "/synthetic/bin/claude",
  opencode: "/synthetic/bin/opencode",
};

beforeEach(() => {
  files.existing.clear();
  scan.endTaggedProcesses.mockImplementation(async () => ({
    found: 0,
    remaining: 0,
  }));
});

function adapter(isLoggedIn: boolean): CliToolAdapter {
  return {
    provider: "codex_cli",
    readStatus: async () => ({
      outcome: isLoggedIn
        ? { ok: true, detail: { authMethod: "chatgpt" } }
        : { ok: false, errorCode: "cli_not_logged_in", detail: {} },
      accountLabel: null,
    }),
    version: async () => ({ ok: true, detail: {} }),
    runTest: async () => ({ ok: true, detail: {} }),
    listModels: async () => [],
    logout: async () => ({ ok: true, detail: {} }),
  };
}

interface Harness {
  readonly execution: CliSessionExecution;
  readonly fake: FakeCliSpawn;
  readonly secure: Mock<() => Promise<void>>;
}

function harness(
  setup: {
    readonly isolation?: CliIsolationOptions;
    readonly hasAdapter?: boolean;
    readonly isLoggedIn?: boolean;
  } = {},
): Harness {
  const fake = fakeCliSpawn({ initialMode: "read-only" });
  const secure = vi.fn(async () => {});
  const execution = new CliSessionExecution({
    runtime: { adapter: async () => adapter(setup.isLoggedIn ?? true) },
    store: { prepare: async () => HOME, secure },
    locator: {
      find: async (provider) => ({
        found: true,
        path: BINARIES[provider] ?? null,
      }),
      locate: async () =>
        setup.hasAdapter === false
          ? { found: false, path: null }
          : { found: true, path: "/synthetic/bin/codex-acp" },
    },
    runner: new CliProcessRunner({
      spawn: fake.spawn,
      signalGroup: fake.signalGroup,
    }),
    isolation: setup.isolation,
  });
  return { execution, fake, secure };
}

function input(
  provider: CliProviderId,
  options: AgentRunOptions,
): AgentPlanSessionInput {
  return {
    agent: {
      model: "gpt-synthetic",
      reasoningEffort: "high",
      connection: {
        id: "connection",
        name: "Codex",
        provider,
        isActive: true,
        hasApiKey: false,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: "2026-01-01",
        cliAccountLabel: null,
        updatedAt: "2026-01-01",
      },
    },
    userId: "owner",
    prompt: "Complete synthetic prompt",
    directory: WORKSPACE,
    options,
    instanceId: "instance-synthetic",
    mcp: {
      node: "/synthetic/bin/node",
      bundle: "/synthetic/pages-mcp.cjs",
      url: "http://pages.invalid",
      token: "synthetic-run-token",
      tools: null,
    },
  };
}

function observer(): PlanSessionObserver & {
  readonly started: Mock<PlanSessionObserver["started"]>;
} {
  return {
    started: vi.fn<PlanSessionObserver["started"]>(),
    identified: vi.fn<PlanSessionObserver["identified"]>(),
  };
}

const READ_ONLY = codexRunOptions("read_only", 0);
const YOLO = codexRunOptions("yolo", 0);
const ISOLATION: CliIsolationOptions = {
  protectedDirectories: ["/synthetic/data"],
  isRequired: false,
  probe: async () => true,
};

it("starts a Codex node through the ACP adapter in its workspace, with the connection's Codex CLI and sign-in", async () => {
  const { execution, fake, secure } = harness();
  const watcher = observer();
  const session = await execution.open(
    input("codex_cli", READ_ONLY),
    new AbortController().signal,
    watcher,
  );
  const turn = await session.turn;
  expect(turn).toMatchObject({ failure: null, errorCode: null });
  const [started] = fake.spawned;
  expect(started?.file).toBe("/synthetic/bin/codex-acp");
  expect(started?.arguments).toEqual([]);
  expect(started?.options.cwd).toBe(WORKSPACE);
  const environment = started?.options.env ?? {};
  expect(environment).toMatchObject({
    CODEX_HOME: HOME.config,
    CODEX_PATH: "/synthetic/bin/codex",
    INITIAL_AGENT_MODE: "read-only",
    PAGES_RUN_INSTANCE: "instance-synthetic",
    NO_BROWSER: "1",
  });
  expect(JSON.parse(environment.CODEX_CONFIG ?? "{}")).toMatchObject({
    forced_login_method: "chatgpt",
    model_provider: "openai",
    features: { shell_tool: false, unified_exec: false },
  });
  expect(JSON.stringify(started)).not.toContain("synthetic-run-token");
  expect(environment.OPENAI_API_KEY).toBeUndefined();
  expect(watcher.started).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "interactive", processId: 4242 }),
  );
  expect(fake.calls.map((call) => call.method)).toContain("session/prompt");
  expect((await session.close()).isConfirmed).toBe(true);
  expect(secure).toHaveBeenCalled();
});

it("keeps Claude Code on its own CLI session; only Codex speaks ACP", async () => {
  const { execution, fake } = harness();
  const session = await execution.open(
    input("claude_code", DEFAULT_AGENT_RUN_OPTIONS),
    new AbortController().signal,
    observer(),
  );
  const [started] = fake.spawned;
  expect(started?.file).toBe("/synthetic/bin/claude");
  expect(started?.arguments).toContain("--permission-mode");
  expect(started?.options.env?.INITIAL_AGENT_MODE).toBeUndefined();
  await session.close();
});

it("runs YOLO only inside bubblewrap, and Nur Lesen there with a read-only workspace", async () => {
  for (const [options, mount] of [
    [YOLO, "--bind"],
    [READ_ONLY, "--ro-bind"],
  ] as const) {
    const { execution, fake } = harness({ isolation: ISOLATION });
    const session = await execution.open(
      input("codex_cli", options),
      new AbortController().signal,
      observer(),
    );
    const [started] = fake.spawned;
    const args = started?.arguments ?? [];
    expect(started?.file).toBe("/usr/bin/bwrap");
    expect(args[args.indexOf(WORKSPACE) - 1]).toBe(mount);
    expect(args.at(-1)).toBe("/synthetic/bin/codex-acp");
    expect(args).toEqual(
      expect.arrayContaining(["--tmpfs", "/synthetic/data"]),
    );
    await session.close();
  }
});

it.each([
  [
    "YOLO without the bubblewrap isolation",
    {},
    YOLO,
    "plan_permission_mode_unenforceable",
  ],
  [
    "the earlier write mode, which never becomes YOLO",
    {},
    DEFAULT_AGENT_RUN_OPTIONS,
    "codex_permission_mode_required",
  ],
  [
    "a server without the ACP adapter",
    { hasAdapter: false },
    READ_ONLY,
    "plan_acp_adapter_missing",
  ],
  [
    "a connection without a ChatGPT sign-in",
    { isLoggedIn: false },
    READ_ONLY,
    "cli_not_logged_in",
  ],
] as const)(
  "refuses %s before any process starts",
  async (scenario, setup, options, code) => {
    const { execution, fake, secure } = harness(setup);
    await expect(
      execution.open(
        input("codex_cli", options),
        new AbortController().signal,
        observer(),
      ),
    ).rejects.toEqual(new AgentError(code));
    expect(fake.spawned).toEqual([]);
    // A refusal after the credential folder was prepared restores its modes.
    expect(secure).toHaveBeenCalledTimes(
      code === "codex_permission_mode_required" ? 0 : 1,
    );
  },
);

it.each([`${HOME.config}/config.toml`, `${WORKSPACE}/.codex/config.toml`])(
  "refuses a Codex configuration file Pages does not manage: %s",
  async (file) => {
    files.existing.add(file);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { execution, fake } = harness();
    await expect(
      execution.open(
        input("codex_cli", READ_ONLY),
        new AbortController().signal,
        observer(),
      ),
    ).rejects.toEqual(new AgentError("plan_codex_configuration_unmanaged"));
    expect(fake.spawned).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(file));
  },
);
