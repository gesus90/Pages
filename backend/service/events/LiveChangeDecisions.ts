import { isResyncEvent } from "@/backend/service/events/LiveChangeAudience";
import { isPagesEventType } from "@/backend/service/events/PagesEventPublisher";
import { PAGES_CORE_CONTRACT_VERSION } from "@/definition/PagesCoreContract";

import type { LiveChangeAudience } from "@/backend/service/events/LiveChangeAudience";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type {
  PagesCoreDecision,
  PagesCoreLiveRequest,
  PagesCoreLiveResponse,
  PagesCoreOutboxEvent,
  PagesCoreSessionAnswer,
} from "@/definition/PagesCoreContract";
import type { User } from "@/definition/User";

/** Sessions decided at the same time; each one reads its account and rights. */
const PARALLEL_SESSIONS = 8;

/** The reads the decisions of `pages-core` are made with. */
export interface LiveChangeDecisionDependencies {
  readonly audience: Pick<LiveChangeAudience, "notice">;
  /**
   * Reads the account and the session binding of a browser's `Cookie` header;
   * `null` when no session holds.
   */
  readonly readSession: (cookie: string) => Promise<LiveSession | null>;
  /** The account's authorization fingerprint, as `/account-version` reports it. */
  readonly authorizationVersion: (user: User) => Promise<string>;
}

/** The account behind a stream and the binding of its session. */
export interface LiveSession {
  readonly user: User;
  /** Stable per session, names nobody; see {@link PagesCoreSessionAnswer}. */
  readonly binding: string;
}

interface PositionedEvent {
  readonly position: number;
  readonly event: PagesEvent;
}

/** An outbox row of a kind this version does not know decides nothing. */
function toPositionedEvent(
  stored: PagesCoreOutboxEvent,
): PositionedEvent | null {
  if (!isPagesEventType(stored.kind)) return null;
  const event: PagesEvent = stored.audience
    ? { type: stored.kind, id: stored.id, audience: stored.audience }
    : { type: stored.kind, id: stored.id };
  return { position: stored.position, event };
}

/**
 * Answers `pages-core`: which session may learn about which outbox event (PAGE-237).
 *
 * @remarks
 * The core holds the streams and knows no business rule; every decision is
 * made here with the same rules as the in-process live view: the session is
 * read again for every request, an ended session or one that must change its
 * password ends its streams, and every event is decided with the account's
 * current rights. A purged page or changed project access becomes `resync`,
 * which names nothing. A failed rights read hides the event.
 */
export class LiveChangeDecisions {
  private readonly dependencies: LiveChangeDecisionDependencies;

  /**
   * Creates the decisions.
   *
   * @param dependencies - Session, fingerprint and rights reads.
   */
  public constructor(dependencies: LiveChangeDecisionDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Decides every asked session about every event of a request.
   *
   * @param request - A request validated against contract v1.
   * @returns One answer per session, in the order asked.
   * @throws When an account or its fingerprint cannot be read; the core then
   * delivers nothing.
   */
  public async decide(
    request: PagesCoreLiveRequest,
  ): Promise<PagesCoreLiveResponse> {
    const events = request.events
      .map(toPositionedEvent)
      .filter((event) => event !== null);
    const sessions: PagesCoreSessionAnswer[] = [];
    for (
      let index = 0;
      index < request.sessions.length;
      index += PARALLEL_SESSIONS
    ) {
      const group = request.sessions.slice(index, index + PARALLEL_SESSIONS);
      sessions.push(
        ...(await Promise.all(
          group.map((session) => this.decideSession(session, events)),
        )),
      );
    }
    return { contract: PAGES_CORE_CONTRACT_VERSION, sessions };
  }

  private async decideSession(
    session: PagesCoreLiveRequest["sessions"][number],
    events: readonly PositionedEvent[],
  ): Promise<PagesCoreSessionAnswer> {
    const live = await this.dependencies.readSession(session.cookie);
    if (!live || live.user.mustChangePassword)
      return { key: session.key, status: "ended" };
    const { user, binding } = live;
    const version = await this.dependencies.authorizationVersion(user);
    const decisions: PagesCoreDecision[] = [];
    for (const { position, event } of events) {
      if (isResyncEvent(event.type)) {
        decisions.push({ position, notice: "resync" });
        continue;
      }
      const change = await this.dependencies.audience.notice(user, event);
      if (change) decisions.push({ position, notice: "change", change });
    }
    return { key: session.key, status: "active", version, binding, decisions };
  }
}
