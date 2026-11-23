import { methods } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AcpSession } from "@/backend/agents/acp/AcpSession";

import type { Mock } from "vitest";
import type * as AcpChat from "@/backend/agents/acp/AcpChat";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
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

const OPENCODE = { ...baseContext().driver, provider: "opencode" };
const text = [{ type: "text" as const, text: "more" }];

/** Starts a session whose prompt stays open until `finish` is called. */
async function running(
  overrides: Record<string, unknown> = {},
  isSteeringSupported = false,
): Promise<Harness & { finish: (value: unknown) => void }> {
  h.initialize.mockResolvedValue({
    promptCapabilities: undefined,
    isSteeringSupported,
  });
  h.promptParams.mockReturnValue({});
  let finish: (value: unknown) => void = () => undefined;
  promptResult = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const harness = start(overrides);
  await vi.waitFor(() => {
    expect(harness.connection.agent.request).toHaveBeenCalledWith(
      methods.agent.session.prompt,
      expect.anything(),
    );
  });
  return { ...harness, finish: (value: unknown) => finish(value) };
}

describe("lifecycle", () => {
  it("ends the terminated promise with the process", async () => {
    const { session } = start({}, { exited: Promise.resolve({}) });
    await expect(session.terminated).resolves.toBeUndefined();
  });

  it("hands the handshake what the session knows", async () => {
    const requests = {
      cancelTurn: vi.fn(),
      close: vi.fn(),
      confirmThread: vi.fn(),
    };
    const { session } = start({
      picaSupport: {
        createRequests: () => requests,
        registerRequests: vi.fn(),
      },
      redact: (value: string) => `<${value}>`,
    });
    await session.turn;
    const target = h.initialize.mock.calls[0][0] as {
      hasPicaCodex: boolean;
      onConfirmThread: (id: string) => void;
      redact: (value: string) => string;
    };
    target.onConfirmThread("t");
    expect(requests.confirmThread).toHaveBeenCalledWith("t");
    expect(target.redact("x")).toBe("<x>");
    expect(target.hasPicaCodex).toBe(true);
  });

  it("confirms no thread without Pica Codex", async () => {
    const { session } = start();
    await session.turn;
    const target = h.initialize.mock.calls[0][0] as {
      onConfirmThread: (id: string) => void;
    };
    expect(() => target.onConfirmThread("t")).not.toThrow();
  });

  it("pauses the process when it can", async () => {
    const { session, process } = start();
    await session.setPaused(true);
    expect(process.setPaused).toHaveBeenCalledWith(true);
    const plain = start({}, { setPaused: undefined });
    await expect(plain.session.setPaused(true)).rejects.toThrow(
      "Session pause unavailable",
    );
  });

  it.each([
    [baseContext().driver, true, false],
    [OPENCODE, true, true],
    [OPENCODE, false, false],
  ])(
    "suspends and resumes only OpenCode (%#)",
    async (driver, has, expected) => {
      const extra = has ? {} : { suspend: undefined, resume: undefined };
      const { session } = start({ driver }, extra);
      await expect(session.suspend()).resolves.toBe(expected);
      await expect(session.resume()).resolves.toBe(expected);
    },
  );

  it("has no suspend for an OpenCode process that cannot", async () => {
    const { session } = start(
      { driver: OPENCODE },
      { suspend: undefined, resume: undefined },
    );
    await expect(session.suspend()).resolves.toBe(false);
  });
});

describe("close", () => {
  it("shuts down once and cleans a confirmed session", async () => {
    const cleanupAdapter = vi.fn();
    const cleanupTemporaryDirectory = vi.fn().mockResolvedValue(undefined);
    const requests = {
      cancelTurn: vi.fn(),
      close: vi.fn(),
      confirmThread: vi.fn(),
    };
    const harness = start({
      codexHome: "/h",
      listener: { update: vi.fn() },
      cleanupAdapter,
      cleanupTemporaryDirectory,
      containment: "pid",
      picaSupport: {
        createRequests: () => requests,
        registerRequests: vi.fn(),
      },
    });
    await harness.session.turn;
    const first = harness.session.close();
    expect(harness.session.close()).toBe(first);
    await expect(first).resolves.toEqual({ isConfirmed: true });
    expect(h.usageClose).toHaveBeenCalled();
    expect(cleanupAdapter).toHaveBeenCalled();
    expect(cleanupTemporaryDirectory).toHaveBeenCalled();
    expect(requests.cancelTurn).toHaveBeenCalled();
    expect(h.closeCliSession.mock.calls[0][3]).toBe("pid");
  });

  it("logs a failed temporary cleanup", async () => {
    const harness = start({
      cleanupTemporaryDirectory: vi.fn().mockRejectedValue(new Error("rm")),
    });
    await harness.session.turn;
    await harness.session.close();
    expect(h.logCaught).toHaveBeenCalled();
    expect(h.closeCliSession.mock.calls[0][3]).toBe("none");
  });

  it("releases the directory of an unconfirmed session", async () => {
    h.closeCliSession.mockResolvedValue({ isConfirmed: false });
    const releaseTemporaryDirectory = vi.fn();
    const harness = start({ releaseTemporaryDirectory });
    await harness.session.turn;
    await harness.session.close();
    expect(releaseTemporaryDirectory).toHaveBeenCalled();
    const plain = start();
    await plain.session.turn;
    await plain.session.close();
  });

  it("works without optional cleanup on a confirmed session", async () => {
    const harness = start();
    await harness.session.turn;
    await expect(harness.session.close()).resolves.toEqual({
      isConfirmed: true,
    });
    expect(harness.context.secure).toHaveBeenCalled();
  });
});

describe("steer", () => {
  it("is inactive before the session is named and after closing", async () => {
    const early = start();
    await expect(early.session.steer(text)).resolves.toBe("inactive");
    await early.session.turn;
    void early.session.close();
    await expect(early.session.steer(text)).resolves.toBe("inactive");
  });

  it("fails an input that does not fit the budget", async () => {
    const harness = await running();
    h.isWithinBudget.mockReturnValue(false);
    await expect(harness.session.steer(text)).resolves.toBe("failed");
    harness.finish({ stopReason: "end_turn" });
  });

  it("uses the steering extension of the adapter", async () => {
    h.requestAcpSteer.mockResolvedValue("steered");
    const harness = await running({}, true);
    await expect(harness.session.steer(text)).resolves.toBe("steered");
    expect(h.requestAcpSteer).toHaveBeenCalledWith(harness.connection.agent, {
      sessionId: "s1",
      prompt: text,
      meta: null,
    });
    harness.finish({ stopReason: "end_turn" });
  });

  it("cuts the prompt short for a person's input without the extension", async () => {
    const harness = await running({ acceptsTurnInput: true });
    await expect(harness.session.steer(text)).resolves.toBe("injected");
    promptResult = () => Promise.resolve({ stopReason: "end_turn" });
    harness.finish({ stopReason: "cancelled" });
    await expect(harness.session.turn).resolves.toBeDefined();
  });

  it("is inactive for a plan that takes no input", async () => {
    const harness = await running();
    await expect(harness.session.steer(text)).resolves.toBe("inactive");
    harness.finish({ stopReason: "end_turn" });
  });
});

describe("interrupt and cancelTool", () => {
  it("interrupts only a running prompt of a node that takes input", async () => {
    const closed = start({ acceptsTurnInput: true });
    await closed.session.turn;
    await expect(closed.session.interrupt()).resolves.toBe(false);
    const refusing = await running();
    await expect(refusing.session.interrupt()).resolves.toBe(false);
    refusing.finish({ stopReason: "end_turn" });
    const harness = await running({ acceptsTurnInput: true });
    await expect(harness.session.interrupt()).resolves.toBe(true);
    harness.finish({ stopReason: "end_turn" });
    void closed.session.close();
    await expect(closed.session.interrupt()).resolves.toBe(false);
  });

  it("cancels a running tool call with a note", async () => {
    const harness = await running();
    await expect(harness.session.cancelTool("note")).resolves.toBe(true);
    promptResult = () => Promise.resolve({ stopReason: "end_turn" });
    harness.finish({ stopReason: "cancelled" });
    await expect(harness.session.turn).resolves.toBeDefined();
  });

  it("does nothing without a prompt or while closing", async () => {
    const harness = start();
    await harness.session.turn;
    await expect(harness.session.cancelTool("note")).resolves.toBe(false);
    void harness.session.close();
    await expect(harness.session.cancelTool("note")).resolves.toBe(false);
  });
});

describe("Claude quota", () => {
  const claude = { ...baseContext().driver, provider: "claude_code" };

  it("hands a reported window to the sink", async () => {
    h.readQuotaWindow.mockReturnValue({ window: 1 });
    const sink = { recordWindow: vi.fn(), recordPlan: vi.fn() };
    const harness = start({ driver: claude, claudeQuota: sink });
    await harness.session.turn;
    await harness.notify(update(chunk("x")));
    expect(sink.recordWindow).toHaveBeenCalledWith({ window: 1 });
  });

  it("ignores an update without a window, another provider and a missing sink", async () => {
    const sink = { recordWindow: vi.fn(), recordPlan: vi.fn() };
    const empty = start({ driver: claude, claudeQuota: sink });
    await empty.session.turn;
    await empty.notify(update(chunk("x")));
    const other = start({ claudeQuota: sink });
    await other.session.turn;
    await other.notify(update(chunk("x")));
    const missing = start({ driver: claude });
    await missing.session.turn;
    await missing.notify(update(chunk("x")));
    expect(sink.recordWindow).not.toHaveBeenCalled();
  });
});

describe("progress", () => {
  it("reports changed events at most every five seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(100_000);
    const progressed = vi.fn();
    const harness = start({ observer: { identified: vi.fn(), progressed } });
    await harness.session.turn;
    progressed.mockClear();
    await harness.notify(update({ sessionUpdate: "plan", entries: [] }));
    expect(progressed).toHaveBeenCalledOnce();
    await harness.notify(update({ sessionUpdate: "plan", entries: [] }));
    expect(progressed).toHaveBeenCalledOnce();
    vi.setSystemTime(110_000);
    await harness.notify(update({ sessionUpdate: "plan", entries: [] }));
    expect(progressed).toHaveBeenCalledTimes(2);
    vi.setSystemTime(120_000);
    await harness.notify(update(chunk("same")));
    expect(progressed).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("works for an observer that takes no progress", async () => {
    const harness = start({ observer: { identified: vi.fn() } });
    await harness.session.turn;
    await harness.notify(update({ sessionUpdate: "plan", entries: [] }));
  });
});
