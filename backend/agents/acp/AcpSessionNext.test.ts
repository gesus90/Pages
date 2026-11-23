import { methods } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentStepFailedError } from "@/backend/error/AgentStepFailedError";
import { AcpSession } from "@/backend/agents/acp/AcpSession";

import type { PlanSessionObserver } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
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
const input = (
  overrides: Record<string, unknown> = {},
): AgentPlanExecutionInput =>
  fake({
    agent: { model: "gpt", reasoningEffort: null },
    beforeStart: vi.fn(),
    ...overrides,
  });

function observer(): PlanSessionObserver {
  return fake({ identified: vi.fn(), progressed: vi.fn() });
}

describe("next", () => {
  it("refuses a profile that runs one turn", async () => {
    const harness = start({
      profile: { ...baseContext().profile, isContinuable: false },
    });
    await expect(
      harness.session.next(input(), new AbortController().signal, observer()),
    ).rejects.toMatchObject({ code: "provider_invalid" });
  });

  it("continues the session with a new prompt", async () => {
    const harness = start();
    await harness.session.turn;
    const identified = vi.fn();
    const turn = await harness.session.next(
      input(),
      new AbortController().signal,
      fake<PlanSessionObserver>({ identified }),
    );
    expect(turn.failure).toBeNull();
    expect(identified).toHaveBeenCalledWith("s1");
    expect(h.turnPrompt).toHaveBeenCalledTimes(2);
  });
});

describe("next in other states", () => {
  it("refuses a session that is busy, closing or unnamed", async () => {
    const busy = start();
    await busy.session.turn;
    const signal = new AbortController().signal;
    const first = busy.session.next(input(), signal, observer());
    await expect(
      busy.session.next(input(), signal, observer()),
    ).rejects.toBeInstanceOf(AgentStepFailedError);
    await first;
    void busy.session.close();
    await expect(
      busy.session.next(input(), signal, observer()),
    ).rejects.toBeInstanceOf(AgentStepFailedError);
    h.open.mockResolvedValue({ sessionId: "s1", options: [] });
    const unnamed = start();
    await unnamed.session.turn;
    await expect(
      unnamed.session.next(input(), signal, observer()),
    ).rejects.toBeInstanceOf(AgentStepFailedError);
  });
});

describe("next by provider", () => {
  it("starts a Codex CLI step through its hook", async () => {
    const harness = start({
      driver: { ...baseContext().driver, provider: "codex_cli" },
    });
    await harness.session.turn;
    const beforeStart = vi.fn();
    await harness.session.next(
      input({ beforeStart }),
      new AbortController().signal,
      observer(),
    );
    expect(beforeStart).toHaveBeenCalled();
  });

  it("starts a Codex CLI step that has no hook", async () => {
    const harness = start({
      driver: { ...baseContext().driver, provider: "codex_cli" },
    });
    await harness.session.turn;
    await harness.session.next(
      input({ beforeStart: undefined }),
      new AbortController().signal,
      observer(),
    );
  });

  it("configures Antigravity again for the same model", async () => {
    const harness = start({
      driver: { ...baseContext().driver, provider: "antigravity" },
    });
    await harness.session.turn;
    h.configure.mockClear();
    await harness.session.next(
      input(),
      new AbortController().signal,
      observer(),
    );
    expect(h.configure).toHaveBeenCalledWith(expect.anything(), "s1", [
      { id: "o" },
    ]);
  });

  it.each([
    { model: "other", reasoningEffort: null },
    { model: "gpt", reasoningEffort: "high" },
  ])("fails an Antigravity step with another assignment %j", async (agent) => {
    const harness = start({
      driver: { ...baseContext().driver, provider: "antigravity" },
    });
    await harness.session.turn;
    await harness.session.next(
      input({ agent }),
      new AbortController().signal,
      observer(),
    );
    expect(h.resolveFailure.mock.calls[0][0]).toMatchObject({
      error: { code: "plan_context_changed" },
    });
  });

  it("fails a step whose signal was stopped before it began", async () => {
    const harness = start();
    await harness.session.turn;
    const controller = new AbortController();
    controller.abort(new DOMException("late", "TimeoutError"));
    await expect(
      harness.session.next(input(), controller.signal, observer()),
    ).resolves.toMatchObject({ marker: "resolved" });
    expect(harness.process.cancel).toHaveBeenCalledWith("check_timeout");
  });

  it("cancels the process and the OpenCode requests when the step is stopped", async () => {
    const harness = start({ driver: OPENCODE });
    await harness.session.turn;
    harness.connection.close.mockClear();
    const controller = new AbortController();
    controller.abort("stop");
    await harness.session.next(input(), controller.signal, observer());
    expect(harness.process.cancel).toHaveBeenCalledWith("login_cancelled");
    expect(harness.connection.close).toHaveBeenCalled();
  });

  it("keeps a notification failure of the first turn", async () => {
    h.logTool.mockImplementationOnce(() => {
      throw new AgentError("acp_output_overflow");
    });
    const harness = start();
    promptResult = async () => {
      await harness.notify(update(chunk("x")));
      return { stopReason: "end_turn" };
    };
    await expect(harness.session.turn).resolves.toMatchObject({
      failure: "failed",
      errorCode: "acp_output_overflow",
    });
  });
});
