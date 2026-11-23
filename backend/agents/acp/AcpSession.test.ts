import { methods } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AcpSession } from "@/backend/agents/acp/AcpSession";

import type { Mock } from "vitest";
import type * as AcpChat from "@/backend/agents/acp/AcpChat";
import type * as Sdk from "@agentclientprotocol/sdk";

const h = vi.hoisted(() => ({
  createBuilder: vi.fn(),
  closeCliSession: vi.fn(),
  refresh: vi.fn(),
  priceCatalog: vi.fn(),
  requestAcpSteer: vi.fn(),
  isWithinBudget: vi.fn(),
  promptParams: vi.fn(),
  turnPrompt: vi.fn(),
  planActivity: vi.fn(),
  usageArgs: [] as unknown[],
  usageStart: vi.fn(),
  usageFinish: vi.fn(),
  usageClose: vi.fn(),
  registerQuota: vi.fn(),
  readQuotaWindow: vi.fn(),
  registerUsage: vi.fn(),
  mcpRequire: vi.fn(),
  mcpReceive: vi.fn(),
  cancelTurn: vi.fn(),
  closeProtocol: vi.fn(),
  antigravityFailure: vi.fn(),
  logTool: vi.fn(),
  describe: vi.fn(),
  configChanged: vi.fn(),
  initialize: vi.fn(),
  open: vi.fn(),
  configure: vi.fn(),
  toolFailure: vi.fn(),
  unavailableTool: vi.fn(),
  permission: vi.fn(),
  forwardUsage: vi.fn(),
  resolveFailure: vi.fn(),
  logCaught: vi.fn(),
}));

vi.mock("@agentclientprotocol/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  client: () => h.createBuilder(),
}));
vi.mock("@/backend/service/agents/sessions/OpenRouterPriceCatalog", () => ({
  openRouterPriceCatalog: h.priceCatalog,
}));
vi.mock("@/backend/agents/cli/CliSessionCloseout", () => ({
  closeCliSession: h.closeCliSession,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: h.logCaught,
  logEvent: vi.fn(),
}));
vi.mock("@/backend/agents/acp/AcpChat", async (importOriginal) => ({
  ...(await importOriginal<typeof AcpChat>()),
  requestAcpSteer: h.requestAcpSteer,
}));
vi.mock("@/backend/agents/acp/AcpPromptBudget", () => ({
  acpPromptParams: h.promptParams,
  isAcpMessageWithinBudget: h.isWithinBudget,
}));
vi.mock("@/backend/agents/acp/AcpTicketAssets", () => ({
  acpTurnPrompt: h.turnPrompt,
}));
vi.mock("@/backend/agents/acp/AcpPlanActivity", () => ({
  reportAcpPlanActivity: h.planActivity,
}));
vi.mock("@/backend/agents/acp/CodexThreadUsage", () => ({
  CodexThreadUsage: class {
    public start = h.usageStart;
    public finish = h.usageFinish;
    public close = h.usageClose;
    public constructor(...args: unknown[]) {
      h.usageArgs = args;
    }
  },
}));
vi.mock("@/backend/agents/acp/ClaudeAcpUsage", () => ({
  registerClaudeUsage: h.registerUsage,
}));
vi.mock("@/backend/agents/acp/ClaudeAcpQuota", () => ({
  registerClaudeQuota: h.registerQuota,
  readClaudeQuotaWindow: h.readQuotaWindow,
}));
vi.mock("@/backend/agents/acp/AcpMcpReadiness", () => ({
  AcpMcpReadiness: class {
    public require = h.mcpRequire;
    public receive = h.mcpReceive;
  },
}));
vi.mock("@/backend/agents/acp/AcpProtocolClose", () => ({
  cancelAcpTurn: h.cancelTurn,
  closeAcpProtocol: h.closeProtocol,
}));
vi.mock("@/backend/agents/acp/AntigravityTurnFailure", () => ({
  readAntigravityTurnFailure: h.antigravityFailure,
}));
vi.mock("@/backend/agents/acp/AcpSessionToolLogging", () => ({
  logAcpToolUpdate: h.logTool,
}));
vi.mock("@/backend/agents/acp/AcpSessionConfiguration", () => ({
  describeAcpSession: h.describe,
  hasAcpConfigurationChanged: h.configChanged,
}));
vi.mock("@/backend/agents/acp/AcpSessionHandshake", () => ({
  initializeAcpSession: h.initialize,
  openAcpSession: h.open,
  configureAcpSession: h.configure,
}));
vi.mock("@/backend/agents/acp/OpenCodeAcpErrors", () => ({
  openCodeToolFailure: h.toolFailure,
  openCodeUnavailableTool: h.unavailableTool,
}));
vi.mock("@/backend/agents/acp/AcpSessionPermission", () => ({
  decideAcpSessionPermission: h.permission,
}));
vi.mock("@/backend/agents/acp/AcpSessionLifecycle", () => ({
  forwardOpenCodeSessionUsage: h.forwardUsage,
  resolveAcpTurnFailure: h.resolveFailure,
}));

type Notify = (notification: unknown) => Promise<void>;

interface Harness {
  readonly session: AcpSession;
  readonly connection: {
    signal: AbortSignal;
    agent: { request: Mock };
    close: Mock;
  };
  readonly process: Record<string, Mock> & {
    exited: Promise<unknown>;
  };
  readonly context: BaseContext;
  readonly notify: Notify;
  readonly builder: { requests: Map<unknown, (request: unknown) => unknown> };
  readonly abort: () => void;
}

interface BaseContext {
  readonly instanceId: string;
  readonly driver: {
    provider: string;
    errors: Record<string, string>;
    steeringMeta: null;
  };
  readonly profile: {
    isContinuable: boolean;
    hasMcpStatusCommand: boolean;
    reportedOptions: Record<string, string>;
    matchesReportedModel:
      ((stored: string, reported: string) => boolean) | null;
  };
  readonly request: {
    directory: string;
    prompt: string;
    model: string;
    mcpServers: { name: string }[];
    reasoningEffort: string | null;
    sessionMeta: Record<string, unknown>;
    modelSupportsImages?: boolean;
    resumeSessionId?: string;
  };
  readonly observer: {
    identified: Mock;
    progressed: Mock;
  };
  readonly signal: AbortSignal;
  readonly isolation: string;
  readonly secure: Mock;
}

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

let promptResult: () => Promise<unknown>;

function baseContext(overrides: Record<string, unknown> = {}): BaseContext {
  return {
    instanceId: "i",
    driver: {
      provider: "codex_cli",
      errors: { adapterUnsupported: "plan_acp_adapter_unsupported" },
      steeringMeta: null,
    },
    profile: {
      isContinuable: true,
      hasMcpStatusCommand: false,
      reportedOptions: {},
      matchesReportedModel: null,
    },
    request: {
      directory: "/w",
      prompt: "p",
      model: "gpt",
      mcpServers: [],
      reasoningEffort: null,
      sessionMeta: {},
    },
    observer: { identified: vi.fn(), progressed: vi.fn() },
    signal: new AbortController().signal,
    isolation: "x",
    secure: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function start(
  overrides: Record<string, unknown> = {},
  processOverrides: Record<string, unknown> = {},
): Harness {
  const controller = new AbortController();
  const connection = {
    signal: controller.signal,
    agent: {
      request: vi.fn((method: unknown) =>
        method === methods.agent.session.prompt
          ? promptResult()
          : Promise.resolve({}),
      ),
    },
    close: vi.fn(() => controller.abort()),
  };
  const builder: Harness["builder"] & {
    onRequest: (
      method: unknown,
      handler: (request: unknown) => unknown,
    ) => unknown;
    onNotification: (method: unknown, handler: Notify) => unknown;
    connect: () => unknown;
    notify?: Notify;
  } = {
    requests: new Map(),
    onRequest(method, handler) {
      builder.requests.set(method, handler);
      return builder;
    },
    onNotification(...[, handler]) {
      builder.notify = handler;
      return builder;
    },
    connect: () => connection,
  };
  h.createBuilder.mockReturnValue(builder);
  const process = fake<Harness["process"]>({
    endInput: vi.fn(),
    cancel: vi.fn(),
    setPaused: vi.fn().mockResolvedValue(undefined),
    suspend: vi.fn(() => true),
    resume: vi.fn(() => true),
    exited: new Promise(() => undefined),
    ...processOverrides,
  });
  const context = baseContext(overrides);
  const session = new AcpSession(process as never, fake({}), context as never);
  return {
    session,
    connection,
    process,
    context,
    notify: (notification) =>
      builder.notify?.(notification) ?? Promise.resolve(),
    builder,
    abort: () => controller.abort(),
  };
}

function update(
  value: Record<string, unknown>,
  sessionId = "s1",
): { params: { sessionId: string; update: Record<string, unknown> } } {
  return { params: { sessionId, update: value } };
}

beforeEach(() => {
  vi.resetAllMocks();
  promptResult = () => Promise.resolve({ stopReason: "end_turn" });
  h.usageArgs = [];
  h.initialize.mockResolvedValue({
    promptCapabilities: { image: true },
    isSteeringSupported: false,
  });
  h.open.mockImplementation((target: { state: { sessionId: string } }) => {
    target.state.sessionId = "s1";
    return Promise.resolve({ sessionId: "s1", options: [] });
  });
  h.configure.mockResolvedValue({
    options: [{ id: "o" }],
    expected: { a: "b" },
  });
  h.mcpRequire.mockResolvedValue(undefined);
  h.mcpReceive.mockReturnValue(false);
  h.turnPrompt.mockResolvedValue([{ type: "text", text: "p" }]);
  h.configChanged.mockReturnValue(false);
  h.isWithinBudget.mockReturnValue(true);
  h.closeCliSession.mockResolvedValue({ isConfirmed: true });
  h.priceCatalog.mockReturnValue({ refresh: h.refresh });
  h.resolveFailure.mockResolvedValue({ failure: "failed", marker: "resolved" });
  h.cancelTurn.mockResolvedValue(undefined);
  h.closeProtocol.mockResolvedValue(undefined);
  h.usageStart.mockResolvedValue(undefined);
  h.usageFinish.mockResolvedValue(undefined);
  h.usageClose.mockResolvedValue(undefined);
  h.antigravityFailure.mockReturnValue(null);
  h.toolFailure.mockReturnValue(null);
  h.unavailableTool.mockReturnValue(null);
  h.readQuotaWindow.mockReturnValue(null);
});

describe("turn", () => {
  it("runs the handshake and one prompt", async () => {
    const { session } = start();
    await expect(session.turn).resolves.toMatchObject({
      failure: null,
      sessionId: "s1",
    });
    expect(h.mcpRequire).toHaveBeenCalledWith("s1", false);
    expect(h.usageStart).not.toHaveBeenCalled();
  });

  it("checks MCP readiness for a profile with a status command", async () => {
    const { session } = start({
      profile: { ...baseContext().profile, hasMcpStatusCommand: true },
      request: { ...baseContext().request, mcpServers: [{ name: "pages" }] },
    });
    await session.turn;
    expect(h.mcpRequire).toHaveBeenCalledWith("s1", true);
  });

  it("resolves a failure of the handshake", async () => {
    h.initialize.mockRejectedValue(new Error("down"));
    const { session } = start();
    await expect(session.turn).resolves.toMatchObject({ marker: "resolved" });
    const options = h.resolveFailure.mock.calls[0][0] as {
      isPicaNative: boolean;
      redact: (text: string) => string;
    };
    expect(options.isPicaNative).toBe(false);
    expect(options.redact("x")).toBe("x");
  });

  it("fails a turn whose configuration drifted before the prompt", async () => {
    h.configChanged.mockReturnValue(true);
    const { session } = start();
    await expect(session.turn).resolves.toMatchObject({
      failure: "failed",
      errorCode: "plan_context_changed",
    });
  });

  it("fails a turn whose configuration drifted during the prompt", async () => {
    h.configChanged.mockReturnValueOnce(false).mockReturnValue(true);
    const { session } = start();
    await expect(session.turn).resolves.toMatchObject({
      errorCode: "plan_context_changed",
    });
  });

  it("withholds images from a model without them", async () => {
    const { session } = start({
      request: { ...baseContext().request, modelSupportsImages: false },
    });
    await session.turn;
    expect(h.turnPrompt.mock.calls[0][2]).toEqual({ image: false });
  });

  it("redacts every result with the context", async () => {
    const { session } = start({
      redact: (text: string) => text.replace("s1", "***"),
    });
    await expect(session.turn).resolves.toMatchObject({ sessionId: "***" });
  });
});

describe("prompt", () => {
  it("sends the prompt, counts usage and drains the listener", async () => {
    const listener = { prompted: vi.fn(), drained: vi.fn() };
    const { session } = start({ listener });
    promptResult = () =>
      Promise.resolve({ stopReason: "end_turn", usage: { inputTokens: 1 } });
    await session.turn;
    expect(listener.prompted).toHaveBeenCalledWith({ inputTokens: 1 });
    expect(listener.drained).toHaveBeenCalled();
    expect(h.forwardUsage).toHaveBeenCalled();
  });

  it("reports a missing usage as null", async () => {
    const listener = { prompted: vi.fn() };
    await start({ listener }).session.turn;
    expect(listener.prompted).toHaveBeenCalledWith(null);
  });

  it("names the session for Claude Code", async () => {
    const listener = { prompted: vi.fn() };
    const { session } = start({
      listener,
      driver: { ...baseContext().driver, provider: "claude_code" },
    });
    await session.turn;
    expect(listener.prompted).toHaveBeenCalledWith(null, false, "s1");
  });

  it("measures the prompt for its provider and tracks Codex usage", async () => {
    const { session, connection } = start({
      codexHome: "/home",
      listener: { update: vi.fn(), drained: vi.fn() },
      request: { ...baseContext().request, resumeSessionId: "old" },
    });
    h.promptParams.mockReturnValue({ built: true });
    await session.turn;
    expect(h.usageStart).toHaveBeenCalledWith("s1", true);
    expect(connection.agent.request).toHaveBeenCalledWith(
      methods.agent.session.prompt,
      { built: true },
    );
    expect(h.promptParams.mock.calls[0][2]).toBe("codex_cli");
    expect(h.usageFinish).toHaveBeenCalledWith(null);
  });

  it("cancels the Pica Codex turn after a prompt", async () => {
    const requests = {
      cancelTurn: vi.fn(),
      close: vi.fn(),
      confirmThread: vi.fn(),
    };
    const { session } = start({
      picaSupport: {
        createRequests: vi.fn(() => requests),
        registerRequests: vi.fn(),
      },
    });
    await session.turn;
    expect(requests.cancelTurn).toHaveBeenCalled();
  });
});

describe("prompt with input", () => {
  it("continues with a person's input and finishes the cut prompt", async () => {
    const listener = { prompted: vi.fn(), drained: vi.fn() };
    const { session } = start({
      listener,
      codexHome: "/home",
      acceptsTurnInput: true,
    });
    let calls = 0;
    promptResult = () => {
      calls += 1;
      if (calls > 1) return Promise.resolve({ stopReason: "end_turn" });
      void session.steer([{ type: "text", text: "more" }]);
      return Promise.resolve({ stopReason: "cancelled", usage: { u: 1 } });
    };
    await session.turn;
    expect(calls).toBe(2);
    expect(listener.prompted).toHaveBeenCalledWith({ u: 1 }, true);
  });

  it("continues after a cut prompt that reported no usage", async () => {
    const { session } = start({
      acceptsTurnInput: true,
      codexHome: "/home",
      listener: { update: vi.fn(), prompted: vi.fn() },
    });
    let calls = 0;
    promptResult = () => {
      calls += 1;
      if (calls > 1) return Promise.resolve({ stopReason: "end_turn" });
      void session.steer([{ type: "text", text: "more" }]);
      return Promise.resolve({ stopReason: "cancelled" });
    };
    await session.turn;
    expect(calls).toBe(2);
  });

  it("stops continuing once the session is closing", async () => {
    const { session } = start({ acceptsTurnInput: true });
    promptResult = () => {
      void session.steer([{ type: "text", text: "more" }]);
      void session.close();
      return Promise.resolve({ stopReason: "cancelled" });
    };
    await session.turn;
    expect(h.turnPrompt).toHaveBeenCalledOnce();
  });
});

describe("prompt results", () => {
  it("names a failed MCP startup", async () => {
    const harness = start();
    promptResult = async () => {
      await harness.notify(
        update({
          sessionUpdate: "tool_call_update",
          toolCallId: "1",
          title: "mcp__pages__startup",
          status: "failed",
        }),
      );
      return { stopReason: "end_turn" };
    };
    await expect(harness.session.turn).resolves.toMatchObject({
      errorCode: "plan_mcp_unavailable",
    });
  });

  it("names the failure the provider reported", async () => {
    const harness = start();
    promptResult = async () => {
      await harness.notify(
        update({
          sessionUpdate: "plan",
          entries: [],
          _meta: { "_claude/rateLimit": { status: "rejected" } },
        }),
      );
      return { stopReason: "end_turn" };
    };
    await expect(harness.session.turn).resolves.toMatchObject({
      errorCode: "provider_quota_exhausted",
    });
  });

  it("maps the stop reason of the prompt", async () => {
    promptResult = () => Promise.resolve({ stopReason: "max_tokens" });
    await expect(start().session.turn).resolves.toMatchObject({
      failure: "incomplete",
    });
  });

  it("turns an adapter-reported Antigravity failure into a failed node", async () => {
    h.antigravityFailure.mockReturnValue({
      code: "provider_unavailable",
      providerFailure: { code: "provider_unavailable", resetAt: null },
    });
    const { session } = start({
      driver: { ...baseContext().driver, provider: "antigravity" },
      request: { ...baseContext().request, mcpServers: [{ name: "x" }] },
    });
    await expect(session.turn).resolves.toMatchObject({
      failure: "failed",
      errorCode: "provider_unavailable",
    });
    expect(h.antigravityFailure).toHaveBeenCalledWith("", true);
  });

  it("leaves a clean Antigravity answer and other stops alone", async () => {
    const { session } = start({
      driver: { ...baseContext().driver, provider: "antigravity" },
    });
    await expect(session.turn).resolves.toMatchObject({ failure: null });
    promptResult = () => Promise.resolve({ stopReason: "cancelled" });
    const other = start({
      driver: { ...baseContext().driver, provider: "antigravity" },
    });
    await other.session.turn;
    expect(h.antigravityFailure).toHaveBeenCalledOnce();
  });
});
