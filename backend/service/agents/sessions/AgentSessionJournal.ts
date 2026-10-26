import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { sanitizePlanOutput } from "@/backend/service/agents/AgentPlanOutput";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";

import type {
  AgentSessionEvent,
  AgentSessionEventKind,
  AgentSessionEventPage,
  AgentSessionHistoryWindow,
} from "@/definition/AgentSessionJournal";
import type {
  AgentSessionStore,
  NewAgentSessionEvent,
} from "./AgentSessionStore";

/** The longest text one event keeps; tool output beyond it is cut and marked. */
export const MAXIMUM_EVENT_TEXT = 4_000;
/** Events kept per attempt; older ones are removed and the history says from where it is complete. */
export const RETAINED_EVENTS = 2_000;
/** The largest page a reader gets at once. */
export const MAXIMUM_PAGE = 200;

/** What a caller reports; the journal redacts, shortens and numbers it. */
export interface AgentSessionEventInput {
  readonly turn: number | null;
  readonly kind: AgentSessionEventKind;
  readonly text: string;
  /** Drops a second report of the same fact, such as a repeated tool result. */
  readonly dedupeKey?: string;
}

/** Receives the events of an attempt in sequence order, each once. */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

interface JournalOptions {
  /** Masks secrets the generic redaction does not know, such as a project credential. */
  readonly redact?: (text: string) => string;
  readonly clock?: () => string;
}

interface Follower {
  readonly listener: AgentSessionEventListener;
  /** The highest sequence the follower received; later events with a lower one are dropped. */
  delivered: number;
  /** Live events that arrived while the stored ones were still being read. */
  buffer: AgentSessionEvent[] | null;
}

/**
 * The structured history of PageAgentCLI sessions: ordered, redacted, bounded and readable after restarts.
 *
 * @remarks
 * Events of one attempt are appended one batch after another, so their
 * sequences follow the order of the calls. A follower first reads what is
 * stored after its cursor and then receives new events; the sequence it
 * received last drops every duplicate, so a reconnect with the last cursor
 * neither repeats nor loses an event. Following reads only the journal: it
 * starts no process and keeps none open.
 */
export class AgentSessionJournal {
  private readonly store: AgentSessionStore;
  private readonly redact: (text: string) => string;
  private readonly clock: () => string;
  private readonly queues = new Map<string, SerialQueue>();
  private readonly followers = new Map<string, Set<Follower>>();

  public constructor(store: AgentSessionStore, options: JournalOptions = {}) {
    this.store = store;
    this.redact = options.redact ?? ((text) => text);
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  /**
   * Stores events of one attempt in the order given and passes them to its followers.
   *
   * @returns The stored events; a dropped duplicate is not among them.
   */
  public async append(
    attemptId: string,
    inputs: readonly AgentSessionEventInput[],
  ): Promise<readonly AgentSessionEvent[]> {
    const events = inputs.map((input) => this.prepare(input));
    const stored = await this.queue(attemptId).run(() =>
      this.store.appendEvents(attemptId, events, RETAINED_EVENTS),
    );
    for (const event of stored) {
      withLogContext({ attemptId }, () =>
        logEvent({
          level:
            event.kind === "error" || event.kind === "tool_failed"
              ? "warn"
              : "debug",
          event: "agent.session.event",
          component: "AgentSessionJournal",
          message: "Agent session event persisted",
          metadata: { kind: event.kind, sequence: event.sequence },
        }),
      );
      this.publish(attemptId, event);
    }
    return stored;
  }

  /**
   * Reads stored events after a cursor.
   *
   * @param attemptId - The attempt, already authorized by the caller.
   * @param after - The last sequence the reader has; 0 reads from the start.
   * @param limit - At most this many events, up to {@link MAXIMUM_PAGE}.
   */
  public async page(
    attemptId: string,
    after: number,
    limit: number,
    window: Pick<AgentSessionHistoryWindow, "before" | "tail"> = {},
  ): Promise<AgentSessionEventPage> {
    const cursor = Number.isSafeInteger(after) && after > 0 ? after : 0;
    const size = Math.min(
      Math.max(Number.isSafeInteger(limit) ? limit : MAXIMUM_PAGE, 1),
      MAXIMUM_PAGE,
    );
    if (this.store.readWindow)
      return this.store.readWindow(attemptId, {
        ...window,
        after: cursor,
        limit: size,
      });
    const stored = await this.store.readEvents(attemptId, cursor, size + 1);
    const events = stored.events.slice(0, size);
    return {
      events,
      cursor: events.at(-1)?.sequence ?? (cursor === 0 ? null : cursor),
      hasMore: stored.events.length > size,
      retainedFrom: stored.retainedFrom,
      source: "journal",
    };
  }

  /**
   * Follows an attempt from a cursor: first the stored events after it, then every new one.
   *
   * @returns Ends the following; it holds no process or resource slot.
   */
  public async follow(
    attemptId: string,
    after: number,
    listener: AgentSessionEventListener,
  ): Promise<() => void> {
    const follower: Follower = { listener, delivered: after, buffer: [] };
    const followers = this.followers.get(attemptId) ?? new Set<Follower>();
    followers.add(follower);
    this.followers.set(attemptId, followers);
    const stop = (): void => {
      followers.delete(follower);
      if (followers.size === 0) this.followers.delete(attemptId);
    };
    try {
      await this.replay(attemptId, follower);
    } catch (error: unknown) {
      logCaughtError("AgentSessionJournal", error);

      stop();
      throw error;
    }
    return stop;
  }

  private async replay(attemptId: string, follower: Follower): Promise<void> {
    let page = await this.page(attemptId, follower.delivered, MAXIMUM_PAGE);
    for (;;) {
      for (const event of page.events) this.deliver(follower, event);
      if (!page.hasMore) break;
      page = await this.page(attemptId, follower.delivered, MAXIMUM_PAGE);
    }
    const buffered = follower.buffer ?? [];
    follower.buffer = null;
    for (const event of buffered) this.deliver(follower, event);
  }

  private publish(attemptId: string, event: AgentSessionEvent): void {
    for (const follower of this.followers.get(attemptId) ?? []) {
      if (follower.buffer) follower.buffer.push(event);
      else this.deliver(follower, event);
    }
  }

  private deliver(follower: Follower, event: AgentSessionEvent): void {
    if (event.sequence <= follower.delivered) return;
    follower.delivered = event.sequence;
    try {
      follower.listener(event);
    } catch (error: unknown) {
      logCaughtError("AgentSessionJournal", error);

      // A failing reader must not stop the session or the other readers.
      logDiagnostic(
        "AgentSessionJournal",
        "warn",
        "PageAgentCLI follower failed",
        error,
      );
    }
  }

  private prepare(input: AgentSessionEventInput): NewAgentSessionEvent {
    const redacted = sanitizePlanOutput(this.redact(input.text));
    const isTruncated =
      input.text.length > MAXIMUM_EVENT_TEXT ||
      redacted.length > MAXIMUM_EVENT_TEXT;
    return {
      turn: input.turn,
      kind: input.kind,
      text: redacted.slice(0, MAXIMUM_EVENT_TEXT),
      isTruncated,
      createdAt: this.clock(),
      dedupeKey: input.dedupeKey ?? null,
    };
  }

  private queue(attemptId: string): SerialQueue {
    const existing = this.queues.get(attemptId);
    if (existing) return existing;
    const created = new SerialQueue();
    this.queues.set(attemptId, created);
    return created;
  }
}
