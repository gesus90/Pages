import { encodePicaMobileCalendar } from "./PicaMobileCalendarMessages";

import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { PicaMobilePlansHost } from "../plans/PicaMobilePlansHandler";
import type { PicaMobileCalendarProvider } from "./PicaMobileCalendarProvider";

/** Collects a burst of changes into one check and one `calendar_changed`. */
const GATHER_MILLISECONDS = 250;
/** Most distinct events one round checks; a storm beyond is cut off here. */
const MAXIMUM_PENDING_EVENTS = 256;

/**
 * Sends `calendar_changed` to one authenticated connection (PAGE-301).
 *
 * @remarks
 * Committed events that may change entries are gathered for a moment, then
 * checked behind the queued messages of the connection with the account's
 * current rights: only entries the account sees are named. An ended session
 * ends the connection, as a request would. Nothing of an entry but its id
 * leaves Pages here; the app reads the range again.
 */
export class PicaMobileCalendarFeed {
  private readonly provider: PicaMobileCalendarProvider;
  private readonly host: PicaMobilePlansHost;
  private readonly pending = new Map<string, PagesEvent>();
  private release: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private isStopped = false;

  /**
   * Creates the feed.
   *
   * @param provider - Hears the events and decides what the account sees.
   * @param host - The connection the feed sends on.
   */
  public constructor(
    provider: PicaMobileCalendarProvider,
    host: PicaMobilePlansHost,
  ) {
    this.provider = provider;
    this.host = host;
  }

  /** Starts hearing changes; called once after the authentication. */
  public start(): void {
    if (this.isStopped || this.release !== null) return;
    this.release = this.provider.follow((event) => this.receive(event));
  }

  /** Stops hearing changes and drops the gathered ones. */
  public stop(): void {
    this.isStopped = true;
    this.release?.();
    this.release = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }

  private receive(event: PagesEvent): void {
    if (this.isStopped || this.pending.size >= MAXIMUM_PENDING_EVENTS) return;
    this.pending.set(`${event.type} ${event.id}`, event);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.host.enqueue(() => this.flush());
    }, GATHER_MILLISECONDS);
    this.timer.unref();
  }

  private async flush(): Promise<void> {
    const session = this.host.session();
    const events = [...this.pending.values()];
    this.pending.clear();
    if (
      this.isStopped ||
      session === null ||
      events.length === 0 ||
      !this.host.isOpen()
    )
      return;
    const outcome = await this.provider.visibleChanges(session, events);
    if (this.isStopped || !this.host.isOpen()) return;
    if (outcome.kind === "sessionEnded") {
      this.host.endSession(null);
      return;
    }
    if (outcome.ids.length === 0) return;
    this.host.send(
      encodePicaMobileCalendar(null, {
        type: "calendar_changed",
        payload: { ids: outcome.ids },
      }),
    );
  }
}
