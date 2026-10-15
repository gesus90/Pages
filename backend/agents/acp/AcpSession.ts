import {
  PROTOCOL_VERSION,
  RequestError,
  client as acpClient,
  methods,
} from "@agentclientprotocol/sdk";

import { readTicketAssetInput } from "@/backend/agents/TicketAssetInput";
import { closeCliSession } from "@/backend/agents/cli/CliSessionCloseout";
import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { AgentError } from "@/backend/error/AgentErrors";

import { acpTicketAssetPrompt } from "./AcpTicketAssets";
import { findAcpSelectOption } from "./AcpConfigOptions";
import {
  createAcpSessionState,
  readAcpConfiguration,
  readAcpUpdate,
} from "./AcpEvents";
import { PAGES_MCP_SERVER } from "./AcpLaunch";
import { readMcpServerStatus } from "./AcpMcpStatus";

import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type {
  ClientConnection,
  PromptCapabilities,
  McpServerStdio,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
  SessionUpdate,
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
import type { AcpConfigStep, AcpDriver, AcpSessionProfile } from "./AcpDriver";
import type { McpServerStatus } from "./AcpMcpStatus";

/** The JSON-RPC code of an agent that needs a sign-in first. */
const AUTH_REQUIRED = -32000;
/** Progress reaches the run record at most this often. */
const PROGRESS_INTERVAL_MS = 5_000;
/** How long closing waits for the adapter to end the protocol session. */
const SESSION_CLOSE_WAIT_MS = 5_000;
const STDERR_EVENT_CHARACTERS = 200;
/** How long the Pages MCP server may stay in the state of connecting before the node fails. */
const MCP_CONNECT_WAIT_MS = 20_000;
const MCP_POLL_MS = 500;

/** What the session runs: exactly the stored model, effort and prompt of the node. */
export interface AcpSessionRequest extends Pick<
  TextExecutionInput,
  "ticketInputs" | "readTicketAssets"
> {
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
export interface AcpSessionContext {
  readonly instanceId: string;
  /** What differs between the adapters of the runners. */
  readonly driver: Pick<
    AcpDriver,
    "provider" | "errors" | "supportedVersions" | "isSupportedAdapter"
  >;
  readonly profile: AcpSessionProfile;
  readonly request: AcpSessionRequest;
  readonly observer: PlanSessionObserver;
  /** The stop and deadline of the node; the process ends with it. */
  readonly signal: AbortSignal;
  /** How the process is isolated, as the run records it. */
  readonly isolation: string;
  /** Restores the modes of the credential folder after the session. */
  readonly secure: () => Promise<void>;
  /** Masks the exact project credential before any text reaches the observer or turn result. */
  readonly redact?: (text: string) => string;
  /** Safe availability diagnostic, including an explicit reason when credentials are missing. */
  readonly github?: string;
}

/** One configuration option the session must take, with the options the adapter showed last. */
interface ConfigSelection extends AcpConfigStep {
  readonly sessionId: string;
  readonly options: readonly SessionConfigOption[];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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
 * The ACP session of one plan node, from the handshake to the closeout.
 *
 * @remarks
 * Pages is the ACP client. The session starts in the authorized workspace,
 * takes the stored mode, model and effort exactly and confirms each of them
 * before the prompt is sent; a value the adapter does not offer fails the
 * node with its own code instead of running with another one. Where the
 * adapter names the model it really uses, the first report is compared with
 * the stored model and a difference ends the turn. Permission requests are
 * answered by the mode, never by a person. A completed turn is no success on
 * its own: the plan checks the closing report afterwards. Closing ends the
 * protocol session, the adapter with its runner process and every tagged
 * helper, and confirms that none is left.
 */
export class AcpSession implements PlanSession {
  public readonly turn: Promise<PlanSessionTurn>;
  private readonly process: Pick<
    CliSessionProcess,
    "endInput" | "exited" | "cancel"
  >;
  private readonly context: AcpSessionContext;
  private readonly connection: ClientConnection;
  private readonly state = createAcpSessionState();
  private observer: PlanSessionObserver;
  private turnSignal: AbortSignal;
  private isWorking = true;
  private lastProgressAt = 0;
  private lastProgress = "";
  private promptCapabilities: PromptCapabilities | null | undefined;
  private isModelChecked = false;
  private isModelMismatch = false;
  private expectedConfiguration: Readonly<Record<string, string>> | null = null;
  /** The text of a local command such as `/mcp`; `null` while the turn is the node's. */
  private localCommandText: string | null = null;
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
    context: AcpSessionContext,
  ) {
    this.process = process;
    this.context = context;
    this.observer = context.observer;
    this.turnSignal = context.signal;
    Object.assign(this.state.effective, context.profile.permissions, {
      isolation: context.isolation,
    });
    if (context.github) this.state.effective.github = context.github;
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

  /** Continues the native Codex thread with a fresh, turn-scoped step instruction. */
  public async next(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn> {
    if (this.context.driver.provider !== "codex_cli")
      throw new AgentError("provider_invalid");
    await this.turn;
    if (this.isWorking || this.closing || this.state.sessionId === null)
      throw new AgentError("plan_step_failed");
    this.isWorking = true;
    this.turnSignal = signal;
    this.observer = observer;
    this.state.text = "";
    this.state.messageId = null;
    this.state.isMessageOpen = false;
    this.state.permissionDenials = 0;
    this.state.tools.clear();
    const cancel = (): void => this.process.cancel("login_cancelled");
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      signal.throwIfAborted();
      this.observer.identified(this.redact(this.state.sessionId));
      noteSessionEvent(
        this.state.events,
        `continue session ${this.state.sessionId}; new step instruction`,
      );
      return await this.prompt(this.state.sessionId, input);
    } catch (error: unknown) {
      return this.failed(error);
    } finally {
      signal.removeEventListener("abort", cancel);
      this.isWorking = false;
    }
  }

  private async work(): Promise<PlanSessionTurn> {
    try {
      await this.initialize();
      const { sessionId, options } = await this.openSession();
      await this.configure(sessionId, options);
      await this.requirePagesMcp(sessionId);
      return await this.prompt(sessionId, this.context.request);
    } catch (error: unknown) {
      return this.failed(error);
    } finally {
      this.isWorking = false;
    }
  }

  private async prompt(
    sessionId: string,
    request: Pick<
      TextExecutionInput,
      "prompt" | "ticketInputs" | "readTicketAssets"
    >,
  ): Promise<PlanSessionTurn> {
    if (this.hasConfigurationChanged())
      return this.ended("failed", "plan_context_changed");
    const response = await this.connection.agent.request(
      methods.agent.session.prompt,
      {
        sessionId,
        prompt: acpTicketAssetPrompt(
          request.prompt,
          await readTicketAssetInput(request),
          this.promptCapabilities,
        ),
      },
    );
    noteSessionEvent(this.state.events, `turn ${response.stopReason}`);
    if (this.hasConfigurationChanged())
      return this.ended("failed", "plan_context_changed");
    if (this.isModelMismatch)
      return this.ended("failed", "plan_model_unavailable");
    return this.ended(
      stopFailure(response.stopReason),
      this.state.isMcpUnavailable ? "plan_mcp_unavailable" : null,
    );
  }

  private hasConfigurationChanged(): boolean {
    if (this.context.driver.provider !== "codex_cli") return false;
    const expected = this.expectedConfiguration;
    if (!expected) return false;
    const conflict = ["sessionMode", "model", "reasoningEffort"].find(
      (field) => expected[field] !== this.state.effective[field],
    );
    if (!conflict) return false;
    noteSessionEvent(
      this.state.events,
      `runtime configuration changed: ${conflict}`,
    );
    return true;
  }

  private async initialize(): Promise<void> {
    const response = await this.connection.agent.request(
      methods.agent.initialize,
      {
        protocolVersion: PROTOCOL_VERSION,
        // The runner works with its own tools; Pages lends it no file system or terminal.
        clientCapabilities: {},
      },
    );
    this.promptCapabilities = response.agentCapabilities?.promptCapabilities;
    const { driver } = this.context;
    const agent = response.agentInfo;
    const adapter = agent ? `${agent.name} ${agent.version}` : "unknown";
    this.state.effective.adapter = adapter;
    this.state.effective.protocol = `ACP ${response.protocolVersion}`;
    if (
      response.protocolVersion === PROTOCOL_VERSION &&
      driver.isSupportedAdapter(agent)
    )
      return;
    noteSessionEvent(
      this.state.events,
      `adapter ${adapter} is not supported, Pages verified ${driver.supportedVersions}`,
    );
    throw new AgentError(driver.errors.adapterUnsupported);
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
    this.observer.identified(this.redact(response.sessionId));
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
    let options = initial;
    for (const step of profile.steps(request))
      options = await this.select({ ...step, sessionId, options });
    readAcpConfiguration(this.state, options, profile.reportedOptions);
    this.expectedConfiguration = { ...this.state.effective };
  }

  private async select(
    selection: ConfigSelection,
  ): Promise<readonly SessionConfigOption[]> {
    const { driver } = this.context;
    const option = findAcpSelectOption(selection.options, selection.id);
    if (option === null) {
      this.noteRefusal(selection, "is not an option of the adapter");
      throw new AgentError(
        selection.refusal === "plan_reasoning_unsupported"
          ? selection.refusal
          : driver.errors.adapterUnsupported,
      );
    }
    const isResolved = selection.isResolvedByAdapter === true;
    if (!isResolved && !option.values.includes(selection.value))
      throw this.refused(selection, `is not among ${option.values.join(", ")}`);
    if (!isResolved && option.currentValue === selection.value)
      return selection.options;
    const options = await this.setOption(selection);
    const confirmed = findAcpSelectOption(options, selection.id);
    if (confirmed === null)
      throw this.refused(selection, "was not confirmed by the adapter");
    if (!isResolved && confirmed.currentValue !== selection.value)
      throw this.refused(
        selection,
        `was not confirmed, the adapter kept ${confirmed.currentValue}`,
      );
    noteSessionEvent(
      this.state.events,
      isResolved
        ? `${selection.id} ${selection.value} as ${confirmed.currentValue}`
        : `${selection.id} ${selection.value} confirmed`,
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
        throw this.refused(selection, "was refused by the adapter");
      throw error;
    }
  }

  /** Records which stored setting the adapter did not take, so the run record names it. */
  private noteRefusal(selection: ConfigSelection, reason: string): void {
    const adapter = this.state.effective.adapter ?? "the adapter";
    noteSessionEvent(
      this.state.events,
      `${selection.id} ${selection.value} ${reason} (${adapter})`,
    );
  }

  private refused(selection: ConfigSelection, reason: string): AgentError {
    this.noteRefusal(selection, reason);
    return new AgentError(selection.refusal);
  }

  private decide(request: RequestPermissionRequest): RequestPermissionResponse {
    const decision = this.context.profile.decide(request);
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
    const { update } = notification;
    if (this.localCommandText !== null) {
      if (update.sessionUpdate === "agent_message_chunk")
        this.collectLocalCommand(update);
      return;
    }
    readAcpUpdate(this.state, update, this.context.profile.reportedOptions);
    this.checkReportedModel();
    this.reportProgress();
  }

  private collectLocalCommand(update: SessionUpdate): void {
    if (
      update.sessionUpdate === "agent_message_chunk" &&
      update.content.type === "text"
    )
      this.localCommandText =
        (this.localCommandText ?? "") + update.content.text;
  }

  /**
   * Compares the first model the adapter names with the stored one.
   *
   * @remarks
   * An adapter that maps the model to a choice of its own cannot prove the
   * model before the prompt; the first usage report does, and a difference
   * ends the turn, so the run never goes on with another model.
   */
  private checkReportedModel(): void {
    const { reportedModel } = this.state;
    const { matchesReportedModel } = this.context.profile;
    if (
      reportedModel === null ||
      this.isModelChecked ||
      matchesReportedModel === null
    )
      return;
    this.isModelChecked = true;
    this.state.effective.model = reportedModel;
    noteSessionEvent(this.state.events, `model ${reportedModel}`);
    if (matchesReportedModel(this.context.request.model, reportedModel)) return;
    this.isModelMismatch = true;
    void this.cancelTurn();
  }

  private async cancelTurn(): Promise<void> {
    const { sessionId } = this.state;
    if (sessionId === null) return;
    try {
      await this.connection.agent.notify(methods.agent.session.cancel, {
        sessionId,
      });
    } catch (error: unknown) {
      // The turn ends with the connection anyway; the mismatch is already recorded.
      noteSessionEvent(
        this.state.events,
        `cancel ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }

  /**
   * Waits until the Pages MCP server of the session is connected.
   *
   * @remarks
   * The adapter lists the server states for its local `/mcp` command, which
   * costs no model call. Codex reports a failed MCP start through its own
   * startup tool call instead.
   */
  private async requirePagesMcp(sessionId: string): Promise<void> {
    if (this.state.isMcpUnavailable)
      throw new AgentError("plan_mcp_unavailable");
    const { profile, request } = this.context;
    if (!profile.hasMcpStatusCommand || request.mcpServers.length === 0) return;
    const deadline = Date.now() + MCP_CONNECT_WAIT_MS;
    let previous: McpServerStatus | null = null;
    for (;;) {
      const status = await this.readMcpStatus(sessionId);
      if (status !== previous)
        noteSessionEvent(
          this.state.events,
          `mcp ${PAGES_MCP_SERVER} ${status}`,
        );
      previous = status;
      if (status === "failed") throw new AgentError("plan_mcp_unavailable");
      if (status !== "connecting") return;
      if (Date.now() >= deadline) throw new AgentError("plan_mcp_unavailable");
      await delay(MCP_POLL_MS);
    }
  }

  private async readMcpStatus(sessionId: string): Promise<McpServerStatus> {
    this.localCommandText = "";
    try {
      await this.connection.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "/mcp" }],
      });
      return readMcpServerStatus(this.localCommandText ?? "", PAGES_MCP_SERVER);
    } finally {
      this.localCommandText = null;
    }
  }

  private reportProgress(): void {
    const now = Date.now();
    if (now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    const progress = this.state.events.join("\n");
    if (progress === this.lastProgress) return;
    this.lastProgressAt = now;
    this.lastProgress = progress;
    this.observer.progressed?.(
      this.state.events.map((event) => this.redact(event)),
    );
  }

  private async failed(error: unknown): Promise<PlanSessionTurn> {
    if (this.turnSignal.aborted) {
      // The stop or deadline ends the process; its exit tells which.
      const exit = await this.process.exited;
      return this.ended(
        exit.errorCode === "check_timeout" ? "timeout" : "cancelled",
        null,
      );
    }
    if (error instanceof AgentError) return this.ended("failed", error.code);
    const { sessionFailed } = this.context.driver.errors;
    if (this.connection.signal.aborted) {
      const exit = await this.process.exited;
      // The deadline of the process itself can fire before the one of the node.
      if (exit.errorCode === "check_timeout")
        return this.ended("timeout", null);
      this.noteStderr(exit.stderrTail);
      return this.ended("failed", sessionFailed);
    }
    if (error instanceof RequestError && error.code === AUTH_REQUIRED)
      return this.ended("failed", "cli_not_logged_in");
    noteSessionEvent(
      this.state.events,
      `error ${error instanceof Error ? error.message : "unknown"}`,
    );
    return this.ended("failed", sessionFailed);
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
        `adapter ${this.redact(line).slice(0, STDERR_EVENT_CHARACTERS)}`,
      );
  }

  private ended(
    failure: PlanSessionTurn["failure"],
    errorCode: AgentErrorCode | null,
  ): PlanSessionTurn {
    const { state } = this;
    return {
      output: this.redact(state.text),
      sessionId: state.sessionId === null ? null : this.redact(state.sessionId),
      failure,
      errorCode,
      endedAt: new Date().toISOString(),
      permissionDenials: state.permissionDenials,
      effective: Object.fromEntries(
        Object.entries(state.effective).map(([key, value]) => [
          this.redact(key),
          this.redact(value),
        ]),
      ),
      events: state.events.map((event) => this.redact(event)),
    };
  }

  private redact(text: string): string {
    return this.context.redact?.(text) ?? text;
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
