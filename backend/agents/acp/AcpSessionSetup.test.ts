import { methods } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AcpSession } from "@/backend/agents/acp/AcpSession";

import type { Mock } from "vitest";
import type * as AcpChat from "@/backend/agents/acp/AcpChat";
import type * as Sdk from "@agentclientprotocol/sdk";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

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

const chunk = (text: string): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

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

const OPENCODE = { ...baseContext().driver, provider: "opencode" };

function requestsStub(): Record<string, Mock> {
  return { cancelTurn: vi.fn(), close: vi.fn(), confirmThread: vi.fn() };
}

describe("constructor", () => {
  it("accounts Codex usage through the listener", async () => {
    const listener = { update: vi.fn(), drained: vi.fn() };
    const { session } = start({ codexHome: "/home", listener });
    await session.turn;
    const report = h.usageArgs[2] as (value: unknown) => Promise<void>;
    expect(h.usageArgs.slice(0, 2)).toEqual(["/home", "gpt"]);
    await report({ total: 1 });
    expect(listener.update).toHaveBeenCalledWith({
      sessionUpdate: "session_info_update",
      _meta: { pagesCodexUsage: { total: 1 } },
    });
    expect(listener.drained).toHaveBeenCalled();
  });

  it("skips Codex usage without a listener", async () => {
    await start({ codexHome: "/home" }).session.turn;
    expect(h.usageArgs).toEqual([]);
  });

  it.each(["picaCodex", "picaHelper"])(
    "refuses a %s listener without Pica support",
    (name) => {
      expect(() => start({ listener: { [name]: vi.fn() } })).toThrow(
        expect.objectContaining({ code: "plan_acp_adapter_unsupported" }),
      );
    },
  );

  it("wires the Pica Codex requests to the session", async () => {
    const requests = requestsStub();
    const picaSupport = {
      createRequests: vi.fn(() => requests),
      registerRequests: vi.fn(),
    };
    const { session, connection } = start({ picaSupport });
    await session.turn;
    const [, getSession, isPrompting] = picaSupport.createRequests.mock
      .calls[0] as unknown as [unknown, () => string, () => boolean];
    expect(getSession()).toBe("s1");
    expect(isPrompting()).toBe(false);
    expect(picaSupport.registerRequests).toHaveBeenCalled();
    connection.close();
    expect(requests.close).toHaveBeenCalled();
  });

  it("answers permission requests by the mode", async () => {
    const { builder, context, session } = start();
    h.permission.mockReturnValue("decision");
    const handler = builder.requests.get(
      methods.client.session.requestPermission,
    );
    expect(handler?.({ params: { p: 1 } })).toBe("decision");
    expect(h.permission.mock.calls[0][0]).toBe(context);
    await session.turn;
  });

  it("closes the listener when the connection ends", async () => {
    const listener = { closed: vi.fn() };
    const { session, connection } = start({ listener });
    await session.turn;
    connection.close();
    expect(listener.closed).toHaveBeenCalled();
  });

  it("cancels the process when the usage history fails", async () => {
    const { session, process } = start();
    const usage = h.registerUsage.mock.calls[0][2] as {
      session: () => string | null;
      failed: () => void;
    };
    await session.turn;
    expect(usage.session()).toBe("s1");
    usage.failed();
    expect(process.cancel).toHaveBeenCalledWith("plan_history_unavailable");
  });

  it("refreshes the prices and ends requests on abort for OpenCode", () => {
    const controller = new AbortController();
    const { connection } = start({
      driver: OPENCODE,
      signal: controller.signal,
      openCodePricingDirectory: "/prices",
    });
    expect(h.priceCatalog).toHaveBeenCalledWith("/prices");
    expect(h.refresh).toHaveBeenCalled();
    controller.abort();
    expect(connection.close).toHaveBeenCalled();
  });

  it("stops at once when OpenCode starts with an aborted signal", () => {
    const controller = new AbortController();
    controller.abort();
    const { connection } = start({
      driver: OPENCODE,
      signal: controller.signal,
    });
    expect(h.priceCatalog).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalled();
  });
});

describe("notifications", () => {
  it("drains the listener after an update", async () => {
    const listener = { update: vi.fn(), drained: vi.fn() };
    const handled = vi.fn();
    const harness = start({ listener, notificationHandled: handled });
    await harness.session.turn;
    await harness.notify(update(chunk("hi")));
    expect(listener.update).toHaveBeenCalled();
    expect(handled).toHaveBeenCalled();
  });

  it("synchronizes native usage on a usage update", async () => {
    const nativeUsage = vi.fn();
    const harness = start({
      driver: OPENCODE,
      listener: { update: vi.fn(), nativeUsage },
      openCodeDataHome: "/data",
      request: { ...baseContext().request, model: "openrouter/x" },
    });
    await harness.session.turn;
    await harness.notify(
      update({ sessionUpdate: "usage_update", used: 1, size: 2 }),
    );
    expect(nativeUsage).toHaveBeenCalledWith("s1", "/data");
  });

  it.each([
    { driver: baseContext().driver },
    { request: { ...baseContext().request, model: "gpt" } },
    { openCodeDataHome: undefined },
  ])("leaves native usage alone when %j", async (override) => {
    const nativeUsage = vi.fn();
    const harness = start({
      driver: OPENCODE,
      listener: { update: vi.fn(), nativeUsage },
      openCodeDataHome: "/data",
      request: { ...baseContext().request, model: "openrouter/x" },
      ...override,
    });
    await harness.session.turn;
    await harness.notify(
      update({ sessionUpdate: "usage_update", used: 1, size: 2 }),
    );
    expect(nativeUsage).not.toHaveBeenCalled();
  });

  it("stops the process when the update breaks a limit", async () => {
    h.logTool.mockImplementation(() => {
      throw new AgentError("acp_output_overflow");
    });
    const harness = start();
    await harness.session.turn;
    await harness.notify(update(chunk("x")));
    expect(harness.process.cancel).toHaveBeenCalledWith("acp_output_overflow");
  });

  it("treats another failure as a lost history", async () => {
    h.logTool.mockImplementation(() => {
      throw new Error("disk");
    });
    const harness = start();
    await harness.session.turn;
    await harness.notify(update(chunk("x")));
    expect(harness.process.cancel).toHaveBeenCalledWith(
      "plan_history_unavailable",
    );
  });

  it("ignores an update of another session", async () => {
    const listener = { update: vi.fn() };
    const harness = start({ listener });
    await harness.session.turn;
    await harness.notify(update(chunk("x"), "other"));
    expect(listener.update).not.toHaveBeenCalled();
  });

  it("accepts an update before the session is named", async () => {
    const listener = { update: vi.fn() };
    const harness = start({ listener });
    await harness.notify(update(chunk("x"), "early"));
    expect(listener.update).toHaveBeenCalled();
    await harness.session.turn;
  });

  it("lets the MCP readiness consume an update", async () => {
    const listener = { update: vi.fn() };
    const harness = start({ listener });
    await harness.session.turn;
    h.mcpReceive.mockReturnValue(true);
    await harness.notify(update(chunk("x")));
    expect(listener.update).not.toHaveBeenCalled();
  });

  it("keeps the options of a configuration update and reports plan activity", async () => {
    const harness = start({ observer: { identified: vi.fn() } });
    await harness.session.turn;
    await harness.notify(
      update({ sessionUpdate: "config_option_update", configOptions: [] }),
    );
    const redact = h.planActivity.mock.calls.at(-1)?.[2] as (
      text: string,
    ) => string;
    expect(redact("x")).toBe("x");
  });
});

describe("OpenCode updates", () => {
  const failing = update({ sessionUpdate: "plan", entries: [] });

  async function opencode(model = "m"): Promise<Harness> {
    const listener = { update: vi.fn() };
    const harness = start({
      driver: OPENCODE,
      listener,
      request: { ...baseContext().request, model },
    });
    await harness.session.turn;
    return harness;
  }

  it("forwards the stored usage for the session of the update", async () => {
    const harness = await opencode();
    h.forwardUsage.mockClear();
    await harness.notify(failing);
    expect(h.forwardUsage).toHaveBeenCalledWith(harness.context, "s1");
    expect(h.toolFailure).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("counts a denied tool and notes an unavailable one", async () => {
    const harness = await opencode("openrouter/m");
    h.toolFailure.mockReturnValue("plan_runner_permission_denied");
    h.unavailableTool.mockReturnValue("no such tool");
    await harness.notify(failing);
    expect(h.toolFailure).toHaveBeenLastCalledWith(expect.anything(), true);
  });
});

describe("reported model", () => {
  const usage = (model: string): ReturnType<typeof update> =>
    update({
      sessionUpdate: "usage_update",
      used: 1,
      size: 2,
      _meta: { "_claude/model": model },
    });

  function profile(
    matches: ((a: string, b: string) => boolean) | null,
  ): BaseContext["profile"] {
    return { ...baseContext().profile, matchesReportedModel: matches };
  }

  it("accepts the stored model once", async () => {
    const harness = start({ profile: profile(() => true) });
    await harness.session.turn;
    await harness.notify(usage("gpt"));
    await harness.notify(usage("gpt"));
    expect(h.cancelTurn).not.toHaveBeenCalled();
  });

  it("cancels the turn on another model", async () => {
    const harness = start({ profile: profile(() => false) });
    await harness.session.turn;
    await harness.notify(usage("other"));
    expect(h.cancelTurn).toHaveBeenCalledOnce();
  });

  it("ends the prompt as an unavailable model", async () => {
    const harness = start({ profile: profile(() => false) });
    promptResult = async () => {
      await harness.notify(usage("other"));
      return { stopReason: "cancelled" };
    };
    await expect(harness.session.turn).resolves.toMatchObject({
      errorCode: "plan_model_unavailable",
    });
  });

  it("does not check an adapter that reports no model", async () => {
    const harness = start({ profile: profile(null) });
    await harness.session.turn;
    await harness.notify(usage("other"));
    expect(h.cancelTurn).not.toHaveBeenCalled();
  });
});
