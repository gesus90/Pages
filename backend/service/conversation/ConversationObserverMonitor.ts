import { observerFailure } from "@/backend/database/repositories/conversation/ConversationObserverRunRepository";

import type { ConversationObserverRunRepository } from "@/backend/database/repositories/conversation/ConversationObserverRunRepository";
import type {
  ConversationObserverHealth,
  ConversationObserverStatus,
} from "@/definition/ConversationObserver";

/** How many of a group's newest calls its status looks at. */
const STATUS_CALLS = 20;
/** The window of the administrators' observer health: the last 24 hours. */
const HEALTH_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Makes a failing group observer visible instead of a silent series of
 * failures (PAGE-340): to the members in the group context and to
 * administrators in the ACP resource view.
 *
 * @remarks
 * It reads only the stored outcome and stable error code of each call,
 * never a prompt, an answer or provider text. Callers check access.
 */
export class ConversationObserverMonitor {
  private readonly runs: Pick<
    ConversationObserverRunRepository,
    "latest" | "health"
  >;
  private readonly now: () => Date;

  public constructor(
    runs: Pick<ConversationObserverRunRepository, "latest" | "health">,
    now: () => Date = () => new Date(),
  ) {
    this.runs = runs;
    this.now = now;
  }

  /**
   * The observer status of one group.
   *
   * @param conversationId - A group whose membership the caller checked.
   */
  public async status(
    conversationId: string,
  ): Promise<ConversationObserverStatus> {
    const latest = await this.runs.latest(conversationId, STATUS_CALLS);
    const succeeded = latest.findIndex((run) => run.state === "succeeded");
    const consecutiveFailures = succeeded < 0 ? latest.length : succeeded;
    const newest = latest[0];
    return {
      consecutiveFailures,
      lastFailure:
        newest && consecutiveFailures > 0 ? observerFailure(newest) : null,
    };
  }

  /** The calls of all groups in the last 24 hours, for administrators only. */
  public health(): Promise<ConversationObserverHealth> {
    return this.runs.health(
      new Date(this.now().getTime() - HEALTH_WINDOW_MS).toISOString(),
    );
  }
}
