import { randomUUID } from "node:crypto";

import { CalendarError } from "@/backend/error/CalendarError";

import {
  checkCalendarInvitees,
  normalizeRecurrence,
  readCalendarTime,
} from "./CalendarEventInput";
import {
  findOccurrence,
  occurrenceDateOf,
  readStoredTime,
} from "./CalendarOccurrences";
import { formatOccurrence } from "./CalendarProjection";
import {
  listOccurrenceDates,
  spanDays,
  splitRecurrence,
} from "./CalendarRecurrence";
import {
  addDays,
  daysBetween,
  fromLocal,
  toLocal,
  toUtcText,
} from "./CalendarTime";

import type {
  CalendarEventRecord,
  CalendarExceptionRecord,
  NewCalendarEvent,
} from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type { CalendarEventPatch } from "@/definition/Calendar";
import type { CalendarOccurrence } from "./CalendarOccurrences";
import type { StoredCalendarTime } from "./CalendarEventInput";
import type { CalendarDependencies, CalendarViewer } from "./CalendarViewer";

/** The events a change touched, for live notices and the push. */
export interface CalendarChangeResult {
  readonly eventIds: readonly string[];
  /** The event and occurrence key the answer of the change shows. */
  readonly eventId: string;
  readonly key: string | null;
}

function hasTimePatch(patch: CalendarEventPatch): boolean {
  return (
    patch.start !== undefined ||
    patch.end !== undefined ||
    patch.allDay !== undefined
  );
}

function exceptionTime(
  time: StoredCalendarTime | null,
  existing: CalendarExceptionRecord | undefined,
): Pick<CalendarExceptionRecord, "allDay" | "startAt" | "endAt"> {
  return {
    allDay: time?.allDay ?? existing?.allDay ?? null,
    startAt: time?.startAt ?? existing?.startAt ?? null,
    endAt: time?.endAt ?? existing?.endAt ?? null,
  };
}

function createOccurrenceException(
  event: CalendarEventRecord,
  occurrence: CalendarOccurrence & { readonly key: string },
  patch: CalendarEventPatch,
  options: {
    readonly existing: CalendarExceptionRecord | undefined;
    readonly time: StoredCalendarTime | null;
  },
): CalendarExceptionRecord {
  const { existing, time } = options;
  return {
    eventId: event.id,
    occurrenceStart: occurrence.key,
    isCancelled: false,
    title: patch.title ?? existing?.title ?? null,
    description: patch.description ?? existing?.description ?? null,
    ...exceptionTime(time, existing),
  };
}

function sameRule(
  left: CalendarEventRecord["recurrence"],
  right: CalendarEventRecord["recurrence"],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The new time of an occurrence after a patch, read in the viewer's zone. */
function patchedOccurrenceTime(
  occurrence: CalendarOccurrence,
  patch: CalendarEventPatch,
  viewer: CalendarViewer,
): StoredCalendarTime {
  const current = formatOccurrence(occurrence, viewer.timeZone);
  return readCalendarTime(
    {
      start: patch.start ?? current.start,
      end: patch.end ?? current.end,
      allDay: patch.allDay ?? occurrence.allDay,
    },
    viewer.timeZone,
  );
}

/**
 * Moves the start of a series by the change one of its occurrences got.
 *
 * @param event - The series.
 * @param occurrence - The occurrence the client edited.
 * @param target - Its new time.
 */
function shiftSeries(
  event: CalendarEventRecord,
  occurrence: CalendarOccurrence,
  target: StoredCalendarTime,
): StoredCalendarTime {
  const base = readStoredTime(event, event.timeZone);
  const next = readStoredTime(target, event.timeZone);
  const startDate = addDays(
    base.startDate,
    daysBetween(occurrence.startDate, next.startDate),
  );
  if (target.allDay) {
    const endDate = addDays(startDate, spanDays(next.startDate, next.endDate));
    return { allDay: true, startAt: startDate, endAt: endDate, startDate };
  }
  const time = toLocal(next.startMs ?? 0, event.timeZone).time;
  const startMs = fromLocal({ date: startDate, time }, event.timeZone);
  const endMs = startMs + ((next.endMs ?? 0) - (next.startMs ?? 0));
  return {
    allDay: false,
    startAt: toUtcText(startMs),
    endAt: toUtcText(endMs),
    startDate,
  };
}

/**
 * Applies the changes of one scope of a series (PAGE-301).
 *
 * @remarks
 * "Only this" stores an exception of the occurrence; "this and all
 * following" ends the series before the occurrence and starts a new one with
 * the change; "all" changes the series. Occurrences changed on their own keep
 * their exception in a later change of all, unless time or rule change.
 * A changed date or time sets acceptances back to open; declines stay.
 */
export class CalendarSeriesChanges {
  private readonly dependencies: CalendarDependencies;

  /**
   * Creates the helper.
   *
   * @param dependencies - Repositories and services.
   */
  public constructor(dependencies: CalendarDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Builds the stored values of an event after a patch of the whole series.
   *
   * @param event - The event or series.
   * @param patch - The fields of the client.
   * @param context - The viewer and the occurrence the client edited, if any.
   */
  public patchedEvent(
    event: CalendarEventRecord,
    patch: CalendarEventPatch,
    context: {
      readonly viewer: CalendarViewer;
      readonly occurrence: CalendarOccurrence | null;
    },
  ): NewCalendarEvent {
    const time = this.patchedTime(event, patch, context);
    return {
      id: event.id,
      title: patch.title ?? event.title,
      description: patch.description ?? event.description,
      allDay: time.allDay,
      startAt: time.startAt,
      endAt: time.endAt,
      timeZone: event.timeZone,
      projectId:
        patch.calendarProjectId === undefined
          ? event.projectId
          : patch.calendarProjectId,
      createdBy: event.createdBy,
      recurrence: normalizeRecurrence(
        patch.recurrence === undefined ? event.recurrence : patch.recurrence,
        time.startDate,
      ),
    };
  }

  /**
   * Changes the whole series or a single event.
   *
   * @param event - The stored event.
   * @param next - Its new values.
   * @param patch - The fields of the client; invitees replace the list.
   */
  public async updateAll(
    event: CalendarEventRecord,
    next: NewCalendarEvent,
    patch: CalendarEventPatch,
  ): Promise<CalendarChangeResult> {
    const { events, participation, directory } = this.dependencies;
    const isTimeChanged =
      next.startAt !== event.startAt ||
      next.endAt !== event.endAt ||
      next.allDay !== event.allDay;
    await events.update(next);
    if (isTimeChanged || !sameRule(event.recurrence, next.recurrence))
      await events.deleteExceptions(event.id);
    if (isTimeChanged) await participation.reopenAcceptances(event.id);
    if (patch.invitees !== undefined)
      await participation.replaceInvitations(
        event.id,
        await checkCalendarInvitees(directory, patch.invitees),
      );
    return { eventIds: [event.id], eventId: event.id, key: null };
  }

  /**
   * Changes only one occurrence of a series.
   *
   * @param event - The series.
   * @param occurrence - The occurrence.
   * @param context - The patch and the viewer.
   */
  public async updateThis(
    event: CalendarEventRecord,
    occurrence: CalendarOccurrence & { readonly key: string },
    context: {
      readonly patch: CalendarEventPatch;
      readonly viewer: CalendarViewer;
    },
  ): Promise<CalendarChangeResult> {
    const { patch, viewer } = context;
    const { events, participation, directory } = this.dependencies;
    const existing = (await events.findExceptions([event.id])).find(
      (entry) => entry.occurrenceStart === occurrence.key,
    );
    const time = hasTimePatch(patch)
      ? patchedOccurrenceTime(occurrence, patch, viewer)
      : null;
    const exception = createOccurrenceException(event, occurrence, patch, {
      existing,
      time,
    });
    await events.saveException(exception);
    await events.touch(event.id);
    if (time !== null) await participation.reopenAcceptances(event.id);
    if (patch.invitees !== undefined)
      await participation.replaceInvitations(
        event.id,
        await checkCalendarInvitees(directory, patch.invitees),
      );
    return { eventIds: [event.id], eventId: event.id, key: occurrence.key };
  }

  /**
   * Changes an occurrence and every later one by splitting the series.
   *
   * @param event - The series.
   * @param occurrence - The first occurrence of the new part.
   * @param context - The patch and the viewer.
   */
  public async updateFollowing(
    event: CalendarEventRecord,
    occurrence: CalendarOccurrence & { readonly key: string },
    context: {
      readonly patch: CalendarEventPatch;
      readonly viewer: CalendarViewer;
    },
  ): Promise<CalendarChangeResult> {
    const { patch, viewer } = context;
    const { events, participation, directory } = this.dependencies;
    const rule = event.recurrence;
    if (rule === null)
      throw new CalendarError("invalid_request", "The event is no series.");
    const base = readStoredTime(event, event.timeZone);
    const splitDate = occurrenceDateOf(event, occurrence.key);
    const split = splitRecurrence(rule, base.startDate, splitDate);
    const time = patchedOccurrenceTime(occurrence, patch, viewer);
    const newId = randomUUID();
    const invitations = await participation.findInvitations([event.id]);
    const next: NewCalendarEvent = {
      id: newId,
      title: patch.title ?? event.title,
      description: patch.description ?? event.description,
      allDay: time.allDay,
      startAt: time.startAt,
      endAt: time.endAt,
      timeZone: event.timeZone,
      projectId:
        patch.calendarProjectId === undefined
          ? event.projectId
          : patch.calendarProjectId,
      createdBy: event.createdBy,
      recurrence: normalizeRecurrence(
        patch.recurrence === undefined ? split.after : patch.recurrence,
        readStoredTime(time, event.timeZone).startDate,
      ),
    };
    await events.update({ ...event, recurrence: split.before });
    await events.deleteExceptions(event.id, { fromOccurrence: occurrence.key });
    await events.insert(next);
    await participation.replaceInvitations(
      newId,
      patch.invitees === undefined
        ? invitations.map((entry) => ({
            kind: entry.kind,
            id: entry.inviteeId,
          }))
        : await checkCalendarInvitees(directory, patch.invitees),
    );
    await participation.copyResponses(event.id, newId);
    if (hasTimePatch(patch)) await participation.reopenAcceptances(newId);
    return { eventIds: [event.id, newId], eventId: newId, key: null };
  }

  /**
   * Deletes one scope of an event.
   *
   * @param event - The stored event.
   * @param scope - Which occurrences go.
   * @param occurrence - The occurrence of `this` and `following`.
   */
  public async delete(
    event: CalendarEventRecord,
    scope: "this" | "following" | "all",
    occurrence: (CalendarOccurrence & { readonly key: string }) | null,
  ): Promise<void> {
    const { events } = this.dependencies;
    if (event.recurrence === null || scope === "all" || occurrence === null) {
      await events.markDeleted(event.id);
      return;
    }
    if (scope === "this") {
      await events.saveException({
        eventId: event.id,
        occurrenceStart: occurrence.key,
        isCancelled: true,
        title: null,
        description: null,
        allDay: null,
        startAt: null,
        endAt: null,
      });
      await events.touch(event.id);
      return;
    }
    const base = readStoredTime(event, event.timeZone);
    const split = splitRecurrence(
      event.recurrence,
      base.startDate,
      occurrenceDateOf(event, occurrence.key),
    );
    if (split.before === null) {
      await events.markDeleted(event.id);
      return;
    }
    await events.update({ ...event, recurrence: split.before });
    await events.deleteExceptions(event.id, { fromOccurrence: occurrence.key });
  }

  /**
   * Finds the occurrence of a series a client named.
   *
   * @param event - The series.
   * @param key - The stored key.
   * @throws {CalendarError} `not_found` when the series has no such occurrence.
   */
  public async requireOccurrence(
    event: CalendarEventRecord,
    key: string,
  ): Promise<CalendarOccurrence & { readonly key: string }> {
    const exceptions = await this.dependencies.events.findExceptions([
      event.id,
    ]);
    const occurrence = findOccurrence(event, exceptions, key);
    if (occurrence === null || occurrence.key === null)
      throw new CalendarError("not_found", "The occurrence does not exist.");
    return { ...occurrence, key: occurrence.key };
  }

  /**
   * Tells whether an occurrence is the first one of its series.
   *
   * @param event - The series.
   * @param key - The stored key of the occurrence.
   */
  public isFirstOccurrence(event: CalendarEventRecord, key: string): boolean {
    if (event.recurrence === null) return true;
    const base = readStoredTime(event, event.timeZone);
    // Every rule has its first occurrence within a week of its start.
    const first = listOccurrenceDates(
      event.recurrence,
      base.startDate,
      addDays(base.startDate, 7),
    )[0];
    const date = occurrenceDateOf(event, key);
    return first === undefined ? date <= base.startDate : date <= first.date;
  }

  private patchedTime(
    event: CalendarEventRecord,
    patch: CalendarEventPatch,
    context: {
      readonly viewer: CalendarViewer;
      readonly occurrence: CalendarOccurrence | null;
    },
  ): StoredCalendarTime {
    const base = readStoredTime(event, event.timeZone);
    const stored: StoredCalendarTime = {
      allDay: event.allDay,
      startAt: event.startAt,
      endAt: event.endAt,
      startDate: base.startDate,
    };
    if (!hasTimePatch(patch)) return stored;
    const { viewer, occurrence } = context;
    if (occurrence !== null && event.recurrence !== null)
      return shiftSeries(
        event,
        occurrence,
        patchedOccurrenceTime(occurrence, patch, viewer),
      );
    const current = formatOccurrence(base, viewer.timeZone);
    return readCalendarTime(
      {
        start: patch.start ?? current.start,
        end: patch.end ?? current.end,
        allDay: patch.allDay ?? event.allDay,
      },
      viewer.timeZone,
    );
  }
}
