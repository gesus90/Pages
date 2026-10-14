import { closeCliSession } from "./CliSessionCloseout";
import { readCliSessionLine } from "./CliSessionEvents";

import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { CliSessionState } from "./CliSessionEvents";
import type { CliSessionExit, CliSessionProcess } from "./CliSessionProcess";
import type { CliPlanRunner, CliSessionPlan } from "./CliSessionPlans";

/** What one session needs from its surroundings. */
export interface CliPlanSessionContext {
  readonly provider: CliPlanRunner;
  readonly instanceId: string;
  readonly plan: CliSessionPlan;
  readonly state: CliSessionState;
  readonly observer: PlanSessionObserver;
  /** Restores the modes of the credential folder after the session. */
  readonly secure: () => Promise<void>;
}

function failureOf(
  exit: CliSessionExit,
  state: CliSessionState,
): PlanSessionTurn["failure"] {
  if (exit.errorCode === "check_timeout") return "timeout";
  if (exit.errorCode !== null) return "cancelled";
  if (exit.code !== 0 || exit.signal !== null) return "failed";
  if (state.hasFailed) return "failed";
  return state.isTurnComplete ? null : "incomplete";
}

/**
 * One running session of a plan node.
 *
 * @remarks
 * The turn of a one-shot call ends with its process. The turn of an
 * interactive session ends with the runner's result event while the process
 * keeps running; only {@link CliPlanSession.close} ends it. Closing always
 * looks for processes of the session that outlived the runner, ends them and
 * confirms that none is left.
 */
export class CliPlanSession implements PlanSession {
  public readonly turn: Promise<PlanSessionTurn>;
  private readonly process: CliSessionProcess;
  private readonly context: CliPlanSessionContext;
  private resolveTurn: ((turn: PlanSessionTurn) => void) | null = null;
  private hasEndedTurn = false;
  private closing: Promise<PlanSessionClosed> | null = null;

  public constructor(
    process: CliSessionProcess,
    context: CliPlanSessionContext,
  ) {
    this.process = process;
    this.context = context;
    this.turn = new Promise((resolve) => {
      this.resolveTurn = resolve;
    });
    void process.exited.then((exit) => {
      this.endTurn(failureOf(exit, context.state));
    });
  }

  /** Feeds one event line; an interactive turn ends at the runner's result event. */
  public receive(line: string): void {
    const update = readCliSessionLine(
      this.context.provider,
      line,
      this.context.state,
    );
    if (update.identified) this.context.observer.identified(update.identified);
    if (update.turnEnded && this.context.plan.mode === "interactive")
      this.endTurn(this.context.state.hasFailed ? "failed" : null);
  }

  /** Ends the session once, then confirms that no process of it is left. */
  public close(): Promise<PlanSessionClosed> {
    this.closing ??= this.shutDown();
    return this.closing;
  }

  private endTurn(failure: PlanSessionTurn["failure"]): void {
    if (this.hasEndedTurn) return;
    this.hasEndedTurn = true;
    const { state } = this.context;
    this.resolveTurn?.({
      output: state.text,
      sessionId: state.sessionId,
      failure,
      errorCode: null,
      endedAt: new Date().toISOString(),
      permissionDenials: state.permissionDenials,
      effective: { ...state.effective },
      events: [...state.events],
    });
  }

  private async shutDown(): Promise<PlanSessionClosed> {
    try {
      return await closeCliSession(this.process, this.context.instanceId);
    } finally {
      await this.context.secure();
    }
  }
}
