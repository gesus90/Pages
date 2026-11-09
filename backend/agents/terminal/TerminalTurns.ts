import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { TerminalTurnEnd } from "./TerminalLaunch";

/**
 * After the CLI reported the end of a turn, Pages waits this long for a
 * prompt somebody typed during the turn, which some CLIs start as a turn of
 * its own right after.
 */
const COMPLETED_GRACE_MS = 1_500;

/**
 * After an interruption a person decides what follows: the turn goes on when
 * they send a prompt within this time, and otherwise ends as interrupted.
 */
const INTERRUPTED_GRACE_MS = 5 * 60_000;

/** How one turn of a terminal session ended for the plan. */
export interface TerminalTurnOutcome {
  readonly failure: PlanSessionTurn["failure"];
  readonly errorCode: AgentErrorCode | null;
  /** The last answer of the agent, unredacted. */
  readonly output: string;
}

interface WaitingTurn {
  readonly resolve: (outcome: TerminalTurnOutcome) => void;
}

/**
 * Decides when a turn of a terminal CLI has ended.
 *
 * @remarks
 * The CLI reports the ends of its turns; a person may type during a turn,
 * and the CLI then continues or starts the next turn at once. A reported
 * end therefore counts only when no new prompt follows within a short
 * grace, after an interruption within a longer one. A question or the end
 * of the process ends the turn at once.
 */
export class TerminalTurns {
  private waiting: WaitingTurn | null = null;
  private settle: ReturnType<typeof setTimeout> | null = null;
  private lastOutput = "";

  /** Whether a turn of Pages waits for its end. */
  public get isRunning(): boolean {
    return this.waiting !== null;
  }

  /**
   * Waits for the end of the turn that starts now.
   *
   * @returns The outcome once the turn has ended for the plan.
   */
  public begin(): Promise<TerminalTurnOutcome> {
    this.cancelSettle();
    this.lastOutput = "";
    return new Promise((resolve) => {
      this.waiting = { resolve };
    });
  }

  /** A prompt reached the model; a pending end does not count. */
  public started(): void {
    this.cancelSettle();
  }

  /**
   * The CLI reported the end of a turn.
   *
   * @param end - What the CLI reported.
   */
  public ended(end: TerminalTurnEnd): void {
    if (end.output) this.lastOutput = end.output;
    if (end.status === "failed") {
      this.finish({
        failure: "failed",
        errorCode: end.errorCode ?? "plan_step_failed",
        output: this.lastOutput,
      });
      return;
    }
    this.cancelSettle();
    const outcome: TerminalTurnOutcome =
      end.status === "completed"
        ? { failure: null, errorCode: null, output: this.lastOutput }
        : { failure: "cancelled", errorCode: null, output: this.lastOutput };
    this.settle = setTimeout(
      () => this.finish(outcome),
      end.status === "completed" ? COMPLETED_GRACE_MS : INTERRUPTED_GRACE_MS,
    );
    this.settle.unref();
  }

  /**
   * Ends the running turn at once, such as for a question or a process exit.
   *
   * @param outcome - How the turn ended.
   */
  public finish(outcome: TerminalTurnOutcome): void {
    this.cancelSettle();
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.resolve({
      ...outcome,
      output: outcome.output || this.lastOutput,
    });
  }

  private cancelSettle(): void {
    if (this.settle !== null) clearTimeout(this.settle);
    this.settle = null;
  }
}
