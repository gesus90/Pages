import {
  readBooleanColumn,
  readCountColumn,
  readNullableBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { CALENDAR_FREQUENCIES, CALENDAR_WEEKDAYS } from "@/definition/Calendar";

import { calendarInList } from "./CalendarSql";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  CalendarFrequency,
  CalendarRecurrence,
  CalendarWeekday,
} from "@/definition/Calendar";

/** The database operations the calendar repositories use. */
export type CalendarDatabase = Pick<Database, "query" | "execute">;

/**
 * One stored event or series.
 *
 * @remarks
 * `startAt` and `endAt` are UTC ISO texts for a timed event and dates
 * `YYYY-MM-DD` for an all-day event, whose `endAt` is its last day.
 */
export interface CalendarEventRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly allDay: boolean;
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
  readonly projectId: string | null;
  readonly createdBy: string;
  readonly revision: number;
  readonly deletedAt: string | null;
  readonly recurrence: CalendarRecurrence | null;
}

/** The values of a new event. */
export type NewCalendarEvent = Omit<
  CalendarEventRecord,
  "revision" | "deletedAt"
>;

/**
 * One occurrence that was changed or cancelled on its own.
 *
 * @remarks
 * `occurrenceStart` is the original start in the stored form of its event;
 * `null` fields keep the value of the series.
 */
export interface CalendarExceptionRecord {
  readonly eventId: string;
  readonly occurrenceStart: string;
  readonly isCancelled: boolean;
  readonly title: string | null;
  readonly description: string | null;
  readonly allDay: boolean | null;
  readonly startAt: string | null;
  readonly endAt: string | null;
}

/** Which events a viewer may see: own ones, invitations and project calendars. */
export interface CalendarViewerScope {
  readonly userId: string;
  readonly groupIds: readonly string[];
  readonly departmentIds: readonly string[];
  readonly projectIds: readonly string[];
}

const EVENT_COLUMNS = `
    calendar_events.id,
    calendar_events.title,
    calendar_events.description,
    calendar_events.is_all_day,
    calendar_events.start_at,
    calendar_events.end_at,
    calendar_events.time_zone,
    calendar_events.project_id,
    calendar_events.created_by,
    calendar_events.revision,
    calendar_events.deleted_at,
    calendar_event_recurrences.frequency,
    calendar_event_recurrences."interval",
    calendar_event_recurrences.weekdays,
    calendar_event_recurrences.until_date,
    calendar_event_recurrences.occurrence_count`;

function isFrequency(value: string): value is CalendarFrequency {
  return (CALENDAR_FREQUENCIES as readonly string[]).includes(value);
}

function isWeekday(value: unknown): value is CalendarWeekday {
  return (
    typeof value === "string" &&
    (CALENDAR_WEEKDAYS as readonly string[]).includes(value)
  );
}

function readWeekdays(text: string): CalendarWeekday[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? parsed.filter(isWeekday) : [];
}

function readRecurrence(
  row: readonly DatabaseValue[],
): CalendarRecurrence | null {
  const frequency = readNullableTextColumn(row, 11, "frequency");
  if (frequency === null) return null;
  if (!isFrequency(frequency))
    throw new Error('Database returned an invalid value for "frequency".');
  const count = row[15];
  return {
    frequency,
    interval: readCountColumn(row, 12, "interval"),
    weekdays: readWeekdays(readTextColumn(row, 13, "weekdays")),
    until: readNullableTextColumn(row, 14, "until_date"),
    count: count === null ? null : readCountColumn(row, 15, "occurrence_count"),
  };
}

function toEvent(row: readonly DatabaseValue[]): CalendarEventRecord {
  return {
    id: readTextColumn(row, 0, "id"),
    title: readTextColumn(row, 1, "title"),
    description: readTextColumn(row, 2, "description"),
    allDay: readBooleanColumn(row, 3, "is_all_day"),
    startAt: readTextColumn(row, 4, "start_at"),
    endAt: readTextColumn(row, 5, "end_at"),
    timeZone: readTextColumn(row, 6, "time_zone"),
    projectId: readNullableTextColumn(row, 7, "project_id"),
    createdBy: readTextColumn(row, 8, "created_by"),
    revision: readCountColumn(row, 9, "revision"),
    deletedAt: readNullableTextColumn(row, 10, "deleted_at"),
    recurrence: readRecurrence(row),
  };
}

function toException(row: readonly DatabaseValue[]): CalendarExceptionRecord {
  return {
    eventId: readTextColumn(row, 0, "event_id"),
    occurrenceStart: readTextColumn(row, 1, "occurrence_start"),
    isCancelled: readBooleanColumn(row, 2, "is_cancelled"),
    title: readNullableTextColumn(row, 3, "title"),
    description: readNullableTextColumn(row, 4, "description"),
    allDay: readNullableBooleanColumn(row, 5, "is_all_day"),
    startAt: readNullableTextColumn(row, 6, "start_at"),
    endAt: readNullableTextColumn(row, 7, "end_at"),
  };
}

/** Owns the stored events, their rules and their exceptions (PAGE-301). */
export class CalendarEventRepository {
  private readonly database: CalendarDatabase;

  /**
   * Creates the repository.
   *
   * @param database - Central database access; inside an announced call its
   * statements join the call's transaction.
   */
  public constructor(database: CalendarDatabase) {
    this.database = database;
  }

  /**
   * Returns one event, deleted ones included.
   *
   * @param id - Event identifier.
   */
  public async findById(id: string): Promise<CalendarEventRecord | null> {
    const rows = await this.database.query(
      `
        SELECT ${EVENT_COLUMNS}
        FROM calendar_events
        LEFT JOIN calendar_event_recurrences
            ON calendar_event_recurrences.event_id = calendar_events.id
        WHERE calendar_events.id = $id;
      `,
      { id },
    );
    const row = rows[0];
    return row ? toEvent(row) : null;
  }

  /**
   * Returns the events a viewer sees that may touch a range.
   *
   * @param scope - Own account, groups, departments and member projects.
   * @param range - Dates `YYYY-MM-DD`; a day of slack on each side covers
   * every time zone. Series are returned when they start before the end.
   */
  public async findVisible(
    scope: CalendarViewerScope,
    range: { readonly fromDate: string; readonly toDate: string },
  ): Promise<CalendarEventRecord[]> {
    const groups = calendarInList("group_id", scope.groupIds);
    const departments = calendarInList("department_id", scope.departmentIds);
    const projects = calendarInList("project_id", scope.projectIds);
    const rows = await this.database.query(
      `
        SELECT ${EVENT_COLUMNS}
        FROM calendar_events
        LEFT JOIN calendar_event_recurrences
            ON calendar_event_recurrences.event_id = calendar_events.id
        WHERE calendar_events.deleted_at IS NULL
            AND calendar_events.start_at <= $to_bound
            AND (
                calendar_event_recurrences.event_id IS NOT NULL
                OR calendar_events.end_at >= $from_bound
            )
            AND (
                calendar_events.created_by = $user_id
                OR calendar_events.project_id IN (${projects.placeholders})
                OR EXISTS (
                    SELECT 1
                    FROM calendar_event_invitations AS invitation
                    WHERE invitation.event_id = calendar_events.id
                        AND (
                            (invitation.invitee_kind IN ('person', 'agent') AND invitation.invitee_id = $user_id)
                            OR (invitation.invitee_kind = 'group' AND invitation.invitee_id IN (${groups.placeholders}))
                            OR (invitation.invitee_kind = 'department' AND invitation.invitee_id IN (${departments.placeholders}))
                        )
                )
            )
        ORDER BY calendar_events.start_at, calendar_events.id;
      `,
      {
        user_id: scope.userId,
        from_bound: range.fromDate,
        to_bound: `${range.toDate}T99`,
        ...groups.parameters,
        ...departments.parameters,
        ...projects.parameters,
      },
    );
    return rows.map(toEvent);
  }

  /**
   * Returns the exceptions of events.
   *
   * @param eventIds - Event identifiers.
   */
  public async findExceptions(
    eventIds: readonly string[],
  ): Promise<CalendarExceptionRecord[]> {
    const events = calendarInList("event_id", eventIds);
    const rows = await this.database.query(
      `
        SELECT
            event_id,
            occurrence_start,
            is_cancelled,
            title,
            description,
            is_all_day,
            start_at,
            end_at
        FROM calendar_event_exceptions
        WHERE event_id IN (${events.placeholders})
        ORDER BY event_id, occurrence_start;
      `,
      events.parameters,
    );
    return rows.map(toException);
  }

  /**
   * Stores a new event with its rule.
   *
   * @param event - The values of the event.
   */
  public async insert(event: NewCalendarEvent): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO calendar_events (
            id,
            title,
            description,
            is_all_day,
            start_at,
            end_at,
            time_zone,
            project_id,
            created_by
        )
        VALUES (
            $id,
            $title,
            $description,
            $is_all_day,
            $start_at,
            $end_at,
            $time_zone,
            $project_id,
            $created_by
        );
      `,
      {
        id: event.id,
        title: event.title,
        description: event.description,
        is_all_day: event.allDay,
        start_at: event.startAt,
        end_at: event.endAt,
        time_zone: event.timeZone,
        project_id: event.projectId,
        created_by: event.createdBy,
      },
    );
    await this.replaceRecurrence(event.id, event.recurrence);
  }

  /**
   * Replaces the fields of an event and raises its revision.
   *
   * @param event - The new values; `createdBy` stays.
   */
  public async update(event: NewCalendarEvent): Promise<void> {
    await this.database.execute(
      `
        UPDATE calendar_events
        SET
            title = $title,
            description = $description,
            is_all_day = $is_all_day,
            start_at = $start_at,
            end_at = $end_at,
            time_zone = $time_zone,
            project_id = $project_id,
            revision = revision + 1,
            updated_at = utc_now()
        WHERE id = $id
            AND deleted_at IS NULL;
      `,
      {
        id: event.id,
        title: event.title,
        description: event.description,
        is_all_day: event.allDay,
        start_at: event.startAt,
        end_at: event.endAt,
        time_zone: event.timeZone,
        project_id: event.projectId,
      },
    );
    await this.replaceRecurrence(event.id, event.recurrence);
  }

  /**
   * Raises the revision of an event after a change of one occurrence.
   *
   * @param id - Event identifier.
   */
  public async touch(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE calendar_events
        SET
            revision = revision + 1,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      { id },
    );
  }

  /**
   * Marks an event deleted; invitees no longer see it.
   *
   * @param id - Event identifier.
   */
  public async markDeleted(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE calendar_events
        SET
            deleted_at = utc_now(),
            revision = revision + 1,
            updated_at = utc_now()
        WHERE id = $id
            AND deleted_at IS NULL;
      `,
      { id },
    );
  }

  /**
   * Stores or replaces the exception of one occurrence.
   *
   * @param exception - The exception.
   */
  public async saveException(
    exception: CalendarExceptionRecord,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO calendar_event_exceptions (
            event_id,
            occurrence_start,
            is_cancelled,
            title,
            description,
            is_all_day,
            start_at,
            end_at
        )
        VALUES (
            $event_id,
            $occurrence_start,
            $is_cancelled,
            $title,
            $description,
            $is_all_day,
            $start_at,
            $end_at
        )
        ON CONFLICT (event_id, occurrence_start) DO UPDATE SET
            is_cancelled = excluded.is_cancelled,
            title = excluded.title,
            description = excluded.description,
            is_all_day = excluded.is_all_day,
            start_at = excluded.start_at,
            end_at = excluded.end_at,
            updated_at = utc_now();
      `,
      {
        event_id: exception.eventId,
        occurrence_start: exception.occurrenceStart,
        is_cancelled: exception.isCancelled,
        title: exception.title,
        description: exception.description,
        is_all_day: exception.allDay,
        start_at: exception.startAt,
        end_at: exception.endAt,
      },
    );
  }

  /**
   * Removes exceptions of an event.
   *
   * @param eventId - Event identifier.
   * @param options - `fromOccurrence` keeps the earlier ones; `onlyChanged`
   * keeps cancelled occurrences.
   */
  public async deleteExceptions(
    eventId: string,
    options: {
      readonly fromOccurrence?: string;
      readonly onlyChanged?: boolean;
    } = {},
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM calendar_event_exceptions
        WHERE event_id = $event_id
            AND ($from_occurrence IS NULL OR occurrence_start >= $from_occurrence)
            AND ($only_changed = FALSE OR is_cancelled = FALSE);
      `,
      {
        event_id: eventId,
        from_occurrence: options.fromOccurrence ?? null,
        only_changed: options.onlyChanged ?? false,
      },
    );
  }

  private async replaceRecurrence(
    eventId: string,
    recurrence: CalendarRecurrence | null,
  ): Promise<void> {
    await this.database.execute(
      "DELETE FROM calendar_event_recurrences WHERE event_id = $event_id;",
      { event_id: eventId },
    );
    if (recurrence === null) return;
    await this.database.execute(
      `
        INSERT INTO calendar_event_recurrences (
            event_id,
            frequency,
            "interval",
            weekdays,
            until_date,
            occurrence_count
        )
        VALUES (
            $event_id,
            $frequency,
            $interval,
            $weekdays,
            $until_date,
            $occurrence_count
        );
      `,
      {
        event_id: eventId,
        frequency: recurrence.frequency,
        interval: recurrence.interval,
        weekdays: JSON.stringify(recurrence.weekdays),
        until_date: recurrence.until,
        occurrence_count: recurrence.count,
      },
    );
  }
}
