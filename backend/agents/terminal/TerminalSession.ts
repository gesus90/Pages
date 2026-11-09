import { closeCliSession } from "@/backend/agents/cli/CliSessionCloseout";
import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { TerminalTurns } from "./TerminalTurns";

import type { ContentBlock, Usage } from "@agentclientprotocol/sdk";
import type {
  AcpSessionListener,
  AcpSteerOutcome,
} from "@/backend/agents/acp/AcpChat";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { TerminalInputs } from "./TerminalInputs";
import type {
  TerminalLaunch,
  TerminalTurnEnd,
  TerminalUsage,
} from "./TerminalLaunch";
import type { TerminalProcess } from "./TerminalProcess";
import type { TerminalRecorder } from "./TerminalRecorder";
import type { TerminalScreen } from "./TerminalScreen";
import type { TerminalHostStore } from "./TerminalStore";
import type { TerminalTurnOutcome } from "./TerminalTurns";

/** The screen is checked this often for a question the CLI shows nowhere else. */
const QUESTION_CHECK_MS = 1_000;

/** What a terminal session is built from; its process runs already. */
export interface TerminalSessionContext {
  readonly instanceId: string;
  readonly launch: Pick<
    TerminalLaunch,
    "monitor" | "questionPattern" | "sessionId"
  >;
  readonly process: Pick<
    TerminalProcess,
    "exited" | "isRunning" | "cancel" | "endInput"
  >;
  readonly recorder: Pick<TerminalRecorder, "finish">;
  readonly screen: Pick<TerminalScreen, "text" | "dispose">;
  readonly inputs: Pick<TerminalInputs, "paste" | "stop">;
  readonly store: Pick<TerminalHostStore, "activate" | "question" | "end">;
  readonly observer: PlanSessionObserver;
  readonly signal: AbortSignal;
  /** The step whose turn starts with the process. */
  readonly stepId: string;
  /** Masks the credentials of the session in texts the run keeps. */
  readonly redact: (text: string) => string;
  /** Records usage and answers into the PageAgentCLI history. */
  readonly listener?: AcpSessionListener;
  /** What the run record says about the session, such as mode and isolation. */
  readonly effective: Readonly<Record<string, string>>;
  readonly isPidNamespace: boolean;
  /** Secures the credentials and removes the private files of the session. */
  readonly secure: () => Promise<void>;
}

/** Usage of one turn, added up from what the CLI reported. */
interface TurnTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
}

function add(
  sum: number | null,
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) return sum;
  return (sum ?? 0) + value;
}

function emptyTokens(): TurnTokens {
  return {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
  };
}

function abortFailure(signal: AbortSignal): TerminalTurnOutcome {
  const isTimeout =
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError";
  return {
    failure: isTimeout ? "timeout" : "cancelled",
    errorCode: null,
    output: "",
  };
}

/**
 * A plan session whose CLI runs in a pseudo terminal (PAGE-265).
 *
 * @remarks
 * The first turn starts with the process: the CLI received the plan prompt
 * at its start. A further step of the same group is pasted as one block and
 * sent; a steer joins the running turn the same way. The CLI reports the
 * ends of its turns through its hooks, transcript or local interface; a
 * question that nobody would answer fails the node at once, and so does the
 * end of the CLI during a turn. Closing hangs the terminal up, ends what is
 * left of the process group and secures the credentials; the terminal then
 * takes no input any more.
 */
export class TerminalSession implements PlanSession {
  public readonly turn: Promise<PlanSessionTurn>;
  public readonly terminated: Promise<void>;
  private readonly context: TerminalSessionContext;
  private readonly turns = new TerminalTurns();
  private readonly events: string[] = [];
  private readonly effective: Record<string, string>;
  private observer: PlanSessionObserver;
  private sessionId: string | null;
  private tokens = emptyTokens();
  private question: string | null = null;
  private questionTimer: ReturnType<typeof setInterval> | null = null;
  private closing: Promise<PlanSessionClosed> | null = null;
  private ending: Promise<void> | null = null;

  public constructor(context: TerminalSessionContext) {
    this.context = context;
    this.observer = context.observer;
    this.sessionId = context.launch.sessionId;
    this.effective = { ...context.effective, surface: "terminal" };
    this.terminated = context.process.exited.then(() => undefined);
    this.turn = this.run(this.turns.begin(), context.signal, context.stepId);
    void context.process.exited.then((exit) => {
      noteSessionEvent(
        this.events,
        `terminal ended with ${exit.code ?? exit.signal ?? "no code"}`,
      );
      void this.endTerminal(new Date().toISOString());
      this.turns.finish(
        context.signal.aborted
          ? abortFailure(context.signal)
          : {
              failure: "failed",
              errorCode: exit.errorCode ?? "plan_step_failed",
              output: "",
            },
      );
    });
    void this.watch();
  }

  /** Whether the closeout has begun. */
  public get isClosing(): boolean {
    return this.closing !== null;
  }

  /**
   * Sends the prompt of the next step of the group into the same CLI.
   *
   * @throws {AgentError} `plan_step_failed` while a turn runs or after the CLI ended.
   */
  public async next(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn> {
    await this.turn;
    if (this.turns.isRunning || this.closing || !this.context.process.isRunning)
      throw new AgentError("plan_step_failed");
    this.observer = observer;
    this.tokens = emptyTokens();
    const stepId = input.resourceContext?.stepId ?? this.context.stepId;
    const outcome = this.turns.begin();
    noteSessionEvent(this.events, "next step instruction pasted");
    await this.context.inputs.paste(input.prompt);
    return this.run(outcome, signal, stepId);
  }

  /** Adds text to the running turn, as a person would type it. */
  public async steer(
    prompt: readonly ContentBlock[],
  ): Promise<AcpSteerOutcome> {
    if (!this.turns.isRunning || this.closing) return "inactive";
    const text = prompt
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();
    if (!text) return "failed";
    await this.context.inputs.paste(text);
    return "injected";
  }

  /** Ends the session once and confirms that no process of it is left. */
  public close(): Promise<PlanSessionClosed> {
    this.closing ??= this.shutDown();
    return this.closing;
  }

  private async watch(): Promise<void> {
    const { launch, screen } = this.context;
    try {
      await launch.monitor.start({
        identified: (sessionId) => {
          this.sessionId = sessionId;
          this.observer.identified(this.context.redact(sessionId));
        },
        turnStarted: () => this.turns.started(),
        turnEnded: (end) => this.ended(end),
        usage: (usage) => this.usage(usage),
        question: (question) => this.ask(question),
      });
    } catch (error: unknown) {
      logCaughtError("TerminalSession", error);
    }
    const pattern = launch.questionPattern;
    if (pattern === null) return;
    this.questionTimer = setInterval(() => {
      const match = pattern.exec(screen.text());
      if (match && this.turns.isRunning) this.ask(match[0]);
    }, QUESTION_CHECK_MS);
    this.questionTimer.unref();
  }

  private async run(
    outcome: Promise<TerminalTurnOutcome>,
    signal: AbortSignal,
    stepId: string,
  ): Promise<PlanSessionTurn> {
    const abort = (): void => this.turns.finish(abortFailure(signal));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try {
      await this.context.store
        .activate(this.context.instanceId, stepId)
        .catch((error: unknown) => {
          logCaughtError("TerminalSession", error);
        });
      return this.finishTurn(await outcome);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  private ended(end: TerminalTurnEnd): void {
    noteSessionEvent(this.events, `turn ${end.status}`);
    this.turns.ended(end);
  }

  private usage(usage: TerminalUsage): void {
    if (usage.model) this.effective.model = usage.model;
    if (usage.reasoningEffort) this.effective.effort = usage.reasoningEffort;
    const increment = usage.increment;
    if (increment)
      this.tokens = {
        inputTokens: add(this.tokens.inputTokens, increment.inputTokens),
        outputTokens: add(this.tokens.outputTokens, increment.outputTokens),
        cacheReadTokens: add(
          this.tokens.cacheReadTokens,
          increment.cacheReadTokens,
        ),
        cacheWriteTokens: add(
          this.tokens.cacheWriteTokens,
          increment.cacheWriteTokens,
        ),
        totalTokens: add(this.tokens.totalTokens, increment.totalTokens),
      };
    if (!usage.model && usage.contextUsed === undefined) return;
    this.context.listener?.update({
      sessionUpdate: "usage_update",
      used: usage.contextUsed ?? 0,
      size: usage.contextLimit ?? 0,
      ...(usage.model ? { _meta: { "_claude/model": usage.model } } : {}),
    });
  }

  private ask(question: string): void {
    if (this.question !== null || !this.turns.isRunning) return;
    const text = this.context.redact(question).slice(0, 2_000);
    this.question = text;
    noteSessionEvent(this.events, `open question: ${text}`);
    void this.context.store
      .question(this.context.instanceId, text)
      .catch((error: unknown) => logCaughtError("TerminalSession", error));
    this.turns.finish({
      failure: "failed",
      errorCode: "plan_terminal_question",
      output: "",
    });
  }

  private finishTurn(outcome: TerminalTurnOutcome): PlanSessionTurn {
    const { listener, redact } = this.context;
    const output = redact(outcome.output);
    if (output)
      listener?.update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: output },
      });
    listener?.prompted(this.reportedUsage());
    const question = this.question;
    return {
      output: question
        ? `${output}\n\nOpen question: ${question}`.trim()
        : output,
      sessionId: this.sessionId === null ? null : redact(this.sessionId),
      failure: outcome.failure,
      errorCode: outcome.errorCode,
      endedAt: new Date().toISOString(),
      permissionDenials: 0,
      effective: Object.fromEntries(
        Object.entries(this.effective).map(([key, value]) => [
          key,
          redact(value),
        ]),
      ),
      events: this.events.map((event) => redact(event)),
    };
  }

  private reportedUsage(): Usage | null {
    const tokens = this.tokens;
    if (Object.values(tokens).every((value) => value === null)) return null;
    return {
      inputTokens: tokens.inputTokens ?? 0,
      outputTokens: tokens.outputTokens ?? 0,
      cachedReadTokens: tokens.cacheReadTokens,
      cachedWriteTokens: tokens.cacheWriteTokens,
      totalTokens:
        tokens.totalTokens ??
        (tokens.inputTokens ?? 0) +
          (tokens.outputTokens ?? 0) +
          (tokens.cacheReadTokens ?? 0) +
          (tokens.cacheWriteTokens ?? 0),
    };
  }

  /** Stores the rest of the output and ends the terminal once; it takes no input afterwards. */
  private endTerminal(endedAt: string): Promise<void> {
    this.ending ??= (async () => {
      await this.context.recorder.finish();
      await this.context.store.end(this.context.instanceId, endedAt);
    })().catch((error: unknown) => {
      logCaughtError("TerminalSession", error);
    });
    return this.ending;
  }

  private async shutDown(): Promise<PlanSessionClosed> {
    const { context } = this;
    if (this.questionTimer !== null) clearInterval(this.questionTimer);
    context.inputs.stop();
    try {
      const closed = await closeCliSession(
        context.process,
        context.instanceId,
        undefined,
        context.isPidNamespace,
      );
      await this.endTerminal(closed.endedAt);
      return closed;
    } finally {
      await context.launch.monitor.close().catch((error: unknown) => {
        logCaughtError("TerminalSession", error);
      });
      context.screen.dispose();
      context.listener?.closed();
      await context.secure();
    }
  }
}
