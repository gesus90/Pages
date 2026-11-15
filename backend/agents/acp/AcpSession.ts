import { client as acpClient, methods } from "@agentclientprotocol/sdk";

import { openRouterPriceCatalog } from "@/backend/service/agents/sessions/OpenRouterPriceCatalog";
import { closeCliSession } from "@/backend/agents/cli/CliSessionCloseout";
import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { abortFailure, stopFailure, finishAcpTurn } from "./AcpSessionOutcome";
import { ACP_STEERING_METHOD, requestAcpSteer } from "./AcpChat";
import { acpPromptParams, isAcpMessageWithinBudget } from "./AcpPromptBudget";
import { acpTurnPrompt } from "./AcpTicketAssets";
import { createAcpSessionState, readAcpUpdate } from "./AcpEvents";
import { reportAcpPlanActivity } from "./AcpPlanActivity";
import { CodexThreadUsage } from "./CodexThreadUsage";
import { AcpTurnControl, PROGRESS_INTERVAL_MS } from "./AcpTurnControl";
import { registerClaudeUsage } from "./ClaudeAcpUsage";
import { AcpMcpReadiness } from "./AcpMcpReadiness";
import { cancelAcpTurn, closeAcpProtocol } from "./AcpProtocolClose";
import { readAntigravityTurnFailure } from "./AntigravityTurnFailure";
import { logAcpToolUpdate } from "./AcpSessionToolLogging";
import {
  describeAcpSession,
  hasAcpConfigurationChanged,
} from "./AcpSessionConfiguration";
import {
  configureAcpSession,
  initializeAcpSession,
  openAcpSession,
} from "./AcpSessionHandshake";
import { openCodeToolFailure } from "./OpenCodeAcpErrors";
import { decideAcpSessionPermission } from "./AcpSessionPermission";
import {
  forwardOpenCodeSessionUsage,
  resolveAcpTurnFailure,
} from "./AcpSessionLifecycle";

import type { AcpHandshakeTarget } from "./AcpSessionHandshake";
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
  SessionNotification,
  SessionConfigOption,
  StopReason,
  Stream,
  Usage,
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
import type { PicaCodexRequests } from "./PicaCodexRequests";

type PausableSessionProcess = Pick<
  CliSessionProcess,
  "endInput" | "exited" | "cancel"
> &
  Partial<Pick<CliSessionProcess, "setPaused" | "suspend" | "resume">>;

export type {
  AcpSessionContext,
  AcpSessionRequest,
} from "./AcpSessionContracts";

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
  private readonly process: PausableSessionProcess;
  private readonly context: AcpSessionContext;
  private hasHistoryFailure = false;
  private notificationFailure: AgentErrorCode | null = null;
  private readonly connection: ClientConnection;
  private readonly state = createAcpSessionState();
  private observer: PlanSessionObserver;
  private turnSignal: AbortSignal;
  private isWorking = true;
  /** The adapter announced `_session/steering` in `initialize`. */
  private isSteeringSupported = false;
  private lastProgressAt = 0;
  private lastProgress = "";
  private promptCapabilities: PromptCapabilities | null | undefined;
  private isModelChecked = false;
  private isModelMismatch = false;
  private openCodeFailure: AgentErrorCode | null = null;
  private expectedConfiguration: Readonly<Record<string, string>> | null = null;
  private configurationOptions: readonly SessionConfigOption[] = [];
  private readonly mcpReadiness: AcpMcpReadiness;
  private readonly codexUsage: CodexThreadUsage | null;
  private readonly picaCodex: PicaCodexRequests | null;
  private closing: Promise<PlanSessionClosed> | null = null;
  /** The inputs and interruptions of a person in the running turn. */
  private readonly control = new AcpTurnControl(() =>
    cancelAcpTurn(this.connection, this.state.sessionId, this.state.events),
  );

  /**
   * Connects to the started adapter and begins the turn at once.
   *
   * @param process - The adapter process; it ends with the node's signal.
   * @param stream - The ACP messages over the process input and output.
   * @param context - Request, mode profile, observer and closeout of the node.
   */
  public constructor(
    process: PausableSessionProcess,
    stream: Stream,
    context: AcpSessionContext,
  ) {
    this.process = process;
    this.terminated = process.exited.then(() => undefined);
    this.context = context;
    this.codexUsage =
      context.codexHome && context.listener
        ? new CodexThreadUsage(
            context.codexHome,
            context.request.model,
            async (report) => {
              context.listener?.update({
                sessionUpdate: "session_info_update",
                _meta: { pagesCodexUsage: report },
              });
              await context.listener?.drained?.();
            },
          )
        : null;
    if (
      (context.listener?.picaCodex || context.listener?.picaHelper) &&
      !context.picaSupport
    )
      throw new AgentError(context.driver.errors.adapterUnsupported);
    this.picaCodex =
      context.picaSupport?.createRequests(
        context,
        () => this.state.sessionId,
        () => this.control.isPrompting,
      ) ?? null;
    this.observer = context.observer;
    this.turnSignal = context.signal;
    describeAcpSession(this.state, context);
    const client = acpClient({ name: "pages" }).onRequest(
      methods.client.session.requestPermission,
      (request) =>
        decideAcpSessionPermission(this.context, this.state, request.params),
    );
    if (this.picaCodex)
      context.picaSupport?.registerRequests(client, this.picaCodex);
    registerClaudeUsage(client, context, {
      session: () => this.state.sessionId,
      failed: () => {
        this.hasHistoryFailure = true;
        this.process.cancel("plan_history_unavailable");
      },
    });
    this.connection = client
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
    this.connection.signal.addEventListener(
      "abort",
      () => this.picaCodex?.close(),
      { once: true },
    );
    this.mcpReadiness = new AcpMcpReadiness(this.connection, this.state);
    this.registerOpenCodeHandling();
    const { listener } = context;
    if (listener)
      this.connection.signal.addEventListener("abort", listener.closed, {
        once: true,
      });
    this.turn = this.work();
  }

  /** Retains the same pending ACP request while its process frame is frozen. */
  public async setPaused(isPaused: boolean): Promise<void> {
    if (!this.process.setPaused) throw new Error("Session pause unavailable");
    await this.process.setPaused(isPaused);
  }

  /** Ends the session once, then confirms that no process of it is left. */
  public close(): Promise<PlanSessionClosed> {
    this.closing ??= this.shutDown();
    return this.closing;
  }

  /** Stops the OpenCode process group while its ACP turn remains pending. */
  public suspend(): Promise<boolean> {
    return Promise.resolve(
      this.context.driver.provider === "opencode" &&
        (this.process.suspend?.() ?? false),
    );
  }

  /** Continues the suspended OpenCode process group. */
  public resume(): Promise<boolean> {
    return Promise.resolve(
      this.context.driver.provider === "opencode" &&
        (this.process.resume?.() ?? false),
    );
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
    if (this.closing || sessionId === null) return "inactive";
    // An input that cannot be sent fails visibly instead of ending the process.
    const steering = { sessionId, prompt };
    const owner = { sessionId, provider: this.context.driver.provider };
    const message = { method: ACP_STEERING_METHOD, params: steering };
    if (!isAcpMessageWithinBudget(message, owner)) return "failed";
    if (
      this.isSteeringSupported &&
      this.control.isPrompting &&
      !this.control.isWaiting
    )
      return requestAcpSteer(this.connection.agent, {
        sessionId,
        prompt,
        meta: this.context.driver.steeringMeta,
      });
    // Without the extension the input cuts the prompt short and follows as the next prompt (PAGE-284).
    return this.context.acceptsTurnInput === true
      ? this.control.add(prompt)
      : "inactive";
  }

  /**
   * Interrupts the running prompt of a plan turn; the turn waits for the next input of a person.
   *
   * @returns Whether a prompt of Pages was running.
   */
  public interrupt(): Promise<boolean> {
    const canTakeInput =
      this.context.acceptsTurnInput === true && !this.closing;
    return Promise.resolve(canTakeInput && this.control.interrupt());
  }

  /**
   * Cancels the running prompt of a chat turn, which stops its running tool
   * call, and continues the same turn with the note (PAGE-303).
   *
   * @param note - What the agent reads about the cancellation.
   * @returns Whether a prompt of Pages was running.
   *
   * @remarks
   * ACP has no cancellation of a single tool call; `session/cancel` ends the
   * running prompt and with it the call. The note follows at once as the
   * next prompt of the same turn, so the turn does not end as cancelled.
   */
  public cancelTool(note: string): Promise<boolean> {
    if (this.closing || !this.control.interrupt())
      return Promise.resolve(false);
    this.control.add([{ type: "text", text: note }]);
    return Promise.resolve(true);
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
      if (this.context.driver.provider === "codex_cli")
        await input.beforeStart?.();
      if (this.context.driver.provider === "antigravity") {
        if (
          input.agent.model !== this.context.request.model ||
          input.agent.reasoningEffort !== this.context.request.reasoningEffort
        )
          throw new AgentError("plan_context_changed");
        await this.configure(this.state.sessionId, this.configurationOptions);
      }
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

  /** Refreshes the OpenCode price catalog and stops the process group on abort. */
  private registerOpenCodeHandling(): void {
    if (this.context.driver.provider !== "opencode") return;
    if (this.context.openCodePricingDirectory)
      void openRouterPriceCatalog(
        this.context.openCodePricingDirectory,
      ).refresh();
    this.context.signal.addEventListener("abort", this.abortRequests, {
      once: true,
    });
    if (this.context.signal.aborted) this.abortRequests();
  }

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
    if (
      hasAcpConfigurationChanged(
        this.context.driver.provider,
        this.expectedConfiguration,
        this.state,
      )
    )
      return this.ended("failed", "plan_context_changed");
    const capabilities =
      this.context.request.modelSupportsImages === false
        ? { ...this.promptCapabilities, image: false }
        : this.promptCapabilities;
    // A person's input or interruption continues the same turn (PAGE-284).
    const response = await this.control.drive({
      first: await acpTurnPrompt(request, sessionId, capabilities),
      // Measured before writing: an oversized prompt is refused, never sent or repeated.
      send: async (next) => {
        await this.codexUsage?.start(
          sessionId,
          Boolean(this.context.request.resumeSessionId),
        );
        return this.connection.agent.request(
          methods.agent.session.prompt,
          acpPromptParams(sessionId, next, this.context.driver.provider),
        );
      },
      settled: async () => {
        await this.picaCodex?.cancelTurn();
      },
      signal: this.turnSignal,
      isClosing: () => this.closing !== null,
      continued: async (cut) => {
        await this.codexUsage?.finish(cut.usage ?? null);
        this.reportPromptUsage(cut.usage ?? null, sessionId, true);
        await this.context.listener?.drained?.();
      },
    });
    await this.codexUsage?.finish(response.usage ?? null);
    this.reportPromptUsage(response.usage ?? null, sessionId);
    forwardOpenCodeSessionUsage(this.context, sessionId);
    await this.context.listener?.drained?.();
    noteSessionEvent(this.state.events, `turn ${response.stopReason}`);
    if (
      hasAcpConfigurationChanged(
        this.context.driver.provider,
        this.expectedConfiguration,
        this.state,
      )
    )
      return this.ended("failed", "plan_context_changed");
    if (this.isModelMismatch)
      return this.ended("failed", "plan_model_unavailable");
    const adapterFailure = this.adapterFailure(response.stopReason);
    if (adapterFailure) return adapterFailure;
    return this.ended(
      stopFailure(response.stopReason),
      this.state.isMcpUnavailable
        ? "plan_mcp_unavailable"
        : (this.state.providerFailure?.code ?? this.openCodeFailure),
    );
  }

  private reportPromptUsage(
    usage: Usage | null,
    sessionId: string,
    isContinued = false,
  ): void {
    const listener = this.context.listener;
    if (this.context.driver.provider === "claude_code") {
      listener?.prompted(usage, isContinued, sessionId);
      return;
    }
    if (isContinued) listener?.prompted(usage, true);
    else listener?.prompted(usage);
  }

  /** Turns an adapter-reported failure into a failed node instead of a model answer. */
  private adapterFailure(stopReason: StopReason): PlanSessionTurn | null {
    const { driver, request } = this.context;
    const hasMcp = request.mcpServers.length > 0;
    const failure =
      driver.provider === "antigravity" && stopReason === "end_turn"
        ? readAntigravityTurnFailure(this.state.text, hasMcp)
        : null;
    if (!failure) return null;
    this.state.providerFailure = failure.providerFailure;
    noteSessionEvent(this.state.events, `adapter reported ${failure.code}`);
    return this.ended("failed", failure.code);
  }

  private handshakeTarget(): AcpHandshakeTarget {
    return {
      connection: this.connection,
      context: this.context,
      state: this.state,
      observer: this.observer,
      hasPicaCodex: Boolean(this.picaCodex),
      onConfirmThread: (sessionId: string) =>
        this.picaCodex?.confirmThread(sessionId),
      redact: (text: string) => this.redact(text),
    };
  }

  private async initialize(): Promise<void> {
    const initialized = await initializeAcpSession(this.handshakeTarget());
    this.promptCapabilities = initialized.promptCapabilities;
    this.isSteeringSupported = initialized.isSteeringSupported;
  }

  private async openSession(): Promise<OpenedSession> {
    const opened = await openAcpSession(this.handshakeTarget());
    forwardOpenCodeSessionUsage(this.context, opened.sessionId);
    return opened;
  }

  private async configure(
    sessionId: string,
    initial: readonly SessionConfigOption[],
  ): Promise<void> {
    const configured = await configureAcpSession(
      this.handshakeTarget(),
      sessionId,
      initial,
    );
    this.configurationOptions = configured.options;
    this.expectedConfiguration = configured.expected;
  }

  private receive(notification: SessionNotification): void {
    const { sessionId } = this.state;
    // An update may arrive before `session/new` answered; it belongs to the only session.
    if (sessionId !== null && notification.sessionId !== sessionId) return;
    const { update } = notification;
    logAcpToolUpdate(update, sessionId);
    if (this.mcpReadiness.receive(update)) return;
    if (update.sessionUpdate === "config_option_update")
      this.configurationOptions = update.configOptions;
    readAcpUpdate(this.state, update, this.context.profile.reportedOptions);
    if (this.context.driver.provider === "opencode") {
      const failure = openCodeToolFailure(update);
      this.openCodeFailure ??= failure;
      if (failure === "plan_runner_permission_denied")
        this.state.permissionDenials += 1;
    }
    reportAcpPlanActivity(update, this.observer, (text) => this.redact(text));
    this.context.listener?.update(update);
    if (this.context.driver.provider === "opencode")
      forwardOpenCodeSessionUsage(this.context, notification.sessionId);
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
    void cancelAcpTurn(
      this.connection,
      this.state.sessionId,
      this.state.events,
    );
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

  private failed(error: unknown): Promise<PlanSessionTurn> {
    return resolveAcpTurnFailure({
      error,
      turnSignal: this.turnSignal,
      process: this.process,
      connectionAborted: this.connection.signal.aborted,
      state: this.state,
      context: this.context,
      isPicaNative: this.picaCodex !== null,
      notificationFailure: this.notificationFailure,
      hasHistoryFailure: this.hasHistoryFailure,
      redact: (text) => this.redact(text),
    });
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
      await this.picaCodex?.cancelTurn();
      await closeAcpProtocol(this.connection, this.state.sessionId);
      this.connection.close();
      const closed = await closeCliSession(
        this.process,
        this.context.instanceId,
        undefined,
        this.context.containment ?? "none",
      );
      await this.codexUsage?.close();
      if (closed.isConfirmed) this.context.cleanupAdapter?.();
      return closed;
    } finally {
      this.picaCodex?.close();
      this.context.signal.removeEventListener("abort", this.abortRequests);
      await this.context.secure();
    }
  }
}
