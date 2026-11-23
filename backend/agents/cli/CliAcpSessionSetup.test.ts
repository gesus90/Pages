import { beforeEach, expect, it, vi } from "vitest";

import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import {
  openCliAcpSession,
  prepareCliGitHubAccess,
  preparePicaChat,
  preparePicaSession,
  prepareScopedClaudeHome,
  registerAcpNamespace,
  secureCliAcpAccess,
} from "@/backend/agents/cli/CliAcpSessionSetup";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpDriver } from "@/backend/agents/acp/AcpDriver";
import type { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import type { prepareClaudePlanSessionHome as prepareHome } from "@/backend/agents/cli/ClaudePlanSessionHome";
import type { ClaudePlanSessionHome } from "@/backend/agents/cli/ClaudePlanSessionHome";
import type { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import type { OpenCliAcpSessionContext } from "@/backend/agents/cli/CliAcpSessionSetup";
import type { CliGitHubAccess } from "@/backend/agents/cli/CliGitHubCredentials";
import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";
import type { VerifiedStart } from "@/backend/agents/cli/CliSessionChecks";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";

const h = vi.hoisted(() => ({
  session: vi.fn<(...parameters: unknown[]) => unknown>(),
  pinned: vi.fn<(...parameters: unknown[]) => unknown>(),
  claudeHome: vi.fn<(...parameters: unknown[]) => unknown>(),
  environment: vi.fn<(...parameters: unknown[]) => unknown>(),
  namespace: vi.fn<(...parameters: unknown[]) => unknown>(),
  selectNative: vi.fn<(...parameters: unknown[]) => unknown>(),
  codexBundle: vi.fn<(...parameters: unknown[]) => unknown>(),
}));

vi.mock("@/backend/agents/acp/AcpSession", () => ({
  AcpSession: class {
    public constructor(...parameters: unknown[]) {
      h.session(...parameters);
    }
  },
}));
vi.mock("@/backend/service/agents/tools/AgentToolSession", () => ({
  pinnedAgentToolDriver: h.pinned,
}));
vi.mock("@/backend/agents/cli/ClaudePlanSessionHome", () => ({
  prepareClaudePlanSessionHome: h.claudeHome,
}));
vi.mock("@/backend/agents/cli/CliEnvironment", () => ({
  createCliEnvironment: h.environment,
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  captureOwnedNamespace: h.namespace,
}));
vi.mock("@/backend/agents/cli/CliAcpLaunch", () => ({
  acpMcpServers: (launch: { mcpServers: unknown[] }, browser: unknown) => [
    ...launch.mcpServers,
    browser,
  ],
  acpSessionRequest: (input: unknown, launch: object) => ({ input, launch }),
  isolationLabel: () => "label",
}));
vi.mock("@/backend/agents/cli/CliPicaSessionSetup", () => ({
  selectPicaNativeArtifact: h.selectNative,
  picaCodexBundle: h.codexBundle,
  acpPicaSupport: "support",
}));

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: unknown): T {
  return value as T;
}

function driverOf(provider: string): AcpDriver {
  return fake<AcpDriver>({ provider });
}

function startOf(parts: object = {}): VerifiedStart {
  return fake<VerifiedStart>({
    adapterVersion: "adapter-1",
    browser: "browser",
    home: { config: "/config" },
    provider: "claude_code",
    file: "/file",
    ...parts,
  });
}

function sessionInput(parts: object = {}): AgentPlanSessionInput {
  return fake<AgentPlanSessionInput>({
    instanceId: "instance",
    agent: { connection: { id: "connection" } },
    ...parts,
  });
}

function contextOf(parts: object = {}): OpenCliAcpSessionContext {
  return fake<OpenCliAcpSessionContext>({
    child: "child",
    channel: fake<AcpLineChannel>({
      stream: "stream",
      acknowledge: vi.fn(),
    }),
    driver: driverOf("claude_code"),
    input: sessionInput(),
    start: startOf(),
    control: { observer: "observer", signal: "signal" },
    profile: "profile",
    launch: { mcpServers: ["server"] },
    picaNative: null,
    picaBundle: null,
    isIsolated: true,
    mode: "yolo",
    limited: { label: "limits" },
    containment: "none",
    github: null,
    redact: "redact",
    secure: "secure",
    ...parts,
  });
}

beforeEach(() => {
  h.pinned.mockReturnValue("pinned");
});

function options(): Record<string, unknown> {
  return fake<Record<string, unknown>>(h.session.mock.calls[0][2]);
}

it("opens a plan session over the worker channel", () => {
  openCliAcpSession(contextOf());
  expect(h.pinned).toHaveBeenCalledWith(expect.anything(), "adapter-1");
  expect(h.session.mock.calls[0].slice(0, 2)).toEqual(["child", "stream"]);
  expect(options()).toMatchObject({
    instanceId: "instance",
    driver: "pinned",
    profile: "profile",
    request: { launch: { mcpServers: ["server", "browser"] } },
    observer: "observer",
    signal: "signal",
    isolation: "label; limits",
    containment: "none",
    github: undefined,
    cleanupAdapter: undefined,
    listener: undefined,
    openCodeDataHome: undefined,
    codexHome: undefined,
    acceptsTurnInput: true,
  });
});

it("acknowledges notifications through the channel", () => {
  const acknowledge = vi.fn();
  openCliAcpSession(contextOf({ channel: { stream: "stream", acknowledge } }));
  fake<{ notificationHandled: () => void }>(options()).notificationHandled();
  expect(acknowledge).toHaveBeenCalledOnce();
});

it("pins a native Pica build and the bundle version of a chat", () => {
  openCliAcpSession(
    contextOf({
      picaNative: { version: "native-1" },
      input: sessionInput({ chat: { listener: "chat-listener" } }),
    }),
  );
  expect(h.pinned).toHaveBeenLastCalledWith(expect.anything(), "native-1");
  openCliAcpSession(
    contextOf({
      picaNative: { version: "native-1" },
      picaBundle: { version: "bundle-1", cleanup: "cleanup" },
    }),
  );
  expect(h.pinned).toHaveBeenLastCalledWith(expect.anything(), "bundle-1");
  expect(h.session.mock.calls[0][2]).toMatchObject({
    listener: "chat-listener",
    acceptsTurnInput: false,
  });
  expect(h.session.mock.calls[1][2]).toMatchObject({
    cleanupAdapter: "cleanup",
  });
});

it("uses the journal and the GitHub status of a plan session", () => {
  openCliAcpSession(
    contextOf({
      input: sessionInput({ journal: "journal" }),
      github: { status: "status" },
    }),
  );
  expect(options()).toMatchObject({ listener: "journal", github: "status" });
});

it("hands the data and Codex homes only to their providers", () => {
  openCliAcpSession(contextOf({ driver: driverOf("opencode") }));
  openCliAcpSession(contextOf({ driver: driverOf("codex_cli") }));
  openCliAcpSession(
    contextOf({
      driver: driverOf("codex_cli"),
      input: sessionInput({ chat: {} }),
    }),
  );
  expect(h.session.mock.calls[0][2]).toMatchObject({
    openCodeDataHome: "/config",
    codexHome: undefined,
  });
  expect(h.session.mock.calls[1][2]).toMatchObject({ codexHome: "/config" });
  expect(h.session.mock.calls[2][2]).toMatchObject({ codexHome: undefined });
});

it("prepares Pica for a chat and for a plan session", async () => {
  h.selectNative.mockReturnValue("native");
  h.codexBundle.mockResolvedValue("bundle");
  const launch = fake<OpenCliAcpSessionContext["launch"]>({});
  const profile = fake<OpenCliAcpSessionContext["profile"]>({});
  const base = {
    driver: driverOf("codex_cli"),
    start: startOf(),
    launch,
    profile,
    adapter: "/adapter",
  };
  expect(await preparePicaChat({ ...base, input: sessionInput() })).toEqual({
    picaNative: null,
    picaBundle: null,
  });
  const retained = vi.fn(async () => null);
  const prepared = await preparePicaChat(
    { ...base, input: sessionInput({ chat: {}, directory: "/work" }) },
    { directory: "/tools", retained },
  );
  expect(prepared).toEqual({
    picaNative: "native",
    picaBundle: "bundle",
    picaSupport: "support",
  });
  expect(h.selectNative).toHaveBeenCalledWith(
    expect.objectContaining({ toolsDirectory: "/tools", adapter: "/adapter" }),
  );
  const [, directory, adapter] = h.codexBundle.mock.calls[0];
  expect(directory).toBe("/work");
  expect(adapter).toMatchObject({ file: "/adapter", version: "adapter-1" });
  expect(
    await fake<{ retained: () => Promise<unknown> }>(adapter).retained(),
  ).toBeNull();
  expect(retained).toHaveBeenCalledWith("codex_acp");
});

it("loads Pica without tools by retaining nothing", async () => {
  await preparePicaSession({
    driver: driverOf("codex_cli"),
    input: sessionInput({ chat: {}, directory: "/work" }),
    launch: fake<OpenCliAcpSessionContext["launch"]>({}),
    profile: fake<OpenCliAcpSessionContext["profile"]>({}),
    adapter: "/adapter",
  });
  expect(h.selectNative).toHaveBeenCalledWith(
    expect.objectContaining({ toolsDirectory: undefined }),
  );
  expect(
    await fake<{ retained: () => Promise<unknown> }>(
      h.codexBundle.mock.calls[0][2],
    ).retained(),
  ).toBeNull();
});

it("gives only a Claude plan session a home of its own", async () => {
  const home = vi
    .fn<typeof prepareHome>()
    .mockResolvedValue(fake<ClaudePlanSessionHome>("home"));
  const run = {
    planId: "plan",
    runId: "run",
    sessionScopeId: "scope",
    stepId: "step",
    sourceRunId: "source",
  };
  const input = sessionInput({ resourceContext: run });
  const claude = driverOf("claude_code");
  expect(
    await prepareScopedClaudeHome(
      driverOf("codex_cli"),
      input,
      startOf(),
      home,
    ),
  ).toBeNull();
  expect(
    await prepareScopedClaudeHome(
      claude,
      sessionInput({ chat: {} }),
      startOf(),
      home,
    ),
  ).toBeNull();
  expect(
    await prepareScopedClaudeHome(
      claude,
      sessionInput({ purpose: "observer" }),
      startOf(),
      home,
    ),
  ).toBeNull();
  expect(await prepareScopedClaudeHome(claude, input, startOf(), home)).toBe(
    "home",
  );
  expect(home).toHaveBeenLastCalledWith(
    { config: "/config" },
    {
      planId: "plan",
      runId: "run",
      scopeId: "scope",
      sourceRunId: "source",
    },
  );
});

it("falls back to the step, to empty IDs and to the default home", async () => {
  const claude = driverOf("claude_code");
  const home = vi
    .fn<typeof prepareHome>()
    .mockResolvedValue(fake<ClaudePlanSessionHome>(null));
  await prepareScopedClaudeHome(
    claude,
    sessionInput({ resourceContext: { stepId: "step" } }),
    startOf(),
    home,
  );
  expect(home.mock.calls[0][1]).toMatchObject({
    planId: "",
    scopeId: "step",
  });
  await prepareScopedClaudeHome(claude, sessionInput(), startOf(), home);
  expect(home.mock.calls[1][1]).toEqual({
    planId: "",
    runId: "",
    scopeId: "",
    sourceRunId: undefined,
  });
  h.claudeHome.mockResolvedValue("default");
  expect(await prepareScopedClaudeHome(claude, sessionInput(), startOf())).toBe(
    "default",
  );
});

function namespaceOptions(
  parts: object = {},
): Parameters<typeof registerAcpNamespace>[0] {
  return {
    resources: fake<AcpResourceScheduler>({
      registerNamespace: vi.fn(async () => {}),
    }),
    input: sessionInput(),
    processId: 42,
    request: fake<CliSessionRequest>({}),
    containment: "pid_namespace",
    ...parts,
  };
}

it("registers the identity of the process frame", async () => {
  h.namespace.mockResolvedValue({ pid: 42 });
  const withUnit = namespaceOptions({
    request: { unit: { name: "unit.service" } },
  });
  expect(await registerAcpNamespace(withUnit)).toEqual({
    pid: 42,
    unit: "unit.service",
  });
  expect(withUnit.resources?.registerNamespace).toHaveBeenCalledWith(
    "instance",
    { pid: 42, unit: "unit.service" },
  );
  expect(
    await registerAcpNamespace(namespaceOptions({ resources: undefined })),
  ).toEqual({
    pid: 42,
  });
});

it("registers nothing without containment or for a failed unit spawn", async () => {
  expect(
    await registerAcpNamespace(namespaceOptions({ containment: "none" })),
  ).toBeUndefined();
  expect(
    await registerAcpNamespace(
      namespaceOptions({ processId: null, containment: "worker_unit" }),
    ),
  ).toBeUndefined();
  await expect(
    registerAcpNamespace(namespaceOptions({ processId: null })),
  ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);
  await expect(
    registerAcpNamespace(namespaceOptions({ processId: 0 })),
  ).rejects.toBeInstanceOf(AcpCleanupUnconfirmedError);
});

function githubDependencies(): {
  github: { prepare: ReturnType<typeof vi.fn> };
  locator: { locate: ReturnType<typeof vi.fn> };
} {
  return {
    github: { prepare: vi.fn(async () => "prepared") },
    locator: { locate: vi.fn(async () => ({ path: "/bin/gh" })) },
  };
}

it("prepares no GitHub access without a credential service", async () => {
  expect(
    await prepareCliGitHubAccess(
      fake<Parameters<typeof prepareCliGitHubAccess>[0]>({ locator: {} }),
      sessionInput(),
      startOf(),
      "yolo",
    ),
  ).toBeNull();
});

it("prepares the authorized access with the bridge of a yolo session", async () => {
  h.environment.mockReturnValue({ PATH: "/search" });
  const dependencies = githubDependencies();
  const access = { status: "available" };
  const gitBridge = vi.fn(async () => "bridge");
  const result = await prepareCliGitHubAccess(
    fake<Parameters<typeof prepareCliGitHubAccess>[0]>(dependencies),
    sessionInput({ github: async () => access, gitBridge }),
    startOf({ adapter: "/adapter" }),
    "yolo",
  );
  expect(result).toBe("prepared");
  expect(dependencies.locator.locate).toHaveBeenCalledWith("gh");
  expect(h.environment).toHaveBeenCalledWith(
    { config: "/config" },
    "claude_code",
    "/adapter",
  );
  expect(dependencies.github.prepare).toHaveBeenCalledWith({
    instanceId: "instance",
    access,
    gh: "/bin/gh",
    bridge: "bridge",
    searchPath: "/search",
  });
});

it("marks read-only and unconnected sessions as unavailable", async () => {
  h.environment.mockReturnValue({});
  const dependencies = githubDependencies();
  const typed =
    fake<Parameters<typeof prepareCliGitHubAccess>[0]>(dependencies);
  await prepareCliGitHubAccess(typed, sessionInput(), startOf(), "read_only");
  await prepareCliGitHubAccess(typed, sessionInput(), startOf(), "yolo");
  const calls = dependencies.github.prepare.mock.calls.map(([call]) => call);
  expect(calls[0]).toMatchObject({
    access: { status: "unavailable", reason: "read-only session" },
    gh: null,
    bridge: undefined,
  });
  expect(calls[1]).toMatchObject({
    access: {
      status: "unavailable",
      reason: "no authorized project connection",
    },
    bridge: undefined,
  });
  expect(dependencies.locator.locate).not.toHaveBeenCalled();
});

it("cleans GitHub and secures the credential store even when cleanup fails", async () => {
  const secure = vi.fn(async () => {});
  const store = fake<Pick<AgentCredentialStore, "secure">>({ secure });
  const cleanup = vi.fn(async () => {});
  await secureCliAcpAccess(
    store,
    sessionInput(),
    startOf(),
    fake<CliGitHubAccess>({ cleanup }),
  );
  expect(cleanup).toHaveBeenCalledOnce();
  expect(secure).toHaveBeenCalledWith("connection", "claude_code");
  await secureCliAcpAccess(store, sessionInput(), startOf(), null);
  const failing = fake<CliGitHubAccess>({
    cleanup: async () => {
      throw new Error("cleanup");
    },
  });
  await expect(
    secureCliAcpAccess(store, sessionInput(), startOf(), failing),
  ).rejects.toThrow("cleanup");
  expect(secure).toHaveBeenCalledTimes(3);
});
