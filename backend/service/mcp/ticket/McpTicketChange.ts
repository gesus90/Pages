import { taskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";

import { McpTicketError } from "./McpTicketError";

import type { UpdateWorkItemInput } from "@/backend/service/task/TaskWriteService";
import type { WorkItemDetail } from "@/definition/Task";
import type { McpTicketContext } from "./McpTicketContext";
import type {
  McpTicketExpected,
  McpTicketPatchRequest,
} from "./McpTicketRequest";

/** The fields of a change that the complete ticket edit of the interface saves. */
const UPDATE_FIELDS = [
  "title",
  "description",
  "statusId",
  "priority",
  "assignee",
  "assigneeGroupId",
  "reporter",
  "parent",
  "milestoneId",
  "startAt",
  "dueAt",
] as const satisfies readonly (keyof McpTicketPatchRequest)[];

/** Internal ids of the people and the parent a change names. */
export interface McpTicketReferences {
  readonly assigneeId: string | null;
  readonly assigneeGroupId: string | null;
  readonly reporterId: string;
  readonly parentId: string | null;
}

/** A stored value of a ticket in the form the interface names it. */
type ComparableValue = string | null | readonly string[];

/** Reads the current value of each field `expected` may name. */
const CURRENT_VALUE: Readonly<
  Record<
    keyof McpTicketExpected,
    (
      context: McpTicketContext,
      ticket: WorkItemDetail,
    ) => Promise<ComparableValue>
  >
> = {
  title: async (_, ticket) => ticket.title,
  description: async (_, ticket) => ticket.description,
  statusId: async (_, ticket) => ticket.statusId,
  priority: async (_, ticket) => ticket.priority,
  assignee: async (context, ticket) =>
    (await context.person(ticket.assigneeId))?.username ?? null,
  assigneeGroupId: async (_, ticket) => ticket.assigneeGroupId,
  reporter: async (context, ticket) =>
    (await context.person(ticket.createdBy))?.username ?? null,
  departmentId: async (_, ticket) => ticket.departmentId,
  parent: async (_, ticket) => ticket.parentKey,
  milestoneId: async (_, ticket) => ticket.milestoneId,
  startAt: async (_, ticket) => ticket.startAt?.slice(0, 10) ?? null,
  dueAt: async (_, ticket) => ticket.dueAt?.slice(0, 10) ?? null,
  labelIds: async (context, ticket) =>
    (
      (await context.services.tasks.findLabelsForWorkItems([ticket.id])).get(
        ticket.id,
      ) ?? []
    ).map((label) => label.id),
};

/** Brings a value into the form two readings of it compare equal in. */
function comparable(
  field: keyof McpTicketExpected,
  value: ComparableValue,
): string {
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  if (
    typeof value === "string" &&
    (field === "assignee" || field === "reporter")
  )
    return JSON.stringify(value.toLowerCase());
  if (typeof value === "string" && field === "parent")
    return JSON.stringify(value.toUpperCase());
  return JSON.stringify(value);
}

/**
 * Compares the values a client last read with the stored ones.
 *
 * @param context - The request.
 * @param ticket - The ticket as stored now.
 * @param expected - The values the client names.
 * @throws {McpTicketError} `conflict` when one of them changed meanwhile.
 *
 * @remarks
 * This answers before anything is written; the complete edit then saves on
 * the condition that the values it read are still stored, which is the
 * comparison the interface uses when it saves.
 */
export async function requireExpected(
  context: McpTicketContext,
  ticket: WorkItemDetail,
  expected: McpTicketExpected,
): Promise<void> {
  for (const field of Object.keys(
    CURRENT_VALUE,
  ) as (keyof McpTicketExpected)[]) {
    const wanted = expected[field];
    if (wanted === undefined) continue;
    const current = await CURRENT_VALUE[field](context, ticket);
    if (comparable(field, wanted) !== comparable(field, current))
      throw new McpTicketError("conflict");
  }
}

/** Whether a change names a field of the complete ticket edit. */
export function changesTicketFields(request: McpTicketPatchRequest): boolean {
  return UPDATE_FIELDS.some((field) => request[field] !== undefined);
}

/** Resolves the person assignment of a change; one of person and group replaces the other. */
async function resolveAssignment(
  context: McpTicketContext,
  ticket: WorkItemDetail,
  request: McpTicketPatchRequest,
): Promise<Pick<McpTicketReferences, "assigneeId" | "assigneeGroupId">> {
  if (request.assignee !== undefined && request.assignee !== null)
    return {
      assigneeId: await context.requireAssignablePerson(
        ticket.projectId,
        request.assignee,
      ),
      assigneeGroupId: null,
    };
  if (request.assigneeGroupId !== undefined && request.assigneeGroupId !== null)
    return { assigneeId: null, assigneeGroupId: request.assigneeGroupId };
  return {
    assigneeId: request.assignee === null ? null : ticket.assigneeId,
    assigneeGroupId:
      request.assigneeGroupId === null ? null : ticket.assigneeGroupId,
  };
}

/**
 * Resolves the usernames and the parent key of a change to internal ids.
 *
 * @param context - The request.
 * @param ticket - The ticket as stored now.
 * @param request - The change.
 * @throws {McpTicketError} `not_found` for a hidden person or parent,
 * `invalid_request` for an assignee who may not receive tickets of the project.
 */
export async function resolveReferences(
  context: McpTicketContext,
  ticket: WorkItemDetail,
  request: McpTicketPatchRequest,
): Promise<McpTicketReferences> {
  const assignment = await resolveAssignment(context, ticket, request);
  const reporterId =
    request.reporter === undefined
      ? ticket.createdBy
      : (await context.requireVisiblePerson(request.reporter)).id;
  let parentId = ticket.parentId;
  if (request.parent !== undefined)
    parentId =
      request.parent === null
        ? null
        : (await context.ticket(request.parent)).id;
  return { ...assignment, reporterId, parentId };
}

/**
 * Builds the complete edit the interface saves from a partial change.
 *
 * @param ticket - The ticket as stored now; unnamed fields keep its values.
 * @param request - The change.
 * @param references - The resolved people and parent.
 * @returns The edit, conditioned on the values just read.
 */
export function updateInput(
  ticket: WorkItemDetail,
  request: McpTicketPatchRequest,
  references: McpTicketReferences,
): UpdateWorkItemInput {
  return {
    ...references,
    title: request.title ?? ticket.title,
    description: request.description,
    baseDescription:
      request.description === undefined ? undefined : ticket.description,
    expected: taskUpdateSnapshot(ticket),
    statusId: request.statusId ?? ticket.statusId,
    priority: request.priority ?? ticket.priority,
    milestoneId:
      request.milestoneId === undefined
        ? ticket.milestoneId
        : request.milestoneId,
    startAt: request.startAt === undefined ? ticket.startAt : request.startAt,
    dueAt: request.dueAt === undefined ? ticket.dueAt : request.dueAt,
  };
}

/**
 * Rejects a change of an archived ticket, as the interface offers none.
 *
 * @param ticket - The ticket to change.
 * @throws {McpTicketError} `invalid_request` when it is archived.
 */
export function requireActiveTicket(ticket: WorkItemDetail): void {
  if (ticket.archivedAt !== null) throw new McpTicketError("invalid_request");
}

/**
 * Checks that every label of a request exists in the shared catalog.
 *
 * @param context - The request.
 * @param labelIds - The labels to assign.
 * @throws {McpTicketError} `not_found` for an unknown label.
 */
export async function requireLabels(
  context: McpTicketContext,
  labelIds: readonly string[],
): Promise<void> {
  if (labelIds.length === 0) return;
  const known = new Set(
    (await context.services.tasks.findLabels()).map((label) => label.id),
  );
  if (!labelIds.every((labelId) => known.has(labelId)))
    throw new McpTicketError("not_found");
}
