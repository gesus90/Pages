import { logCaughtError } from "@/backend/logging/Logger";
import { CalendarError } from "@/backend/error/CalendarError";
import { CALENDAR_LIMITS } from "@/definition/Calendar";
import { PICA_MOBILE_ERROR_CODE } from "@/definition/PicaMobileProtocol";

import { readCurrentSessionUser } from "../PicaMobileSessionUser";
import { toPicaMobileCalendarEntry } from "./PicaMobileCalendarMessages";

import type { AuthService } from "@/backend/auth/AuthService";
import type { CalendarService } from "@/backend/service/calendar/CalendarService";
import type { LiveChangeAudience } from "@/backend/service/events/LiveChangeAudience";
import type {
  PagesEvent,
  PagesEventPublisher,
} from "@/backend/service/events/PagesEventPublisher";
import type { PicaMobileErrorCode } from "@/definition/PicaMobileProtocol";
import type {
  PicaMobileCalendarAnswer,
  PicaMobileCalendarRequest,
} from "@/definition/PicaMobileCalendar";
import type { User } from "@/definition/User";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type {
  PicaMobileCalendarChangesOutcome,
  PicaMobileCalendarOutcome,
  PicaMobileCalendarProvider,
} from "./PicaMobileCalendarProvider";

/** The Pages services `calendar.v1` is answered from. */
export interface PicaMobileCalendarServices {
  readonly authService: Pick<AuthService, "getAuthenticatedUser">;
  readonly calendarService: Pick<
    CalendarService,
    | "readRange"
    | "create"
    | "update"
    | "delete"
    | "respond"
    | "searchInvitees"
    | "targets"
    | "isAffected"
  >;
  readonly liveChangeAudience: Pick<LiveChangeAudience, "notice">;
  readonly pagesEventPublisher: Pick<PagesEventPublisher, "subscribe">;
}

type SaveRequest = Extract<
  PicaMobileCalendarRequest,
  { readonly type: "calendar_event_save" }
>;

const COMPONENT = "PagesPicaMobileCalendar";

/**
 * Tells whether a committed event may change calendar entries: an event or
 * the project dates (`calendar.changed`), a due ticket or a milestone.
 *
 * @param event - A committed Pages event.
 */
export function isPicaMobileCalendarEvent(event: PagesEvent): boolean {
  return (
    event.type === "calendar.changed" ||
    event.type.startsWith("ticket.") ||
    event.type.startsWith("milestone.")
  );
}

/** The `forbidden`, `not_found` or `invalid_request` of a refused calendar request. */
function codeOf(error: CalendarError): PicaMobileErrorCode {
  if (error.code === "forbidden") return PICA_MOBILE_ERROR_CODE.FORBIDDEN;
  if (error.code === "not_found") return PICA_MOBILE_ERROR_CODE.NOT_FOUND;
  return PICA_MOBILE_ERROR_CODE.INVALID_REQUEST;
}

/** The entry id a committed event stands for in the calendar. */
function entryIdOf(event: PagesEvent): string {
  if (event.type.startsWith("ticket.")) return `due:${event.id}`;
  if (event.type.startsWith("milestone.")) return `milestone:${event.id}`;
  return event.id;
}

/** The fields of a save request without its id and scope: the whole event. */
function fieldsOf(payload: SaveRequest["payload"]): Record<string, unknown> {
  return {
    title: payload.title,
    description: payload.description,
    start: payload.start,
    end: payload.end,
    allDay: payload.allDay,
    calendarProjectId: payload.calendarProjectId,
    invitees: payload.invitees,
    recurrence: payload.recurrence,
  };
}

/**
 * Answers `calendar.v1` with the calendar service of Pages (PAGE-301).
 *
 * @remarks
 * The account behind the session is read first; an ended session, a
 * deactivated account or a pending password change end the connection.
 * Every read and change then runs with the account's current rights in the
 * calendar service. Its refusals become `forbidden`, `not_found` or
 * `invalid_request`; `conflict` and `too_large` count as `invalid_request`.
 * Entries are reduced to the fields of the contract.
 */
export class PagesPicaMobileCalendar implements PicaMobileCalendarProvider {
  private readonly resolveServices: () => Promise<PicaMobileCalendarServices>;

  /**
   * Creates the provider.
   *
   * @param resolveServices - Resolves the Pages services when they are
   * needed, so the listener works before the database does.
   */
  public constructor(
    resolveServices: () => Promise<PicaMobileCalendarServices>,
  ) {
    this.resolveServices = resolveServices;
  }

  /** Answers one request for the account behind the session. */
  public async answer(
    session: PicaMobileSessionIdentity,
    request: PicaMobileCalendarRequest,
  ): Promise<PicaMobileCalendarOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);
    if (user === null) return { kind: "sessionEnded" };
    try {
      return {
        kind: "answer",
        answer: await this.dispatch(services.calendarService, user, request),
      };
    } catch (error: unknown) {
      if (!(error instanceof CalendarError)) throw error;
      return { kind: "refused", code: codeOf(error), message: error.message };
    }
  }

  /** Hears the committed events of this process that may change entries. */
  public follow(listener: (event: PagesEvent) => void): () => void {
    let release: (() => void) | null = null;
    let isStopped = false;
    void this.resolveServices()
      .then((services) => {
        if (isStopped) return;
        release = services.pagesEventPublisher.subscribe((event) => {
          if (isPicaMobileCalendarEvent(event)) listener(event);
        });
      })
      .catch((error: unknown) => {
        logCaughtError(COMPONENT, error);
      });
    return () => {
      isStopped = true;
      release?.();
      release = null;
    };
  }

  /**
   * Names the entries behind events the account sees: `calendar.changed`
   * when the account is affected by the event or a member of the project,
   * due tickets and milestones when it may see the ticket or milestone.
   */
  public async visibleChanges(
    session: PicaMobileSessionIdentity,
    events: readonly PagesEvent[],
  ): Promise<PicaMobileCalendarChangesOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);
    if (user === null) return { kind: "sessionEnded" };
    const ids = new Set<string>();
    for (const event of events) {
      if (await this.isVisible(services, user, event)) ids.add(entryIdOf(event));
    }
    return { kind: "changes", ids: [...ids] };
  }

  private async isVisible(
    services: PicaMobileCalendarServices,
    user: User,
    event: PagesEvent,
  ): Promise<boolean> {
    try {
      if (event.type === "calendar.changed")
        return await services.calendarService.isAffected(user, event.id);
      return (await services.liveChangeAudience.notice(user, event)) !== null;
    } catch (error: unknown) {
      logCaughtError(COMPONENT, error);

      // An undecidable change is not named; the next read shows it anyway.
      return false;
    }
  }

  private async dispatch(
    calendar: PicaMobileCalendarServices["calendarService"],
    user: User,
    request: PicaMobileCalendarRequest,
  ): Promise<PicaMobileCalendarAnswer> {
    switch (request.type) {
      case "calendar_range": {
        const range = await calendar.readRange(user, request.payload);
        return {
          type: "calendar",
          payload: {
            from: range.from,
            to: range.to,
            timeZone: range.timeZone,
            entries: range.entries.map(toPicaMobileCalendarEntry),
          },
        };
      }
      case "calendar_event_save":
        return this.save(calendar, user, request.payload);
      case "calendar_event_delete":
        await calendar.delete(user, request.payload);
        return {
          type: "calendar_event_deleted",
          payload: { id: request.payload.id },
        };
      case "calendar_event_respond": {
        const { id, response } = request.payload;
        const entry = await calendar.respond(user, id, response);
        return {
          type: "calendar_event",
          payload: { entry: toPicaMobileCalendarEntry(entry) },
        };
      }
      case "calendar_invitees":
        return this.invitees(calendar, user, request.payload.query);
      case "calendar_targets": {
        const targets = await calendar.targets(user);
        return {
          type: "calendar_target_options",
          payload: {
            targets: targets.map(({ projectId, name }) => ({ projectId, name })),
          },
        };
      }
    }
  }

  private async save(
    calendar: PicaMobileCalendarServices["calendarService"],
    user: User,
    payload: SaveRequest["payload"],
  ): Promise<PicaMobileCalendarAnswer> {
    const fields = fieldsOf(payload);
    const entry =
      payload.id === null
        ? await calendar.create(user, fields)
        : await calendar.update(
            user,
            { id: payload.id, scope: payload.scope ?? "this" },
            fields,
          );
    return {
      type: "calendar_event",
      payload: { entry: toPicaMobileCalendarEntry(entry) },
    };
  }

  private async invitees(
    calendar: PicaMobileCalendarServices["calendarService"],
    user: User,
    query: string,
  ): Promise<PicaMobileCalendarAnswer> {
    const options = await calendar.searchInvitees(
      user,
      query,
      CALENDAR_LIMITS.mobileInviteeOptions,
    );
    return {
      type: "calendar_invitee_options",
      payload: {
        options: options
          .slice(0, CALENDAR_LIMITS.mobileInviteeOptions)
          .map(({ kind, id, name }) => ({ kind, id, name })),
      },
    };
  }
}
