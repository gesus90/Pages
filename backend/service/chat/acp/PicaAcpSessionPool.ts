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
  AgentPlanSessionInput,
  PlanSession,
  PlanSessionClosed,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type {
  ConversationRelease,
  ConversationReleaseReason,
  ConversationRunnerSession,
  ConversationSessionOwner,
  ConversationSessionRunner,
} from "@/backend/agents/ConversationSessionRunner";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AcpChatSessionView } from "@/definition/AcpResource";
import type { PicaBridgeMcpChannel } from "./PicaBridge";

const MILLISECONDS_PER_MINUTE = 60_000;

/** What a new native session of the pool starts with. */
export interface PicaAcpPoolInput {
  /** Reports to the job that holds the session; it outlives the job that starts it. */
  readonly listener: AcpSessionListener;
  /** The MCP credential of the session; `null` for a runner without the bridge. */
  readonly channel: PicaBridgeMcpChannel | null;
}

/** How a job asks the pool for its chat session. */
export interface PicaAcpPoolOpening {
  /** The agent, the conversation and the configuration the session answers for. */
  readonly session: ConversationSessionOwner;
  readonly prepare?: (afterSequence: number | null) => Promise<number>;
  /** The stop, the deadline and the shutdown of the job. */
  readonly signal: AbortSignal;
  /**
   * The observer of the job: it hears the native session identifier, which the
   * pool also passes on to the next job for the resume after the idle time.
   */
  readonly observer: PlanSessionObserver;
  readonly listener: AcpSessionListener;
  /** Opens or binds the bridge credential of the session; absent for a runner without the bridge. */
  readonly bridge?: {
    readonly open: () => PicaBridgeMcpChannel;
    readonly attach: (channel: PicaBridgeMcpChannel) => void;
  };
  /** The native session and first round of a new session, built with the listener and credential of the pool. */
  readonly input: (start: PicaAcpPoolInput) => AgentPlanSessionInput;
  /** The turn a resting session answers the job with. */
  readonly turn: () => AgentPlanExecutionInput;
}

/** What the pool runs on. */
export interface PicaAcpSessionPoolOptions {
  /** Starts, continues and releases the native sessions. */
  readonly runner: ConversationSessionRunner;
  /**
   * The idle time of a resting session of an agent, from the settings of the
   * agent and the instance; read for every rest.
   */
  readonly idleMinutes: (agentId: string) => Promise<number>;
  readonly now?: () => Date;
}

interface PoolEntry {
  readonly session: ConversationSessionOwner;
  readonly controller: AbortController;
  readonly listener: PicaAcpPooledListener;
  readonly channel: PicaBridgeMcpChannel | null;
  native: ConversationRunnerSession | null;
  throughSequence: number | null;
  instanceId: string;
  /** Releases of the workspace that wait for the confirmed end of the process. */
  readonly releases: Array<() => Promise<void>>;
  isLent: boolean;
  isEnding: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastActivityAt: Date;
  /** The release in progress; empty again after one that could not be confirmed, so it can be retried. */
  releasing: Promise<ConversationRelease> | null;
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

/** What the job reads of a release: whether its process is gone. */
function closedOf(release: ConversationRelease): PlanSessionClosed {
  return {
    exit: release.exit,
    endedAt: release.endedAt,
    leftovers: release.leftovers,
    isConfirmed: release.isConfirmed,
  };
}

/**
 * Refuses a bridge credential that was not issued to the agent and the
 * conversation of the session.
 * @throws {PicaAcpJobError} `general` for a credential of anyone else.
 */
function requireOwnChannel(
  channel: PicaBridgeMcpChannel | null,
  session: ConversationSessionOwner,
): void {
  if (
    channel &&
    (channel.owner.agentId !== session.agentId ||
      channel.owner.conversationId !== session.conversationId)
  )
    throw new PicaAcpJobError("general");
}

/**
 * One native ACP session per agent and conversation, kept through the
 * conversation session contract of the runner.
 * @remarks
 * A job of an agent employee answers its round through the session of its
 * chat: a resting session takes the round as its next round, otherwise a new
 * one starts through the runner, with the transcript the job gives it, and
 * resumes the stored native session when the job names it. Rounds of one chat
 * already run one after another, so a session serves one job at a time. After
 * its job the session rests and is released after the idle time of the agent
 * settings. A stop, a failed turn, a changed configuration or agent, a
 * working folder that goes away, a waiting start at the instance limit and
 * the end of its process release it at once. A release revokes the bridge
 * credential first and frees the working folder and the place of a new
 * session only after the runner confirmed that the process is gone; a release
 * that could not be confirmed keeps the entry, refuses a new session of the
 * conversation and is tried again by the next release.
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
   * @throws {PicaAcpJobError} `general` while another job holds the session.
   * @throws {AcpCleanupUnconfirmedError} While the process of the earlier
   * session of the conversation is not confirmed gone.
   */
  public async open(opening: PicaAcpPoolOpening): Promise<PlanSession> {
    const { conversationId, agentId, fingerprint } = opening.session;
    const existing = this.entries.get(conversationId);
    if (existing?.isLent) throw new PicaAcpJobError("general");
    if (
      existing?.native &&
      !existing.isEnding &&
      existing.session.agentId === agentId &&
      existing.session.fingerprint === fingerprint
    )
      return this.reuse(existing, existing.native, opening);
    if (existing) {
      const reason: ConversationReleaseReason = existing.isEnding
        ? "reconnect"
        : "configuration";
      const release = await this.release(existing, reason);
      if (!release.isConfirmed) throw new AcpCleanupUnconfirmedError();
    }
    return this.startNew(opening);
  }

  /**
   * Ends the native cwd owner before workspace deletion.
   * @throws {AcpCleanupUnconfirmedError} When the release is not confirmed.
   */
  public async closeForWorkspace(conversationId: string): Promise<void> {
    const entry = this.entries.get(conversationId);
    if (!entry) return;
    const release = await this.release(entry, "workspace");
    if (!release.isConfirmed) throw new AcpCleanupUnconfirmedError();
  }

  /**
   * Hands the release of a chat's workspace to its resting process.
   * @remarks
   * A resting process still owns its working directory, and its next round
   * continues in it. The directory goes away only when the process ends.
   * @returns Whether the process rests and took over the release; otherwise
   * the caller releases the workspace itself.
   */
  public keepWorkspace(
    conversationId: string,
    release: () => Promise<void>,
  ): boolean {
    const entry = this.entries.get(conversationId);
    if (!entry?.native || entry.isLent || entry.isEnding) return false;
    entry.releases.push(release);
    return true;
  }

  /**
   * Ends every session of an agent whose access level changed.
   * @param agentId - The agent whose sessions end.
   * @throws {AcpCleanupUnconfirmedError} When the end of a resting process is not confirmed.
   * @remarks
   * A resting session ends now, with its process, its children and its MCP
   * servers, and its bridge credential closes. A session that still runs a
   * round finishes that round with the meaning it started with and then ends
   * instead of resting, so no later round continues it with its earlier
   * rights.
   */
  public async closeForAgent(agentId: string): Promise<void> {
    const entries = [...this.entries.values()].filter(
      (entry) => entry.session.agentId === agentId,
    );
    const resting = entries.filter((entry) => {
      if (!entry.isLent) return true;
      entry.isEnding = true;
      return false;
    });
    const closed = await Promise.all(
      resting.map(async (entry) =>
        entry.native ? this.release(entry, "configuration") : null,
      ),
    );
    if (closed.some((outcome) => outcome !== null && !outcome.isConfirmed))
      throw new AcpCleanupUnconfirmedError();
  }

  /**
   * Ends the session of a chat, such as before the chat is deleted.
   * @throws {AcpCleanupUnconfirmedError} When the release is not confirmed, so
   * the caller keeps what the process may still use.
   */
  public async close(conversationId: string): Promise<void> {
    const entry = this.entries.get(conversationId);
    if (!entry) return;
    const release = await this.release(entry, "deletion");
    if (!release.isConfirmed) throw new AcpCleanupUnconfirmedError();
  }

  /** Releases every session, for the shutdown of the service. */
  public async closeAll(): Promise<void> {
    await Promise.allSettled(
      [...this.entries.values()].map((entry) =>
        this.release(entry, "shutdown"),
      ),
    );
  }

  /**
   * Ends the longest resting session so a waiting start gets its place.
   * @remarks
   * A session whose release could not be confirmed is asked again, after the
   * resting ones, because only a confirmed end frees its place.
   * @returns Whether one ends now; `false` while an earlier one still ends.
   */
  public reclaimIdle(): boolean {
    if (this.reclaiming) return false;
    const [oldest] = [...this.entries.values()]
      .filter(
        (entry) => !entry.isLent && entry.native && entry.releasing === null,
      )
      .sort(
        (first, second) =>
          Number(first.isEnding) - Number(second.isEnding) ||
          first.lastActivityAt.getTime() - second.lastActivityAt.getTime(),
      );
    if (!oldest) return false;
    this.reclaiming = this.release(oldest, "capacity")
      .then(() => undefined)
      .finally(() => {
        this.reclaiming = null;
      });
    return true;
  }

  /**
   * Whether a chat has a live process.
   * @returns `busy` while a job holds it, `idle` while it waits for the next
   * round, `null` without a process.
   */
  public stateOf(conversationId: string): "busy" | "idle" | null {
    const entry = this.entries.get(conversationId);
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
    const channel = opening.bridge?.open() ?? null;
    const entry: PoolEntry = {
      session: opening.session,
      controller: new AbortController(),
      listener: new PicaAcpPooledListener(opening.listener),
      channel,
      native: null,
      throughSequence: null,
      instanceId: "",
      releases: [],
      isLent: true,
      isEnding: false,
      timer: null,
      lastActivityAt: this.now(),
      releasing: null,
    };
    this.entries.set(opening.session.conversationId, entry);
    const unlink = linkSignal(opening.signal, entry.controller);
    try {
      requireOwnChannel(channel, opening.session);
      entry.throughSequence = (await opening.prepare?.(null)) ?? null;
      const opened = await this.options.runner.open({
        owner: opening.session,
        input: opening.input({ listener: entry.listener, channel }),
        signal: entry.controller.signal,
        observer: opening.observer,
        bridge: channel,
      });
      entry.native = opened.session;
      entry.instanceId = opened.session.instanceId;
      void opened.session.exited.then((release) =>
        this.settleExit(entry, release),
      );
      return this.lend(entry, opened.session, {
        turn: opened.firstRound,
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
    native: ConversationRunnerSession,
    opening: PicaAcpPoolOpening,
  ): Promise<PlanSession> {
    this.clearTimer(entry);
    entry.isLent = true;
    entry.lastActivityAt = this.now();
    const unlink = linkSignal(opening.signal, entry.controller);
    try {
      // The job saves the agent session through its last message, so the resume after the idle time finds it.
      const nativeSessionId = native.nativeSessionId();
      if (nativeSessionId !== null)
        opening.observer.identified(nativeSessionId);
      entry.listener.attach(opening.listener);
      // The credential of the session goes to this job and its running turn only.
      if (entry.channel) opening.bridge?.attach(entry.channel);
      entry.throughSequence =
        (await opening.prepare?.(entry.throughSequence)) ??
        entry.throughSequence;
      return this.lend(entry, native, {
        turn: native.round(opening.turn(), opening.signal, opening.observer),
        unlink,
      });
    } catch (error: unknown) {
      unlink();
      entry.listener.detach();
      entry.isLent = false;
      await this.release(entry, "failure");
      throw error;
    }
  }

  /** The session as the job sees it: closing it lets the session rest instead of ending it. */
  private lend(
    entry: PoolEntry,
    native: ConversationRunnerSession,
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
      const isStopped = entry.controller.signal.aborted;
      if (!isHealthy || isStopped || entry.isEnding)
        return closedOf(
          await this.release(entry, isStopped ? "stop" : "failure"),
        );
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
      close: () => {
        closing ??= giveBack();
        return closing;
      },
    };
    return this.forward(lent, native, observe);
  }

  private forward(
    lent: PlanSession,
    native: ConversationRunnerSession,
    observe: (pending: Promise<PlanSessionTurn>) => Promise<PlanSessionTurn>,
  ): PlanSession {
    const { steer, interrupt, cancelTool } = native;
    return {
      ...lent,
      next: (
        input: AgentPlanExecutionInput,
        signal: AbortSignal,
        observer: PlanSessionObserver,
      ) => observe(native.round(input, signal, observer)),
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
      if (!entry.isLent) void this.release(entry, "idle");
    }, minutes * MILLISECONDS_PER_MINUTE);
    entry.timer.unref();
  }

  /**
   * Releases a session once; the entry and its folder go only with a confirmed end.
   * @remarks
   * The bridge credential is revoked first, whatever the outcome, so the agent
   * loses the Pages tools before its process is confirmed gone. An unconfirmed
   * release keeps the entry and its folder releases, and the next call asks
   * the runner again. A session that has not started its process yet has
   * nothing to confirm; the start that still runs releases the process when
   * its job gives the session back.
   */
  private release(
    entry: PoolEntry,
    reason: ConversationReleaseReason,
  ): Promise<ConversationRelease> {
    entry.isEnding = true;
    this.clearTimer(entry);
    entry.channel?.close();
    const { native } = entry;
    if (!native) return Promise.resolve(this.record(reason, true));
    entry.releasing ??= this.releaseOnce(entry, native, reason);
    return entry.releasing;
  }

  private async releaseOnce(
    entry: PoolEntry,
    native: ConversationRunnerSession,
    reason: ConversationReleaseReason,
  ): Promise<ConversationRelease> {
    let release: ConversationRelease;
    try {
      release = await native.release(reason);
    } catch (error: unknown) {
      // The runner never rejects; a session that does is not provably gone.
      logCaughtError("PicaAcpSessionPool", error);
      release = this.record(reason, false);
    }
    if (release.isConfirmed) this.forget(entry);
    else entry.releasing = null;
    return release;
  }

  private record(
    reason: ConversationReleaseReason,
    isConfirmed: boolean,
  ): ConversationRelease {
    return {
      reason,
      exit: null,
      endedAt: this.now().toISOString(),
      leftovers: 0,
      isConfirmed,
    };
  }

  /** A process that ended on its own was closed out by the runner; free the entry once that is confirmed. */
  private settleExit(entry: PoolEntry, release: ConversationRelease): void {
    entry.isEnding = true;
    this.clearTimer(entry);
    entry.channel?.close();
    if (release.isConfirmed) this.forget(entry);
  }

  /** Drops a session whose process is confirmed gone, however it ended. */
  private forget(entry: PoolEntry): void {
    entry.isEnding = true;
    this.clearTimer(entry);
    entry.channel?.close();
    if (this.entries.get(entry.session.conversationId) === entry)
      this.entries.delete(entry.session.conversationId);
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
