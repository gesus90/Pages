import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { CalendarError } from "@/backend/error/CalendarError";

import { PICA_CALENDAR_SCHEMAS } from "./PicaCalendarToolSchemas";

import type { z } from "zod";
import type { CalendarErrorCode } from "@/backend/error/CalendarError";
import type { CalendarService } from "@/backend/service/calendar/CalendarService";
import type { UserService } from "@/backend/service/UserService";
import type { CalendarViewEntry } from "@/definition/Calendar";
import type { User } from "@/definition/User";
import type {
  PicaCalendarRecurrence,
  PicaCalendarTool,
} from "./PicaCalendarToolSchemas";

/** The chat operation behind each native calendar tool. */
export const PICA_CALENDAR_OPERATIONS = {
  "calendar.read": "calendar_read",
  "calendar.invitees.search": "calendar_invitees_search",
  "calendar.event.create": "calendar_event_create",
  "calendar.event.update": "calendar_event_update",
  "calendar.event.respond": "calendar_event_respond",
  "calendar.event.delete": "calendar_event_delete",
} as const satisfies Readonly<Record<string, PicaCalendarTool>>;

/** One chat operation of {@link PICA_CALENDAR_OPERATIONS}. */
export type PicaCalendarOperation = keyof typeof PICA_CALENDAR_OPERATIONS;

/** The calendar operations that change something and carry an operation ID. */
export const PICA_CALENDAR_WRITE_OPERATIONS: readonly PicaCalendarOperation[] =
  [
    "calendar.event.create",
    "calendar.event.update",
    "calendar.event.respond",
    "calendar.event.delete",
  ];

/** The part of the calendar service Pica uses. */
export type PicaCalendarOperations = Pick<
  CalendarService,
  | "readRange"
  | "searchInvitees"
  | "create"
  | "update"
  | "respond"
  | "previewDelete"
  | "delete"
  | "runOnce"
>;

/** What the calendar adapter of Pica is built from. */
export interface PicaCalendarToolDependencies {
  readonly users: Pick<UserService, "getById">;
  /** Resolved on every call, because the calendar starts after the chat. */
  readonly calendar: () => Promise<PicaCalendarOperations>;
  /**
   * The stored access of agent accounts; an agent with "read only" (or
   * without a stored access) may only read the calendar.
   */
  readonly agentAccess?: () => Promise<{
    find(agentId: string): Promise<{ readonly access: string } | null>;
  }>;
}

type ToolParameters = Readonly<Record<string, unknown>>;

/** One call after Pages resolved the acting account and the calendar. */
interface CalendarCall {
  readonly actor: User;
  readonly calendar: PicaCalendarOperations;
  readonly input: ToolParameters;
  readonly operationId: string | null;
}

const OPERATION_CODES: Readonly<
  Record<CalendarErrorCode, AgentOperationError["code"]>
> = {
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  invalid_request: "INVALID_REQUEST",
  conflict: "CONFLICT",
  too_large: "PAYLOAD_TOO_LARGE",
};

const DEFAULT_INVITEE_LIMIT = 20;

/** Tells whether an operation belongs to Pica's calendar tools. */
export function isPicaCalendarOperation(
  operation: string,
): operation is PicaCalendarOperation {
  return Object.hasOwn(PICA_CALENDAR_OPERATIONS, operation);
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "validation",
      problems: parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    });
  return parsed.data;
}

/** A rule without an interval repeats every period, as in the calendar dialog. */
function withInterval(
  recurrence: PicaCalendarRecurrence | null | undefined,
): (PicaCalendarRecurrence & { readonly interval: number }) | null | undefined {
  if (recurrence === null || recurrence === undefined) return recurrence;
  return { ...recurrence, interval: recurrence.interval ?? 1 };
}

/** The entry as the calendar shows it, without the interface-only details. */
function visibleEntry(
  entry: CalendarViewEntry,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== "details"),
  );
}

function toOperationError(error: CalendarError): AgentOperationError {
  if (error.code === "invalid_request")
    return new AgentOperationError("INVALID_REQUEST", {
      reason: "validation",
      problems: [error.message],
    });
  if (error.code === "conflict" && error.currentRevision !== undefined)
    return new AgentOperationError("CONFLICT", {
      currentRevision: error.currentRevision,
    });
  return new AgentOperationError(OPERATION_CODES[error.code]);
}

/** Runs a change once per server-owned operation ID. */
async function once(
  call: CalendarCall,
  operation: PicaCalendarOperation,
  work: () => Promise<unknown>,
): Promise<unknown> {
  if (call.operationId === null) return work();
  const outcome = await call.calendar.runOnce(
    call.actor,
    {
      operationId: call.operationId,
      request: { operation, parameters: call.input },
    },
    work,
  );
  return outcome.result;
}

async function readCalendar(call: CalendarCall): Promise<unknown> {
  const range = parse(PICA_CALENDAR_SCHEMAS.calendar_read, call.input);
  const read = await call.calendar.readRange(call.actor, range);
  return { ...read, entries: read.entries.map(visibleEntry) };
}

async function searchInvitees(call: CalendarCall): Promise<unknown> {
  const { query, limit } = parse(
    PICA_CALENDAR_SCHEMAS.calendar_invitees_search,
    call.input,
  );
  const invitees = await call.calendar.searchInvitees(
    call.actor,
    query,
    limit ?? DEFAULT_INVITEE_LIMIT,
  );
  return { invitees };
}

async function createEvent(call: CalendarCall): Promise<unknown> {
  const fields = parse(PICA_CALENDAR_SCHEMAS.calendar_event_create, call.input);
  return once(call, "calendar.event.create", async () =>
    visibleEntry(
      await call.calendar.create(call.actor, {
        ...fields,
        recurrence: withInterval(fields.recurrence),
      }),
    ),
  );
}

async function updateEvent(call: CalendarCall): Promise<unknown> {
  const { id, scope, occurrenceStart, recurrence, ...patch } = parse(
    PICA_CALENDAR_SCHEMAS.calendar_event_update,
    call.input,
  );
  return once(call, "calendar.event.update", async () =>
    visibleEntry(
      await call.calendar.update(
        call.actor,
        { id, scope, occurrenceStart },
        recurrence === undefined
          ? patch
          : { ...patch, recurrence: withInterval(recurrence) },
      ),
    ),
  );
}

async function respondToEvent(call: CalendarCall): Promise<unknown> {
  const { id, response } = parse(
    PICA_CALENDAR_SCHEMAS.calendar_event_respond,
    call.input,
  );
  return once(call, "calendar.event.respond", async () =>
    visibleEntry(await call.calendar.respond(call.actor, id, response)),
  );
}

/** Without `confirmed: true` the deletion is only described; nothing changes. */
async function deleteEvent(call: CalendarCall): Promise<unknown> {
  const { confirmed, ...target } = parse(
    PICA_CALENDAR_SCHEMAS.calendar_event_delete,
    call.input,
  );
  if (confirmed !== true)
    return call.calendar.previewDelete(call.actor, target);
  return once(call, "calendar.event.delete", async () => {
    const { eventId } = await call.calendar.delete(call.actor, target);
    return { deleted: true, eventId, scope: target.scope };
  });
}

const HANDLERS: Readonly<
  Record<PicaCalendarOperation, (call: CalendarCall) => Promise<unknown>>
> = {
  "calendar.read": readCalendar,
  "calendar.invitees.search": searchInvitees,
  "calendar.event.create": createEvent,
  "calendar.event.update": updateEvent,
  "calendar.event.respond": respondToEvent,
  "calendar.event.delete": deleteEvent,
};

/**
 * Adapts Pica's calendar operations to the calendar service of the interface
 * (PAGE-301).
 *
 * @remarks
 * Every call acts as the verified account with its current rights: it reads
 * only what that account's calendar shows, and only the creator of an event,
 * or an administrator, changes or deletes it. A deletion runs only with
 * `confirmed: true`; without it the call returns what would be removed.
 */
export class PicaCalendarToolService {
  private readonly dependencies: PicaCalendarToolDependencies;

  /**
   * Captures the account lookup and the lazily started calendar.
   *
   * @param dependencies - Users and the calendar service.
   */
  public constructor(dependencies: PicaCalendarToolDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs a calendar operation, or returns null for another operation.
   *
   * @param userId - The verified acting account, supplied by the executor.
   * @param operation - The internal chat operation.
   * @param parameters - The native arguments, with an optional server-owned operation ID.
   * @returns The result of the calendar service.
   * @throws {AgentOperationError} For malformed input, an unavailable account
   * or a refusal of the calendar, with the matching chat error code.
   */
  public async handle(
    userId: string,
    operation: string,
    parameters: ToolParameters,
  ): Promise<{ readonly result: unknown } | null> {
    if (!isPicaCalendarOperation(operation)) return null;
    const { operationId, ...input } = parameters;
    const actor = await this.actor(userId);
    if (
      operation.startsWith("calendar.event.") &&
      (await this.isReadOnly(actor))
    )
      throw new AgentOperationError("FORBIDDEN");
    const call: CalendarCall = {
      actor,
      calendar: await this.dependencies.calendar(),
      input,
      operationId: typeof operationId === "string" ? operationId : null,
    };
    try {
      return { result: await HANDLERS[operation](call) };
    } catch (error: unknown) {
      if (error instanceof CalendarError) throw toOperationError(error);
      throw error;
    }
  }

  private async isReadOnly(actor: User): Promise<boolean> {
    if (actor.isAgent !== true || this.dependencies.agentAccess === undefined)
      return false;
    const employee = await (
      await this.dependencies.agentAccess()
    ).find(actor.id);
    return (employee?.access ?? "read_only") === "read_only";
  }

  private async actor(userId: string): Promise<User> {
    const actor = await this.dependencies.users.getById(userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new AgentOperationError("FORBIDDEN");
    return actor;
  }
}
