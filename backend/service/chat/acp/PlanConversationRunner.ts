import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";
import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type {
  ConversationBridgeChannel,
  ConversationRelease,
  ConversationReleaseReason,
  ConversationRunnerSession,
  ConversationSessionOpened,
  ConversationSessionRunner,
  ConversationSessionStart,
} from "@/backend/agents/ConversationSessionRunner";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";

/** Remembers the native agent session identifier every observer of the session reports. */
class NativeSessionTrace {
  private sessionId: string | null = null;

  /** The identifier the adapter reported last, or `null` before it reported one. */
  public get id(): string | null {
    return this.sessionId;
  }

  /**
   * Passes every milestone on and keeps the identifier.
   * @param observer - The observer of the round the milestones belong to.
   */
  public observe(observer: PlanSessionObserver): PlanSessionObserver {
    return {
      ...observer,
      identified: (sessionId) => {
        this.sessionId = sessionId;
        observer.identified(sessionId);
      },
    };
  }
}

/** The release of a session whose close threw or could not be confirmed. */
function unconfirmed(reason: ConversationReleaseReason): ConversationRelease {
  return {
    reason,
    exit: null,
    endedAt: new Date().toISOString(),
    leftovers: 0,
    isConfirmed: false,
  };
}

/**
 * A native ACP session of the plan runner, offered as a conversation session.
 * @remarks
 * The runner keeps the process, the lease and the connection of the session
 * across rounds. A release closes them through the runner's own closeout, so
 * it is confirmed only when that closeout is.
 */
class PlanConversationSession implements ConversationRunnerSession {
  public readonly instanceId: string;
  public readonly exited: Promise<ConversationRelease>;
  public readonly steer?: (
    prompt: readonly ContentBlock[],
  ) => Promise<AcpSteerOutcome>;
  public readonly interrupt?: () => Promise<boolean>;
  public readonly cancelTool?: (note: string) => Promise<boolean>;
  private readonly native: PlanSession;
  private readonly trace: NativeSessionTrace;
  private readonly bridge: ConversationBridgeChannel | null;
  private releasing: Promise<ConversationRelease> | null = null;

  public constructor(
    native: PlanSession,
    start: ConversationSessionStart,
    trace: NativeSessionTrace,
  ) {
    this.native = native;
    this.trace = trace;
    this.bridge = start.bridge;
    this.instanceId = start.input.instanceId;
    const { steer, interrupt, cancelTool } = native;
    if (steer) this.steer = (prompt) => steer.call(native, prompt);
    if (interrupt) this.interrupt = () => interrupt.call(native);
    if (cancelTool) this.cancelTool = (note) => cancelTool.call(native, note);
    this.exited = this.watchExit();
  }

  /** The native agent session identifier the adapter reported, or `null`. */
  public nativeSessionId(): string | null {
    return this.trace.id;
  }

  /**
   * Runs the next round as another turn of the same native session.
   * @throws {PicaAcpJobError} `general` for a runner whose session takes no further turn.
   */
  public async round(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSessionTurn> {
    const { next } = this.native;
    if (!next) throw new PicaAcpJobError("general");
    return next.call(this.native, input, signal, this.trace.observe(observer));
  }

  /** Revokes the bridge credential first, then closes the native session out; the first record stands. */
  public release(
    reason: ConversationReleaseReason,
  ): Promise<ConversationRelease> {
    this.releasing ??= this.releaseOnce(reason);
    return this.releasing;
  }

  private async releaseOnce(
    reason: ConversationReleaseReason,
  ): Promise<ConversationRelease> {
    // The agent loses the Pages tools before its process is confirmed gone.
    this.bridge?.close();
    try {
      const closed = await this.native.close();
      return {
        reason,
        exit: closed.exit,
        endedAt: closed.endedAt,
        leftovers: closed.leftovers,
        isConfirmed: closed.isConfirmed,
      };
    } catch (error: unknown) {
      logCaughtError("PlanConversationSession", error);
      // A close that threw can be tried again; a close that answered is final.
      this.releasing = null;
      return unconfirmed(reason);
    }
  }

  /** A process that ends on its own is closed out like a released one. */
  private async watchExit(): Promise<ConversationRelease> {
    const { terminated } = this.native;
    if (!terminated) return new Promise<ConversationRelease>(() => undefined);
    try {
      await terminated;
    } catch (error: unknown) {
      logCaughtError("PlanConversationSession", error);
    }
    return this.release("failure");
  }
}

/**
 * The conversation session runner on top of the plan session runner.
 * @remarks
 * A conversation session is one native ACP session of the same runner plans
 * use: the same connection checks, scheduler lease and closeout. It differs in
 * what it is bound to. A plan binds a session to plan, step and attempt and
 * ends it after its order; a conversation binds it to agent and conversation,
 * keeps it across rounds and ends it by a release the pool decides.
 */
export class PlanConversationRunner implements ConversationSessionRunner {
  private readonly plans: Pick<PlanExecution, "open">;

  /** @param plans - The plan runner that starts the native sessions. */
  public constructor(plans: Pick<PlanExecution, "open">) {
    this.plans = plans;
  }

  /** Starts the native session through the plan runner and wraps it as a conversation session. */
  public async open(
    start: ConversationSessionStart,
  ): Promise<ConversationSessionOpened> {
    const trace = new NativeSessionTrace();
    const native = await this.plans.open(
      start.input,
      start.signal,
      trace.observe(start.observer),
    );
    return {
      session: new PlanConversationSession(native, start, trace),
      firstRound: native.turn,
    };
  }
}
