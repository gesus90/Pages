import {
  PROTOCOL_VERSION,
  RequestError,
  client as acpClient,
  methods,
} from "@agentclientprotocol/sdk";

import { closeCliSession } from "@/backend/agents/cli/CliSessionCloseout";
import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { AgentError } from "@/backend/error/AgentErrors";

import { findAcpSelectOption } from "./AcpConfigOptions";
import { isSupportedCodexAcp } from "./CodexAcpAdapter";
import {
  createAcpSessionState,
  readAcpConfiguration,
  readAcpUpdate,
} from "./CodexAcpEvents";
import { decideCodexPermission } from "./CodexAcpProfile";

import type {
  ClientConnection,
  McpServerStdio,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
  StopReason,
  Stream,
} from "@agentclientprotocol/sdk";
import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { CliSessionProcess } from "@/backend/agents/cli/CliSessionProcess";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { CodexAcpProfile } from "./CodexAcpProfile";

/** The JSON-RPC code of an agent that needs a sign-in first. */
const AUTH_REQUIRED = -32000;
/** Progress reaches the run record at most this often. */
const PROGRESS_INTERVAL_MS = 5_000;
/** How long closing waits for the adapter to end the protocol session. */
const SESSION_CLOSE_WAIT_MS = 5_000;
const STDERR_EVENT_CHARACTERS = 200;

/** What the session runs: exactly the stored model, effort and prompt of the node. */
export interface CodexAcpRequest {
  readonly directory: string;
  /** The complete prompt; it is sent unchanged as one text block. */
  readonly prompt: string;
  readonly model: string;
  /** `null` leaves the effort to the model's default, as the agent stores it. */
  readonly reasoningEffort: string | null;
  readonly mcpServers: readonly McpServerStdio[];
  readonly sessionMeta: Readonly<Record<string, unknown>>;
}

/** What one ACP session needs from its surroundings. */
export interface CodexAcpSessionContext {
  readonly instanceId: string;
  readonly profile: CodexAcpProfile;
  readonly request: CodexAcpRequest;
  readonly observer: PlanSessionObserver;
  /** The stop and deadline of the node; the process ends with it. */
  readonly signal: AbortSignal;
  /** How the process is isolated, as the run records it. */
  readonly isolation: string;
  /** Restores the modes of the credential folder after the session. */
  readonly secure: () => Promise<void>;
}

/** One configuration option the session must take exactly. */
interface ConfigSelection {
  readonly sessionId: string;
  readonly options: readonly SessionConfigOption[];
  readonly id: string;
  readonly value: string;
  /** Why the node fails when the adapter does not offer or confirm the value. */
  readonly refusal: AgentErrorCode;
}

function stopFailure(reason: StopReason): PlanSessionTurn["failure"] {
  switch (reason) {
    case "end_turn":
      return null;
    case "cancelled":
      return "cancelled";
    case "refusal":
      return "failed";
    case "max_tokens":
    case "max_turn_requests":
      return "incomplete";
  }
}

/**
 * The ACP session of one Codex plan node, from the handshake to the closeout.
 *
 * @remarks
 * Pages is the ACP client. The session starts in the authorized workspace,
 * takes the stored mode, model and effort exactly and confirms each of them
 * before the prompt is sent; a value the adapter does not offer fails the
 * node with its own code instead of running with another one. Permission
 * requests are answered by the mode, never by a person. A completed turn is
 * no success on its own: the plan checks the closing report afterwards.
 * Closing ends the protocol session, the adapter with its Codex process and
 * every tagged helper, and confirms that none is left.
 */
export class CodexAcpSession implements PlanSession {
  public readonly turn: Promise<PlanSessionTurn>;
  private readonly process: Pick<
    CliSessionProcess,
    "endInput" | "exited" | "cancel"
  >;
  private readonly context: CodexAcpSessionContext;
  private readonly connection: ClientConnection;
  private readonly state = createAcpSessionState();
  private lastProgressAt = 0;
  private lastProgress = "";
  private closing: Promise<PlanSessionClosed> | null = null;

  /**
   * Connects to the started adapter and begins the turn at once.
   *
   * @param process - The adapter process; it ends with the node's signal.
   * @param stream - The ACP messages over the process input and output.
   * @param context - Request, mode profile, observer and closeout of the node.
   */
  public constructor(
    process: Pick<CliSessionProcess, "endInput" | "exited" | "cancel">,
    stream: Stream,
    context: CodexAcpSessionContext,
  ) {
    this.process = process;
    this.context = context;
    Object.assign(this.state.effective, context.profile.permissions, {
      isolation: context.isolation,
    });
    this.connection = acpClient({ name: "pages" })
      .onRequest(methods.client.session.requestPermission, (request) =>
        this.decide(request.params),
      )
      .onNotification(methods.client.session.update, (notification) => {
        this.receive(notification.params);
      })
      .connect(stream);
    this.turn = this.work();
  }

  /** Ends the session once, then confirms that no process of it is left. */
  public close(): Promise<PlanSessionClosed> {
    this.closing ??= this.shutDown();
    return this.closing;
  }

  private async work(): Promise<PlanSessionTurn> {
    try {
      await this.initialize();
      const { sessionId, options } = await this.openSession();
      await this.configure(sessionId, options);
      if (this.state.isMcpUnavailable)
        throw new AgentError("plan_mcp_unavailable");
      const response = await this.connection.agent.request(
        methods.agent.session.prompt,
        {
          sessionId,
          prompt: [{ type: "text", text: this.context.request.prompt }],
        },
      );
      noteSessionEvent(this.state.events, `turn ${response.stopReason}`);
      return this.ended(
        stopFailure(response.stopReason),
        this.state.isMcpUnavailable ? "plan_mcp_unavailable" : null,
      );
    } catch (error: unknown) {
      return this.failed(error);
    }
  }

  private async initialize(): Promise<void> {
    const response = await this.connection.agent.request(
      methods.agent.initialize,
      {
        protocolVersion: PROTOCOL_VERSION,
        // Codex works with its own tools in its own sandbox; Pages lends it no file system or terminal.
        clientCapabilities: {},
      },
    );
    const agent = response.agentInfo;
    if (
      response.protocolVersion !== PROTOCOL_VERSION ||
      !isSupportedCodexAcp(agent)
    )
      throw new AgentError("plan_acp_adapter_unsupported");
    this.state.effective.adapter = `${agent.name} ${agent.version}`;
    this.state.effective.protocol = `ACP ${response.protocolVersion}`;
  }

  private async openSession(): Promise<{
    readonly sessionId: string;
    readonly options: readonly SessionConfigOption[];
  }> {
    const { request } = this.context;
    const response = await this.connection.agent.request(
      methods.agent.session.new,
      {
        cwd: request.directory,
        mcpServers: [...request.mcpServers],
        _meta: { ...request.sessionMeta },
      },
    );
    this.state.sessionId = response.sessionId;
    noteSessionEvent(this.state.events, `session ${response.sessionId}`);
    this.context.observer.identified(response.sessionId);
    return {
      sessionId: response.sessionId,
      options: response.configOptions ?? [],
    };
  }

  private async configure(
    sessionId: string,
    initial: readonly SessionConfigOption[],
  ): Promise<void> {
    const { profile, request } = this.context;
    let options = await this.select({
      sessionId,
      options: initial,
      id: "mode",
      value: profile.sessionMode,
      refusal: "plan_permission_mode_unenforceable",
    });
    options = await this.select({
      sessionId,
      options,
      id: "model",
      value: request.model,
      refusal: "plan_model_unavailable",
    });
    // The effort is set after the model: a model change resets it to the model's default.
    if (request.reasoningEffort !== null)
      options = await this.select({
        sessionId,
        options,
        id: "reasoning_effort",
        value: request.reasoningEffort,
        refusal: "plan_reasoning_unsupported",
      });
    readAcpConfiguration(this.state, options);
  }

  private async select(
    selection: ConfigSelection,
  ): Promise<readonly SessionConfigOption[]> {
    const option = findAcpSelectOption(selection.options, selection.id);
    if (option === null) throw new AgentError("plan_acp_adapter_unsupported");
    if (!option.values.includes(selection.value))
      throw new AgentError(selection.refusal);
    if (option.currentValue === selection.value) return selection.options;
    const options = await this.setOption(selection);
    const confirmed = findAcpSelectOption(options, selection.id);
    if (confirmed?.currentValue !== selection.value)
      throw new AgentError(selection.refusal);
    noteSessionEvent(
      this.state.events,
      `${selection.id} ${selection.value} confirmed`,
    );
    return options;
  }

  private async setOption(
    selection: ConfigSelection,
  ): Promise<readonly SessionConfigOption[]> {
    try {
      const response = await this.connection.agent.request(
        methods.agent.session.setConfigOption,
        {
          sessionId: selection.sessionId,
          configId: selection.id,
          value: selection.value,
        },
      );
      return response.configOptions;
    } catch (error: unknown) {
      // A refusal of the adapter, not a lost connection, means the value is not offered.
      if (error instanceof RequestError && !this.connection.signal.aborted)
        throw new AgentError(selection.refusal);
      throw error;
    }
  }

  private decide(request: RequestPermissionRequest): RequestPermissionResponse {
    const decision = decideCodexPermission(this.context.profile.mode, request);
    if (decision.isDenied) {
      this.state.permissionDenials += 1;
      noteSessionEvent(
        this.state.events,
        `refused ${request.toolCall.title ?? request.toolCall.kind ?? "request"}`,
      );
    }
    return { outcome: decision.outcome };
  }

  private receive(notification: SessionNotification): void {
    const { sessionId } = this.state;
    // An update may arrive before `session/new` answered; it belongs to the only session.
    if (sessionId !== null && notification.sessionId !== sessionId) return;
    readAcpUpdate(this.state, notification.update);
    this.reportProgress();
  }

  private reportProgress(): void {
    const now = Date.now();
    if (now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    const progress = this.state.events.join("\n");
    if (progress === this.lastProgress) return;
    this.lastProgressAt = now;
    this.lastProgress = progress;
    this.context.observer.progressed?.([...this.state.events]);
  }

  private async failed(error: unknown): Promise<PlanSessionTurn> {
    if (this.context.signal.aborted) {
      // The stop or deadline ends the process; its exit tells which.
      const exit = await this.process.exited;
      return this.ended(
        exit.errorCode === "check_timeout" ? "timeout" : "cancelled",
        null,
      );
    }
    if (error instanceof AgentError) return this.ended("failed", error.code);
    if (this.connection.signal.aborted) {
      const exit = await this.process.exited;
      this.noteStderr(exit.stderrTail);
      return this.ended("failed", "plan_acp_session_failed");
    }
    if (error instanceof RequestError && error.code === AUTH_REQUIRED)
      return this.ended("failed", "cli_not_logged_in");
    noteSessionEvent(
      this.state.events,
      `error ${error instanceof Error ? error.message : "unknown"}`,
    );
    return this.ended("failed", "plan_acp_session_failed");
  }

  private noteStderr(tail: string): void {
    const line = tail
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .at(-1);
    if (line)
      noteSessionEvent(
        this.state.events,
        `adapter ${line.slice(0, STDERR_EVENT_CHARACTERS)}`,
      );
  }

  private ended(
    failure: PlanSessionTurn["failure"],
    errorCode: AgentErrorCode | null,
  ): PlanSessionTurn {
    const { state } = this;
    return {
      output: state.text,
      sessionId: state.sessionId,
      failure,
      errorCode,
      endedAt: new Date().toISOString(),
      permissionDenials: state.permissionDenials,
      effective: { ...state.effective },
      events: [...state.events],
    };
  }

  private async shutDown(): Promise<PlanSessionClosed> {
    try {
      await this.closeProtocolSession();
      this.connection.close();
      return await closeCliSession(this.process, this.context.instanceId);
    } finally {
      await this.context.secure();
    }
  }

  private async closeProtocolSession(): Promise<void> {
    const { sessionId } = this.state;
    if (sessionId === null || this.connection.signal.aborted) return;
    let wait: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.connection.agent.request(methods.agent.session.close, {
          sessionId,
        }),
        new Promise<void>((resolve) => {
          wait = setTimeout(resolve, SESSION_CLOSE_WAIT_MS);
        }),
      ]);
    } catch {
      // The adapter may be gone already; ending its process below ends the session anyway.
    } finally {
      clearTimeout(wait);
    }
  }
}
