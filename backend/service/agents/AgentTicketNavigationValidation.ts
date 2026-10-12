import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  AGENT_TICKET_LINK_OPERATIONS,
  AGENT_TICKET_NAVIGATION_READ_OPERATIONS,
} from "@/definition/AgentTicketNavigation";
import { isWorkItemLinkType, isWorkItemType } from "@/definition/Task";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import { readAgentTicketReference } from "./AgentTicketValidation";

import type {
  AgentAssignmentTargetType,
  AgentTicketLinkAddInput,
  AgentTicketLinkOperation,
  AgentTicketLinkRemoveInput,
  AgentTicketNavigationReadOperation,
  AgentTicketSearchInput,
} from "@/definition/AgentTicketNavigation";
import type { AgentTicketReference } from "@/definition/AgentTickets";
import type { WorkItemType } from "@/definition/Task";

/** The list window every navigation read takes; `pageAgentEntries` validates the values. */
export interface AgentReadWindow {
  readonly cursor: unknown;
  readonly limit: unknown;
}

const WINDOW_KEYS = ["cursor", "limit"];
const MAXIMUM_TAG_FILTERS = 50;

/** Tells whether an operation name is a ticket navigation read. */
export function isAgentTicketNavigationRead(
  name: unknown,
): name is AgentTicketNavigationReadOperation {
  return AGENT_TICKET_NAVIGATION_READ_OPERATIONS.some(
    (operation) => operation === name,
  );
}

/** Tells whether an operation name is a ticket link change. */
export function isAgentTicketLinkOperation(
  name: unknown,
): name is AgentTicketLinkOperation {
  return AGENT_TICKET_LINK_OPERATIONS.some((operation) => operation === name);
}

function readWindow(
  fields: Readonly<Record<string, unknown>>,
): AgentReadWindow {
  return { cursor: fields.cursor, limit: fields.limit };
}

/** Rejects a parameter name the operation does not take. */
function rejectUnknownKeys(
  fields: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  if (Object.keys(fields).some((key) => !allowed.includes(key)))
    throw new AgentOperationError("INVALID_REQUEST");
}

function readSearchText(input: unknown): string {
  if (typeof input !== "string")
    throw new AgentOperationError("INVALID_REQUEST");
  const text = input.trim();
  if (!text || Array.from(text).length > PAGES_AGENT_LIMITS.textCharacters)
    throw new AgentOperationError("INVALID_REQUEST");
  return text;
}

function readTagIds(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length > MAXIMUM_TAG_FILTERS)
    throw new AgentOperationError("INVALID_REQUEST");
  const tagIds: unknown[] = input;
  return [...new Set(tagIds.map(readIdentifier))];
}

const IDENTIFIER_FILTERS = [
  "statusId",
  "milestoneId",
  "departmentId",
  "assigneeId",
  "assigneeGroupId",
] as const;

/** Reads the filters that name one record by identifier; an absent filter stays out. */
function readIdentifierFilters(
  fields: Readonly<Record<string, unknown>>,
): Pick<AgentTicketSearchInput, (typeof IDENTIFIER_FILTERS)[number]> {
  return Object.fromEntries(
    IDENTIFIER_FILTERS.flatMap((key) =>
      fields[key] === undefined ? [] : [[key, readIdentifier(fields[key])]],
    ),
  );
}

function readTicketType(input: unknown): WorkItemType {
  if (!isWorkItemType(input)) throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

/**
 * Validates the filters and the window of a ticket search.
 *
 * @param input - The raw operation parameters.
 * @returns The project, the filters that are present and the list window.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing project, an unknown or malformed parameter,
 * or an assignee filter that names a person and a group.
 */
export function readAgentTicketSearch(input: unknown): {
  readonly search: AgentTicketSearchInput;
  readonly window: AgentReadWindow;
} {
  const fields = readParameterRecord(input);
  rejectUnknownKeys(fields, [
    "projectId",
    "text",
    "type",
    "parentId",
    "tagIds",
    ...IDENTIFIER_FILTERS,
    ...WINDOW_KEYS,
  ]);
  if (fields.assigneeId !== undefined && fields.assigneeGroupId !== undefined)
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    search: {
      projectId: readIdentifier(fields.projectId),
      ...readIdentifierFilters(fields),
      ...(fields.text === undefined
        ? {}
        : { text: readSearchText(fields.text) }),
      ...(fields.type === undefined
        ? {}
        : { type: readTicketType(fields.type) }),
      ...(fields.parentId === undefined
        ? {}
        : { parent: readAgentTicketReference(fields.parentId) }),
      ...(fields.tagIds === undefined
        ? {}
        : { tagIds: readTagIds(fields.tagIds) }),
    },
    window: readWindow(fields),
  };
}

/**
 * Validates the scope and the window of a tree read.
 *
 * @param input - The raw operation parameters.
 * @returns The project, the ticket whose subtree is wanted, and the list window.
 * @throws {AgentOperationError} `INVALID_REQUEST` when neither a project nor a ticket is named.
 *
 * @remarks
 * A ticket alone is enough: the project is the one of the ticket.
 */
export function readAgentTicketTree(input: unknown): {
  readonly projectId: string | null;
  readonly ticket: AgentTicketReference | null;
  readonly window: AgentReadWindow;
} {
  const fields = readParameterRecord(input);
  rejectUnknownKeys(fields, ["projectId", "ticketId", ...WINDOW_KEYS]);
  if (fields.projectId === undefined && fields.ticketId === undefined)
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    projectId:
      fields.projectId === undefined ? null : readIdentifier(fields.projectId),
    ticket:
      fields.ticketId === undefined
        ? null
        : readAgentTicketReference(fields.ticketId),
    window: readWindow(fields),
  };
}

/**
 * Validates the ticket and the window of a link read.
 *
 * @param input - The raw operation parameters.
 * @returns The reference to the ticket and the list window.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentTicketLinksRead(input: unknown): {
  readonly ticket: AgentTicketReference;
  readonly window: AgentReadWindow;
} {
  const fields = readParameterRecord(input);
  rejectUnknownKeys(fields, ["ticketId", ...WINDOW_KEYS]);
  return {
    ticket: readAgentTicketReference(fields.ticketId),
    window: readWindow(fields),
  };
}

/**
 * Validates the query and the window of an assignment target search.
 *
 * @param input - The raw operation parameters.
 * @returns The text, the kind of target and the project that narrow the search, and the list window.
 * @throws {AgentOperationError} `INVALID_REQUEST` for an unknown or malformed parameter.
 */
export function readAgentAssignmentTargetSearch(input: unknown): {
  readonly text: string | null;
  readonly targetType: AgentAssignmentTargetType | null;
  readonly projectId: string | null;
  readonly window: AgentReadWindow;
} {
  const fields = readParameterRecord(input);
  rejectUnknownKeys(fields, [
    "text",
    "targetType",
    "projectId",
    ...WINDOW_KEYS,
  ]);
  const { targetType } = fields;
  if (
    targetType !== undefined &&
    targetType !== "person" &&
    targetType !== "group" &&
    targetType !== "department"
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    text: fields.text === undefined ? null : readSearchText(fields.text),
    targetType: targetType ?? null,
    projectId:
      fields.projectId === undefined ? null : readIdentifier(fields.projectId),
    window: readWindow(fields),
  };
}

/**
 * Validates a link add before any persistence or policy read.
 *
 * @param input - The raw operation parameters.
 * @returns The ticket, the target and the link type; the ticket is the source of the link.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentTicketLinkAdd(
  input: unknown,
): AgentTicketLinkAddInput {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, [
    "operationId",
    "ticketId",
    "targetTicketId",
    "linkType",
  ]);
  if (!isWorkItemLinkType(fields.linkType))
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    operationId: readIdentifier(fields.operationId),
    ticket: readAgentTicketReference(fields.ticketId),
    target: readAgentTicketReference(fields.targetTicketId),
    linkType: fields.linkType,
  };
}

/**
 * Validates a link removal before any persistence or policy read.
 *
 * @param input - The raw operation parameters.
 * @returns The ticket and the link of that ticket to remove.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentTicketLinkRemove(
  input: unknown,
): AgentTicketLinkRemoveInput {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["operationId", "ticketId", "linkId"]);
  return {
    operationId: readIdentifier(fields.operationId),
    ticket: readAgentTicketReference(fields.ticketId),
    linkId: readIdentifier(fields.linkId),
  };
}
