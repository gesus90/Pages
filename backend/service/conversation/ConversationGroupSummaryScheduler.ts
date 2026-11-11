import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";
import { CONVERSATION_SUMMARY_LIMITS } from "@/definition/ConversationObserver";

import type { ConversationEvents } from "./ConversationEvents";
import type { ConversationGroupSummaries } from "./ConversationGroupSummaries";

const COMPONENT = "ConversationGroupSummaryScheduler";

/**
 * Runs the summaries of groups in the background of the Pages process
 * (PAGE-296), every five minutes, with no browser open and no job of the
 * operating system.
 *
 * @remarks
 * Every tick starts from the stored state, so a restart goes on where the
 * last summary ended. A tick that is still running is not started twice. A
 * changed message of a group, such as a recognized voice message, checks
 * the stored summaries at once; the summaries themselves post no message,
 * so they cause no notification and no answer.
 */
export class ConversationGroupSummaryScheduler {
  private readonly summaries: Pick<
    ConversationGroupSummaries,
    "runDue" | "invalidateChanged"
  >;
  private readonly events: Pick<ConversationEvents, "subscribe">;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private tick: Promise<void> | null = null;

  public constructor(
    summaries: Pick<ConversationGroupSummaries, "runDue" | "invalidateChanged">,
    events: Pick<ConversationEvents, "subscribe">,
  ) {
    this.summaries = summaries;
    this.events = events;
  }

  /** Starts the ticks and the check of changed messages; a second call changes nothing. */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runDue();
    }, CONVERSATION_SUMMARY_LIMITS.intervalMilliseconds);
    this.timer.unref();
    this.unsubscribe = this.events.subscribe((event) => {
      if (event.kind !== "message_updated") return;
      void withBackgroundDatabaseWork("conversation_summary_check", () =>
        this.summaries.invalidateChanged(),
      ).catch((error: unknown) => {
        logCaughtError(COMPONENT, error);
      });
    });
  }

  /** Stops the ticks and waits for a running one. */
  public async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.tick;
  }

  /** Runs one tick unless one runs already. */
  public runDue(): Promise<void> {
    this.tick ??= withBackgroundDatabaseWork("conversation_summaries", () =>
      this.summaries.runDue(),
    )
      .catch((error: unknown) => {
        logCaughtError(COMPONENT, error);
      })
      .finally(() => {
        this.tick = null;
      });
    return this.tick;
  }
}
