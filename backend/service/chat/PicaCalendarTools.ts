import { PICA_CALENDAR_SCHEMAS } from "./PicaCalendarToolSchemas";
import { PICA_TOOL_OUTCOME } from "./PicaToolSchemas";

import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { PicaCalendarTool } from "./PicaCalendarToolSchemas";
import type { PicaCalendarOperation } from "./PicaCalendarToolService";
import type { PicaToolOutcome } from "./PicaToolSchemas";

type ToolParameters = Readonly<Record<string, unknown>>;

/** How a calendar tool reaches the operation catalog of the chat. */
interface CalendarToolDispatch {
  readonly execute: (
    operation: PicaCalendarOperation,
    parameters: ToolParameters,
    context: RuntimeExecutionContext,
  ) => Promise<PicaToolOutcome>;
}

interface CalendarToolBinding {
  readonly operation: PicaCalendarOperation;
  readonly description: string;
}

const RIGHTS =
  "Pages runs the call as the person of this conversation (or the agent's own account in an agent's session) with their current calendar rights.";

const TIMES =
  "Times are ISO-8601 with offset (e.g. 2026-11-16T09:00:00+01:00) or, for all-day events, dates YYYY-MM-DD with end as the last day (inclusive); use the person's time zone, which calendar_read returns as timeZone.";

const TARGET =
  "id is an entry id from calendar_read (each occurrence of a series has its own, which already names the occurrence) or an event id; scope this|following|all selects the occurrence, it and all later ones, or the whole series; with an event id and scope this or following, occurrenceStart names the occurrence. A single event ignores scope.";

const CALENDAR_TOOLS: Readonly<Record<PicaCalendarTool, CalendarToolBinding>> =
  {
    calendar_read: {
      operation: "calendar.read",
      description: `Read the person's calendar for a period of at most 92 days, exactly as their calendar view shows it: own events, invitations (directly, by group or by department), project calendars of their projects, project dates, due tickets and milestones. from and to are dates (inclusive, in the person's time zone) or ISO instants (to exclusive). Returns timeZone and entries with title, start, end, allDay, calendar, invitees, responses (accepted|declined|open per person), myResponse, recurrence, source and editable. Use it for "What is on tomorrow?" (from = to = tomorrow's date). The person sees only their own calendar: whether others, such as the members of a group, are free is only known for the events the person can see, for example shared invitations and project events; say so instead of claiming someone is free. ${RIGHTS}`,
    },
    calendar_invitees_search: {
      operation: "calendar.invitees.search",
      description: `Find whom the person may invite by part of a name: people, agents, groups and departments with kind, id and name (at most 50, default 20). Use the kind and id in invitees of calendar_event_create or calendar_event_update. Ambiguous names are never resolved automatically; ask the person. ${RIGHTS}`,
    },
    calendar_event_create: {
      operation: "calendar.event.create",
      description: `Create an event the person owns, on their request. title, start, end and allDay are required; description, calendarProjectId (a project calendar the person may write to, null or left out for their own events), invitees [{kind: person|agent|group|department, id}] with ids from calendar_invitees_search, and recurrence {frequency: daily|weekly|monthly|yearly, interval (default 1), weekdays [mo..su] only for weekly, until YYYY-MM-DD or count, not both}. ${TIMES} Example "a weekly every Monday at 9 with Team Pages": search the group with calendar_invitees_search, then create with start next Monday 09:00, a suitable end, invitees [{kind: group, id}] and recurrence {frequency: weekly, interval: 1, weekdays: [mo]}. Returns the entry of the event (the first occurrence of a series). ${RIGHTS}`,
    },
    calendar_event_update: {
      operation: "calendar.event.update",
      description: `Change an event; only its creator or an administrator may. ${TARGET} Give only the fields to change (title, description, start, end, allDay, calendarProjectId, invitees replaces the whole list, recurrence or null to end the series rule). ${TIMES} Returns the changed entry. ${RIGHTS}`,
    },
    calendar_event_respond: {
      operation: "calendar.event.respond",
      description: `Accept or decline an invitation for the person with response accepted|declined; the answer applies to the whole series. id is an entry id from calendar_read or an event id. Only invited people answer; the creator cannot. ${RIGHTS}`,
    },
    calendar_event_delete: {
      operation: "calendar.event.delete",
      description: `Delete an event or a part of a series; only its creator or an administrator may. Delete only on the person's explicit request in the current message. ${TARGET} First call without confirmed: it changes nothing and returns the event, the scope, affectedOccurrences and invitedCount; show that to the person and ask them to confirm. Only after they confirm, call again with the same arguments and confirmed: true; it returns deleted: true. ${RIGHTS}`,
    },
  };

function isCalendarTool(name: string): name is PicaCalendarTool {
  return Object.hasOwn(CALENDAR_TOOLS, name);
}

/**
 * Registers Pica's calendar tools (PAGE-301), which agent employees receive
 * through their bridge too.
 *
 * @param registry - The tool registry of one turn.
 * @param dispatch - Runs an operation through the chat's operation catalog.
 */
export function registerPicaCalendarTools(
  registry: RuntimeToolRegistry,
  dispatch: CalendarToolDispatch,
): void {
  for (const tool of Object.keys(PICA_CALENDAR_SCHEMAS).filter(
    isCalendarTool,
  )) {
    const { operation, description } = CALENDAR_TOOLS[tool];
    registry.register<ToolParameters, PicaToolOutcome>({
      id: tool,
      description,
      inputSchema: PICA_CALENDAR_SCHEMAS[tool],
      outputSchema: PICA_TOOL_OUTCOME,
      execute: (parameters, context) =>
        dispatch.execute(operation, parameters, context),
    });
  }
}
