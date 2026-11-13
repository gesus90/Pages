import { createHash } from "node:crypto";

import { CalendarError } from "@/backend/error/CalendarError";
import {
  CALENDAR_LIMITS,
  calendarEventFieldsSchema,
  calendarEventPatchSchema,
} from "@/definition/Calendar";

import { CalendarReader, readCalendarWindow } from "./CalendarReader";
import { parseEntryId } from "./CalendarProjection";
import { readCalendarViewer } from "./CalendarViewer";
import { CalendarWriter } from "./CalendarWriter";

import type {
  CalendarAnswer,
  CalendarDeletionPreview,
  CalendarEventFields,
  CalendarEventPatch,
  CalendarEventView,
  CalendarInviteeKind,
  CalendarKind,
  CalendarOptions,
  CalendarRange,
  CalendarTarget,
  CalendarViewEntry,
} from "@/definition/Calendar";
import type { User } from "@/definition/User";
import type { CalendarTargetRequest } from "./CalendarWriter";
import type { CalendarDependencies, CalendarViewer } from "./CalendarViewer";

/** One person, agent, group or department an account may invite. */
export interface CalendarInviteeOption {
  readonly kind: CalendarInviteeKind;
  readonly id: string;
  readonly name: string;
}

/** What a range read can narrow. */
export interface CalendarRangeOptions {
  /** Calendars to include; all without a filter. */
  readonly kinds?: readonly CalendarKind[];
}

/** The outcome of a change with a stored operation ID. */
export type CalendarOperationOutcome<Result> =
  | { readonly kind: "fresh"; readonly result: Result }
  | { readonly kind: "replayed"; readonly result: unknown };

function readFields(input: unknown): CalendarEventFields {
  const parsed = calendarEventFieldsSchema.safeParse(input);
  if (!parsed.success)
    throw new CalendarError("invalid_request", "The event is invalid.");
  return parsed.data;
}

function readPatch(input: unknown): CalendarEventPatch {
  const parsed = calendarEventPatchSchema.safeParse(input);
  if (!parsed.success)
    throw new CalendarError("invalid_request", "The change is invalid.");
  return parsed.data;
}

/** The same value with the keys of every object sorted, so field order never matters. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

/**
 * The calendar of Pages (PAGE-301): the one service the interface, Pica
 * Mobile (`calendar.v1`), Pica and the MCP interface all call.
 *
 * @remarks
 * Every call reads the account's memberships and rights anew. Reads return
 * only what concerns the account: own events, invitations (directly, by
 * group or by department), project calendars of member projects, project
 * dates, due tickets and milestones. Only the creator, or an administrator,
 * changes or deletes an event. Times are answered in the account's zone.
 */
export class CalendarService {
  private readonly dependencies: CalendarDependencies;
  private readonly reader: CalendarReader;
  private readonly writer: CalendarWriter;

  /**
   * Creates the service.
   *
   * @param dependencies - Repositories and services.
   */
  public constructor(dependencies: CalendarDependencies) {
    this.dependencies = dependencies;
    this.reader = new CalendarReader(dependencies);
    this.writer = new CalendarWriter(dependencies, this.reader);
  }

  /**
   * Reads the viewer of a request: zone, language, memberships, rights.
   *
   * @param actor - The signed-in account.
   */
  public async viewer(actor: User): Promise<CalendarViewer> {
    return readCalendarViewer(this.dependencies, actor);
  }

  /**
   * Lists the entries of a range of at most 92 days.
   *
   * @param actor - The account.
   * @param range - `from` and `to`: dates (inclusive) or instants (`to` exclusive).
   * @param options - Optional calendar filter.
   * @throws {CalendarError} `invalid_request` for an invalid or too long range.
   */
  public async readRange(
    actor: User,
    range: { readonly from: string; readonly to: string },
    options: CalendarRangeOptions = {},
  ): Promise<CalendarRange> {
    const viewer = await this.viewer(actor);
    const window = readCalendarWindow(range.from, range.to, viewer.timeZone);
    const entries = await this.reader.readEntries(
      viewer,
      window,
      options.kinds === undefined ? undefined : new Set(options.kinds),
    );
    return {
      from: range.from,
      to: range.to,
      timeZone: viewer.timeZone,
      entries,
    };
  }

  /**
   * Reads one stored event with its series, invitees, answers and revision.
   *
   * @param actor - The account.
   * @param id - The event or an occurrence of it.
   * @throws {CalendarError} `not_found` for a missing or invisible event.
   */
  public async readEvent(actor: User, id: string): Promise<CalendarEventView> {
    const viewer = await this.viewer(actor);
    return this.reader.viewOf(viewer, await this.reader.requireVisible(viewer, id));
  }

  /**
   * Reads the entry of an event or of one of its occurrences.
   *
   * @param actor - The account.
   * @param id - The event, or an occurrence entry id.
   * @param occurrenceKey - The stored key of an occurrence, when `id` is the series.
   */
  public async readEntry(
    actor: User,
    id: string,
    occurrenceKey: string | null = null,
  ): Promise<CalendarViewEntry> {
    const viewer = await this.viewer(actor);
    const visible = await this.reader.requireVisible(viewer, id);
    return this.reader.entryOf(viewer, visible, parseEntryId(id).key ?? occurrenceKey);
  }

  /**
   * Creates an event; the creator is always the account.
   *
   * @param actor - The creator.
   * @param input - The fields of the client, checked here.
   * @returns The entry of the event, the first occurrence of a series.
   */
  public async create(actor: User, input: unknown): Promise<CalendarViewEntry> {
    const viewer = await this.viewer(actor);
    const result = await this.writer.create(viewer, readFields(input));
    return this.readEntry(actor, result.eventId, result.key);
  }

  /**
   * Changes an event or a scope of a series.
   *
   * @param actor - The creator or an administrator.
   * @param target - Event or occurrence, scope and expected revision.
   * @param patch - The changed fields of the client, checked here.
   * @returns The entry of the changed event or occurrence.
   */
  public async update(
    actor: User,
    target: CalendarTargetRequest,
    patch: unknown,
  ): Promise<CalendarViewEntry> {
    const viewer = await this.viewer(actor);
    const result = await this.writer.update(viewer, target, readPatch(patch));
    return this.readEntry(actor, result.eventId, result.key);
  }

  /**
   * Deletes an event or a scope of a series.
   *
   * @param actor - The creator or an administrator.
   * @param target - Event or occurrence, scope and expected revision.
   */
  public async delete(
    actor: User,
    target: CalendarTargetRequest,
  ): Promise<{ readonly eventId: string }> {
    return this.writer.delete(await this.viewer(actor), target);
  }

  /**
   * Describes a deletion without changing anything.
   *
   * @param actor - The creator or an administrator.
   * @param target - Event or occurrence, scope and expected revision.
   */
  public async previewDelete(
    actor: User,
    target: CalendarTargetRequest,
  ): Promise<CalendarDeletionPreview> {
    return this.writer.previewDelete(await this.viewer(actor), target);
  }

  /**
   * Answers an invitation for the whole series.
   *
   * @param actor - An invited person.
   * @param id - The event or an occurrence of it.
   * @param answer - Accepted or declined.
   * @returns The entry of the answered event or occurrence.
   */
  public async respond(
    actor: User,
    id: string,
    answer: CalendarAnswer,
  ): Promise<CalendarViewEntry> {
    const viewer = await this.viewer(actor);
    const result = await this.writer.respond(viewer, id, answer);
    return this.readEntry(actor, result.eventId, result.key);
  }

  /**
   * Searches whom the account may invite.
   *
   * @param actor - The account; it must be signed in.
   * @param text - Part of a name.
   * @param limit - Most options returned.
   */
  public async searchInvitees(
    actor: User,
    text: string,
    limit: number = CALENDAR_LIMITS.mobileInviteeOptions,
  ): Promise<CalendarInviteeOption[]> {
    const bounded = Math.max(1, Math.min(limit, CALENDAR_LIMITS.mcpInviteeOptions));
    const options = await this.dependencies.directory.searchInvitees(
      text.slice(0, 200),
      bounded + 1,
    );
    return options.filter((option) => option.id !== actor.id).slice(0, bounded);
  }

  /**
   * Lists "my events" and the projects the account may put events into.
   *
   * @param actor - The account.
   */
  public async targets(actor: User): Promise<CalendarTarget[]> {
    return this.reader.targets(await this.viewer(actor));
  }

  /**
   * Returns the zone, targets, rule choices and limits of the account.
   *
   * @param actor - The account.
   */
  public async options(actor: User): Promise<CalendarOptions> {
    return this.reader.options(await this.viewer(actor));
  }

  /**
   * Counts the future events the account is invited to and has not answered.
   *
   * @param actor - The account.
   */
  public async countOpenInvitations(actor: User): Promise<number> {
    return this.reader.countOpenInvitations(await this.viewer(actor));
  }

  /**
   * Tells whether an account hears of a change of an event or of the project
   * dates of a project, deleted events included.
   *
   * @param actor - The account.
   * @param objectId - An event ID, or `project:<projectId>`.
   */
  public async isAffected(actor: User, objectId: string): Promise<boolean> {
    if (objectId.startsWith("project:")) {
      const viewer = await this.viewer(actor);
      const projectId = objectId.slice("project:".length);
      return viewer.projects.some((project) => project.id === projectId);
    }
    return this.dependencies.participation.isAffected(actor.id, objectId);
  }

  /**
   * Announces a change of the project dates of a project to the live view.
   *
   * @param projectId - The project whose dates changed.
   */
  public announceProjectDates(projectId: string): void {
    this.dependencies.publisher.publish({
      type: "calendar.changed",
      id: `project:${projectId}`,
    });
  }

  /**
   * Runs a change once per operation ID of an account.
   *
   * @param actor - The acting account.
   * @param operation - The operation ID and the request it stands for.
   * @param work - The change; its result is stored as JSON.
   * @returns The fresh result, or the stored answer of an identical earlier call.
   * @throws {CalendarError} `conflict` when the same ID came with another request.
   */
  public async runOnce<Result>(
    actor: User,
    operation: { readonly operationId: string; readonly request: unknown },
    work: () => Promise<Result>,
  ): Promise<CalendarOperationOutcome<Result>> {
    const { participation } = this.dependencies;
    const digest = createHash("sha256")
      .update(JSON.stringify(canonical(operation.request)))
      .digest("hex");
    const stored = await participation.findOperation(actor.id, operation.operationId);
    if (stored !== null) {
      if (stored.requestDigest !== digest)
        throw new CalendarError("conflict", "The operation ID was used for another request.");
      const replayed: unknown = JSON.parse(stored.response);
      return { kind: "replayed", result: replayed };
    }
    const result = await work();
    await participation.saveOperation(actor.id, operation.operationId, {
      requestDigest: digest,
      response: JSON.stringify(result ?? null),
    });
    return { kind: "fresh", result };
  }
}
