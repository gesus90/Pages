import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { PicaMobileErrorCode } from "@/definition/PicaMobileProtocol";
import type {
  PicaMobileCalendarAnswer,
  PicaMobileCalendarRequest,
} from "@/definition/PicaMobileCalendar";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";

/**
 * What the calendar answers to one request.
 *
 * @remarks
 * `refused` carries one of `forbidden`, `not_found` and `invalid_request`
 * and a message without foreign data. `sessionEnded` means the session or
 * the account no longer holds; the connection ends then.
 */
export type PicaMobileCalendarOutcome =
  | { readonly kind: "answer"; readonly answer: PicaMobileCalendarAnswer }
  | {
      readonly kind: "refused";
      readonly code: PicaMobileErrorCode;
      readonly message: string;
    }
  | { readonly kind: "sessionEnded" };

/** The entry ids of committed changes the account sees, or the end of its session. */
export type PicaMobileCalendarChangesOutcome =
  | { readonly kind: "changes"; readonly ids: readonly string[] }
  | { readonly kind: "sessionEnded" };

/**
 * The calendar of Pages for Pica Mobile (`calendar.v1`, PAGE-301).
 *
 * @remarks
 * A connection without a provider does not announce `calendar.v1` and
 * answers its requests as unknown. Every call checks the session first.
 */
export interface PicaMobileCalendarProvider {
  /** Answers one request for the account behind the session. */
  answer(
    session: PicaMobileSessionIdentity,
    request: PicaMobileCalendarRequest,
  ): Promise<PicaMobileCalendarOutcome>;
  /**
   * Hears every committed event that may change calendar entries.
   *
   * @returns Stops hearing them.
   */
  follow(listener: (event: PagesEvent) => void): () => void;
  /** Names the entries behind events that the account behind the session sees. */
  visibleChanges(
    session: PicaMobileSessionIdentity,
    events: readonly PagesEvent[],
  ): Promise<PicaMobileCalendarChangesOutcome>;
}
