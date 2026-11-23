import { beforeEach, describe, expect, it, vi } from "vitest";

import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentError } from "@/backend/error/AgentErrors";
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

function open(
  dependencies: Dependencies,
  input: AgentPlanSessionInput = makeInput(),
  signal: AbortSignal = new AbortController().signal,
): Promise<unknown> {
  return new CliSessionExecution(dependencies).open(input, signal, OBSERVER);
}

describe("failure handling", () => {
  it("keeps the tool reservation of an unconfirmed cleanup", async () => {
    const tools = {
      recordAuthentication: vi.fn(),
      supervisor: { release: vi.fn() },
    };
    const { dependencies, store } = makeDependencies({ tools });
    h.prepareTools.mockResolvedValue(new Map());
    h.observeTools.mockReturnValue("watched");
    h.playwright.mockResolvedValue(null);
    h.openAcp.mockRejectedValue(new AcpCleanupUnconfirmedError());
    store.secure.mockRejectedValue(new Error("secure failed"));
    await expect(open(dependencies)).rejects.toBeInstanceOf(
      AcpCleanupUnconfirmedError,
    );
    expect(tools.supervisor.release).not.toHaveBeenCalled();
    expect(h.cleanupAssets).toHaveBeenCalled();
  });

  it("throws the failure of securing after another failure", async () => {
    const { dependencies, store } = makeDependencies();
    h.openAcp.mockRejectedValue(new Error("open failed"));
    store.secure.mockRejectedValue(new Error("secure failed"));
    await expect(open(dependencies)).rejects.toThrow("secure failed");
    expect(h.logCaught).toHaveBeenCalledWith(
      "CliSessionExecution",
      expect.objectContaining({ message: "secure failed" }),
    );
  });

  it("does not secure a provider without a native adapter", async () => {
    const { dependencies, store } = makeDependencies();
    h.openAcp.mockRejectedValue(new Error("open failed"));
    await expect(
      open(dependencies, makeInput({ provider: "anthropic" })),
    ).rejects.toThrow("open failed");
    expect(store.secure).not.toHaveBeenCalled();
  });

  it("does not secure again when the verification failed", async () => {
    const { dependencies, store } = makeDependencies();
    h.runOptionError.mockReturnValue("plan_run_option_unsupported");
    await expect(open(dependencies)).rejects.toMatchObject({
      code: "plan_run_option_unsupported",
    });
    expect(store.prepare).not.toHaveBeenCalled();
    expect(store.secure).not.toHaveBeenCalled();
  });
});

describe("verification", () => {
  it("prepares the shared environment of the home", async () => {
    const { dependencies, store } = makeDependencies();
    store.prepare.mockResolvedValue({
      root: "/home",
      sharedEnvironment: "env",
    });
    await open(dependencies);
    expect(h.prepareShared).toHaveBeenCalledWith("env");
  });

  it("secures the home and rethrows an invalid sign-in", async () => {
    const { dependencies, store } = makeDependencies();
    h.validateStatus.mockImplementation(() => {
      throw new AgentError("cli_not_logged_in");
    });
    await expect(open(dependencies)).rejects.toMatchObject({
      code: "cli_not_logged_in",
    });
    expect(store.secure).toHaveBeenCalledWith("connection-1", "codex_cli");
  });

  it("refuses a CLI without an executable path", async () => {
    const { dependencies, locator } = makeDependencies();
    locator.find.mockResolvedValue({ path: null });
    await expect(open(dependencies)).rejects.toMatchObject({
      code: "cli_not_executable",
    });
  });

  it("starts without an adapter when no ACP provider remains", async () => {
    const { dependencies } = makeDependencies();
    h.acpProvider
      .mockReturnValueOnce("codex_cli")
      .mockReturnValueOnce("codex_cli")
      .mockReturnValueOnce(null)
      .mockReturnValue("codex_cli");
    await open(dependencies);
    expect(h.requireAdapter).toHaveBeenCalledWith(null, DRIVER);
  });

  it("refuses to spawn without an ACP provider", async () => {
    const { dependencies } = makeDependencies();
    h.acpProvider
      .mockReturnValueOnce("codex_cli")
      .mockReturnValueOnce("codex_cli")
      .mockReturnValueOnce("codex_cli")
      .mockReturnValue(null);
    await expect(open(dependencies)).rejects.toMatchObject({
      code: "provider_invalid",
    });
  });

  it("runs the hook before the start and honors a stop", async () => {
    const { dependencies } = makeDependencies();
    const controller = new AbortController();
    const beforeStart = vi.fn(async () => controller.abort());
    await expect(
      open(dependencies, makeInput({ beforeStart }), controller.signal),
    ).rejects.toBeInstanceOf(AgentPlanCancelledError);
    expect(beforeStart).toHaveBeenCalledTimes(1);
  });

  it("starts a session whose hook returns without a stop", async () => {
    const { dependencies } = makeDependencies();
    const beforeStart = vi.fn(async () => {});
    await expect(open(dependencies, makeInput({ beforeStart }))).resolves.toBe(
      WRAPPED,
    );
  });
});

describe("adapter lookup", () => {
  it("finds the adapter binary and checks the managed configuration", async () => {
    const { dependencies, locator } = makeDependencies();
    await open(dependencies);
    expect(locator.locate).toHaveBeenCalledWith("codex-acp");
    expect(DRIVER.requireManagedConfiguration).toHaveBeenCalledWith(
      { root: "/home" },
      "/work",
    );
  });

  it("uses the adapter pinned by the tool manager", async () => {
    const tools = {
      recordAuthentication: vi.fn(),
      supervisor: { release: vi.fn() },
    };
    const { dependencies, locator } = makeDependencies({
      tools,
      units: {
        isAvailable: async () => true,
        wrap: async (request: object) => ({ request, unit: { name: "u" } }),
      },
    });
    h.prepareTools.mockResolvedValue(
      new Map([["codex_acp", { file: "/pinned/adapter" }]]),
    );
    h.observeTools.mockReturnValue("watched");
    h.superviseTools.mockReturnValue("supervised");
    h.playwright.mockResolvedValue(null);
    await open(dependencies, makeInput({ access: "yolo" }));
    expect(locator.locate).not.toHaveBeenCalled();
    expect(DRIVER.requireManagedConfiguration).not.toHaveBeenCalled();
    expect(h.readNativeHost).toHaveBeenCalledWith("/work", expect.anything());
  });

  it("falls back to a lookup when the manager pins no adapter", async () => {
    const tools = {
      recordAuthentication: vi.fn(),
      supervisor: { release: vi.fn() },
    };
    const { dependencies, locator } = makeDependencies({ tools });
    h.prepareTools.mockResolvedValue(new Map());
    h.observeTools.mockReturnValue("watched");
    h.superviseTools.mockReturnValue("supervised");
    h.playwright.mockResolvedValue("browser");
    h.providerToolIds.mockReturnValue([]);
    await open(dependencies);
    expect(locator.locate).toHaveBeenCalledTimes(1);
    expect(h.playwright).toHaveBeenCalled();
  });

  it("refuses a missing adapter with the code of its driver", async () => {
    const { dependencies, locator } = makeDependencies();
    locator.locate.mockResolvedValue({ path: null });
    await expect(open(dependencies)).rejects.toMatchObject({
      code: "codex_adapter_missing",
    });
  });
});
