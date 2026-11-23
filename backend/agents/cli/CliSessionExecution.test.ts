import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  AgentToolPreflightError,
  AgentToolReadinessError,
} from "@/backend/service/agents/tools/AgentToolReadinessError";
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

describe("constructor", () => {
  it("runs without isolation when none is configured", () => {
    new CliSessionExecution(makeDependencies().dependencies);
    expect(h.gate).toHaveBeenCalledWith(null, false);
  });

  it("requires isolation for a required option", () => {
    const isolation = { protectedDirectories: ["/data"], isRequired: true };
    new CliSessionExecution(makeDependencies({ isolation }).dependencies);
    expect(h.isolation).toHaveBeenCalledWith(["/data"], undefined, isolation);
    expect(h.gate).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("does not require an optional isolation", () => {
    const isolation = { protectedDirectories: [], isRequired: false };
    new CliSessionExecution(makeDependencies({ isolation }).dependencies);
    expect(h.gate).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("requires isolation when tools are managed", () => {
    new CliSessionExecution(makeDependencies({ tools: {} }).dependencies);
    expect(h.gate).toHaveBeenCalledWith(null, true);
  });
});

describe("open", () => {
  it("starts directly without a resource scheduler", async () => {
    const { dependencies } = makeDependencies();
    const session = await new CliSessionExecution(dependencies).open(
      makeInput({ resourceContext: { recoveryRunId: "run-0" } }),
      new AbortController().signal,
      OBSERVER,
    );
    expect(session).toBe(WRAPPED);
    expect(h.assetSession).toHaveBeenCalledWith(SESSION, { id: "assets" });
  });

  it("releases a recovered run and admits through the scheduler", async () => {
    const releaseForResume = vi.fn(async () => {});
    const openWithin = vi.fn(
      async (request: {
        start: (signal: AbortSignal, lifecycle: object) => Promise<unknown>;
      }) => request.start(new AbortController().signal, lifecycle),
    );
    const lifecycle = { trackSpawn: vi.fn(), beforeSpawn: vi.fn() };
    const { dependencies } = makeDependencies({
      resources: { releaseForResume, openWithin },
    });
    const input = makeInput({
      resourceContext: {
        recoveryRunId: "run-0",
        runId: "run-1",
        stepId: "step-1",
        admissionDeadlineMs: 500,
      },
    });
    await new CliSessionExecution(dependencies).open(
      input,
      new AbortController().signal,
      OBSERVER,
    );
    expect(releaseForResume).toHaveBeenCalledWith("run-0");
    expect(lifecycle.trackSpawn).toHaveBeenCalled();
    expect(openWithin).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: {
          instanceId: "instance-1",
          userId: "user-1",
          provider: "codex_cli",
          runId: "run-1",
          stepId: "step-1",
        },
        deadlineMs: 500,
      }),
    );
  });

  it("admits a session without a resource context", async () => {
    const openWithin = vi.fn(
      async (request: { owner: object; deadlineMs?: number }) => request,
    );
    const { dependencies } = makeDependencies({ resources: { openWithin } });
    await new CliSessionExecution(dependencies).open(
      makeInput(),
      new AbortController().signal,
      OBSERVER,
    );
    expect(openWithin.mock.calls[0]?.[0]).toMatchObject({
      owner: { runId: null, stepId: null },
      deadlineMs: undefined,
    });
  });

  it("skips the scheduler for a provider without ACP", async () => {
    h.acpProvider.mockReturnValue(null);
    const openWithin = vi.fn();
    const { dependencies } = makeDependencies({
      resources: { releaseForResume: vi.fn(), openWithin },
    });
    await expect(
      new CliSessionExecution(dependencies).open(
        makeInput({ provider: "anthropic" }),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toMatchObject({ code: "provider_invalid" });
    expect(openWithin).not.toHaveBeenCalled();
  });
});

describe("tools", () => {
  function toolDependencies(): ReturnType<typeof makeDependencies> & {
    readonly tools: {
      readonly recordAuthentication: ReturnType<typeof vi.fn>;
      readonly supervisor: { readonly release: ReturnType<typeof vi.fn> };
    };
  } {
    const tools = {
      recordAuthentication: vi.fn(),
      supervisor: { release: vi.fn() },
    };
    const units = {
      isAvailable: async () => true,
      wrap: async (request: object) => ({ request, unit: { name: "unit-1" } }),
    };
    return { tools, ...makeDependencies({ tools, units }) };
  }

  it("prepares, observes and supervises the tool session", async () => {
    const { tools, dependencies } = toolDependencies();
    const locations = new Map([["codex", { file: "/pinned/cli" }]]);
    h.prepareTools.mockResolvedValue(locations);
    h.observeTools.mockReturnValue("watched");
    h.superviseTools.mockReturnValue("supervised");
    h.playwright.mockResolvedValue("browser");
    h.providerToolIds.mockReturnValue(["codex"]);
    h.readNativeHost.mockResolvedValue({ name: "host" });
    h.nativeHostRequest.mockImplementation((request: object) => request);
    const session = await new CliSessionExecution(dependencies).open(
      makeInput({ access: "yolo" }),
      new AbortController().signal,
      OBSERVER,
    );
    expect(session).toBe("supervised");
    expect(h.superviseTools).toHaveBeenCalledWith(tools, "instance-1", WRAPPED);
    expect(tools.recordAuthentication).toHaveBeenCalledWith(
      "connection-1",
      "codex_cli",
      true,
    );
    expect(h.adapterVersion).toHaveBeenCalledWith("codex_cli", locations);
    expect(h.connectionStatus).toHaveBeenCalledWith(
      dependencies,
      expect.anything(),
      expect.objectContaining({ file: "/pinned/cli" }),
    );
  });

  it("wraps a readiness refusal as a preflight error", async () => {
    const { dependencies } = toolDependencies();
    h.prepareTools.mockRejectedValue(
      new AgentToolReadinessError(
        "codex",
        "missing_dependency",
        "not_installed",
      ),
    );
    await expect(
      new CliSessionExecution(dependencies).open(
        makeInput(),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toBeInstanceOf(AgentToolPreflightError);
  });

  it("rethrows another preparation error", async () => {
    const { dependencies } = toolDependencies();
    h.prepareTools.mockRejectedValue(new Error("boom"));
    await expect(
      new CliSessionExecution(dependencies).open(
        makeInput(),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toThrow("boom");
  });

  it("releases the tools and secures the connection after a failure", async () => {
    const { tools, store, dependencies } = toolDependencies();
    h.prepareTools.mockResolvedValue(new Map());
    h.observeTools.mockReturnValue("watched");
    h.playwright.mockResolvedValue(null);
    h.requireMode.mockImplementation(() => {
      throw new AgentError("provider_invalid");
    });
    await expect(
      new CliSessionExecution(dependencies).open(
        makeInput(),
        new AbortController().signal,
        OBSERVER,
      ),
    ).rejects.toMatchObject({ code: "provider_invalid" });
    expect(tools.supervisor.release).toHaveBeenCalledWith("instance-1");
    expect(store.secure).toHaveBeenCalledWith("connection-1", "codex_cli");
  });
});
