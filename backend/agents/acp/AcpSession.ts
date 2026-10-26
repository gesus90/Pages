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
import { diagnosticProviderFailure } from "@/backend/agents/AgentProviderFailure";
import { readContinuationCapabilities } from "@/backend/service/agents/sessions/AgentSessionContinuation";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { abortFailure, stopFailure, finishAcpTurn } from "./AcpSessionOutcome";
import {
  ACP_STEERING_METHOD,
  isAcpSteeringSupported,
  readAcpSteerOutcome,
} from "./AcpChat";
import { acpTicketAssetPrompt } from "./AcpTicketAssets";
import {
  createAcpSessionState,
  readAcpConfiguration,
  readAcpUpdate,
  noteAcpStderr,
} from "./AcpEvents";
import { reportAcpPlanActivity } from "./AcpPlanActivity";
import { AcpMcpReadiness } from "./AcpMcpReadiness";
import { confirmAcpConfiguration } from "./AcpSessionConfiguration";
import {
  classifyOpenCodeFailure,
  openCodeAcpFailure,
  openCodeToolFailure,
} from "./OpenCodeAcpErrors";

import type {
  AcpSessionContext,
  AcpPromptRequest,
  OpenedSession,
} from "./AcpSessionContracts";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type {
  ClientConnection,
  ContentBlock,
  PromptCapabilities,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionConfigOption,
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
import type { AcpSteerOutcome } from "./AcpChat";

export type {
  AcpSessionContext,
  AcpSessionRequest,
} from "./AcpSessionContracts";

/** The JSON-RPC code of an agent that needs a sign-in first. */
const AUTH_REQUIRED = -32000;
/** Progress reaches the run record at most this often. */
const PROGRESS_INTERVAL_MS = 5_000;
/** How long closing waits for the adapter to end the protocol session. */
const SESSION_CLOSE_WAIT_MS = 5_000;
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
  public readonly terminated: Promise<void>;
  private readonly process: Pick<
    CliSessionProcess,
    "endInput" | "exited" | "cancel"
  >;
  private readonly context: AcpSessionContext;
  private hasHistoryFailure = false;
  private notificationFailure: AgentErrorCode | null = null;
  private readonly connection: ClientConnection;
  private readonly state = createAcpSessionState();
  private observer: PlanSessionObserver;
  private turnSignal: AbortSignal;
  private isWorking = true;
  /** A `session/prompt` of Pages is running, so a steer can join its turn. */
  private isPrompting = false;
  /** The adapter announced `_session/steering` in `initialize`. */
  private isSteeringSupported = false;
  private lastProgressAt = 0;
  private lastProgress = "";
  private promptCapabilities: PromptCapabilities | null | undefined;
  private isModelChecked = false;
  private isModelMismatch = false;
  private openCodeFailure: AgentErrorCode | null = null;
  private expectedConfiguration: Readonly<Record<string, string>> | null = null;
  private readonly mcpReadiness: AcpMcpReadiness;
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
    this.terminated = process.exited.then(() => undefined);
    this.context = context;
    this.observer = context.observer;
    this.turnSignal = context.signal;
    Object.assign(this.state.effective, context.profile.permissions, {
      isolation: context.isolation,
    });
    if (context.driver.provider === "opencode") {
      this.state.effective.workspace = context.request.directory;
      this.state.effective.modelVerification =
        "ACP model selector; provider response does not report a separate model identity";
    }
    if (context.github) this.state.effective.github = context.github;
    this.connection = acpClient({ name: "pages" })
      .onRequest(methods.client.session.requestPermission, (request) =>
        this.decide(request.params),
      )
      .onNotification(methods.client.session.update, async (notification) => {
        try {
          this.receive(notification.params);
          await this.context.listener?.drained?.();
        } catch (error: unknown) {
          logCaughtError("AcpSession", error);
          this.notificationFailure =
            error instanceof AgentError
              ? error.code
              : "plan_history_unavailable";
          this.hasHistoryFailure =
            this.notificationFailure === "plan_history_unavailable";
          this.process.cancel(this.notificationFailure);
        } finally {
          this.context.notificationHandled?.();
        }
      })
      .connect(stream);
    this.mcpReadiness = new AcpMcpReadiness(this.connection, this.state);
    if (context.driver.provider === "opencode") {
      context.signal.addEventListener("abort", this.abortRequests, {
        once: true,
      });
      if (context.signal.aborted) this.abortRequests();
    }
    const { listener } = context;
    if (listener)
      this.connection.signal.addEventListener("abort", listener.closed, {
        once: true,
      });
    this.turn = this.work();
  }

  /** Ends the session once, then confirms that no process of it is left. */
  public close(): Promise<PlanSessionClosed> {
    this.closing ??= this.shutDown();
    return this.closing;
  }

  /**
   * Adds a prompt to the running turn through the steering extension the
   * adapter announced in `initialize`.
   *
   * @param prompt - The blocks of the additional message.
   * @returns What became of it; `inactive` without the announced extension or
   * without a running prompt of Pages, so a steer never reaches the adapter
   * between turns.
   */
  public async steer(
    prompt: readonly ContentBlock[],
  ): Promise<AcpSteerOutcome> {
    const { sessionId } = this.state;
    if (
      !this.isSteeringSupported ||
      !this.isPrompting ||
      this.closing ||
      sessionId === null
    )
      return "inactive";
    const { steeringMeta } = this.context.driver;
    try {
      return readAcpSteerOutcome(
        await this.connection.agent.request(ACP_STEERING_METHOD, {
          sessionId,
          prompt: [...prompt],
          ...(steeringMeta === null ? {} : { _meta: { ...steeringMeta } }),
        }),
      );
    } catch (caughtError: unknown) {
      logCaughtError("AcpSession", caughtError);

      // The adapter refused the steer or the connection is gone; the turn decides the rest.
      return "failed";
    }
  }

  /**
   * Continues the ACP session with a fresh, turn-scoped prompt: the next
   * member of a Codex, Claude Code or OpenCode plan group or the next turn of a Pica
   * conversation.
   *
   * @throws {AgentError} `provider_invalid` for a profile that runs one turn only.
   */
  public async next(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn> {
    if (!this.context.profile.isContinuable)
      throw new AgentError("provider_invalid");
    await this.turn;
    if (this.isWorking || this.closing || this.state.sessionId === null)
      throw new AgentError("plan_step_failed");
    this.isWorking = true;
    this.turnSignal = signal;
    this.observer = observer;
    this.state.text = "";
    this.state.messageBytes = 0;
    this.state.isResultOversized = false;
    this.state.isMessageOpen = false;
    this.state.messageId = null;
    this.state.permissionDenials = 0;
    this.state.providerFailure = null;
    this.openCodeFailure = null;
    this.state.tools.clear();
    const cancel = (): void => {
      this.process.cancel(
        abortFailure(signal) === "timeout"
          ? "check_timeout"
          : "login_cancelled",
      );
      if (this.context.driver.provider === "opencode") this.abortRequests();
    };
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
      logCaughtError("AcpSession", error);

      return this.failed(error);
    } finally {
      signal.removeEventListener("abort", cancel);
      this.isWorking = false;
    }
  }

  private readonly abortRequests = (): void => this.connection.close();

  private async work(): Promise<PlanSessionTurn> {
    try {
      await this.initialize();
      const { sessionId, options } = await this.openSession();
      await this.configure(sessionId, options);
      await this.mcpReadiness.require(
        sessionId,
        this.context.profile.hasMcpStatusCommand &&
          this.context.request.mcpServers.length > 0,
      );
      return await this.prompt(sessionId, this.context.request);
    } catch (error: unknown) {
      logCaughtError("AcpSession", error);

      return this.failed(error);
    } finally {
      this.isWorking = false;
    }
  }

  private async prompt(
    sessionId: string,
    request: AcpPromptRequest,
  ): Promise<PlanSessionTurn> {
    if (this.hasConfigurationChanged())
      return this.ended("failed", "plan_context_changed");
    const prompt: ContentBlock[] = [
      ...acpTicketAssetPrompt(
        request.prompt,
        await readTicketAssetInput(request),
        this.promptCapabilities,
      ),
      ...((await request.promptContent?.(this.promptCapabilities)) ?? []),
    ];
    this.isPrompting = true;
    const response = await this.connection.agent
      .request(methods.agent.session.prompt, { sessionId, prompt })
      .finally(() => {
        this.isPrompting = false;
      });
    this.context.listener?.prompted(response.usage ?? null);
    await this.context.listener?.drained?.();
    noteSessionEvent(this.state.events, `turn ${response.stopReason}`);
    if (this.hasConfigurationChanged())
      return this.ended("failed", "plan_context_changed");
    if (this.isModelMismatch)
      return this.ended("failed", "plan_model_unavailable");
    return this.ended(
      stopFailure(response.stopReason),
      this.state.isMcpUnavailable
        ? "plan_mcp_unavailable"
        : (this.state.providerFailure?.code ?? this.openCodeFailure),
    );
  }

  private hasConfigurationChanged(): boolean {
    if (this.context.driver.provider === "claude_code") return false;
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
    this.isSteeringSupported = isAcpSteeringSupported(response._meta);
    this.context.listener?.initialized?.(
      this.isSteeringSupported,
      this.promptCapabilities,
    );
    this.context.listener?.announced?.(response.agentCapabilities);
    const { driver } = this.context;
    const agent = response.agentInfo;
    const adapter = agent ? `${agent.name} ${agent.version}` : "unknown";
    this.state.effective.adapter = adapter;
    this.state.effective.protocol = `ACP ${response.protocolVersion}`;
    if (
      response.protocolVersion === PROTOCOL_VERSION &&
      driver.isSupportedAdapter(agent)
    ) {
      const continuation =
        this.context.profile.keepsSession === false
          ? { canResume: false, canLoad: false }
          : readContinuationCapabilities(response.agentCapabilities);
      this.observer.capabilities?.({ ...continuation, adapter });
      return;
    }
    noteSessionEvent(
      this.state.events,
      `adapter ${adapter} is not supported, Pages verified ${driver.supportedVersions}`,
    );
    throw new AgentError(driver.errors.adapterUnsupported);
  }

  private async openSession(): Promise<OpenedSession> {
    const { request } = this.context;
    const resumeSessionId = request.resumeSessionId ?? null;
    if (resumeSessionId !== null) return this.resumeSession(resumeSessionId);
    const response = await this.connection.agent.request(
      methods.agent.session.new,
      {
        cwd: request.directory,
        mcpServers: [...request.mcpServers],
        _meta: { ...request.sessionMeta },
      },
    );
    return this.opened(response.sessionId, response.configOptions);
  }

  /** Continues an earlier protocol session of the same working directory. */
  private async resumeSession(sessionId: string): Promise<OpenedSession> {
    const { request } = this.context;
    noteSessionEvent(this.state.events, "resume session");
    try {
      const response = await this.connection.agent.request(
        methods.agent.session.resume,
        {
          sessionId,
          cwd: request.directory,
          mcpServers: [...request.mcpServers],
          _meta: { ...request.sessionMeta },
        },
      );
      return this.opened(sessionId, response.configOptions);
    } catch (error: unknown) {
      logCaughtError("AcpSession", error);

      // The adapter refused the session; a lost connection fails as it always does.
      if (error instanceof RequestError && !this.connection.signal.aborted)
        throw new AgentError("acp_session_resume_failed");
      throw error;
    }
  }

  private opened(
    sessionId: string,
    options: readonly SessionConfigOption[] | null | undefined,
  ): OpenedSession {
    this.state.sessionId = sessionId;
    logEvent({
      level: "info",
      event: "acp.session.opened",
      component: "AcpSession",
      message: "ACP session opened",
      metadata: { sessionId, provider: this.context.driver.provider },
    });
    noteSessionEvent(this.state.events, `session ${sessionId}`);
    this.observer.identified(this.redact(sessionId));
    return { sessionId, options: options ?? [] };
  }

  private async configure(
    sessionId: string,
    initial: readonly SessionConfigOption[],
  ): Promise<void> {
    const { profile, request, driver } = this.context;
    const options = await confirmAcpConfiguration(
      {
        connection: this.connection,
        state: this.state,
        errors: driver.errors,
        sessionId,
      },
      initial,
      profile.steps(request),
    );
    readAcpConfiguration(this.state, options, profile.reportedOptions);
    if (driver.provider === "opencode")
      this.state.effective.reasoningEffort ??= "default";
    this.expectedConfiguration = { ...this.state.effective };
  }

  private decide(request: RequestPermissionRequest): RequestPermissionResponse {
    const decision = this.context.profile.decide(request);
    if (decision.isDenied) {
      logEvent({
        level: "warn",
        event: "acp.permission.denied",
        component: "AcpSession",
        message: "ACP tool permission denied",
        metadata: { sessionId: this.state.sessionId },
      });
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
    if (
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update"
    )
      logEvent({
        level: update.status === "failed" ? "warn" : "debug",
        event: "acp.tool.updated",
        component: "AcpSession",
        message: "ACP tool lifecycle update",
        metadata: {
          sessionId,
          toolId: update.toolCallId,
          status: update.status,
          kind: update.sessionUpdate,
        },
      });
    if (this.mcpReadiness.receive(update)) return;
    readAcpUpdate(this.state, update, this.context.profile.reportedOptions);
    if (this.context.driver.provider === "opencode") {
      const failure = openCodeToolFailure(update);
      this.openCodeFailure ??= failure;
      if (failure === "plan_runner_permission_denied")
        this.state.permissionDenials += 1;
    }
    reportAcpPlanActivity(update, this.observer, (text) => this.redact(text));
    this.context.listener?.update(update);
    this.checkReportedModel();
    this.reportProgress();
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
      logCaughtError("AcpSession", error);

      // The turn ends with the connection anyway; the mismatch is already recorded.
      noteSessionEvent(
        this.state.events,
        `cancel ${error instanceof Error ? error.message : "failed"}`,
      );
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
      if (this.context.driver.provider === "opencode")
        return this.ended(abortFailure(this.turnSignal), null);
      // The stop or deadline ends the process; its exit tells which.
      const exit = await this.process.exited;
      return this.ended(
        exit.errorCode === "check_timeout" ? "timeout" : "cancelled",
        null,
      );
    }
    if (error instanceof AgentError) return this.ended("failed", error.code);
    const providerFailure =
      diagnosticProviderFailure(error) ?? this.state.providerFailure;
    if (providerFailure) {
      this.state.providerFailure = providerFailure;
      return this.ended("failed", providerFailure.code);
    }
    const { sessionFailed } = this.context.driver.errors;
    if (this.connection.signal.aborted) return this.disconnected();
    if (this.context.driver.provider === "opencode") {
      const code = openCodeAcpFailure(error);
      noteSessionEvent(this.state.events, `OpenCode failure: ${code}`);
      return this.ended("failed", code);
    }
    if (error instanceof RequestError && error.code === AUTH_REQUIRED)
      return this.ended("failed", "cli_not_logged_in");
    noteSessionEvent(
      this.state.events,
      `error ${error instanceof Error ? error.message : "unknown"}`,
    );
    return this.ended("failed", sessionFailed);
  }

  private async disconnected(): Promise<PlanSessionTurn> {
    const exit = await this.process.exited;
    // The deadline of the process itself can fire before the one of the node.
    if (exit.errorCode === "check_timeout") return this.ended("timeout", null);
    if (
      exit.errorCode === "acp_worker_limit" ||
      exit.errorCode === "acp_output_overflow"
    )
      return this.ended("failed", exit.errorCode);
    if (this.context.driver.provider !== "opencode")
      noteAcpStderr(this.state, exit.stderrTail, (line) => this.redact(line));
    return this.ended(
      "failed",
      this.context.driver.provider === "opencode"
        ? classifyOpenCodeFailure(exit.stderrTail)
        : this.context.driver.errors.sessionFailed,
    );
  }

  private ended(
    failure: PlanSessionTurn["failure"],
    errorCode: AgentErrorCode | null,
  ): PlanSessionTurn {
    return finishAcpTurn(
      this.state,
      {
        failure: this.notificationFailure ? "failed" : failure,
        errorCode: this.notificationFailure ?? errorCode,
        hasHistoryFailure: this.hasHistoryFailure,
      },
      (text) => this.redact(text),
    );
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
      this.context.signal.removeEventListener("abort", this.abortRequests);
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
    } catch (caughtError: unknown) {
      logCaughtError("AcpSession", caughtError);

      // The adapter may be gone already; ending its process below ends the session anyway.
    } finally {
      clearTimeout(wait);
    }
  }
}
