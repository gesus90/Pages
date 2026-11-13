import { CalendarError } from "@/backend/error/CalendarError";
import {
  CALENDAR_FREQUENCIES,
  CALENDAR_LIMITS,
  CALENDAR_SCOPES,
  CALENDAR_WEEKDAYS,
} from "@/definition/Calendar";

import {
  expandOccurrences,
  findOccurrence,
  readStoredTime,
} from "./CalendarOccurrences";
import { CalendarPeople } from "./CalendarPeople";
import {
  calendarTexts,
  compareEntries,
  formatOccurrence,
  formatOccurrenceKey,
  parseEntryId,
  toDueEntry,
  toEventEntry,
  toMilestoneEntry,
  toProjectDateEntry,
} from "./CalendarProjection";
import { lastOccurrenceDate } from "./CalendarRecurrence";
import {
  addDays,
  dateIn,
  fromLocal,
  isCalendarDate,
  parseInstant,
  toLocal,
} from "./CalendarTime";

import type { CalendarEventRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type {
  CalendarEventView,
  CalendarKind,
  CalendarOptions,
  CalendarTarget,
  CalendarViewEntry,
} from "@/definition/Calendar";
import type { CalendarOccurrence, CalendarWindow } from "./CalendarOccurrences";
import type { CalendarDependencies, CalendarViewer } from "./CalendarViewer";

const DAY_MILLISECONDS = 86_400_000;
/** A change of summer time makes a range of whole days an hour longer. */
const RANGE_SLACK_MILLISECONDS = 2 * 3_600_000;

/** A stored event the viewer may see, with its people. */
export interface VisibleCalendarEvent {
  readonly event: CalendarEventRecord;
  readonly people: CalendarPeople;
}

/**
 * Reads the range a client asked for.
 *
 * @param from - A date (start of that day) or an instant.
 * @param to - A date (end of that day, inclusive) or an instant (exclusive).
 * @param timeZone - The zone of the viewer.
 * @returns The window in instants and dates of the viewer.
 * @throws {CalendarError} `invalid_request` for an end before the start or
 * more than 92 days.
 */
export function readCalendarWindow(
  from: string,
  to: string,
  timeZone: string,
): CalendarWindow {
  const fromMs = parseInstant(from, timeZone);
  const toMs = isCalendarDate(to)
    ? fromLocal({ date: addDays(to, 1), time: "00:00:00" }, timeZone)
    : Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs)
    throw new CalendarError(
      "invalid_request",
      "The range ends before it starts.",
    );
  if (
    toMs - fromMs >
    CALENDAR_LIMITS.rangeDays * DAY_MILLISECONDS + RANGE_SLACK_MILLISECONDS
  )
    throw new CalendarError(
      "invalid_request",
      "The range is longer than 92 days.",
    );
  return {
    fromMs,
    toMs,
    fromDate: dateIn(from, timeZone),
    toDate: isCalendarDate(to) ? to : toLocal(toMs - 1, timeZone).date,
  };
}

/** Reads entries, events, targets and counts of the calendar (PAGE-301). */
export class CalendarReader {
  private readonly dependencies: CalendarDependencies;

  /**
   * Creates the reader.
   *
   * @param dependencies - Repositories and services.
   */
  public constructor(dependencies: CalendarDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Lists the entries of a window as the viewer's calendar shows them.
   *
   * @param viewer - The account.
   * @param window - The range.
   * @param kinds - Calendars to include; all without a filter.
   */
  public async readEntries(
    viewer: CalendarViewer,
    window: CalendarWindow,
    kinds?: ReadonlySet<CalendarKind>,
  ): Promise<CalendarViewEntry[]> {
    const wants = (kind: CalendarKind): boolean =>
      kinds === undefined || kinds.has(kind);
    const entries: CalendarViewEntry[] = [];
    if (wants("personal") || wants("project"))
      entries.push(
        ...(await this.readEventEntries(viewer, window)).filter((entry) =>
          wants(entry.calendar.kind),
        ),
      );
    entries.push(...(await this.readDerivedEntries(viewer, window, wants)));
    return entries.sort(compareEntries);
  }

  /**
   * Returns a stored event the viewer may see or change.
   *
   * @param viewer - The account.
   * @param eventId - The event; an occurrence id names its series.
   * @throws {CalendarError} `not_found` for a missing, deleted or invisible event.
   */
  public async requireVisible(
    viewer: CalendarViewer,
    eventId: string,
  ): Promise<VisibleCalendarEvent> {
    const event = await this.dependencies.events.findById(
      parseEntryId(eventId).eventId,
    );
    if (!event || event.deletedAt !== null)
      throw new CalendarError("not_found", "The event does not exist.");
    const people = await CalendarPeople.read(this.dependencies, [event]);
    if (!this.canSee(viewer, event, people))
      throw new CalendarError("not_found", "The event does not exist.");
    return { event, people };
  }

  /**
   * Builds the entry of one occurrence, or of the first one of a series.
   *
   * @param viewer - The account.
   * @param visible - The event and its people.
   * @param key - The stored key of an occurrence; `null` for the start.
   */
  public async entryOf(
    viewer: CalendarViewer,
    visible: VisibleCalendarEvent,
    key: string | null,
  ): Promise<CalendarViewEntry> {
    const { event, people } = visible;
    const exceptions = await this.dependencies.events.findExceptions([
      event.id,
    ]);
    const occurrence =
      (key === null ? null : findOccurrence(event, exceptions, key)) ??
      this.firstOccurrence(event, exceptions);
    return toEventEntry({
      event,
      occurrence,
      participants: people.of(event),
      viewer,
      projectNames: await this.projectNames(viewer, [event]),
      isViewerAgent:
        people.isAgent(viewer.user.id) || viewer.user.isAgent === true,
    });
  }

  /**
   * Builds the detail view of a stored event.
   *
   * @param viewer - The account.
   * @param visible - The event and its people.
   */
  public async viewOf(
    viewer: CalendarViewer,
    visible: VisibleCalendarEvent,
  ): Promise<CalendarEventView> {
    const { event, people } = visible;
    const participants = people.of(event);
    const exceptions = await this.dependencies.events.findExceptions([
      event.id,
    ]);
    const entry = await this.entryOf(viewer, visible, null);
    const times = formatOccurrence(
      readStoredTime(event, event.timeZone),
      viewer.timeZone,
    );
    const canEdit = entry.editable;
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      ...times,
      allDay: event.allDay,
      timeZone: viewer.timeZone,
      calendar: entry.calendar,
      recurrence: event.recurrence,
      invitees: participants.invitees,
      responses: participants.responses,
      myResponse: entry.myResponse,
      createdBy: participants.createdBy,
      exceptions: exceptions.map((exception) => ({
        occurrenceStart: formatOccurrenceKey(
          exception.occurrenceStart,
          viewer.timeZone,
        ),
        isCancelled: exception.isCancelled,
      })),
      permissions: {
        canEdit,
        canDelete: canEdit,
        canRespond:
          participants.affectedIds.has(viewer.user.id) &&
          !people.isAgent(viewer.user.id) &&
          viewer.user.isAgent !== true,
      },
      revision: event.revision,
    };
  }

  /**
   * Counts the future events the viewer is invited to and has not answered.
   *
   * @param viewer - The account.
   */
  public async countOpenInvitations(viewer: CalendarViewer): Promise<number> {
    if (viewer.user.isAgent === true) return 0;
    const today = toLocal(Date.now(), viewer.timeZone).date;
    const events = (
      await this.dependencies.events.findVisible(this.scopeOf(viewer), {
        fromDate: today,
        toDate: "9999-12-31",
      })
    ).filter((event) => event.createdBy !== viewer.user.id);
    const people = await CalendarPeople.read(this.dependencies, events);
    return events.filter((event) => {
      const participants = people.of(event);
      const own = participants.responses.find(
        (entry) => entry.userId === viewer.user.id,
      );
      if (!own || own.response !== "open") return false;
      if (event.recurrence === null)
        return readStoredTime(event, event.timeZone).endDate >= today;
      const last = lastOccurrenceDate(
        event.recurrence,
        readStoredTime(event, event.timeZone).startDate,
      );
      return last === null || last >= today;
    }).length;
  }

  /**
   * Lists the calendars the viewer can put a new event into.
   *
   * @param viewer - The account.
   */
  public async targets(viewer: CalendarViewer): Promise<CalendarTarget[]> {
    const targets: CalendarTarget[] = [
      { projectId: null, name: calendarTexts(viewer.language).mine },
    ];
    for (const project of viewer.projects) {
      if (
        await this.dependencies.projects.canWriteProject(
          viewer.user,
          project.id,
        )
      )
        targets.push({ projectId: project.id, name: project.name });
    }
    return targets;
  }

  /**
   * Returns the fixed facts a client needs before it changes something.
   *
   * @param viewer - The account.
   */
  public async options(viewer: CalendarViewer): Promise<CalendarOptions> {
    return {
      timeZone: viewer.timeZone,
      targets: await this.targets(viewer),
      frequencies: CALENDAR_FREQUENCIES,
      weekdays: CALENDAR_WEEKDAYS,
      scopes: CALENDAR_SCOPES,
      limits: CALENDAR_LIMITS,
    };
  }

  /**
   * Tells whether the viewer sees a stored event.
   *
   * @param viewer - The account.
   * @param event - The event.
   * @param people - Its people.
   */
  public canSee(
    viewer: CalendarViewer,
    event: CalendarEventRecord,
    people: CalendarPeople,
  ): boolean {
    if (event.createdBy === viewer.user.id || viewer.isAdmin) return true;
    if (
      event.projectId !== null &&
      viewer.projects.some((project) => project.id === event.projectId)
    )
      return true;
    return people.of(event).affectedIds.has(viewer.user.id);
  }

  /**
   * Returns the names of the projects of events.
   *
   * @param viewer - The account; its member projects are known.
   * @param events - The events.
   */
  public async projectNames(
    viewer: CalendarViewer,
    events: readonly CalendarEventRecord[],
  ): Promise<Map<string, string>> {
    const names = new Map(
      viewer.projects.map((project) => [project.id, project.name]),
    );
    const missing = events
      .map((event) => event.projectId)
      .filter((id): id is string => id !== null && !names.has(id));
    for (const project of await this.dependencies.sources.findProjectNames(
      missing,
    ))
      names.set(project.id, project.name);
    return names;
  }

  private scopeOf(viewer: CalendarViewer): {
    readonly userId: string;
    readonly groupIds: readonly string[];
    readonly departmentIds: readonly string[];
    readonly projectIds: readonly string[];
  } {
    return {
      userId: viewer.user.id,
      groupIds: viewer.groupIds,
      departmentIds: viewer.departmentIds,
      projectIds: viewer.projects.map((project) => project.id),
    };
  }

  private firstOccurrence(
    event: CalendarEventRecord,
    exceptions: Parameters<typeof expandOccurrences>[1],
  ): CalendarOccurrence {
    const base = readStoredTime(event, event.timeZone);
    if (event.recurrence === null)
      return {
        ...base,
        key: null,
        title: event.title,
        description: event.description,
      };
    const window: CalendarWindow = {
      fromMs: base.startMs ?? Date.parse(`${base.startDate}T00:00:00Z`),
      toMs: Number.MAX_SAFE_INTEGER,
      fromDate: base.startDate,
      toDate: addDays(base.startDate, 366 * 5),
    };
    return (
      expandOccurrences(event, exceptions, window)[0] ?? {
        ...base,
        key: null,
        title: event.title,
        description: event.description,
      }
    );
  }

  private async readEventEntries(
    viewer: CalendarViewer,
    window: CalendarWindow,
  ): Promise<CalendarViewEntry[]> {
    const events = await this.dependencies.events.findVisible(
      this.scopeOf(viewer),
      {
        fromDate: addDays(window.fromDate, -1),
        toDate: addDays(window.toDate, 1),
      },
    );
    if (events.length === 0) return [];
    const people = await CalendarPeople.read(this.dependencies, events);
    const exceptions = await this.dependencies.events.findExceptions(
      events.map((event) => event.id),
    );
    const projectNames = await this.projectNames(viewer, events);
    const isViewerAgent =
      people.isAgent(viewer.user.id) || viewer.user.isAgent === true;
    return events.flatMap((event) => {
      const participants = people.of(event);
      return expandOccurrences(
        event,
        exceptions.filter((entry) => entry.eventId === event.id),
        window,
      ).map((occurrence) =>
        toEventEntry({
          event,
          occurrence,
          participants,
          viewer,
          projectNames,
          isViewerAgent,
        }),
      );
    });
  }

  private async readDerivedEntries(
    viewer: CalendarViewer,
    window: CalendarWindow,
    wants: (kind: CalendarKind) => boolean,
  ): Promise<CalendarViewEntry[]> {
    const projectIds = viewer.projects.map((project) => project.id);
    const range = { fromDate: window.fromDate, toDate: window.toDate };
    const entries: CalendarViewEntry[] = [];
    if (wants("project"))
      entries.push(
        ...(
          await this.dependencies.sources.findProjectDates(projectIds, range)
        ).map((record) => toProjectDateEntry(record, viewer)),
      );
    if (wants("due")) {
      const visibility = await this.dependencies.projects.workItemVisibility(
        viewer.user,
      );
      entries.push(
        ...(
          await this.dependencies.sources.findDueTickets(
            { userId: viewer.user.id, groupIds: viewer.groupIds },
            visibility,
            range,
          )
        ).map((record) => toDueEntry(record, viewer)),
      );
    }
    if (wants("milestone"))
      entries.push(
        ...(
          await this.dependencies.sources.findMilestones(projectIds, range)
        ).map((record) => toMilestoneEntry(record, viewer)),
      );
    return entries;
  }
}
