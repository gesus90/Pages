import { z } from "zod";

import {
  CALENDAR_KINDS,
  CALENDAR_LIMITS,
  CALENDAR_SCOPES,
  calendarAnswerSchema,
  calendarEventFieldsSchema,
  calendarEventPatchSchema,
  calendarTimeSchema,
} from "@/definition/Calendar";

import { McpCalendarError } from "./McpCalendarError";

import type {
  CalendarAnswer,
  CalendarEventFields,
  CalendarEventPatch,
  CalendarKind,
  CalendarScope,
} from "@/definition/Calendar";

/** Longest path parameter: an event ID or the ID of one of its occurrences. */
const MAXIMUM_IDENTIFIER_LENGTH = 300;
/** Longest search text of the invitee search. */
const MAXIMUM_SEARCH_LENGTH = 200;
/** Options of the invitee search without a `limit`. */
const DEFAULT_INVITEE_LIMIT = CALENDAR_LIMITS.mobileInviteeOptions;

const operationIdField = z.uuid();
const revisionField = z.number().int().min(0);
const scopeField = z.enum(CALENDAR_SCOPES);

const rangeQuerySchema = z
  .object({
    from: calendarTimeSchema,
    to: calendarTimeSchema,
    kinds: z.string().max(200).optional(),
  })
  .strict();

const inviteeQuerySchema = z
  .object({
    text: z.string().max(MAXIMUM_SEARCH_LENGTH).optional(),
    limit: z
      .string()
      .regex(/^\d{1,3}$/u)
      .transform(Number)
      .pipe(z.number().int().min(1).max(CALENDAR_LIMITS.mcpInviteeOptions))
      .optional(),
  })
  .strict();

const createSchema = calendarEventFieldsSchema
  .extend({ operationId: operationIdField })
  .strict();

const updateSchema = calendarEventPatchSchema
  .extend({
    operationId: operationIdField,
    expectedRevision: revisionField,
    scope: scopeField.optional(),
    occurrenceStart: calendarTimeSchema.optional(),
  })
  .strict();

const respondSchema = z
  .object({ operationId: operationIdField, response: calendarAnswerSchema })
  .strict();

const deleteSchema = z
  .object({
    operationId: operationIdField,
    expectedRevision: revisionField,
    scope: scopeField.optional(),
    occurrenceStart: calendarTimeSchema.optional(),
    confirmed: z.boolean().optional(),
  })
  .strict();

const emptySchema = z.object({}).strict();

/** The query of `GET /calendar/entries` (list_calendar). */
export interface McpCalendarRangeRequest {
  readonly from: string;
  readonly to: string;
  /** The calendars to include; all without the parameter. */
  readonly kinds?: readonly CalendarKind[];
}

/** The query of `GET /calendar/invitees` (search_calendar_invitees). */
export interface McpCalendarInviteeRequest {
  readonly text: string;
  readonly limit: number;
}

/** Event, occurrence and expected revision of a change or a deletion. */
export interface McpCalendarTarget {
  readonly expectedRevision: number;
  /** Missing only for a single event, where it counts as `all`. */
  readonly scope?: CalendarScope;
  readonly occurrenceStart?: string;
}

/** The body of `POST /calendar/events` (create_calendar_event). */
export interface McpCalendarCreateRequest {
  readonly operationId: string;
  readonly fields: CalendarEventFields;
}

/** The body of `PATCH /calendar/events/{id}` (update_calendar_event). */
export interface McpCalendarUpdateRequest {
  readonly operationId: string;
  readonly target: McpCalendarTarget;
  /** The named fields; every other field stays as it is. */
  readonly patch: CalendarEventPatch;
}

/** The body of `POST /calendar/events/{id}/response` (respond_calendar_event). */
export interface McpCalendarRespondRequest {
  readonly operationId: string;
  readonly response: CalendarAnswer;
}

/** The body of `POST /calendar/events/{id}/delete` (delete_calendar_event). */
export interface McpCalendarDeleteRequest {
  readonly operationId: string;
  readonly target: McpCalendarTarget;
  readonly isConfirmed: boolean;
}

/** Parses untrusted input or rejects it with `invalid_request`. */
function parse<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const result = schema.safeParse(input);
  if (!result.success) throw new McpCalendarError("invalid_request");
  return result.data;
}

/**
 * Reads the query of a request as an object of single values.
 *
 * @throws {McpCalendarError} `invalid_request` for a parameter named twice.
 */
function queryObject(query: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(values, name))
      throw new McpCalendarError("invalid_request");
    values[name] = value;
  }
  return values;
}

function isCalendarKind(text: string): text is CalendarKind {
  return CALENDAR_KINDS.some((kind) => kind === text);
}

/**
 * Reads the comma-separated calendar filter.
 *
 * @throws {McpCalendarError} `invalid_request` for an empty or unknown kind.
 */
function readKinds(text: string): CalendarKind[] {
  const kinds = new Set<CalendarKind>();
  for (const part of text.split(",")) {
    const kind = part.trim();
    if (!isCalendarKind(kind)) throw new McpCalendarError("invalid_request");
    kinds.add(kind);
  }
  return [...kinds];
}

function readRange(query: URLSearchParams): McpCalendarRangeRequest {
  const { from, to, kinds } = parse(rangeQuerySchema, queryObject(query));
  return kinds === undefined
    ? { from, to }
    : { from, to, kinds: readKinds(kinds) };
}

function readInvitees(query: URLSearchParams): McpCalendarInviteeRequest {
  const { text, limit } = parse(inviteeQuerySchema, queryObject(query));
  return { text: text ?? "", limit: limit ?? DEFAULT_INVITEE_LIMIT };
}

function readCreate(body: unknown): McpCalendarCreateRequest {
  const { operationId, ...fields } = parse(createSchema, body);
  return { operationId, fields };
}

function readUpdate(body: unknown): McpCalendarUpdateRequest {
  const parsed = parse(updateSchema, body);
  const { operationId, expectedRevision, scope, occurrenceStart, ...patch } =
    parsed;
  if (Object.keys(patch).length === 0)
    throw new McpCalendarError("invalid_request");
  return {
    operationId,
    target: { expectedRevision, scope, occurrenceStart },
    patch,
  };
}

function readDelete(body: unknown): McpCalendarDeleteRequest {
  const { operationId, expectedRevision, scope, occurrenceStart, confirmed } =
    parse(deleteSchema, body);
  return {
    operationId,
    target: { expectedRevision, scope, occurrenceStart },
    isConfirmed: confirmed === true,
  };
}

/**
 * Reads a path parameter of a calendar resource.
 *
 * @param value - The parameter as the router passes it.
 * @returns The event ID or occurrence ID.
 * @throws {McpCalendarError} `not_found` for a missing or overlong parameter.
 */
function readEventId(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "" || trimmed.length > MAXIMUM_IDENTIFIER_LENGTH)
    throw new McpCalendarError("not_found");
  return trimmed;
}

/** Validators of every query, body and path parameter the calendar API takes (PAGE-301). */
export const McpCalendarRequest = {
  range: readRange,
  invitees: readInvitees,
  create: readCreate,
  update: readUpdate,
  respond: (body: unknown): McpCalendarRespondRequest =>
    parse(respondSchema, body),
  delete: readDelete,
  eventId: readEventId,
  empty: (query: URLSearchParams): void => {
    parse(emptySchema, queryObject(query));
  },
} as const;
