import { randomUUID } from "node:crypto";

import { CalendarError } from "@/backend/error/CalendarError";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  checkCalendarInvitees,
  normalizeRecurrence,
  readCalendarTime,
} from "./CalendarEventInput";
import { normalizeOccurrenceKey, readStoredTime } from "./CalendarOccurrences";
import { CalendarPeople } from "./CalendarPeople";
import { formatOccurrence, parseEntryId } from "./CalendarProjection";
import { countOccurrencesFrom } from "./CalendarRecurrence";
import { CalendarSeriesChanges } from "./CalendarSeriesChanges";

import type { CalendarEventRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";
import type {
  CalendarAnswer,
  CalendarDeletionPreview,
  CalendarEventFields,
  CalendarEventPatch,
  CalendarScope,
} from "@/definition/Calendar";
import type { CalendarOccurrence } from "./CalendarOccurrences";
import type { CalendarReader, VisibleCalendarEvent } from "./CalendarReader";
import type { CalendarChangeResult } from "./CalendarSeriesChanges";
import type { CalendarDependencies, CalendarViewer } from "./CalendarViewer";

/**
 * Which event or occurrence a change addresses.
 *
 * @remarks
 * `id` is an event id or the id of an occurrence entry; `occurrenceStart`
 * names the occurrence when `id` is the series. `expectedRevision` refuses a
 * change of an event that changed since the client read it.
 */
export interface CalendarTargetRequest {
  readonly id: string;
  readonly scope: CalendarScope;
  readonly occurrenceStart?: string | null;
  readonly expectedRevision?: number;
}

/** The result of a change: the event and occurrence to show. */
export interface CalendarWriteResult {
  readonly eventId: string;
  readonly key: string | null;
}

/** Creates, changes, deletes and answers events of the calendar (PAGE-301). */
export class CalendarWriter {
  private readonly dependencies: CalendarDependencies;
  private readonly reader: CalendarReader;
  private readonly series: CalendarSeriesChanges;

  /**
   * Creates the writer.
   *
   * @param dependencies - Repositories and services.
   * @param reader - Visibility and targets.
   */
  public constructor(
    dependencies: CalendarDependencies,
    reader: CalendarReader,
  ) {
    this.dependencies = dependencies;
    this.reader = reader;
    this.series = new CalendarSeriesChanges(dependencies);
  }

  /**
   * Creates an event of the viewer.
   *
   * @param viewer - The creator; never a field of the client.
   * @param fields - The checked fields.
   * @throws {CalendarError} `forbidden` for a project the viewer may not
   * write in, `invalid_request` for invalid times, rules or invitees.
   */
  public async create(
    viewer: CalendarViewer,
    fields: CalendarEventFields,
  ): Promise<CalendarWriteResult> {
    await this.requireTarget(viewer, fields.calendarProjectId);
    const time = readCalendarTime(fields, viewer.timeZone);
    const invitees = await checkCalendarInvitees(
      this.dependencies.directory,
      fields.invitees,
    );
    const id = randomUUID();
    await this.dependencies.publisher.announce(
      async () => {
        await this.dependencies.events.insert({
          id,
          title: fields.title,
          description: fields.description,
          allDay: time.allDay,
          startAt: time.startAt,
          endAt: time.endAt,
          timeZone: viewer.timeZone,
          projectId: fields.calendarProjectId,
          createdBy: viewer.user.id,
          recurrence: normalizeRecurrence(fields.recurrence, time.startDate),
        });
        await this.dependencies.participation.replaceInvitations(id, invitees);
        return id;
      },
      () => [{ type: "calendar.changed", id }],
    );
    await this.notifyInvited([id], new Set());
    return { eventId: id, key: null };
  }

  /**
   * Changes an event or a scope of a series.
   *
   * @param viewer - The acting account.
   * @param target - Event, scope and expected revision.
   * @param patch - The fields that change; the others stay.
   * @throws {CalendarError} `not_found`, `forbidden`, `conflict` or `invalid_request`.
   */
  public async update(
    viewer: CalendarViewer,
    target: CalendarTargetRequest,
    patch: CalendarEventPatch,
  ): Promise<CalendarWriteResult> {
    const visible = await this.requireEditable(viewer, target);
    const { event } = visible;
    if (
      patch.calendarProjectId !== undefined &&
      patch.calendarProjectId !== event.projectId
    )
      await this.requireTarget(viewer, patch.calendarProjectId);
    const before = visible.people.of(event).affectedIds;
    const occurrence = await this.occurrenceOf(event, target);
    const result = await this.dependencies.publisher.announce(
      () =>
        this.applyUpdate(viewer, {
          event,
          occurrence,
          scope: target.scope,
          patch,
        }),
      (change) =>
        change.eventIds.map((id) => ({
          type: "calendar.changed" as const,
          id,
        })),
    );
    await this.notifyInvited(result.eventIds, before);
    return { eventId: result.eventId, key: result.key };
  }

  /**
   * Deletes an event or a scope of a series; invitees no longer see it.
   *
   * @param viewer - The acting account.
   * @param target - Event, scope and expected revision.
   */
  public async delete(
    viewer: CalendarViewer,
    target: CalendarTargetRequest,
  ): Promise<{ readonly eventId: string }> {
    const { event } = await this.requireEditable(viewer, target);
    const occurrence = await this.occurrenceOf(event, target);
    await this.dependencies.publisher.announce(
      () => this.series.delete(event, target.scope, occurrence),
      () => [{ type: "calendar.changed", id: event.id }],
    );
    return { eventId: event.id };
  }

  /**
   * Describes what a deletion would remove, without changing anything.
   *
   * @param viewer - The acting account.
   * @param target - Event, scope and expected revision.
   */
  public async previewDelete(
    viewer: CalendarViewer,
    target: CalendarTargetRequest,
  ): Promise<CalendarDeletionPreview> {
    const visible = await this.requireEditable(viewer, target);
    const { event } = visible;
    const occurrence = await this.occurrenceOf(event, target);
    const base = readStoredTime(event, event.timeZone);
    const shown = occurrence ?? base;
    const affected = this.affectedOccurrences(event, target.scope, occurrence);
    return {
      confirmationRequired: true,
      event: {
        id: event.id,
        title: event.title,
        start: formatOccurrence(shown, viewer.timeZone).start,
      },
      scope: event.recurrence === null ? "all" : target.scope,
      affectedOccurrences: affected,
      invitedCount: visible.people.of(event).affectedIds.size,
    };
  }

  /**
   * Stores the answer of an invited person for the whole series.
   *
   * @param viewer - The invited person.
   * @param id - The event or an occurrence of it.
   * @param answer - Accepted or declined.
   * @throws {CalendarError} `forbidden` for the creator, an agent or anyone
   * not invited.
   */
  public async respond(
    viewer: CalendarViewer,
    id: string,
    answer: CalendarAnswer,
  ): Promise<CalendarWriteResult> {
    const visible = await this.reader.requireVisible(viewer, id);
    const { event, people } = visible;
    const isInvited = people.of(event).affectedIds.has(viewer.user.id);
    if (
      !isInvited ||
      people.isAgent(viewer.user.id) ||
      viewer.user.isAgent === true
    )
      throw new CalendarError("forbidden", "Only invited people answer.");
    await this.dependencies.publisher.announce(
      () =>
        this.dependencies.participation.saveResponse({
          eventId: event.id,
          userId: viewer.user.id,
          response: answer,
        }),
      () => [{ type: "calendar.changed", id: event.id }],
    );
    return { eventId: event.id, key: parseEntryId(id).key };
  }

  private async applyUpdate(
    viewer: CalendarViewer,
    change: {
      readonly event: CalendarEventRecord;
      readonly occurrence:
        (CalendarOccurrence & { readonly key: string }) | null;
      readonly scope: CalendarScope;
      readonly patch: CalendarEventPatch;
    },
  ): Promise<CalendarChangeResult> {
    const { event, occurrence, scope, patch } = change;
    if (occurrence !== null && scope === "this")
      return this.series.updateThis(event, occurrence, { patch, viewer });
    if (
      occurrence !== null &&
      scope === "following" &&
      !this.series.isFirstOccurrence(event, occurrence.key)
    )
      return this.series.updateFollowing(event, occurrence, { patch, viewer });
    const next = this.series.patchedEvent(event, patch, { viewer, occurrence });
    const result = await this.series.updateAll(event, next, patch);
    return { ...result, key: occurrence?.key ?? null };
  }

  private affectedOccurrences(
    event: CalendarEventRecord,
    scope: CalendarScope,
    occurrence: CalendarOccurrence | null,
  ): number | "unbegrenzt" {
    if (event.recurrence === null || (scope === "this" && occurrence !== null))
      return 1;
    const base = readStoredTime(event, event.timeZone);
    const fromDate =
      scope === "following" && occurrence !== null
        ? occurrence.startDate
        : base.startDate;
    return countOccurrencesFrom(event.recurrence, base.startDate, fromDate);
  }

  private async requireEditable(
    viewer: CalendarViewer,
    target: CalendarTargetRequest,
  ): Promise<VisibleCalendarEvent> {
    const visible = await this.reader.requireVisible(viewer, target.id);
    const { event } = visible;
    if (event.createdBy !== viewer.user.id && !viewer.isAdmin)
      throw new CalendarError(
        "forbidden",
        "Only the creator or an administrator changes the event.",
      );
    if (
      target.expectedRevision !== undefined &&
      target.expectedRevision !== event.revision
    )
      throw new CalendarError(
        "conflict",
        "The event changed meanwhile.",
        event.revision,
      );
    return visible;
  }

  private async requireTarget(
    viewer: CalendarViewer,
    projectId: string | null,
  ): Promise<void> {
    if (projectId === null) return;
    const targets = await this.reader.targets(viewer);
    if (!targets.some((target) => target.projectId === projectId))
      throw new CalendarError(
        "forbidden",
        "The calendar of the project is not writable.",
      );
  }

  /** Finds the occurrence a change of a series addresses, or `null`. */
  private async occurrenceOf(
    event: CalendarEventRecord,
    target: CalendarTargetRequest,
  ): Promise<(CalendarOccurrence & { readonly key: string }) | null> {
    if (event.recurrence === null) return null;
    const raw = parseEntryId(target.id).key ?? target.occurrenceStart ?? null;
    if (raw === null) {
      if (target.scope === "all") return null;
      throw new CalendarError(
        "invalid_request",
        "occurrenceStart is required for this scope.",
      );
    }
    const key = normalizeOccurrenceKey(event, raw);
    return this.series.requireOccurrence(event, key);
  }

  /** Pushes the accounts that became invited; failures never undo the change. */
  private async notifyInvited(
    eventIds: readonly string[],
    before: ReadonlySet<string>,
  ): Promise<void> {
    const listener = this.dependencies.invitations?.() ?? null;
    if (listener === null) return;
    try {
      for (const eventId of eventIds) {
        const event = await this.dependencies.events.findById(eventId);
        if (!event || event.deletedAt !== null) continue;
        const people = await CalendarPeople.read(this.dependencies, [event]);
        const participants = people.of(event);
        const added = [...participants.affectedIds].filter(
          (userId) => !before.has(userId) && !people.isAgent(userId),
        );
        if (added.length === 0) continue;
        await listener.invited(
          {
            eventId: event.id,
            title: event.title,
            startAt: event.startAt,
            allDay: event.allDay,
            creatorId: event.createdBy,
            creatorName: participants.createdBy.name,
          },
          added,
        );
      }
    } catch (error: unknown) {
      logCaughtError("CalendarWriter", error);
    }
  }
}
