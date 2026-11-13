import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";
import { activeAgentTodo } from "@/definition/AgentPlanAgentTodos";

import { swarmMainPrompt, swarmMainReminder } from "./SwarmPrompts";

import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";
import type { SwarmCoordinator, SwarmFinish } from "./SwarmCoordinator";
import type { SwarmTurn } from "./SwarmPorts";
import type { SwarmOpenedSession, SwarmSessionRequest } from "./SwarmSessions";

/** How often the main model is woken again after a turn without `swarm_finish`. */
export const SWARM_MAIN_REMINDERS = 100;

/** How long the main model may wait idle for a change before it is woken anyway. */
const IDLE_WAKE_MS = 30_000;

/** How long the closing turn of the main model may run after `swarm_finish`. */
const FINISH_GRACE_MS = 60_000;

/** What the main loop needs besides coordinator and sessions. */
export interface SwarmMainLoopContext {
  readonly node: AgentPlanSwarm;
  readonly task: string;
  readonly isResumed: boolean;
  readonly signal: AbortSignal;
  readonly todos: (todos: readonly AgentPlanAgentTodo[]) => Promise<void>;
}

type TurnOrFinish =
  | { readonly kind: "turn"; readonly turn: SwarmTurn }
  | { readonly kind: "finish"; readonly finish: SwarmFinish };

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

/**
 * Drives the session of the main model of a swarm until it calls `swarm_finish` (PAGE-313).
 *
 * @remarks
 * When a turn of the main model ends without `swarm_finish`, the loop waits
 * for the next change of the board, at most {@link IDLE_WAKE_MS}, and wakes
 * it with the current board, at most {@link SWARM_MAIN_REMINDERS} times. A
 * failed turn of the main model is the loss of its session and fails the node.
 */
export class SwarmMainLoop {
  private readonly coordinator: SwarmCoordinator;
  private readonly sessions: {
    open(request: SwarmSessionRequest): Promise<SwarmOpenedSession>;
  };
  private readonly context: SwarmMainLoopContext;

  public constructor(
    coordinator: SwarmCoordinator,
    sessions: {
      open(request: SwarmSessionRequest): Promise<SwarmOpenedSession>;
    },
    context: SwarmMainLoopContext,
  ) {
    this.coordinator = coordinator;
    this.sessions = sessions;
    this.context = context;
  }

  /** Runs the main model and returns the changes of the node result. */
  public async run(): Promise<Partial<AgentPlanStepResult>> {
    const { node, signal } = this.context;
    const model = node.main.model;
    if (!model)
      return {
        status: "failed",
        error: "swarm_main_model_missing",
        output: null,
      };
    const opened = await this.sessions.open({
      role: "main",
      model,
      access: node.main.access,
      prompt: swarmMainPrompt({
        task: this.context.task,
        instruction: node.main.instruction ?? null,
        view: this.coordinator.view(),
        isResumed: this.context.isResumed,
      }),
      signal,
      todos: (todos) => {
        this.coordinator.showMainTodos(todos);
        this.coordinator.showMainActivity(activeAgentTodo(todos)?.text ?? null);
        void this.context.todos(todos);
      },
    });
    try {
      return await this.drive(opened);
    } finally {
      await opened.close();
    }
  }

  private async drive(
    opened: SwarmOpenedSession,
  ): Promise<Partial<AgentPlanStepResult>> {
    let turn = opened.turn;
    for (let reminder = 0; ; reminder += 1) {
      const outcome = await this.race(turn);
      if (outcome.kind === "finish") {
        await Promise.race([
          turn.catch(() => undefined),
          delay(FINISH_GRACE_MS),
        ]);
        return this.finished(outcome.finish);
      }
      if (this.context.signal.aborted) throw new AgentPlanCancelledError();
      if (outcome.turn.failure !== null)
        return { status: "failed", error: "swarm_main_lost", output: null };
      if (reminder >= SWARM_MAIN_REMINDERS)
        return {
          status: "failed",
          error: "swarm_main_unfinished",
          output: null,
        };
      await this.coordinator.waitForChange(IDLE_WAKE_MS, this.context.signal);
      const finish = await this.finishIfDone();
      if (finish) return this.finished(finish);
      turn = opened.next(
        swarmMainReminder(this.coordinator.view()),
        this.context.signal,
      );
    }
  }

  private async race(turn: Promise<SwarmTurn>): Promise<TurnOrFinish> {
    return Promise.race([
      turn.then(
        (ended): TurnOrFinish => ({ kind: "turn", turn: ended }),
        (error: unknown): TurnOrFinish => {
          logCaughtError("SwarmMainLoop", error);
          return {
            kind: "turn",
            turn: {
              output: "",
              failure: "failed",
              errorCode: "swarm_main_lost",
            },
          };
        },
      ),
      this.coordinator.finished.then((finish): TurnOrFinish => ({
        kind: "finish",
        finish,
      })),
    ]);
  }

  /** A finish that arrived while the loop waited. */
  private async finishIfDone(): Promise<SwarmFinish | null> {
    return Promise.race([this.coordinator.finished, Promise.resolve(null)]);
  }

  private finished(finish: SwarmFinish): Partial<AgentPlanStepResult> {
    return finish.status === "succeeded"
      ? { status: "succeeded", output: finish.summary, error: null }
      : { status: "failed", output: finish.summary, error: "swarm_failed" };
  }
}
