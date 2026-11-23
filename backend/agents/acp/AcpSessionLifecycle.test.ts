import {
  PROTOCOL_VERSION,
  RequestError,
  methods,
} from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { createAcpSessionState } from "@/backend/agents/acp/AcpEvents";
import {
  forwardOpenCodeSessionUsage,
  initializeAcpSessionConnection,
  openOrResumeAcpSession,
  resolveAcpTurnFailure,
  shutDownAcpSession,
} from "@/backend/agents/acp/AcpSessionLifecycle";

import type { Mock } from "vitest";
import type {
  AcpInitializeOptions,
  AcpOpenSessionOptions,
  AcpShutDownOptions,
  AcpTurnFailureOptions,
} from "@/backend/agents/acp/AcpSessionLifecycle";
import type { AcpSessionContext } from "@/backend/agents/acp/AcpSessionContracts";

const mocks = vi.hoisted(() => ({
  closeCliSession: vi.fn(),
  closeAcpProtocol: vi.fn(),
  readUsage: vi.fn(),
  logCaughtError: vi.fn(),
}));

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

vi.mock("@/backend/agents/cli/CliSessionCloseout", () => ({
  closeCliSession: mocks.closeCliSession,
}));
vi.mock("@/backend/agents/acp/AcpProtocolClose", () => ({
  closeAcpProtocol: mocks.closeAcpProtocol,
}));
vi.mock("@/backend/agents/cli/OpenCodeSessionUsage", () => ({
  readOpenCodeSessionUsage: mocks.readUsage,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logEvent: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function usageContext(overrides: Record<string, unknown> = {}): {
  context: AcpSessionContext;
  receive: Mock;
} {
  const receive = vi.fn();
  const context = {
    driver: { provider: "opencode" },
    openCodeUsagePath: "/db",
    openCodePricingDirectory: "/pricing",
    isFreeModel: true,
    openRouterModelIds: { a: "b" },
    request: { model: "m" },
    listener: { openCodeMessages: receive },
    ...overrides,
  };
  return { context: fake<AcpSessionContext>(context), receive };
}

describe("forwardOpenCodeSessionUsage", () => {
  it("forwards the usage of a free model with its prices", () => {
    mocks.readUsage.mockReturnValue(["u"]);
    const { context, receive } = usageContext();
    forwardOpenCodeSessionUsage(context, "s");
    expect(receive).toHaveBeenCalledWith(["u"], "/pricing", "m", { a: "b" });
  });

  it("forwards a paid model without a name and without price ids", () => {
    const { context, receive } = usageContext({
      isFreeModel: false,
      openRouterModelIds: undefined,
    });
    forwardOpenCodeSessionUsage(context, "s");
    expect(receive.mock.calls[0].slice(2)).toEqual([null, {}]);
  });

  it.each([
    { driver: { provider: "codex_cli" } },
    { openCodeUsagePath: undefined },
    { openCodePricingDirectory: undefined },
    { listener: undefined },
  ])("does nothing without %j", (override) => {
    const { context } = usageContext(override);
    forwardOpenCodeSessionUsage(context, "s");
    expect(mocks.readUsage).not.toHaveBeenCalled();
  });

  it("logs a failed read", () => {
    mocks.readUsage.mockImplementation(() => {
      throw new Error("db");
    });
    forwardOpenCodeSessionUsage(usageContext().context, "s");
    expect(mocks.logCaughtError).toHaveBeenCalledOnce();
  });
});

describe("initializeAcpSessionConnection", () => {
  const init = {
    protocolVersion: PROTOCOL_VERSION,
    agentInfo: { name: "a", version: "1" },
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true },
    },
    _meta: { steering: { supported: true } },
  };

  function build(
    response: unknown,
    isPicaCodex: boolean,
    withListener: boolean,
    keepsSession?: boolean,
  ): {
    options: AcpInitializeOptions;
    listener: Record<string, Mock>;
    observer: Record<string, Mock>;
  } {
    const listener = { initialized: vi.fn(), announced: vi.fn() };
    const observer = { capabilities: vi.fn(), identified: vi.fn() };
    const options = fake<AcpInitializeOptions>({
      connection: { agent: { request: vi.fn().mockResolvedValue(response) } },
      context: {
        request: { mcpServers: [] },
        driver: {
          supportedVersions: "1",
          isSupportedAdapter: () => true,
          errors: { adapterUnsupported: "plan_acp_adapter_unsupported" },
        },
        profile: { keepsSession },
        listener: withListener ? listener : undefined,
      },
      state: createAcpSessionState(),
      observer,
      isPicaCodex,
    });
    return { options, listener, observer };
  }

  it("reports the negotiated capabilities", async () => {
    const { options, listener, observer } = build(init, false, true);
    await expect(initializeAcpSessionConnection(options)).resolves.toEqual({
      isSteeringSupported: true,
      promptCapabilities: { image: true },
    });
    expect(listener.initialized).toHaveBeenCalledWith(true, { image: true });
    expect(observer.capabilities).toHaveBeenCalledWith({
      canResume: false,
      canLoad: true,
      adapter: "a 1",
    });
  });

  it("offers no steering to Pica Codex and no continuation to a forgetful profile", async () => {
    const { options, observer } = build(
      { protocolVersion: PROTOCOL_VERSION, agentInfo: init.agentInfo },
      true,
      false,
      false,
    );
    await expect(initializeAcpSessionConnection(options)).resolves.toEqual({
      isSteeringSupported: false,
      promptCapabilities: undefined,
    });
    expect(observer.capabilities).toHaveBeenCalledWith({
      canResume: false,
      canLoad: false,
      adapter: "a 1",
    });
  });
});

describe("openOrResumeAcpSession", () => {
  function build(
    resumeSessionId: string | undefined,
    request: (method: unknown) => unknown,
    aborted = false,
  ): {
    state: ReturnType<typeof createAcpSessionState>;
    options: AcpOpenSessionOptions;
  } {
    const state = createAcpSessionState();
    return {
      state,
      options: fake<AcpOpenSessionOptions>({
        connection: {
          agent: {
            request: vi.fn((method: unknown) => {
              const result = request(method);
              return result instanceof Error
                ? Promise.reject(result)
                : Promise.resolve(result);
            }),
          },
          signal: { aborted },
        },
        context: {
          request: {
            directory: "/w",
            mcpServers: [],
            sessionMeta: {},
            resumeSessionId,
          },
        },
        state,
      }),
    };
  }

  it("opens a new session", async () => {
    const { options } = build(undefined, () => ({
      sessionId: "n",
      configOptions: [],
    }));
    await expect(openOrResumeAcpSession(options)).resolves.toEqual({
      sessionId: "n",
      options: [],
    });
  });

  it("resumes a session", async () => {
    const { options, state } = build("old", () => ({ configOptions: null }));
    await expect(openOrResumeAcpSession(options)).resolves.toEqual({
      sessionId: "old",
      options: null,
    });
    expect(state.events).toEqual(["resume session"]);
  });

  it("fails a refused resume", async () => {
    const { options } = build("old", () => new RequestError(-1, "x"));
    await expect(openOrResumeAcpSession(options)).rejects.toBeInstanceOf(
      AgentError,
    );
  });

  it("passes on the error of a lost connection and other errors", async () => {
    const lost = build("old", () => new RequestError(-1, "x"), true);
    await expect(openOrResumeAcpSession(lost.options)).rejects.toBeInstanceOf(
      RequestError,
    );
    const other = build("old", () => new Error("pipe"));
    await expect(openOrResumeAcpSession(other.options)).rejects.toThrow("pipe");
    expect(methods.agent.session.resume).toBeDefined();
  });
});

describe("resolveAcpTurnFailure", () => {
  const driver = {
    provider: "codex_cli",
    errors: { sessionFailed: "plan_acp_session_failed" },
  };

  function build(overrides: Record<string, unknown> = {}): {
    controller: AbortController;
    options: AcpTurnFailureOptions;
  } {
    const controller = new AbortController();
    const state = createAcpSessionState();
    const exited = Promise.resolve({ errorCode: null, stderrTail: "" });
    const options = {
      error: new Error("boom"),
      turnSignal: controller.signal,
      process: { exited },
      connectionAborted: false,
      state,
      context: { driver, request: { model: "gpt" } },
      isPicaNative: false,
      notificationFailure: null,
      hasHistoryFailure: false,
      redact: (text: string) => text,
      ...overrides,
    };
    return { controller, options: fake<AcpTurnFailureOptions>(options) };
  }

  it("ends an aborted OpenCode turn by its signal", async () => {
    const { controller, options } = build({
      context: {
        driver: { ...driver, provider: "opencode" },
        request: { model: "m" },
      },
    });
    controller.abort();
    await expect(resolveAcpTurnFailure(options)).resolves.toMatchObject({
      failure: "cancelled",
    });
  });

  it("asks the process exit about an aborted turn", async () => {
    const timed = build({
      process: { exited: Promise.resolve({ errorCode: "check_timeout" }) },
    });
    timed.controller.abort();
    await expect(resolveAcpTurnFailure(timed.options)).resolves.toMatchObject({
      failure: "timeout",
    });
    const stopped = build();
    stopped.controller.abort();
    await expect(resolveAcpTurnFailure(stopped.options)).resolves.toMatchObject(
      {
        failure: "cancelled",
      },
    );
  });

  it("prefers the failure of a native notification", async () => {
    const { options } = build({ notificationFailure: "acp_output_overflow" });
    await expect(resolveAcpTurnFailure(options)).resolves.toMatchObject({
      failure: "failed",
      errorCode: "acp_output_overflow",
    });
  });

  it("classifies the error of the turn", async () => {
    const { options } = build({ error: new AgentError("acp_result_limit") });
    await expect(resolveAcpTurnFailure(options)).resolves.toMatchObject({
      errorCode: "acp_result_limit",
    });
  });

  it("falls back to the exit of a disconnected process", async () => {
    const { options } = build({
      connectionAborted: true,
      context: { driver, request: { model: "openrouter/x" } },
      process: {
        exited: Promise.resolve({ errorCode: null, stderrTail: "429" }),
      },
    });
    await expect(resolveAcpTurnFailure(options)).resolves.toMatchObject({
      failure: "failed",
      errorCode: "openrouter_rate_limited",
    });
  });
});

describe("shutDownAcpSession", () => {
  function build(
    overrides: Record<string, unknown> = {},
    closedConfirmed = true,
  ): {
    context: Record<string, unknown> & {
      cleanupAdapter: Mock;
      cleanupTemporaryDirectory: Mock;
      releaseTemporaryDirectory: Mock;
      secure: Mock;
    };
    options: Record<string, unknown> & {
      picaCodex: { close: Mock };
    };
  } {
    const closed = { isConfirmed: closedConfirmed };
    mocks.closeCliSession.mockResolvedValue(closed);
    const context = {
      instanceId: "i",
      signal: new AbortController().signal,
      secure: vi.fn().mockResolvedValue(undefined),
      cleanupAdapter: vi.fn(),
      cleanupTemporaryDirectory: vi.fn().mockResolvedValue(undefined),
      releaseTemporaryDirectory: vi.fn(),
      containment: "pid",
      ...overrides,
    };
    const options = {
      connection: { close: vi.fn() },
      process: {},
      context,
      sessionId: "s",
      picaCodex: { cancelTurn: vi.fn(), close: vi.fn() },
      abortRequests: vi.fn(),
    };
    return { context, options };
  }

  it("cleans up after a confirmed close", async () => {
    const { context, options } = build();
    await expect(
      shutDownAcpSession(fake<AcpShutDownOptions>(options)),
    ).resolves.toEqual({
      isConfirmed: true,
    });
    expect(mocks.closeCliSession).toHaveBeenCalledWith(
      {},
      "i",
      undefined,
      "pid",
    );
    expect(context.cleanupAdapter).toHaveBeenCalled();
    expect(context.cleanupTemporaryDirectory).toHaveBeenCalled();
    expect(options.picaCodex.close).toHaveBeenCalled();
    expect(context.secure).toHaveBeenCalled();
  });

  it("logs a failed temporary cleanup", async () => {
    const { options } = build({
      cleanupTemporaryDirectory: vi.fn().mockRejectedValue(new Error("rm")),
    });
    await shutDownAcpSession(fake<AcpShutDownOptions>(options));
    expect(mocks.logCaughtError).toHaveBeenCalledOnce();
  });

  it("releases the directory when the close is not confirmed", async () => {
    const { context, options } = build({ containment: undefined }, false);
    await shutDownAcpSession(fake<AcpShutDownOptions>(options));
    expect(context.releaseTemporaryDirectory).toHaveBeenCalled();
    expect(mocks.closeCliSession.mock.calls[0][3]).toBe("none");
  });

  it("works without optional cleanup and Pica Codex", async () => {
    const { options } = build({
      cleanupAdapter: undefined,
      cleanupTemporaryDirectory: undefined,
      releaseTemporaryDirectory: undefined,
    });
    await shutDownAcpSession(
      fake<AcpShutDownOptions>({ ...options, picaCodex: null }),
    );
    const unconfirmed = build({ releaseTemporaryDirectory: undefined }, false);
    await shutDownAcpSession(
      fake<AcpShutDownOptions>({ ...unconfirmed.options, picaCodex: null }),
    );
  });

  it("still secures the credentials when closing fails", async () => {
    const { context, options } = build();
    mocks.closeAcpProtocol.mockRejectedValue(new Error("x"));
    await expect(
      shutDownAcpSession(fake<AcpShutDownOptions>(options)),
    ).rejects.toThrow("x");
    expect(context.secure).toHaveBeenCalled();
  });
});
