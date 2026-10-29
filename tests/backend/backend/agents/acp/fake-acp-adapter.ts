import {
  RequestError,
  agent,
  methods,
  ndJsonStream,
} from "@agentclientprotocol/sdk";

import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";

import type {
  AgentConnection,
  AgentCapabilities,
  PromptCapabilities,
  AgentContext,
  Implementation,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionUpdate,
  StopReason,
  Stream,
} from "@agentclientprotocol/sdk";
import type { CliSessionExit } from "@/backend/agents/cli/CliSessionProcess";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";

const SESSION_ID = "thread-synthetic";
const MODES = ["read-only", "workspace-write", "agent", "agent-full-access"];
const CLAUDE_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
];
const CLAUDE_MODEL_CHOICES = ["default", "opus", "sonnet", "haiku"];
const CLAUDE_EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"];
/** The model each picker choice of the fake Claude adapter resolves to. */
const CLAUDE_RESOLVED_MODELS: Readonly<Record<string, string>> = {
  default: "claude-opus-5-5",
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

/** One request or notification the fake adapter received, in order. */
export interface ReceivedCall {
  readonly method: string;
  readonly params: unknown;
}

/** What a scripted turn of the fake adapter can do. */
export interface FakeTurn {
  /** The text of the prompt the client sent. */
  readonly prompt: string;
  /** Sends one session update to the client. */
  readonly update: (update: SessionUpdate) => Promise<void>;
  /** Asks the client for a permission, as Codex does before an action. */
  readonly ask: (
    request: Omit<RequestPermissionRequest, "sessionId">,
  ) => Promise<RequestPermissionResponse>;
  /** Aborts when the client cancels the prompt request. */
  readonly signal: AbortSignal;
}

/** How the fake adapter behaves; everything is synthetic. */
export interface FakeAdapterOptions {
  readonly continuation?: Pick<
    AgentCapabilities,
    "loadSession" | "sessionCapabilities"
  >;
  readonly promptCapabilities?: PromptCapabilities;
  /** Which adapter it imitates: Codex by default. */
  readonly flavor?: "codex" | "claude" | "antigravity";
  readonly agentInfo?: Implementation | null;
  /** Claude: what the `/mcp` command lists the Pages server as. */
  readonly mcpStatus?: "connected" | "connecting" | "failed" | "unlisted";
  /** Claude: the model named by the first usage update instead of the chosen one. */
  readonly reportedModel?: string | null;
  readonly protocolVersion?: number;
  readonly models?: readonly string[];
  readonly efforts?: readonly string[];
  /** The mode the session starts in, as `INITIAL_AGENT_MODE` would set it. */
  readonly initialMode?: string;
  /** Options whose change the adapter refuses with an error. */
  readonly refused?: readonly string[];
  /** Options whose change the adapter answers without applying it. */
  readonly unconfirmed?: readonly string[];
  /** Options the adapter does not offer at all. */
  readonly missing?: readonly string[];
  readonly sessionError?: RequestError;
  /** The Pages MCP server reports a failed start while the session opens. */
  readonly isMcpStartFailing?: boolean;
  readonly turn?: (turn: FakeTurn) => Promise<StopReason>;
}

const SUPPORTED_ADAPTER: Implementation = {
  name: "@agentclientprotocol/codex-acp",
  version: "2.2.2",
};

const SUPPORTED_CLAUDE_ADAPTER: Implementation = {
  name: "@agentclientprotocol/claude-agent-acp",
  version: "0.90.0",
};

/**
 * The process of a fake Codex ACP adapter, speaking ACP over JSON lines.
 *
 * @remarks
 * The client side is the real channel Pages uses; the adapter side is an agent
 * app of the official SDK over newline-delimited JSON. Closing the input,
 * cancelling or a crash end the process like a real one.
 */
export class FakeAdapterProcess {
  public readonly channel = new AcpLineChannel();
  public readonly exited: Promise<CliSessionExit>;
  public readonly cancelled: AgentErrorCode[] = [];
  public inputClosings = 0;
  private readonly agentStream: Stream;
  private resolveExit: ((exit: CliSessionExit) => void) | null = null;
  private input: ReadableStreamDefaultController<Uint8Array> | null = null;
  private hasExited = false;

  /**
   * Creates the process; it ends with the node signal like a real session process.
   *
   * @param signal - The stop and deadline of the node.
   */
  public constructor(signal: AbortSignal) {
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    const encoder = new TextEncoder();
    const input = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.input = controller;
      },
    });
    this.channel.attach((line) => {
      if (this.hasExited) return false;
      this.input?.enqueue(encoder.encode(`${line}\n`));
      return true;
    });
    this.agentStream = ndJsonStream(this.outputStream(), input);
    signal.addEventListener("abort", () => {
      const isTimeout =
        signal.reason instanceof DOMException &&
        signal.reason.name === "TimeoutError";
      this.cancel(isTimeout ? "check_timeout" : "login_cancelled");
    });
  }

  /** Connects an agent app to the adapter side of the process. */
  public connect(app: ReturnType<typeof agent>): AgentConnection {
    return app.connect(this.agentStream);
  }

  /** A real adapter ends once its input is closed. */
  public endInput(): void {
    this.inputClosings += 1;
    this.exit({ code: 0, signal: null, errorCode: null, stderrTail: "" });
  }

  /** Ends the process as Pages would end its process group. */
  public cancel(code: AgentErrorCode): void {
    this.cancelled.push(code);
    this.exit({
      code: null,
      signal: "SIGTERM",
      errorCode: code,
      stderrTail: "",
    });
  }

  /** Ends the process by itself with a failure. */
  public crash(stderr: string): void {
    this.exit({ code: 1, signal: null, errorCode: null, stderrTail: stderr });
  }

  private outputStream(): WritableStream<Uint8Array> {
    const decoder = new TextDecoder();
    let pending = "";
    return new WritableStream<Uint8Array>({
      write: async (chunk) => {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines)
          if (line.trim()) await this.channel.receive(line);
      },
    });
  }

  private exit(exit: CliSessionExit): void {
    if (this.hasExited) return;
    this.hasExited = true;
    this.channel.close();
    this.input?.close();
    this.resolveExit?.(exit);
  }
}

/** Markdown as the Claude adapter answers its `/mcp` command with. */
function mcpListing(
  status: NonNullable<FakeAdapterOptions["mcpStatus"]>,
): string {
  const heading = {
    connected: "Connected",
    connecting: "Connecting",
    failed: "Failed",
    unlisted: "Disabled",
  }[status];
  if (status === "unlisted") return "**MCP servers:** 0\n";
  return `**MCP servers:** 1 (1 ${status})\n\n**${heading}**\n- \`pages\`: 2 tools\n`;
}

function selectOption(
  id: string,
  currentValue: string,
  values: readonly string[],
): SessionConfigOption {
  return {
    id,
    name: id,
    type: "select",
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  };
}

/** The state and the agent app of a fake Codex ACP adapter. */
export interface FakeCodexAgent {
  readonly app: ReturnType<typeof agent>;
  readonly calls: ReceivedCall[];
}

/** What the fake adapter currently has selected, and how it answers option changes. */
interface FakeSession {
  readonly configOptions: () => SessionConfigOption[];
  /** Applies a requested value as the adapter would; throws when it refuses. */
  readonly select: (configId: string, value: string) => void;
  /** The model the adapter's current choice resolves to, as Claude reports it. */
  readonly resolvedModel: () => string | undefined;
}

function effortOptionId(flavor: FakeAdapterOptions["flavor"]): string {
  if (flavor === "claude") return "effort";
  if (flavor === "antigravity") return "thinking_level";
  return "reasoning_effort";
}

function modeChoices(flavor: FakeAdapterOptions["flavor"]): readonly string[] {
  if (flavor === "claude") return CLAUDE_MODES;
  if (flavor === "antigravity") return ["default", "yolo"];
  return MODES;
}

function createSession(options: FakeAdapterOptions): FakeSession {
  const isClaude = options.flavor === "claude";
  const isAntigravity = options.flavor === "antigravity";
  const models = options.models ?? ["gpt-default", "gpt-synthetic"];
  const efforts =
    options.efforts ?? (isClaude ? CLAUDE_EFFORTS : ["low", "medium", "high"]);
  const effortId = effortOptionId(options.flavor);
  const modes = modeChoices(options.flavor);
  const defaultMode = isAntigravity ? "default" : "agent";
  const current: Record<string, string> = isClaude
    ? {
        mode: options.initialMode ?? "default",
        model: "default",
        effort: "default",
      }
    : {
        mode: options.initialMode ?? defaultMode,
        model: models[0] ?? "gpt-default",
        reasoning_effort: "medium",
        thinking_level: "high",
      };
  const choices = isClaude ? CLAUDE_MODEL_CHOICES : models;
  // The value the adapter stores for a requested one, or `null` when it offers none.
  function resolve(configId: string, value: string): string | null {
    if (!isClaude || configId !== "model") return value;
    const exact = Object.entries(CLAUDE_RESOLVED_MODELS).find(
      ([choice, model]) => choice !== "default" && model === value,
    );
    if (exact) return exact[0];
    return choices.includes(value) ? value : null;
  }
  return {
    configOptions: () =>
      [
        selectOption("mode", current.mode, modes),
        selectOption("model", current.model, choices),
        selectOption(effortId, current[effortId], efforts),
      ].filter((option) => !(options.missing ?? []).includes(option.id)),
    select: (configId, value) => {
      if ((options.refused ?? []).includes(configId))
        throw RequestError.invalidParams();
      const stored = resolve(configId, value);
      if (isClaude && stored === null) throw RequestError.invalidParams();
      if (stored === null || (options.unconfirmed ?? []).includes(configId))
        return;
      current[configId] = stored;
      // A model change resets the effort to the model's default, as the adapters do.
      if (configId === "model")
        current[effortId] = isClaude ? "default" : "medium";
    },
    resolvedModel: () => CLAUDE_RESOLVED_MODELS[current.model ?? "default"],
  };
}

async function claudePrompt(
  options: FakeAdapterOptions,
  session: FakeSession,
  turn: FakeTurn,
): Promise<StopReason> {
  if (turn.prompt === "/mcp") {
    await turn.update({
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: mcpListing(options.mcpStatus ?? "connected"),
      },
    });
    return "end_turn";
  }
  await turn.update({
    sessionUpdate: "usage_update",
    used: 10,
    size: 1000,
    _meta: {
      "_claude/model": options.reportedModel ?? session.resolvedModel(),
    },
  });
  return (options.turn ?? (async () => "end_turn"))(turn);
}

/**
 * Builds a fake ACP adapter with the options and turn of a test.
 *
 * @param options - Flavor, catalog, confirmation behaviour and the scripted turn.
 * @returns The agent app and every call it received.
 */
export function fakeAcpAgent(options: FakeAdapterOptions = {}): FakeCodexAgent {
  const calls: ReceivedCall[] = [];
  const isClaude = options.flavor === "claude";
  const session = createSession(options);
  const defaultInfo = isClaude ? SUPPORTED_CLAUDE_ADAPTER : SUPPORTED_ADAPTER;
  function record(method: string, params: unknown): void {
    calls.push({ method, params });
  }
  const app = agent({ name: "fake-acp" })
    .onRequest(methods.agent.initialize, (context) => {
      record(methods.agent.initialize, context.params);
      return {
        agentCapabilities: {
          promptCapabilities: options.promptCapabilities,
          ...options.continuation,
        },
        protocolVersion: options.protocolVersion ?? 1,
        agentInfo:
          options.agentInfo === undefined ? defaultInfo : options.agentInfo,
        authMethods: [],
      };
    })
    .onRequest(methods.agent.session.new, async (context) => {
      record(methods.agent.session.new, context.params);
      if (options.sessionError) throw options.sessionError;
      if (options.isMcpStartFailing)
        await context.client.notify(methods.client.session.update, {
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "mcp_startup.pages.synthetic",
            title: "mcp__pages__startup",
            kind: "other",
            status: "failed",
          },
        });
      return { sessionId: SESSION_ID, configOptions: session.configOptions() };
    })
    .onRequest(methods.agent.session.setConfigOption, (context) => {
      record(methods.agent.session.setConfigOption, context.params);
      const { configId, value } = context.params;
      if (typeof value === "string") session.select(configId, value);
      return { configOptions: session.configOptions() };
    })
    .onRequest(methods.agent.session.prompt, async (context) => {
      record(methods.agent.session.prompt, context.params);
      const [block] = context.params.prompt;
      const turn = fakeTurn(
        context.client,
        block?.type === "text" ? block.text : "",
        context.signal,
      );
      const stopReason = isClaude
        ? await claudePrompt(options, session, turn)
        : await (options.turn ?? (async () => "end_turn"))(turn);
      return { stopReason };
    })
    .onRequest(methods.agent.session.close, (context) => {
      record(methods.agent.session.close, context.params);
      return {};
    })
    .onNotification(methods.agent.session.cancel, (context) => {
      record(methods.agent.session.cancel, context.params);
    });
  return { app, calls };
}

/** Builds a fake Codex ACP adapter; see {@link fakeAcpAgent}. */
export function fakeCodexAgent(
  options: FakeAdapterOptions = {},
): FakeCodexAgent {
  return fakeAcpAgent(options);
}

function fakeTurn(
  client: AgentContext,
  prompt: string,
  signal: AbortSignal,
): FakeTurn {
  return {
    prompt,
    signal,
    update: (update) =>
      client.notify(methods.client.session.update, {
        sessionId: SESSION_ID,
        update,
      }),
    ask: (request) =>
      client.request(methods.client.session.requestPermission, {
        ...request,
        sessionId: SESSION_ID,
      }),
  };
}

/** The session identifier the fake adapter assigns. */
export const FAKE_SESSION_ID = SESSION_ID;
