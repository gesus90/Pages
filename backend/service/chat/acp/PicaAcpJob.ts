import { randomUUID } from "node:crypto";

import { createRuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";
import { withDatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import {
  logCaughtError,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";

import { picaSteerText, picaTurnPrompt } from "./PicaAcpContent";
import { PicaAcpJournal } from "./PicaAcpJournal";
import { PicaAcpCredential } from "./PicaAcpCredential";
import { PicaAcpUsage } from "./PicaAcpUsage";
import { attemptPicaCloseoutStep, savePicaAcpSession } from "./PicaAcpCloseout";
import { PicaAcpAnswerOutput } from "./PicaAcpAnswerOutput";
import { PicaAcpSelections } from "./PicaAcpSelections";
import { PicaAcpSteering } from "./PicaAcpSteering";
import { PicaAcpToolTurns } from "./PicaAcpToolTurns";
import { PicaAcpThreadWatch } from "./PicaAcpThreadWatch";
import {
  picaAcpOutcome,
  readAnswer,
  requireCompleted,
  turnBeganEvent,
} from "./PicaAcpTurnResult";
import { PicaAcpUpdates } from "./PicaAcpUpdates";

import type { PromptCapabilities } from "@agentclientprotocol/sdk";
import type { DatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";
import type {
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { NewChatMessage } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type {
  ChatJobCompactionEvent,
  ChatSteerStatus,
} from "@/definition/ChatJob";
import type { User } from "@/definition/User";
import type { PicaMessageContent, PicaTurnBrief } from "./PicaAcpContent";
import type { PicaAcpRunner } from "./PicaAcpRunners";
import type { PicaAcpMessage } from "./PicaAcpSteering";
import type { PicaAcpOutcome } from "./PicaAcpTurnResult";
import type { PicaAcpJobDependencies } from "./PicaAcpJobDependencies";

export type { PicaAcpJobDependencies } from "./PicaAcpJobDependencies";

/** The runner of a job and the run options it was validated with before anything was stored. */
export interface PicaAcpRun {
  readonly runner: PicaAcpRunner;
  readonly options: AgentRunOptions;
}

/** One job: the conversation, the pinned agent and the message it answers. */
export interface PicaAcpJobSpecification {
  readonly id: string;
  readonly actor: User;
  readonly sessionId: string;
  readonly agent: ResolvedAgentAssignment;
  readonly run: PicaAcpRun;
  /** The fixed working directory of the conversation. */
  readonly directory: string;
  readonly message: PicaAcpMessage;
  /** Instructions and context with the transcript, for a new agent session. */
  readonly brief: PicaTurnBrief;
  /** The agent session to continue; `null` starts a new one. */
  readonly resumeSessionId: string | null;
  /** Runs a task in the queue of the conversation. */
  readonly gate: <Result>(task: () => Promise<Result>) => Promise<Result>;
}

/**
 * One Pica answer over ACP that runs on the server with the assigned CLI
 * runner: Codex, Claude Code, OpenCode or Antigravity.
 *
 * @remarks
 * The job pins the agent that was assigned when the message was sent. It
 * holds one ACP lease of the shared scheduler while it runs: the turn of its
 * message, every message steered into that turn and every follow-up turn.
 * Afterwards it closes the process; the next job continues the same agent
 * session. Everything the browser shows is in the journal, so the browser
 * may leave and come back; only an explicit stop ends the job early.
 */
export class PicaAcpJob {
  public readonly id: string;
  public readonly userId: string;
  private readonly dependencies: PicaAcpJobDependencies;
  private readonly specification: PicaAcpJobSpecification;
  private readonly journal: PicaAcpJournal;
  private readonly updates: PicaAcpUpdates;
  private readonly steering: PicaAcpSteering;
  private readonly thread = new PicaAcpThreadWatch();
  private readonly deliveryQueue = new SerialQueue();
  private readonly usage: PicaAcpUsage;
  private readonly credential: PicaAcpCredential;
  private readonly selections: PicaAcpSelections;
  private readonly answerOutput: PicaAcpAnswerOutput;
  private isSteerBinding = false;
  private endedDuringSteer = false;
  private hasAdapterTurn = false;
  private context: RuntimeExecutionContext | null = null;
  private session: PlanSession | null = null;
  private acpSessionId: string | null = null;
  private capabilities: PromptCapabilities | null | undefined;
  private turn = 0;
  private readonly toolTurns: PicaAcpToolTurns;
  private isTurnRunning = false;
  private isStopRequested = false;
  private hasSteering: boolean | null = null;

  public constructor(
    dependencies: PicaAcpJobDependencies,
    specification: PicaAcpJobSpecification,
  ) {
    this.id = specification.id;
    this.userId = specification.actor.id;
    this.dependencies = dependencies;
    this.specification = specification;
    this.journal = new PicaAcpJournal(dependencies.jobs, specification.id);
    this.usage = new PicaAcpUsage(
      dependencies.jobs,
      this.journal,
      specification.id,
      specification.run.runner.hasPartialTokenUsage === true,
    );
    this.credential = new PicaAcpCredential(
      specification.directory,
      specification.agent.connection.provider === "claude_code",
    );
    this.answerOutput = new PicaAcpAnswerOutput(
      dependencies.answerFiles,
      specification,
    );
    this.toolTurns = new PicaAcpToolTurns(dependencies, (turn) =>
      this.answerOutput.runId(turn),
    );
    this.selections = new PicaAcpSelections(
      dependencies.attachments,
      (selection) =>
        dependencies.steers.select(specification.sessionId, selection),
    );
    this.updates = new PicaAcpUpdates(
      {
        picaCodex: {
          catalog: () => this.credential.catalog(this.requireContext().signal),
          capture: () => this.credential.capture(this.requireContext()),
        },
        ...(specification.agent.connection.provider === "claude_code"
          ? { picaHelper: () => this.credential.helperPath() }
          : {}),
        steering: (canSteer, capabilities) => {
          this.capabilities = capabilities;
          this.hasSteering = canSteer;
          void this.journal
            .record({ kind: "capabilities", canSteer })
            .catch((caughtError: unknown) => {
              logCaughtError("PicaAcpJob", caughtError);
              return undefined;
            });
        },
        text: (turn, isReset, delta) => this.journal.text(turn, isReset, delta),
        context: (context, cost) => this.usage.recordContext(context, cost),
        compaction: (compaction) => this.recordCompaction(compaction),
        promptEnded: (turn, tokens) => {
          if (this.isSteerBinding && turn === this.turn)
            this.endedDuringSteer = true;
          if (this.credential.boundTurn === turn) this.credential.revoke();
          this.usage.recordTokens(turn, tokens);
        },
        threadStatus: (isActive) => this.thread.observe(isActive),
        content: (turn, block) => this.answerOutput.take(turn, block),
        closed: () => this.thread.close(),
      },
      specification.run.runner,
    );
    this.steering = new PicaAcpSteering({
      gate: specification.gate,
      status: (messageId, status) => this.recordSteer(messageId, status),
      isTurnRunning: () =>
        this.isTurnRunning &&
        this.session !== null &&
        this.hasSteering === true,
      deliver: (message) => this.deliver(message),
    });
  }

  /** Whether the job still takes messages; checked inside the queue of the conversation. */
  public isAccepting(): boolean {
    return this.steering.isAccepting();
  }

  /**
   * Takes a message sent while the job runs; call it inside the queue of the conversation.
   *
   * @returns Its first status, or `null` once the job no longer takes messages.
   */
  public steer(message: PicaAcpMessage): Promise<ChatSteerStatus | null> {
    return this.steering.accept(message);
  }

  /** Marks the coming cancellation as the person's explicit stop. */
  public stop(): void {
    this.isStopRequested = true;
  }

  /**
   * Runs the job until its last turn ended, it failed or it was stopped.
   *
   * @param signal - The stop, the deadline and the server shutdown of the job.
   */
  public async run(signal: AbortSignal): Promise<void> {
    return withLogContext({ jobId: this.id, runId: this.id }, () =>
      withDatabaseLogMetrics((metrics) =>
        this.runJob(AbortSignal.any([signal, this.toolTurns.signal]), metrics),
      ),
    );
  }

  private async runJob(
    signal: AbortSignal,
    metrics: DatabaseLogMetrics,
  ): Promise<void> {
    logEvent({
      level: "info",
      event: "pica.job.started",
      component: "PicaAcpJob",
      message: "Pica job started",
    });
    let outcome: PicaAcpOutcome;
    try {
      await this.prepare(signal);
      await this.execute(this.requireContext().signal);
      outcome = { state: "completed", errorCode: null };
    } catch (error: unknown) {
      logCaughtError("PicaAcpJob", error);

      outcome = picaAcpOutcome(error, {
        signal: this.context?.signal ?? signal,
        isStopRequested: this.isStopRequested,
      });
    }
    await this.finish(outcome);
    logEvent({
      level: outcome.state === "failed" ? "error" : "info",
      event: "pica.job.completed",
      component: "PicaAcpJob",
      message: "Pica job ended and cleanup attempted",
      metadata: {
        status: outcome.state,
        code: outcome.errorCode,
        ...metrics.finish(),
      },
    });
  }

  private async prepare(signal: AbortSignal): Promise<void> {
    const { actor, sessionId, agent } = this.specification;
    const base = await createRuntimeExecutionContext(
      { actor, sessionId, runId: this.id, signal },
      this.dependencies.sessions,
    );
    this.context = Object.freeze({
      ...base,
      authorize: async () => {
        await base.authorize();
        await this.dependencies.requireCurrent?.(actor.id, agent);
        await this.dependencies.access.requireUser(
          actor.id,
          agent.connection.id,
        );
        signal.throwIfAborted();
      },
    });
    this.context =
      this.dependencies.adminTools?.bind(this.context) ?? this.context;
    const lease = this.dependencies.bridge.open({
      jobId: this.id,
      userId: this.userId,
      sessionId: this.specification.sessionId,
      onImages: (turn, images, isCurrent) =>
        this.answerOutput.stageImages(turn, images, isCurrent),
      catalog: await this.toolTurns.catalog(this.userId),
      onTool: (event) => {
        void this.journal
          .record({ kind: "tool", ...event })
          .catch((caughtError: unknown) => {
            logCaughtError("PicaAcpJob", caughtError);
            return undefined;
          });
      },
    });
    this.credential.open(lease);
    await this.journal.record({ kind: "phase", phase: "starting" });
  }

  private async execute(signal: AbortSignal): Promise<void> {
    const { resumeSessionId } = this.specification;
    await this.beginTurn("message", this.specification.message);
    let result = await this.openTurn(resumeSessionId, signal);
    let isResumed = resumeSessionId !== null;
    // An agent session that cannot be continued is replaced once, visibly, with the transcript.
    if (isResumed && result.errorCode === "acp_session_resume_failed") {
      await this.closeSession();
      isResumed = false;
      this.credential.write(
        this.toolTurns.rebind(
          this.requireContext(),
          this.credential.requireLease(),
          this.specification.message,
        ),
      );
      this.credential.bind(this.turn);
      result = await this.openTurn(null, signal);
    }
    await this.journal.record({ kind: "session", isResumed });
    signal.throwIfAborted();
    requireCompleted(result);
    await this.storeAnswer(result.output);
    await this.continueTurns(signal);
  }

  /** Opens the agent session for the job's message; the turn of that message runs at once. */
  private async openTurn(
    resumeSessionId: string | null,
    signal: AbortSignal,
  ): Promise<PlanSessionTurn> {
    const { message, brief } = this.specification;
    // A continued agent session knows the conversation; a new one gets the transcript.
    const turnBrief =
      resumeSessionId === null
        ? brief
        : { ...brief, prompt: { ...brief.prompt, history: [], summary: null } };
    const session = await this.dependencies.plans.open(
      this.sessionInput(message, turnBrief, resumeSessionId),
      signal,
      this.observer(),
    );
    this.session = session;
    await this.journal.record({ kind: "phase", phase: "running" });
    return this.awaitTurn(session.turn);
  }

  private async continueTurns(signal: AbortSignal): Promise<void> {
    for (;;) {
      const next = await this.steering.next();
      if (next === null) return;
      const answerId =
        next.origin === "adapter"
          ? await this.adapterTurn(signal)
          : await this.followUpTurn(next.message, signal);
      await this.dependencies.steers.answer(next.message.id, answerId);
      this.steering.answered(next.message.id);
    }
  }

  /** Follows a turn codex-acp started for a steer after its own turn ended. */
  private async adapterTurn(signal: AbortSignal): Promise<string> {
    this.turn += 1;
    await this.journal.record(turnBeganEvent(this.turn, "followUp"));
    await this.thread.ended(signal);
    this.hasAdapterTurn = false;
    if (this.credential.boundTurn === this.turn) this.credential.revoke();
    signal.throwIfAborted();
    // The adapter returns no usage for a turn it started itself.
    this.usage.recordTokens(this.turn, null);
    const answer = this.updates.answer();
    this.updates.endAdapterTurn();
    this.thread.reset();
    return this.storeAnswer(answer);
  }

  private async followUpTurn(
    message: PicaAcpMessage,
    signal: AbortSignal,
  ): Promise<string> {
    const session = this.session;
    if (!session?.next) throw new PicaAcpJobError("providerFailed");
    await this.beginTurn("followUp", message);
    const { brief } = this.specification;
    const input: AgentPlanExecutionInput = {
      ...this.turnInput(message, {
        ...brief,
        prompt: { ...brief.prompt, history: [], summary: null },
      }),
      agent: this.specification.agent,
      userId: this.userId,
      directory: this.specification.directory,
      beforeStart: () => this.authorize(),
    };
    const result = await this.awaitTurn(
      session.next(input, signal, this.observer()),
    );
    signal.throwIfAborted();
    requireCompleted(result);
    return this.storeAnswer(result.output);
  }

  private async beginTurn(
    origin: "message" | "followUp",
    message: PicaAcpMessage,
  ): Promise<void> {
    this.turn += 1;
    this.credential.write(
      this.toolTurns.bind(
        this.turn,
        this.requireContext(),
        this.credential.requireLease(),
        message,
      ),
    );
    this.credential.bind(this.turn);
    await this.journal.record(turnBeganEvent(this.turn, origin));
  }

  private async awaitTurn(
    pending: Promise<PlanSessionTurn>,
  ): Promise<PlanSessionTurn> {
    this.isTurnRunning = true;
    try {
      return await pending;
    } finally {
      this.isTurnRunning = false;
      await this.steering.settle();
      if (!this.hasAdapterTurn) this.credential.revoke();
    }
  }

  private sessionInput(
    message: PicaAcpMessage,
    brief: PicaTurnBrief,
    resumeSessionId: string | null,
  ): AgentPlanSessionInput {
    const { agent, directory, run } = this.specification;
    return {
      ...this.turnInput(message, brief),
      agent,
      userId: this.userId,
      directory,
      options: run.options,
      instanceId: randomUUID(),
      chat: {
        ...(run.runner.hasBridgeMcp
          ? { mcpServers: this.credential.mcpServers() }
          : {}),
        resumeSessionId,
        listener: this.updates,
      },
      beforeStart: () => this.authorize(),
    };
  }

  private turnInput(
    message: PicaAcpMessage,
    brief: PicaTurnBrief,
  ): Pick<AgentPlanExecutionInput, "prompt" | "promptContent"> {
    return {
      prompt: [
        picaTurnPrompt(brief, message.text, message.attachments),
        this.credential.usage(),
      ].join("\n\n"),
      promptContent: async (capabilities) => {
        this.capabilities = capabilities;
        const content = await this.selections.read(message, capabilities);
        await this.selections.select(message.id, content.items);
        return content.blocks;
      },
    };
  }

  private async deliver(message: PicaAcpMessage): Promise<AcpSteerOutcome> {
    return this.deliveryQueue.run(() => this.deliverMessage(message));
  }

  private async deliverMessage(
    message: PicaAcpMessage,
  ): Promise<AcpSteerOutcome> {
    const steer = this.session?.steer?.bind(this.session);
    if (!steer || !this.isTurnRunning) return "inactive";
    const content = await this.selections.read(message, this.capabilities);
    if (!this.isTurnRunning) return "inactive";
    const sent = await this.sendSteer(steer, message, content);
    if (sent === null) return "inactive";
    const outcome = this.activateSteer(message, sent);
    // The snapshot tells what reached the agent. A steer the adapter did not
    // take gets it with its own turn, or fails visibly with all its attachments.
    if (outcome === "injected" || outcome === "startedNewTurn")
      await this.selections.select(message.id, content.items);
    return outcome;
  }

  /**
   * Reserves the credential of a steer and sends it to the agent.
   *
   * @returns The adapter's outcome, or `null` when the turn ended before the
   * steer was sent; its credential is revoked then.
   */
  private async sendSteer(
    steer: NonNullable<PlanSession["steer"]>,
    message: PicaAcpMessage,
    content: PicaMessageContent,
  ): Promise<AcpSteerOutcome | null> {
    this.isSteerBinding = true;
    this.endedDuringSteer = false;
    try {
      this.thread.reset();
      this.credential.bind(null);
      this.credential.write(
        this.toolTurns.reserve(
          this.requireContext(),
          this.credential.requireLease(),
          message,
        ),
      );
      await this.credential.requireLease().settle();
      if (!this.isTurnRunning) {
        this.credential.revoke();
        return null;
      }
      return await steer([
        {
          type: "text",
          text: [picaSteerText(message.text), this.credential.usage()].join(
            "\n\n",
          ),
        },
        ...content.blocks,
      ]);
    } catch (error: unknown) {
      this.credential.revoke();
      throw error;
    } finally {
      this.isSteerBinding = false;
    }
  }

  /** Activates the reserved credential for a steer the adapter took; otherwise revokes it. */
  private activateSteer(
    message: PicaAcpMessage,
    sent: AcpSteerOutcome,
  ): AcpSteerOutcome {
    const outcome =
      sent === "injected" && this.endedDuringSteer ? "failed" : sent;
    if (outcome !== "injected" && outcome !== "startedNewTurn") {
      this.credential.revoke();
      return outcome;
    }
    const nextTurn = outcome === "startedNewTurn" ? this.turn + 1 : null;
    if (
      !this.toolTurns.activate(
        this.requireContext(),
        this.credential.requireLease(),
        message,
        nextTurn,
      )
    ) {
      this.credential.revoke();
      return "failed";
    }
    this.credential.bind(nextTurn ?? this.turn);
    this.hasAdapterTurn = nextTurn !== null;
    return outcome;
  }

  /** Stores the answer of the current turn and returns its message ID. */
  private async storeAnswer(
    output: string,
    ending: Pick<NewChatMessage, "isStopped"> = {},
  ): Promise<string> {
    await this.credential.requireLease().settle(this.turn);
    await this.answerOutput.settle(this.turn);
    const content = readAnswer(output);
    const message = await this.dependencies.messages.append(
      this.userId,
      this.specification.sessionId,
      { role: "assistant", content, ...ending },
    );
    // Files of this turn are linked before the answer event, so the browser reads them with it.
    await this.answerOutput.claim(this.turn, message.id);
    await this.journal.record({
      kind: "answer",
      turn: this.turn,
      messageId: message.id,
    });
    return message.id;
  }

  private async recordSteer(
    messageId: string,
    status: ChatSteerStatus,
  ): Promise<void> {
    await this.dependencies.steers.update(messageId, status);
    await this.journal.record({ kind: "steer", messageId, status });
  }

  /** A compaction is journaled on its own; it is no tool of Pages, no steer and no stop. */
  private recordCompaction(
    compaction: Omit<ChatJobCompactionEvent, "kind">,
  ): void {
    void this.journal
      .record({ kind: "compaction", ...compaction })
      .catch((caughtError: unknown) => {
        logCaughtError("PicaAcpJob", caughtError);
        return undefined;
      });
  }

  private observer(): PlanSessionObserver {
    return {
      started: () => undefined,
      identified: (sessionId) => {
        this.acpSessionId = sessionId;
      },
    };
  }

  private authorize(): Promise<void> {
    return this.requireContext().authorize();
  }

  private requireContext(): RuntimeExecutionContext {
    if (this.context === null) throw new PicaAcpJobError("general");
    return this.context;
  }

  private async finish(outcome: PicaAcpOutcome): Promise<void> {
    // Intake closes first, so a message sent now starts the next job instead of failing here.
    await attemptPicaCloseoutStep(() => this.steering.stopIntake());
    this.credential.revoke();
    await attemptPicaCloseoutStep(() => this.credential.settle());
    const context = this.context;
    if (context)
      await attemptPicaCloseoutStep(async () => {
        await this.dependencies.adminTools?.release(context);
      });
    if (outcome.state === "stopped")
      await attemptPicaCloseoutStep(() => this.storeStoppedAnswer());
    await attemptPicaCloseoutStep(() =>
      this.journal.record({ kind: "phase", phase: "finishing" }),
    );
    await this.closeSession();
    this.credential.close();
    await attemptPicaCloseoutStep(() => this.answerOutput.discard());
    await attemptPicaCloseoutStep(() => this.steering.close());
    await attemptPicaCloseoutStep(() =>
      savePicaAcpSession(
        this.dependencies,
        this.specification,
        this.acpSessionId,
      ),
    );
    await attemptPicaCloseoutStep(async () => {
      await this.usage.idle();
      await this.journal.record({ kind: "end", ...outcome });
      await this.journal.drain();
    });
    await attemptPicaCloseoutStep(() =>
      this.dependencies.jobs.finish(this.id, outcome.state, outcome.errorCode),
    );
  }

  /**
   * Keeps what the agent wrote in the turn the person stopped, marked as
   * stopped, before the agent session is saved through the last message.
   */
  private async storeStoppedAnswer(): Promise<void> {
    // The text restarts with every turn, so an answer that is stored already is never stored again.
    const partial = this.updates.answer();
    if (!partial.trim()) return;
    await this.storeAnswer(partial, { isStopped: true });
  }

  private async closeSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (session === null) return;
    await attemptPicaCloseoutStep(async () => {
      await session.close();
    });
  }
}
