import { beforeEach, expect, it, vi } from "vitest";

import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  DEFAULT_AGENT_RUN_OPTIONS,
  acpRunOptions,
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
import type { FakeAdapterOptions } from "../acp/fake-acp-adapter";
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
    readonly provider?: CliProviderId;
    readonly adapter?: FakeAdapterOptions;
  } = {},
): Harness {
  const isClaude = setup.provider === "claude_code";
  const fake = fakeCliSpawn({
    flavor: isClaude ? "claude" : "codex",
    initialMode: isClaude ? "default" : "read-only",
    ...setup.adapter,
  });
  const secure = vi.fn(async () => {});
  const execution = new CliSessionExecution({
    runtime: { adapter: async () => adapter(setup.isLoggedIn ?? true) },
    store: { prepare: async () => HOME, secure },
    locator: {
      find: async (provider) => ({
        found: true,
        path: BINARIES[provider] ?? null,
      }),
      locate: async (binary) =>
        setup.hasAdapter === false
          ? { found: false, path: null }
          : { found: true, path: `/synthetic/bin/${binary}` },
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
      model: provider === "claude_code" ? "claude-sonnet-5-5" : "gpt-synthetic",
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

const READ_ONLY = acpRunOptions("read_only", 0);
const YOLO = acpRunOptions("yolo", 0);
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

it("starts a Claude Code node through the Claude ACP adapter with the connection's Claude CLI, sign-in and only managed switches", async () => {
  const { execution, fake, secure } = harness({ provider: "claude_code" });
  const watcher = observer();
  const session = await execution.open(
    input("claude_code", READ_ONLY),
    new AbortController().signal,
    watcher,
  );
  const turn = await session.turn;
  expect(turn).toMatchObject({ failure: null, errorCode: null });
  expect(turn.effective).toMatchObject({
    adapter: "@agentclientprotocol/claude-agent-acp 0.90.0",
    model: "claude-sonnet-5-5",
    modelOption: "sonnet",
    reasoningEffort: "high",
    sessionMode: "default",
    permissionMode: "read_only",
    shell: "off",
    pagesMcp: "read",
  });
  const [started] = fake.spawned;
  expect(started?.file).toBe("/synthetic/bin/claude-agent-acp");
  expect(started?.arguments).toEqual([]);
  expect(started?.options.cwd).toBe(WORKSPACE);
  const environment = started?.options.env ?? {};
  expect(environment).toMatchObject({
    CLAUDE_CONFIG_DIR: HOME.config,
    CLAUDE_CODE_EXECUTABLE: "/synthetic/bin/claude",
    CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK: "1",
    CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP: "1",
    PAGES_RUN_INSTANCE: "instance-synthetic",
  });
  expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
  expect(JSON.stringify(started)).not.toContain("synthetic-run-token");
  const created = fake.calls.find((call) => call.method === "session/new");
  expect(created?.params).toMatchObject({
    cwd: WORKSPACE,
    mcpServers: [{ name: "pages", command: "/synthetic/bin/node" }],
    _meta: {
      claudeCode: {
        options: {
          settingSources: [],
          strictMcpConfig: true,
          tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
        },
      },
    },
  });
  expect(watcher.started).toHaveBeenCalledWith(
    expect.objectContaining({ mode: "interactive", processId: 4242 }),
  );
  expect((await session.close()).isConfirmed).toBe(true);
  expect(secure).toHaveBeenCalled();
});

it("offers a Claude Code node in YOLO every native tool and approves nothing it has to ask for twice", async () => {
  const { execution, fake } = harness({
    provider: "claude_code",
    isolation: ISOLATION,
  });
  const session = await execution.open(
    input("claude_code", YOLO),
    new AbortController().signal,
    observer(),
  );
  const turn = await session.turn;
  expect(turn.effective).toMatchObject({
    sessionMode: "bypassPermissions",
    permissionMode: "yolo",
    isolation: "bubblewrap",
  });
  const created = fake.calls.find((call) => call.method === "session/new");
  const options = JSON.stringify(created?.params);
  expect(options).toContain('"settingSources":[]');
  expect(options).not.toContain('"tools"');
  expect(options).not.toContain('"disallowedTools"');
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
  {
    provider: "codex_cli",
    scenario: "YOLO without the bubblewrap isolation",
    setup: {},
    options: YOLO,
    code: "plan_yolo_isolation_unavailable",
  },
  {
    provider: "codex_cli",
    scenario: "the earlier write mode, which never becomes YOLO",
    setup: {},
    options: DEFAULT_AGENT_RUN_OPTIONS,
    code: "codex_permission_mode_required",
  },
  {
    provider: "codex_cli",
    scenario: "a server without the ACP adapter",
    setup: { hasAdapter: false },
    options: READ_ONLY,
    code: "plan_acp_adapter_missing",
  },
  {
    provider: "codex_cli",
    scenario: "a connection without a ChatGPT sign-in",
    setup: { isLoggedIn: false },
    options: READ_ONLY,
    code: "cli_not_logged_in",
  },
  {
    provider: "claude_code",
    scenario: "YOLO without the bubblewrap isolation",
    setup: {},
    options: YOLO,
    code: "plan_yolo_isolation_unavailable",
  },
  {
    provider: "claude_code",
    scenario: "the earlier write mode, which never becomes YOLO",
    setup: {},
    options: DEFAULT_AGENT_RUN_OPTIONS,
    code: "claude_permission_mode_required",
  },
  {
    provider: "claude_code",
    scenario: "a server without the Claude ACP adapter",
    setup: { hasAdapter: false },
    options: READ_ONLY,
    code: "plan_claude_acp_adapter_missing",
  },
  {
    provider: "claude_code",
    scenario: "a connection without a Claude sign-in",
    setup: { isLoggedIn: false },
    options: READ_ONLY,
    code: "cli_not_logged_in",
  },
] as const)(
  "refuses $provider with $scenario before any process starts",
  async ({ provider, setup, options, code }) => {
    const { execution, fake, secure } = harness({ ...setup, provider });
    await expect(
      execution.open(
        input(provider, options),
        new AbortController().signal,
        observer(),
      ),
    ).rejects.toEqual(new AgentError(code));
    expect(fake.spawned).toEqual([]);
    // A refusal after the credential folder was prepared restores its modes.
    expect(secure).toHaveBeenCalledTimes(
      code.endsWith("_permission_mode_required") ? 0 : 1,
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
