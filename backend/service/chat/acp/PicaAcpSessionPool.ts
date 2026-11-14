import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";
import { logCaughtError } from "@/backend/logging/Logger";
import { AGENT_CHAT_IDLE_DEFAULT_MINUTES } from "@/definition/AgentSessionLimits";
import { PicaAcpPooledListener } from "./PicaAcpPooledListener";

import type { ContentBlock } from "@agentclientprotocol/sdk";
import type {
  AcpSessionListener,
  AcpSteerOutcome,
} from "@/backend/agents/acp/AcpChat";
import type {
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AcpChatSessionView } from "@/definition/AcpResource";
import type { PicaBridgeMcpChannel } from "./PicaBridge";

const MILLISECONDS_PER_MINUTE = 60_000;

/** Whose chat session a job asks for, and with which configuration. */
export interface PicaAcpPoolSession {
  /** The chat session of the agent: one per agent and conversation. */
  readonly chatSessionId: string;
  readonly agentId: string;
  readonly agentName: string;
  /** The conversation, as the memory of the agent names it. */
  readonly conversation: string;
  /** Connection, model, effort, profile, access, folder and credentials; another value starts anew. */
  readonly fingerprint: string;
}

/** What a new native session starts with. */
export interface PicaAcpPoolStart {
  /** Lives as long as the session, not as the job that starts it. */
  readonly signal: AbortSignal;
  readonly listener: AcpSessionListener;
  /** The MCP credential of the session; `null` for a runner without the bridge. */
  readonly channel: PicaBridgeMcpChannel | null;
  /**
   * The observer the native session reports to: it keeps the agent session
   * identifier for the resume after the idle time and passes it on to the
   * job (PAGE-376).
   */
  readonly observer: PlanSessionObserver;
}

/** How a job asks the pool for its chat session. */
export interface PicaAcpPoolOpening {
  readonly session: PicaAcpPoolSession;
  readonly prepare?: (afterSequence: number | null) => Promise<number>;
  /** The stop, the deadline and the shutdown of the job. */
  readonly signal: AbortSignal;
  readonly observer: PlanSessionObserver;
  readonly listener: AcpSessionListener;
  /** Opens or binds the bridge credential of the session; absent for a runner without the bridge. */
  readonly bridge?: {
    readonly open: () => PicaBridgeMcpChannel;
    readonly attach: (channel: PicaBridgeMcpChannel) => void;
  };
  /** Starts a native session through the scheduler; its first turn answers the job. */
  readonly start: (start: PicaAcpPoolStart) => Promise<{
    readonly session: PlanSession;
    readonly instanceId: string;
  }>;
  /** The turn a resting session answers the job with. */
  readonly turn: () => AgentPlanExecutionInput;
}

/** What the pool runs on. */
export interface PicaAcpSessionPoolOptions {
  /**
   * The idle time of a resting session of an agent, from the settings of the
   * agent and the instance; read for every rest (PAGE-376).
   */
  readonly idleMinutes: (agentId: string) => Promise<number>;
  readonly now?: () => Date;
}

interface PoolEntry {
  readonly session: PicaAcpPoolSession;
  readonly controller: AbortController;
  readonly listener: PicaAcpPooledListener;
  readonly channel: PicaBridgeMcpChannel | null;
  native: PlanSession | null;
  throughSequence: number | null;
  instanceId: string;
  /** The identifier of the agent session, for the job that reuses the process. */
  acpSessionId: string | null;
  /** Releases of the workspace that wait for the end of the process. */
  readonly releases: Array<() => Promise<void>>;
  isLent: boolean;
  isEnding: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastActivityAt: Date;
  ending: Promise<void> | null;
}

/** Aborts the session with the job while the job holds it. */
function linkSignal(
  signal: AbortSignal,
  controller: AbortController,
): () => void {
  const abort = (): void => controller.abort(signal.reason);
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

/**
 * One native ACP session per agent and conversation (PAGE-335).
 *
 * @remarks
 * A job of an agent employee answers its round through the session of its
 * chat: a resting session takes the round as its next turn, otherwise a new
 * one starts through the scheduler, with the transcript the job gives it.
 * Rounds of one chat already run one after another, so a session serves one
 * job at a time. After its job the session rests and ends after the idle time
 * of the agent settings, which releases its lease; a stop, a failed turn, a
 * changed configuration or the end of its process end it at once. A waiting
 * start at the instance limit takes the place of the longest resting one.
 */
export class PicaAcpSessionPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly options: PicaAcpSessionPoolOptions;
  private reclaiming: Promise<void> | null = null;

  public constructor(options: PicaAcpSessionPoolOptions) {
    this.options = options;
  }

  /**
   * Gives the job the session of its chat, with the turn of its round running.
   *
   * @throws {PicaAcpJobError} `general` while another job holds the session.
   */
  public async open(opening: PicaAcpPoolOpening): Promise<PlanSession> {
    const { chatSessionId, fingerprint } = opening.session;
    const existing = this.entries.get(chatSessionId);
    if (existing?.isLent) throw new PicaAcpJobError("general");
    if (
      existing?.native &&
      !existing.isEnding &&
      existing.session.fingerprint === fingerprint
    )
      return this.reuse(existing, existing.native, opening);
    if (existing) await this.end(existing);
    return this.startNew(opening);
  }

  /** Ends the native cwd owner before workspace deletion, refusing an unconfirmed closeout. */
  public async closeForWorkspace(chatSessionId: string): Promise<void> {
    const entry = this.entries.get(chatSessionId);
    if (!entry) return;
    entry.isEnding = true;
    this.clearTimer(entry);
    const closed = await entry.native?.close();
    if (closed && !closed.isConfirmed) throw new AcpCleanupUnconfirmedError();
    this.forget(entry);
  }

  /**
   * Hands the release of a chat's workspace to its resting process.
   *
   * @remarks
   * A resting process still owns its working directory, and its next round
   * continues in it. The directory goes away only when the process ends.
   *
   * @returns Whether the process rests and took over the release; otherwise
   * the caller releases the workspace itself.
   */
  public keepWorkspace(
    chatSessionId: string,
    release: () => Promise<void>,
  ): boolean {
    const entry = this.entries.get(chatSessionId);
    if (!entry?.native || entry.isLent || entry.isEnding) return false;
    entry.releases.push(release);
    return true;
  }

  /** Ends the session of a chat, such as before the chat is deleted. */
  public async close(chatSessionId: string): Promise<void> {
    const entry = this.entries.get(chatSessionId);
    if (entry) await this.end(entry);
  }

  /** Ends every session, for the shutdown of the service. */
  public async closeAll(): Promise<void> {
    await Promise.allSettled(
      [...this.entries.values()].map((entry) => this.end(entry)),
    );
  }

  /**
   * Ends the longest resting session so a waiting start gets its place.
   *
   * @returns Whether one ends now; `false` while an earlier one still ends.
   */
  public reclaimIdle(): boolean {
    if (this.reclaiming) return false;
    const [oldest] = [...this.entries.values()]
      .filter((entry) => !entry.isLent && !entry.isEnding && entry.native)
      .sort(
        (first, second) =>
          first.lastActivityAt.getTime() - second.lastActivityAt.getTime(),
      );
    if (!oldest) return false;
    this.reclaiming = this.end(oldest).finally(() => {
      this.reclaiming = null;
    });
    return true;
  }

  /**
   * Whether a chat has a live process.
   *
   * @returns `busy` while a job holds it, `idle` while it waits for the next
   * round, `null` without a process.
   */
  public stateOf(chatSessionId: string): "busy" | "idle" | null {
    const entry = this.entries.get(chatSessionId);
    if (!entry?.native || entry.isEnding) return null;
    return entry.isLent ? "busy" : "idle";
  }

  /** The sessions the agents hold now, for the resource view. */
  public describe(): readonly AcpChatSessionView[] {
    return [...this.entries.values()]
      .filter((entry) => entry.native !== null && !entry.isEnding)
      .map((entry) => ({
        instanceId: entry.instanceId,
        agentId: entry.session.agentId,
        agentName: entry.session.agentName,
        conversation: entry.session.conversation,
        state: entry.isLent ? ("busy" as const) : ("idle" as const),
        lastActivityAt: entry.lastActivityAt.toISOString(),
      }));
  }

  private async startNew(opening: PicaAcpPoolOpening): Promise<PlanSession> {
    const entry: PoolEntry = {
      session: opening.session,
      controller: new AbortController(),
      listener: new PicaAcpPooledListener(opening.listener),
      channel: opening.bridge?.open() ?? null,
      native: null,
      throughSequence: null,
      instanceId: "",
      acpSessionId: null,
      releases: [],
      isLent: true,
      isEnding: false,
      timer: null,
      lastActivityAt: this.now(),
      ending: null,
    };
    this.entries.set(opening.session.chatSessionId, entry);
    const unlink = linkSignal(opening.signal, entry.controller);
    try {
      entry.throughSequence = (await opening.prepare?.(null)) ?? null;
      const started = await opening.start({
        signal: entry.controller.signal,
        listener: entry.listener,
        channel: entry.channel,
        observer: this.identifying(entry, opening.observer),
      });
      entry.native = started.session;
      entry.instanceId = started.instanceId;
      void started.session.terminated?.then(() => this.forget(entry));
      return this.lend(entry, started.session, {
        turn: started.session.turn,
        unlink,
      });
    } catch (error: unknown) {
      unlink();
      this.forget(entry);
      throw error;
    }
  }

  private async reuse(
    entry: PoolEntry,
    native: PlanSession,
    opening: PicaAcpPoolOpening,
  ): Promise<PlanSession> {
    if (!native.next) throw new PicaAcpJobError("general");
    this.clearTimer(entry);
    entry.isLent = true;
    entry.lastActivityAt = this.now();
    // The job saves the agent session through its last message, so the resume after the idle time finds it.
    if (entry.acpSessionId !== null)
      opening.observer.identified(entry.acpSessionId);
    entry.listener.attach(opening.listener);
    if (entry.channel) opening.bridge?.attach(entry.channel);
    const unlink = linkSignal(opening.signal, entry.controller);
    try {
      entry.throughSequence =
        (await opening.prepare?.(entry.throughSequence)) ??
        entry.throughSequence;
      return this.lend(entry, native, {
        turn: native.next(opening.turn(), opening.signal, opening.observer),
        unlink,
      });
    } catch (error: unknown) {
      unlink();
      await this.end(entry);
      throw error;
    }
  }

  /** The session as the job sees it: closing it lets the session rest instead of ending it. */
  private lend(
    entry: PoolEntry,
    native: PlanSession,
    lending: {
      readonly turn: Promise<PlanSessionTurn>;
      readonly unlink: () => void;
    },
  ): PlanSession {
    let isHealthy = true;
    let closing: Promise<PlanSessionClosed> | null = null;
    const observe = async (
      pending: Promise<PlanSessionTurn>,
    ): Promise<PlanSessionTurn> => {
      try {
        const result = await pending;
        if (result.failure !== null || result.errorCode !== null)
          isHealthy = false;
        return result;
      } catch (error: unknown) {
        isHealthy = false;
        throw error;
      } finally {
        entry.lastActivityAt = this.now();
      }
    };
    const giveBack = async (): Promise<PlanSessionClosed> => {
      lending.unlink();
      entry.listener.detach();
      entry.isLent = false;
      entry.lastActivityAt = this.now();
      if (!isHealthy || entry.controller.signal.aborted || entry.isEnding)
        return this.endNow(entry, native);
      await this.rest(entry);
      return {
        exit: null,
        endedAt: entry.lastActivityAt.toISOString(),
        leftovers: 0,
        isConfirmed: true,
      };
    };
    const lent: PlanSession = {
      turn: observe(lending.turn),
      terminated: native.terminated,
      close: () => {
        closing ??= giveBack();
        return closing;
      },
    };
    return this.forward(lent, native, observe);
  }

  private forward(
    lent: PlanSession,
    native: PlanSession,
    observe: (pending: Promise<PlanSessionTurn>) => Promise<PlanSessionTurn>,
  ): PlanSession {
    const { next, steer, interrupt, cancelTool } = native;
    return {
      ...lent,
      ...(next
        ? {
            next: (
              input: AgentPlanExecutionInput,
              signal: AbortSignal,
              observer: PlanSessionObserver,
            ) => observe(next.call(native, input, signal, observer)),
          }
        : {}),
      ...(steer
        ? {
            steer: (
              prompt: readonly ContentBlock[],
            ): Promise<AcpSteerOutcome> => steer.call(native, prompt),
          }
        : {}),
      ...(interrupt ? { interrupt: () => interrupt.call(native) } : {}),
      ...(cancelTool
        ? { cancelTool: (note: string) => cancelTool.call(native, note) }
        : {}),
    };
  }

  /** The observer of a new native session: it remembers the agent session identifier. */
  private identifying(
    entry: PoolEntry,
    observer: PlanSessionObserver,
  ): PlanSessionObserver {
    return {
      ...observer,
      identified: (sessionId) => {
        entry.acpSessionId = sessionId;
        observer.identified(sessionId);
      },
    };
  }

  /** Starts the idle time; a failed read of the settings keeps the default. */
  private async rest(entry: PoolEntry): Promise<void> {
    let minutes = AGENT_CHAT_IDLE_DEFAULT_MINUTES;
    try {
      minutes = await this.options.idleMinutes(entry.session.agentId);
    } catch (error: unknown) {
      logCaughtError("PicaAcpSessionPool", error);
    }
    if (entry.isLent || entry.isEnding) return;
    this.clearTimer(entry);
    entry.timer = setTimeout(() => {
      if (!entry.isLent) void this.end(entry);
    }, minutes * MILLISECONDS_PER_MINUTE);
    entry.timer.unref();
  }

  /** Ends a session its job cannot hand on, with the closeout the job reports. */
  private async endNow(
    entry: PoolEntry,
    native: PlanSession,
  ): Promise<PlanSessionClosed> {
    entry.isEnding = true;
    this.clearTimer(entry);
    try {
      return await native.close();
    } finally {
      this.forget(entry);
    }
  }

  /** Ends a session once; its lease is released by its own closeout. */
  private end(entry: PoolEntry): Promise<void> {
    entry.ending ??= this.endOnce(entry);
    return entry.ending;
  }

  private async endOnce(entry: PoolEntry): Promise<void> {
    entry.isEnding = true;
    this.clearTimer(entry);
    try {
      await entry.native?.close();
    } catch (error: unknown) {
      logCaughtError("PicaAcpSessionPool", error);
    } finally {
      this.forget(entry);
    }
  }

  /** Drops a session whose process ended, however it ended. */
  private forget(entry: PoolEntry): void {
    entry.isEnding = true;
    this.clearTimer(entry);
    entry.channel?.close();
    if (this.entries.get(entry.session.chatSessionId) === entry)
      this.entries.delete(entry.session.chatSessionId);
    const releases = entry.releases.splice(0);
    void Promise.allSettled(releases.map((release) => release())).then(
      (outcomes) => {
        for (const outcome of outcomes)
          if (outcome.status === "rejected")
            logCaughtError("PicaAcpSessionPool", outcome.reason);
      },
    );
  }

  private clearTimer(entry: PoolEntry): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
