import { randomUUID } from "node:crypto";

import { createRuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { describeError } from "@/backend/error/ErrorDescription";
import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";

import { createPicaTools } from "../PicaTools";
import {
  picaSteerText,
  picaTurnPrompt,
  readPicaAttachments,
} from "./PicaAcpContent";
import { PicaAcpJournal } from "./PicaAcpJournal";
import { PicaAcpSteering } from "./PicaAcpSteering";
import { PicaAcpThreadWatch } from "./PicaAcpThreadWatch";
import { errorCodeOf, readAnswer, requireCompleted } from "./PicaAcpTurnResult";
import { PicaAcpUpdates } from "./PicaAcpUpdates";

import type { PromptCapabilities } from "@agentclientprotocol/sdk";
import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";
import type {
  AgentPlanSessionInput,
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { ExecutionAuthorizer } from "@/backend/agents/ScopedExecution";
import type { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import type {
  ChatSessionRepository,
  NewChatMessage,
} from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type {
  ChatContextUsage,
  ChatCost,
  ChatJobCompactionEvent,
  ChatJobState,
  ChatJobUsage,
  ChatSelectionItem,
  ChatSteerStatus,
  ChatTokenUsage,
} from "@/definition/ChatJob";
import type { User } from "@/definition/User";
import type { ChatSessionService } from "../ChatSessionService";
import type { ChatToolExecutor } from "../ChatToolExecutor";
import type { PicaBridge, PicaBridgeLease } from "./PicaBridge";
import type { PicaAttachmentReader, PicaTurnBrief } from "./PicaAcpContent";
import type { PicaAcpRunner } from "./PicaAcpRunners";
import type { PicaAcpMessage } from "./PicaAcpSteering";

/** The runner of a job and the run options it was validated with before anything was stored. */
export interface PicaAcpRun {
  readonly runner: PicaAcpRunner;
  readonly options: AgentRunOptions;
}

/** What a job needs from Pages; every write path is an existing one. */
export interface PicaAcpJobDependencies {
  readonly plans: Pick<PlanExecution, "open">;
  readonly jobs: Pick<
    ChatJobRepository,
    "append" | "finish" | "saveContext" | "saveTurn"
  >;
  readonly steers: Pick<ChatSteerRepository, "update" | "select" | "answer">;
  readonly acpSessions: Pick<ChatAcpSessionRepository, "save">;
  readonly messages: Pick<ChatSessionRepository, "append" | "messages">;
  readonly attachments: PicaAttachmentReader;
  readonly bridge: Pick<PicaBridge, "open">;
  readonly tools: Pick<ChatToolExecutor, "run">;
  /** The scope of the connection, checked again before every tool call. */
  readonly access: ExecutionAuthorizer;
  readonly sessions: Pick<ChatSessionService, "require" | "confirmationWord">;
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

/** How a job ended. */
interface PicaAcpOutcome {
  readonly state: Exclude<ChatJobState, "running">;
  readonly errorCode: string | null;
}

/**
 * One Pica answer over ACP that runs on the server, with Codex CLI (PAGE-68)
 * or Claude Code (PAGE-90).
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
  private readonly writes = new SerialQueue();
  private readonly tokens = new Map<
    number,
    Omit<ChatTokenUsage, "isPartial"> | null
  >();
  private readonly selected = new Set<string>();
  /** Opened when the job runs, so a job that never ran leaves no token behind. */
  private bridge: PicaBridgeLease | null = null;
  private context: RuntimeExecutionContext | null = null;
  private session: PlanSession | null = null;
  private acpSessionId: string | null = null;
  private capabilities: PromptCapabilities | null | undefined;
  private usage: Pick<ChatJobUsage, "context" | "cost"> = {
    context: null,
    cost: null,
  };
  private turn = 0;
  private isTurnRunning = false;
  private isStopRequested = false;

  public constructor(
    dependencies: PicaAcpJobDependencies,
    specification: PicaAcpJobSpecification,
  ) {
    this.id = specification.id;
    this.userId = specification.actor.id;
    this.dependencies = dependencies;
    this.specification = specification;
    this.journal = new PicaAcpJournal(dependencies.jobs, specification.id);
    this.updates = new PicaAcpUpdates(
      {
        text: (turn, isReset, delta) => this.journal.text(turn, isReset, delta),
        context: (context, cost) => this.recordContext(context, cost),
        compaction: (compaction) => this.recordCompaction(compaction),
        promptEnded: (turn, tokens) => {
          // From here on the thread's activity belongs to a turn the adapter starts for a steer.
          this.thread.reset();
          this.recordTokens(turn, tokens);
        },
        threadStatus: (isActive) => this.thread.observe(isActive),
        closed: () => this.thread.close(),
      },
      { isCostEstimated: specification.run.runner.isCostEstimated },
    );
    this.steering = new PicaAcpSteering({
      gate: specification.gate,
      status: (messageId, status) => this.recordSteer(messageId, status),
      isTurnRunning: () => this.isTurnRunning && this.session !== null,
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
    let outcome: PicaAcpOutcome;
    try {
      await this.prepare(signal);
      await this.execute(signal);
      outcome = { state: "completed", errorCode: null };
    } catch (error: unknown) {
      outcome = this.outcomeOf(error, signal);
    }
    await this.finish(outcome);
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
        await this.dependencies.access.requireUser(
          actor.id,
          agent.connection.id,
        );
        signal.throwIfAborted();
      },
    });
    this.bridge = this.dependencies.bridge.open({
      jobId: this.id,
      catalog: createPicaTools({
        tools: this.dependencies.tools,
        sessions: this.dependencies.sessions,
        authorize: () => Promise.resolve(),
      }).describe(),
      onTool: (event) => {
        void this.journal
          .record({ kind: "tool", ...event })
          .catch(() => undefined);
      },
    });
    await this.journal.record({ kind: "phase", phase: "starting" });
  }

  private async execute(signal: AbortSignal): Promise<void> {
    const { resumeSessionId } = this.specification;
    await this.beginTurn("message");
    let result = await this.openTurn(resumeSessionId, signal);
    let isResumed = resumeSessionId !== null;
    // An agent session that cannot be continued is replaced once, visibly, with the transcript.
    if (isResumed && result.errorCode === "acp_session_resume_failed") {
      await this.closeSession();
      isResumed = false;
      result = await this.openTurn(null, signal);
    }
    await this.journal.record({ kind: "session", isResumed });
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
    await this.beginTurn("followUp");
    await this.thread.ended(signal);
    // The adapter returns no usage for a turn it started itself.
    this.recordTokens(this.turn, null);
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
    await this.beginTurn("followUp");
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
    requireCompleted(result);
    return this.storeAnswer(result.output);
  }

  private async beginTurn(origin: "message" | "followUp"): Promise<void> {
    const context = this.requireContext();
    this.turn += 1;
    this.requireBridge().setTurn({
      tools: createPicaTools({
        tools: this.dependencies.tools,
        sessions: this.dependencies.sessions,
        authorize: context.authorize,
      }),
      context,
    });
    await this.journal.record({ kind: "turn", turn: this.turn, origin });
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
    }
  }

  private sessionInput(
    message: PicaAcpMessage,
    brief: PicaTurnBrief,
    resumeSessionId: string | null,
  ): AgentPlanSessionInput {
    const { agent, directory } = this.specification;
    return {
      ...this.turnInput(message, brief),
      agent,
      userId: this.userId,
      directory,
      options: this.specification.run.options,
      instanceId: randomUUID(),
      mcp: null,
      chat: {
        mcpServers: [this.requireBridge().server],
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
      prompt: picaTurnPrompt(brief, message.text, message.attachments),
      promptContent: async (capabilities) => {
        this.capabilities = capabilities;
        const content = await readPicaAttachments(
          message.attachments,
          this.dependencies.attachments,
          capabilities,
        );
        await this.select(message.id, content.items);
        return content.blocks;
      },
    };
  }

  private async deliver(message: PicaAcpMessage): Promise<AcpSteerOutcome> {
    const session = this.session;
    if (!session?.steer || !this.isTurnRunning) return "inactive";
    const content = await readPicaAttachments(
      message.attachments,
      this.dependencies.attachments,
      this.capabilities,
    );
    const outcome = await session.steer([
      { type: "text", text: picaSteerText(message.text) },
      ...content.blocks,
    ]);
    // The snapshot tells what reached the agent. A steer the adapter did not
    // take gets it with its own turn, or fails visibly with all its attachments.
    if (outcome === "injected" || outcome === "startedNewTurn")
      await this.select(message.id, content.items);
    return outcome;
  }

  private async select(
    messageId: string,
    items: readonly ChatSelectionItem[],
  ): Promise<void> {
    // The snapshot is written once; a repeated prompt of the same message sends the same.
    if (this.selected.has(messageId)) return;
    this.selected.add(messageId);
    await this.dependencies.steers.select(this.specification.sessionId, {
      messageId,
      items,
    });
  }

  /** Stores the answer of the current turn and returns its message ID. */
  private async storeAnswer(
    output: string,
    ending: Pick<NewChatMessage, "isStopped"> = {},
  ): Promise<string> {
    const content = readAnswer(output);
    const message = await this.dependencies.messages.append(
      this.userId,
      this.specification.sessionId,
      { role: "assistant", content, ...ending },
    );
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
      .catch(() => undefined);
  }

  private recordContext(
    context: ChatContextUsage | null,
    cost: ChatCost | null,
  ): void {
    // Context is replaced, never added up; a cost stays until the adapter reports another.
    this.usage = { context, cost: cost ?? this.usage.cost };
    const { usage } = this;
    void this.writes
      .run(async () => {
        await this.dependencies.jobs.saveContext(this.id, context, usage.cost);
        await this.journal.record({
          kind: "usage",
          usage: this.currentUsage(),
        });
      })
      .catch(() => {
        console.error("[pages] The usage of a Pica job could not be stored.");
      });
  }

  private recordTokens(
    turn: number,
    tokens: Omit<ChatTokenUsage, "isPartial"> | null,
  ): void {
    // One entry per turn: a repeated report replaces it instead of counting twice.
    this.tokens.set(turn, tokens);
    void this.writes
      .run(async () => {
        await this.dependencies.jobs.saveTurn(this.id, turn, tokens);
        await this.journal.record({
          kind: "usage",
          usage: this.currentUsage(),
        });
      })
      .catch(() => {
        console.error("[pages] The usage of a Pica job could not be stored.");
      });
  }

  private currentUsage(): ChatJobUsage {
    const turns = [...this.tokens.values()];
    const reported = turns.filter(
      (entry): entry is Omit<ChatTokenUsage, "isPartial"> => entry !== null,
    );
    const sum = (field: "input" | "output" | "total"): number =>
      reported.reduce((total, entry) => total + entry[field], 0);
    return {
      ...this.usage,
      tokens:
        reported.length === 0
          ? null
          : {
              input: sum("input"),
              output: sum("output"),
              total: sum("total"),
              isPartial: reported.length < turns.length,
            },
    };
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

  private requireBridge(): PicaBridgeLease {
    if (this.bridge === null) throw new PicaAcpJobError("general");
    return this.bridge;
  }

  private requireContext(): RuntimeExecutionContext {
    if (this.context === null) throw new PicaAcpJobError("general");
    return this.context;
  }

  private outcomeOf(error: unknown, signal: AbortSignal): PicaAcpOutcome {
    if (signal.aborted) {
      if (signal.reason === "timeout")
        return { state: "failed", errorCode: "timeout" };
      return this.isStopRequested
        ? { state: "stopped", errorCode: null }
        : { state: "interrupted", errorCode: "interrupted" };
    }
    const code = errorCodeOf(error);
    if (code !== null) return { state: "failed", errorCode: code };
    // Only the kind and a short message of the error are logged, never the conversation.
    console.error("[pages] A Pica job failed.", describeError(error));
    return { state: "failed", errorCode: "general" };
  }

  private async finish(outcome: PicaAcpOutcome): Promise<void> {
    // Intake closes first, so a message sent now starts the next job instead of failing here.
    await this.attempt("intake", () => this.steering.stopIntake());
    this.bridge?.setTurn(null);
    if (outcome.state === "stopped")
      await this.attempt("stopped answer", () => this.storeStoppedAnswer());
    await this.attempt("phase", () =>
      this.journal.record({ kind: "phase", phase: "finishing" }),
    );
    await this.closeSession();
    this.bridge?.close();
    await this.attempt("steers", () => this.steering.close());
    await this.attempt("agent session", () => this.saveSession());
    await this.attempt("end", async () => {
      await this.writes.idle();
      await this.journal.record({ kind: "end", ...outcome });
      await this.journal.drain();
    });
    await this.attempt("state", () =>
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
    await this.attempt("closeout", async () => {
      await session.close();
    });
  }

  private async saveSession(): Promise<void> {
    if (this.acpSessionId === null) return;
    const { agent, sessionId } = this.specification;
    const messages = await this.dependencies.messages.messages(sessionId);
    await this.dependencies.acpSessions.save({
      chatSessionId: sessionId,
      userId: this.userId,
      connectionId: agent.connection.id,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      profile: this.specification.run.runner.profile,
      acpSessionId: this.acpSessionId,
      throughMessageId: messages.at(-1)?.id ?? null,
    });
  }

  /** Runs one step of the closeout; a failure is logged without content and does not skip the others. */
  private async attempt(
    step: string,
    task: () => Promise<void>,
  ): Promise<void> {
    try {
      await task();
    } catch (error: unknown) {
      console.error(
        "[pages] A Pica job closeout step failed.",
        step,
        describeError(error),
      );
    }
  }
}
