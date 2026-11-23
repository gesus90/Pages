import {
  PROTOCOL_VERSION,
  RequestError,
  methods,
} from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { createAcpSessionState } from "@/backend/agents/acp/AcpEvents";
import {
  configureAcpSession,
  initializeAcpSession,
  openAcpSession,
} from "@/backend/agents/acp/AcpSessionHandshake";

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { AcpSessionState } from "@/backend/agents/acp/AcpEvents";
import type { AcpHandshakeTarget } from "@/backend/agents/acp/AcpSessionHandshake";

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

type Handler = (params: Record<string, unknown>) => unknown;

function build(
  handlers: Map<unknown, Handler>,
  overrides: {
    context?: Record<string, unknown>;
    target?: Record<string, unknown>;
    aborted?: boolean;
  } = {},
): {
  request: ReturnType<typeof vi.fn>;
  state: AcpSessionState;
  observer: {
    identified: ReturnType<typeof vi.fn>;
    capabilities: ReturnType<typeof vi.fn>;
  };
  target: AcpHandshakeTarget;
} {
  const request = vi.fn((method: unknown, params: Record<string, unknown>) => {
    const result = handlers.get(method)?.(params);
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  });
  const state = createAcpSessionState();
  const observer = { identified: vi.fn(), capabilities: vi.fn() };
  const context = {
    request: {
      directory: "/w",
      mcpServers: [],
      sessionMeta: { a: 1 },
      resumeSessionId: null,
    },
    driver: {
      provider: "codex_cli",
      supportedVersions: "1",
      mcpCapabilities: undefined,
      isSupportedAdapter: () => true,
      errors: { adapterUnsupported: "plan_acp_adapter_unsupported" },
    },
    profile: {
      steps: () => [],
      reportedOptions: { model: "model" },
    },
    ...overrides.context,
  };
  const target = fake<AcpHandshakeTarget>({
    connection: {
      agent: { request },
      signal: { aborted: overrides.aborted ?? false },
    },
    context,
    state,
    observer,
    hasPicaCodex: false,
    redact: (text: string) => `r:${text}`,
    ...overrides.target,
  });
  return { request, state, observer, target };
}

const INIT = {
  protocolVersion: PROTOCOL_VERSION,
  agentInfo: { name: "codex", version: "1" },
  agentCapabilities: {
    loadSession: true,
    sessionCapabilities: { resume: {} },
    promptCapabilities: { image: true },
  },
  _meta: { steering: { supported: true } },
};

describe("initializeAcpSession", () => {
  it("negotiates the capabilities and reports them", async () => {
    const initialized = vi.fn();
    const announced = vi.fn();
    const { target, observer } = build(
      new Map([[methods.agent.initialize, () => INIT]]),
      { context: { listener: { initialized, announced } } },
    );
    const result = await initializeAcpSession(target);
    expect(result).toEqual({
      promptCapabilities: { image: true },
      isSteeringSupported: true,
    });
    expect(initialized).toHaveBeenCalledWith(true, { image: true });
    expect(announced).toHaveBeenCalledWith(INIT.agentCapabilities);
    expect(observer.capabilities).toHaveBeenCalledWith({
      canResume: true,
      canLoad: true,
      adapter: "codex 1",
    });
  });

  it("works without listener and capabilities, and without steering for Pica Codex", async () => {
    const { target } = build(
      new Map([
        [
          methods.agent.initialize,
          () => ({
            protocolVersion: PROTOCOL_VERSION,
            agentInfo: INIT.agentInfo,
          }),
        ],
      ]),
      { target: { hasPicaCodex: true, observer: { identified: vi.fn() } } },
    );
    await expect(initializeAcpSession(target)).resolves.toEqual({
      promptCapabilities: undefined,
      isSteeringSupported: false,
    });
  });

  it("leaves no continuation to a profile that forgets the session", async () => {
    const { target, observer } = build(
      new Map([[methods.agent.initialize, () => INIT]]),
      {
        context: {
          profile: {
            keepsSession: false,
            steps: () => [],
            reportedOptions: {},
          },
        },
      },
    );
    await initializeAcpSession(target);
    expect(observer.capabilities).toHaveBeenCalledWith({
      canResume: false,
      canLoad: false,
      adapter: "codex 1",
    });
  });

  it("refuses a remote MCP server the adapter cannot reach", async () => {
    const { target } = build(
      new Map([[methods.agent.initialize, () => INIT]]),
      {
        context: {
          request: {
            directory: "/w",
            mcpServers: [{ type: "http", name: "p", url: "u", headers: [] }],
          },
        },
      },
    );
    await expect(initializeAcpSession(target)).rejects.toBeInstanceOf(
      AgentError,
    );
  });
});

describe("openAcpSession", () => {
  const created = (
    params: Record<string, unknown>,
  ): { sessionId: string; configOptions: { id: string }[] | undefined } => ({
    sessionId: "new",
    configOptions: params.cwd === "/w" ? [{ id: "x" }] : undefined,
  });

  it("opens a new session", async () => {
    const onConfirmThread = vi.fn();
    const { target, state, observer, request } = build(
      new Map([[methods.agent.session.new, created]]),
      { target: { onConfirmThread } },
    );
    const opened = await openAcpSession(target);
    expect(opened).toEqual({ sessionId: "new", options: [{ id: "x" }] });
    expect(onConfirmThread).toHaveBeenCalledWith("new");
    expect(state.sessionId).toBe("new");
    expect(state.events).toEqual(["session new"]);
    expect(observer.identified).toHaveBeenCalledWith("r:new");
    expect(request.mock.calls[0][1]).toMatchObject({ _meta: { a: 1 } });
  });

  it("defaults the options of a session that reports none", async () => {
    const { target } = build(
      new Map([[methods.agent.session.new, () => ({ sessionId: "n" })]]),
    );
    expect((await openAcpSession(target)).options).toEqual([]);
  });

  function resuming(
    handler: Handler,
    canReplaceMissingSession = false,
    aborted = false,
  ): ReturnType<typeof build> {
    return build(
      new Map<unknown, Handler>([
        [methods.agent.session.resume, handler],
        [methods.agent.session.new, created],
      ]),
      {
        aborted,
        context: {
          request: {
            directory: "/w",
            mcpServers: [],
            sessionMeta: {},
            resumeSessionId: "old",
            canReplaceMissingSession,
          },
        },
      },
    );
  }

  it("resumes an earlier session", async () => {
    const { target, state } = resuming(() => ({ configOptions: [] }));
    expect((await openAcpSession(target)).sessionId).toBe("old");
    expect(state.events[0]).toBe("resume session");
  });

  it("fails a refused resume", async () => {
    const { target } = resuming(() => new RequestError(-32602, "gone"));
    await expect(openAcpSession(target)).rejects.toMatchObject({
      code: "acp_session_resume_failed",
    });
  });

  it("replaces a missing session when the plan allows it", async () => {
    const { target } = resuming(() => new RequestError(-32602, "gone"), true);
    expect((await openAcpSession(target)).sessionId).toBe("new");
  });

  it("passes on a resume error of a lost connection", async () => {
    const { target } = resuming(
      () => new RequestError(-32602, "gone"),
      true,
      true,
    );
    await expect(openAcpSession(target)).rejects.toBeInstanceOf(RequestError);
  });

  it("passes on another resume error", async () => {
    const { target } = resuming(() => new Error("pipe"));
    await expect(openAcpSession(target)).rejects.toThrow("pipe");
  });
});

describe("configureAcpSession", () => {
  const model = fake<SessionConfigOption>({
    id: "model",
    name: "m",
    type: "select",
    currentValue: "m1",
    options: [{ value: "m1", name: "m1" }],
  });

  it("reads the options and keeps what is expected", async () => {
    const { target, state } = build(new Map());
    const result = await configureAcpSession(target, "s", [model]);
    expect(result.options).toEqual([model]);
    expect(result.expected).toEqual({ model: "m1" });
    expect(state.effective.reasoningEffort).toBeUndefined();
  });

  it("names the default effort of OpenCode unless one was read", async () => {
    const opencode = { provider: "opencode", errors: {} };
    const first = build(new Map(), { context: { driver: opencode } });
    expect((await configureAcpSession(first.target, "s", [])).expected).toEqual(
      {
        reasoningEffort: "default",
      },
    );
    const second = build(new Map(), { context: { driver: opencode } });
    second.state.effective.reasoningEffort = "high";
    await configureAcpSession(second.target, "s", []);
    expect(second.state.effective.reasoningEffort).toBe("high");
  });
});
