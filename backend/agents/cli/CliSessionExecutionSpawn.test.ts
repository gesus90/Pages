import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";

interface OpenContext {
  readonly limited: { readonly label: string };
  readonly redact: (text: string) => string;
  readonly secure: () => Promise<void>;
  readonly claudeQuota?: unknown;
}

interface WorkerRequest {
  readonly onLine: (line: string) => void;
}

interface PicaInput {
  readonly launch: { readonly mcpServers: unknown[] };
}

const h = vi.hoisted(() => ({
  gate: vi.fn(),
  isolation: vi.fn(),
  isolateSession: vi.fn(),
  playwright: vi.fn(),
  prepareTools: vi.fn(),
  observeTools: vi.fn(),
  superviseTools: vi.fn(),
  adapterVersion: vi.fn(),
  providerToolIds: vi.fn(),
  driverFor: vi.fn(),
  logCaught: vi.fn(),
  logDiagnostic: vi.fn(),
  merge: vi.fn(),
  readsHostConfiguration: vi.fn(),
  nativeHostRequest: vi.fn(),
  readNativeHost: vi.fn(),
  describeAgent: vi.fn(),
  agentObserver: vi.fn(),
  connectChild: vi.fn(),
  assetSession: vi.fn(),
  assetWorkspace: vi.fn(),
  prepareAssets: vi.fn(),
  cleanupAssets: vi.fn(),
  attachTemporary: vi.fn(),
  temporaryCleanup: vi.fn(),
  cleanupFailedStart: vi.fn(),
  workerRequest: vi.fn<(request: WorkerRequest) => unknown>(),
  prepareShared: vi.fn(),
  redactLine: vi.fn(),
  prepareProtocol: vi.fn(),
  requireIsolation: vi.fn(),
  runOptionError: vi.fn(),
  connectionStatus: vi.fn(),
  recordNamespace: vi.fn(),
  requireMode: vi.fn(),
  requireAdapter: vi.fn(),
  acpProvider: vi.fn(),
  containment: vi.fn(),
  validateStatus: vi.fn(),
  openAcp: vi.fn<(context: OpenContext) => Promise<unknown>>(),
  githubAccess: vi.fn(),
  scopedHome: vi.fn(),
  picaChat: vi.fn<(input: PicaInput) => Promise<unknown>>(),
  registerNamespace: vi.fn(),
  secureAccess: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: h.logCaught,
  logDiagnostic: h.logDiagnostic,
}));
vi.mock("@/backend/service/agents/tools/AgentPlaywrightSession", () => ({
  agentPlaywrightServer: h.playwright,
}));
vi.mock("@/backend/service/agents/tools/AgentToolSession", () => ({
  agentToolAdapterVersion: h.adapterVersion,
  prepareAgentToolSession: h.prepareTools,
  observeAgentToolSession: h.observeTools,
  superviseAgentToolSession: h.superviseTools,
}));
vi.mock("@/backend/service/agents/tools/AgentToolRegistry", () => ({
  providerToolIds: h.providerToolIds,
}));
vi.mock("@/backend/agents/acp/AcpDrivers", () => ({
  acpDriverFor: h.driverFor,
}));
vi.mock("@/backend/agents/cli/CliHostMcpServers", () => ({
  mergeHostMcpServers: h.merge,
  readsHostMcpConfiguration: h.readsHostConfiguration,
}));
vi.mock("@/backend/agents/cli/CliNativeHost", () => ({
  nativeHostRequest: h.nativeHostRequest,
  readNativeHost: h.readNativeHost,
}));
vi.mock("@/backend/agents/cli/OpenCodeAgentModel", () => ({
  describeOpenCodeAgent: h.describeAgent,
  openCodeAgentObserver: h.agentObserver,
}));
vi.mock("@/backend/agents/cli/CliSessionChannel", () => ({
  connectChild: h.connectChild,
}));
vi.mock("@/backend/agents/cli/CliAssetWorkspace", () => ({
  assetSession: h.assetSession,
  sessionAssetWorkspace: h.assetWorkspace,
  prepareSessionAssets: h.prepareAssets,
  cleanupSessionAssets: h.cleanupAssets,
}));
vi.mock("@/backend/agents/cli/CliIsolationGate", () => ({
  CliIsolationGate: class {
    public readonly isolateSession = h.isolateSession;
    public constructor(...parts: unknown[]) {
      h.gate(...parts);
    }
  },
}));
vi.mock("@/backend/agents/cli/CliPlanIsolation", () => ({
  CliPlanIsolation: class {
    public constructor(...parts: unknown[]) {
      h.isolation(...parts);
    }
  },
}));
vi.mock("@/backend/agents/cli/CliPlanTemporaryDirectory", () => ({
  attachPlanTemporaryDirectory: h.attachTemporary,
  jobTemporaryCleanup: h.temporaryCleanup,
}));
vi.mock("@/backend/agents/cli/CliAcpStartCleanup", () => ({
  cleanupFailedAcpStart: h.cleanupFailedStart,
}));
vi.mock("@/backend/agents/cli/CliAcpLaunch", () => ({
  acpWorkerRequest: h.workerRequest,
}));
vi.mock("@/backend/agents/cli/AgentSharedEnvironment", () => ({
  prepareSharedAgentEnvironment: h.prepareShared,
}));
vi.mock("@/backend/agents/cli/CliAcpRedaction", () => ({
  redactAcpJsonLine: h.redactLine,
}));
vi.mock("@/backend/agents/cli/CliAcpProtocol", () => ({
  prepareAcpProtocol: h.prepareProtocol,
}));
vi.mock("@/backend/agents/cli/CliSessionPlans", () => ({
  requireAcpIsolation: h.requireIsolation,
  sessionRunOptionError: h.runOptionError,
}));
vi.mock("@/backend/agents/cli/CliSessionChecks", () => ({
  readConnectionStatus: h.connectionStatus,
  recordGitHubNamespace: h.recordNamespace,
  requireAcpMode: h.requireMode,
  requireAdapter: h.requireAdapter,
  sessionAcpProvider: h.acpProvider,
  sessionContainment: h.containment,
  validateSessionStatus: h.validateStatus,
}));
vi.mock("@/backend/agents/cli/CliAcpSessionSetup", () => ({
  openCliAcpSession: h.openAcp,
  prepareCliGitHubAccess: h.githubAccess,
  prepareScopedClaudeHome: h.scopedHome,
  preparePicaChat: h.picaChat,
  registerAcpNamespace: h.registerNamespace,
  secureCliAcpAccess: h.secureAccess,
}));

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

type Dependencies = ConstructorParameters<typeof CliSessionExecution>[0];

const SESSION = { id: "plan-session" };
const WRAPPED = { id: "wrapped-session" };
const OBSERVER = fake<Parameters<CliSessionExecution["open"]>[2]>({});

function makeInput(
  parts: {
    access?: string;
    provider?: string;
    chat?: boolean;
    purpose?: string;
    resourceContext?: object;
    beforeStart?: () => Promise<void>;
  } = {},
): AgentPlanSessionInput {
  return fake<AgentPlanSessionInput>({
    instanceId: "instance-1",
    userId: "user-1",
    directory: "/work",
    agent: {
      connection: {
        id: "connection-1",
        provider: parts.provider ?? "codex_cli",
      },
    },
    options: { access: parts.access ?? "read_only" },
    chat: parts.chat,
    purpose: parts.purpose,
    resourceContext: parts.resourceContext,
    beforeStart: parts.beforeStart,
  });
}

function makeDependencies(parts: object = {}): {
  readonly dependencies: Dependencies;
  readonly store: {
    prepare: ReturnType<typeof vi.fn>;
    secure: ReturnType<typeof vi.fn>;
  };
  readonly locator: {
    find: ReturnType<typeof vi.fn>;
    locate: ReturnType<typeof vi.fn>;
  };
  readonly runner: { startSession: ReturnType<typeof vi.fn> };
} {
  const store = {
    prepare: vi.fn(async () => ({ root: "/home" })),
    secure: vi.fn(async () => {}),
  };
  const locator = {
    find: vi.fn(async () => ({ path: "/bin/cli" })),
    locate: vi.fn(async () => ({ path: "/bin/adapter" })),
  };
  const runner = { startSession: vi.fn(() => ({ processId: 77 })) };
  const dependencies = fake<Dependencies>({
    runtime: { adapter: vi.fn() },
    store,
    locator,
    runner,
    ...parts,
  });
  return { dependencies, store, locator, runner };
}

const DRIVER = {
  provider: "codex_cli",
  binary: "codex-acp",
  errors: { adapterMissing: "codex_adapter_missing" },
  requireManagedConfiguration: vi.fn(async () => {}),
};

beforeEach(() => {
  for (const mock of Object.values(h)) mock.mockReset();
  DRIVER.requireManagedConfiguration.mockReset();
  h.assetWorkspace.mockReturnValue({ id: "assets" });
  h.prepareAssets.mockImplementation(async (input: object) => input);
  h.assetSession.mockReturnValue(WRAPPED);
  h.cleanupAssets.mockResolvedValue(undefined);
  h.acpProvider.mockReturnValue("codex_cli");
  h.runOptionError.mockReturnValue(null);
  h.providerToolIds.mockReturnValue(["codex", "codex_acp"]);
  h.connectionStatus.mockResolvedValue({
    outcome: { ok: true },
    credentials: "credentials",
  });
  h.driverFor.mockReturnValue(DRIVER);
  h.adapterVersion.mockReturnValue("1.2.3");
  h.readNativeHost.mockResolvedValue(undefined);
  h.requireMode.mockReturnValue("read_only");
  h.requireAdapter.mockReturnValue("/bin/adapter");
  h.scopedHome.mockResolvedValue(null);
  h.githubAccess.mockResolvedValue(null);
  h.prepareProtocol.mockReturnValue({
    profile: { unattended: "none" },
    channel: { receive: vi.fn() },
    redact: (text: string) => `redacted:${text}`,
    launch: { mcpServers: ["pages"] },
  });
  h.picaChat.mockResolvedValue({
    picaNative: null,
    picaBundle: null,
    picaSupport: undefined,
  });
  h.workerRequest.mockImplementation((request: object) => ({
    ...request,
    arguments: [],
  }));
  h.attachTemporary.mockImplementation(async (request: object) => request);
  h.temporaryCleanup.mockReturnValue({});
  h.isolateSession.mockImplementation(async (request: object) => ({
    request,
    isIsolated: true,
  }));
  h.containment.mockReturnValue("pid_namespace");
  h.agentObserver.mockImplementation(
    (input: object, observer: object) => observer,
  );
  h.describeAgent.mockImplementation((input: object, text: string) => text);
  h.registerNamespace.mockResolvedValue("namespace");
  h.recordNamespace.mockResolvedValue(undefined);
  h.openAcp.mockResolvedValue(SESSION);
  h.cleanupFailedStart.mockResolvedValue(undefined);
});

const UNITS = {
  isAvailable: async () => true,
  wrap: async (request: object) => ({ request, unit: { name: "unit-1" } }),
};

function open(
  dependencies: Dependencies,
  input: AgentPlanSessionInput = makeInput(),
  signal: AbortSignal = new AbortController().signal,
): Promise<unknown> {
  return new CliSessionExecution(dependencies).open(input, signal, OBSERVER);
}

describe("limited unit", () => {
  it("wraps the worker in a unit and names its limits", async () => {
    const lifecycle = { trackSpawn: vi.fn(), beforeSpawn: vi.fn() };
    const openWithin = vi.fn(
      async (request: { start: (s: AbortSignal, l: object) => unknown }) =>
        request.start(new AbortController().signal, lifecycle),
    );
    const { dependencies, runner } = makeDependencies({
      units: UNITS,
      resources: { openWithin },
    });
    await open(dependencies);
    expect(lifecycle.beforeSpawn).toHaveBeenCalledWith("unit-1");
    expect(runner.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ unit: { name: "unit-1" } }),
    );
    expect(h.openAcp.mock.calls[0]?.[0].limited.label).toMatch(/^unit unit-1:/);
  });

  it("warns once when a reading node runs without a unit", async () => {
    const { dependencies } = makeDependencies({
      units: { isAvailable: async () => false, wrap: vi.fn() },
    });
    const execution = new CliSessionExecution(dependencies);
    const signal = new AbortController().signal;
    await execution.open(makeInput(), signal, OBSERVER);
    await execution.open(makeInput(), signal, OBSERVER);
    expect(h.logDiagnostic).toHaveBeenCalledTimes(1);
    expect(h.openAcp.mock.calls[0]?.[0].limited.label).toBe("no limited unit");
  });

  it("refuses a chat without a unit", async () => {
    const { dependencies } = makeDependencies();
    await expect(
      open(dependencies, makeInput({ chat: true })),
    ).rejects.toMatchObject({ code: "acp_worker_unit_unavailable" });
    expect(h.cleanupFailedStart).toHaveBeenCalled();
  });

  it("refuses a YOLO session without a unit", async () => {
    const { dependencies } = makeDependencies();
    await expect(
      open(dependencies, makeInput({ access: "yolo" })),
    ).rejects.toMatchObject({ code: "acp_worker_unit_unavailable" });
  });
});

describe("worker isolation", () => {
  it("rejects a reading worker the namespace could not isolate", async () => {
    const { dependencies } = makeDependencies();
    await open(dependencies);
    expect(h.requireIsolation).toHaveBeenCalledWith(
      true,
      "read_only",
      expect.anything(),
    );
  });

  it("skips the isolation rule for a mode outside the two ACP modes", async () => {
    const { dependencies } = makeDependencies({ units: UNITS });
    await open(dependencies, makeInput({ access: "workspace" }));
    expect(h.requireIsolation).not.toHaveBeenCalled();
  });

  it("starts a YOLO worker natively without a namespace", async () => {
    const { dependencies } = makeDependencies({ units: UNITS });
    const beforeStart = vi.fn(async () => {});
    h.readNativeHost.mockResolvedValue({ name: "host" });
    h.nativeHostRequest.mockImplementation((request: object) => ({
      ...request,
      native: true,
    }));
    await open(dependencies, makeInput({ access: "yolo", beforeStart }));
    expect(h.isolateSession).not.toHaveBeenCalled();
    expect(h.scopedHome).not.toHaveBeenCalled();
    expect(beforeStart).toHaveBeenCalledTimes(2);
    expect(h.containment).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ native: true }),
    );
  });

  it("stops before the spawn when the signal aborted meanwhile", async () => {
    const { dependencies, runner } = makeDependencies();
    const controller = new AbortController();
    h.attachTemporary.mockImplementation(async (request: object) => {
      controller.abort();
      return request;
    });
    await expect(
      open(dependencies, makeInput(), controller.signal),
    ).rejects.toBeInstanceOf(AgentPlanCancelledError);
    expect(runner.startSession).not.toHaveBeenCalled();
  });
});

describe("worker output", () => {
  async function receiveLine(
    access: string,
    line: string,
  ): Promise<ReturnType<typeof vi.fn>> {
    const { dependencies } = makeDependencies({ units: UNITS });
    const receive = vi.fn();
    h.prepareProtocol.mockReturnValue({
      profile: { unattended: "none" },
      channel: { receive },
      redact: (text: string) => `redacted:${text}`,
      launch: { mcpServers: [] },
    });
    h.readNativeHost.mockResolvedValue(
      access === "yolo" ? { name: "host" } : undefined,
    );
    h.nativeHostRequest.mockImplementation((request: object) => request);
    h.redactLine.mockImplementation((text: string) => `json:${text}`);
    await open(dependencies, makeInput({ access }));
    const request = h.workerRequest.mock.calls[0]?.[0];
    request.onLine(line);
    return receive;
  }

  it("redacts a native line as JSON", async () => {
    const receive = await receiveLine("yolo", "x");
    expect(receive).toHaveBeenCalledWith("json:x");
  });

  it("redacts a namespace line as text", async () => {
    const receive = await receiveLine("read_only", "x");
    expect(receive).toHaveBeenCalledWith("redacted:x");
  });
});

describe("attached session", () => {
  it("connects the child and secures the access on close", async () => {
    const { dependencies, store } = makeDependencies({ units: UNITS });
    h.describeAgent.mockImplementation(
      (input: object, text: string) => `agent:${text}`,
    );
    await open(dependencies);
    expect(h.connectChild).toHaveBeenCalledWith(
      { processId: 77 },
      expect.anything(),
      expect.objectContaining({ namespace: "namespace", unattended: "none" }),
    );
    const context = h.openAcp.mock.calls[0]?.[0];
    expect(context.redact("text")).toBe("agent:redacted:text");
    await context.secure();
    expect(h.secureAccess).toHaveBeenCalledWith(
      store,
      expect.anything(),
      expect.anything(),
      null,
    );
    expect(context.claudeQuota).toBeUndefined();
  });

  it("hands Claude sessions the quota sink of the connection", async () => {
    const sinkFor = vi.fn(() => "sink");
    const { dependencies } = makeDependencies({
      claudeQuota: { sinkFor },
      units: UNITS,
    });
    h.driverFor.mockReturnValue({ ...DRIVER, provider: "claude_code" });
    await open(dependencies, makeInput({ provider: "claude_code" }));
    expect(h.openAcp.mock.calls[0]?.[0].claudeQuota).toBe("sink");
    expect(sinkFor).toHaveBeenCalledWith("connection-1");
  });

  it("passes no quota sink for Claude when none is configured", async () => {
    const { dependencies } = makeDependencies({ units: UNITS });
    h.driverFor.mockReturnValue({ ...DRIVER, provider: "claude_code" });
    await open(dependencies);
    expect(h.openAcp.mock.calls[0]?.[0].claudeQuota).toBeUndefined();
  });
});

describe("failed start", () => {
  it("cleans up the Pica bundle and ends the start", async () => {
    const cleanup = vi.fn();
    const confirmStartEnded = vi.fn();
    const openWithin = vi.fn(
      async (request: { start: (s: AbortSignal, l: object) => unknown }) =>
        request.start(new AbortController().signal, {
          trackSpawn: vi.fn(),
          beforeSpawn: vi.fn(),
          confirmStartEnded,
        }),
    );
    const { dependencies } = makeDependencies({
      units: UNITS,
      resources: { openWithin },
    });
    h.picaChat.mockResolvedValue({
      picaNative: null,
      picaBundle: { cleanup },
      picaSupport: undefined,
    });
    h.openAcp.mockRejectedValue(new Error("attach failed"));
    await expect(open(dependencies)).rejects.toThrow("attach failed");
    expect(h.cleanupFailedStart).toHaveBeenCalledWith(
      { processId: 77 },
      expect.objectContaining({ instanceId: "instance-1" }),
      cleanup,
    );
    expect(confirmStartEnded).toHaveBeenCalledTimes(1);
  });

  it("cleans up without a child or bundle when preparing fails", async () => {
    const { dependencies } = makeDependencies();
    h.picaChat.mockRejectedValue(new Error("pica failed"));
    await expect(open(dependencies)).rejects.toThrow("pica failed");
    expect(h.cleanupFailedStart).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ limited: null, containment: "none" }),
      undefined,
    );
  });
});

describe("host MCP servers", () => {
  function hostDependencies(): ReturnType<typeof makeDependencies> & {
    readonly servers: ReturnType<typeof vi.fn>;
  } {
    const servers = vi.fn(async () => [{ server: "host-server" }]);
    return {
      servers,
      ...makeDependencies({ hostMcp: { servers }, units: UNITS }),
    };
  }

  async function launchOf(
    input: AgentPlanSessionInput,
    dependencies: Dependencies,
  ): Promise<PicaInput["launch"] | undefined> {
    h.readNativeHost.mockResolvedValue({ name: "host" });
    h.nativeHostRequest.mockImplementation((request: object) => request);
    h.requireMode.mockReturnValue(
      input.options.access === "yolo" ? "yolo" : "read_only",
    );
    await open(dependencies, input);
    return h.picaChat.mock.calls[0]?.[0].launch;
  }

  it("merges the host servers into a YOLO plan session", async () => {
    const { dependencies, servers } = hostDependencies();
    h.merge.mockReturnValue(["merged"]);
    const launch = await launchOf(makeInput({ access: "yolo" }), dependencies);
    expect(launch?.mcpServers).toEqual(["merged"]);
    expect(h.merge).toHaveBeenCalledWith(["pages"], ["host-server"]);
    expect(servers).toHaveBeenCalledWith("codex_cli");
  });

  it.each([
    ["a chat", { access: "yolo", chat: true }],
    ["a decision", { access: "yolo", purpose: "decision" }],
    ["an observer", { access: "yolo", purpose: "observer" }],
    ["a reading session", { access: "read_only" }],
  ])("leaves %s without host servers", async (label, parts) => {
    const { dependencies, servers } = hostDependencies();
    const launch = await launchOf(makeInput(parts), dependencies);
    expect(launch?.mcpServers).toEqual(["pages"]);
    expect(servers).not.toHaveBeenCalled();
  });

  it("leaves a provider that reads the host configuration itself", async () => {
    const { dependencies, servers } = hostDependencies();
    h.readsHostConfiguration.mockReturnValue(true);
    await launchOf(makeInput({ access: "yolo" }), dependencies);
    expect(servers).not.toHaveBeenCalled();
  });

  it("passes no servers without a host discovery", async () => {
    const { dependencies } = makeDependencies({ units: UNITS });
    const launch = await launchOf(makeInput({ access: "yolo" }), dependencies);
    expect(launch?.mcpServers).toEqual(["pages"]);
  });
});
