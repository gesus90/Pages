import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { isMilestoneLinkType, isWorkItemType } from "@/definition/Task";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type {
  AgentMilestoneCreateInput,
  AgentMilestoneDependencyAddInput,
  AgentMilestoneDependencyRemoveInput,
  AgentMilestoneField,
  AgentMilestoneFieldInput,
  AgentMilestoneFieldOperation,
  AgentMilestoneOperation,
  AgentTicketAssignee,
  AgentTicketCreateInput,
  AgentTicketField,
  AgentTicketFieldInput,
  AgentTicketFieldOperation,
  AgentTicketOperation,
  AgentTicketReference,
} from "@/definition/AgentTickets";

const TICKET_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const TICKET_IDENTIFIER = /^[\w-]+$/;
const TICKET_ADDRESS =
  /^(?:https?:\/\/[^\s/?#]+)?(?:\/[^\s?#]*)?\/(?:aufgaben|tasks)\/([A-Za-z][A-Za-z0-9]*-\d+)\/?(?:[?#]\S*)?$/;

/** The parameter names of each single-field ticket operation. */
const TICKET_FIELDS: Readonly<
  Record<
    AgentTicketFieldOperation,
    {
      readonly field: AgentTicketField;
      readonly expected: string;
      readonly value: string;
    }
  >
> = {
  "ticket.setTitle": {
    field: "title",
    expected: "expectedTitle",
    value: "title",
  },
  "ticket.setDescription": {
    field: "description",
    expected: "expectedDescription",
    value: "description",
  },
  "ticket.setStatus": {
    field: "status",
    expected: "expectedStatusId",
    value: "statusId",
  },
  "ticket.setParent": {
    field: "parent",
    expected: "expectedParentId",
    value: "parentId",
  },
};

/** The parameter names of each single-field milestone operation. */
const MILESTONE_FIELDS: Readonly<
  Record<
    AgentMilestoneFieldOperation,
    {
      readonly field: AgentMilestoneField;
      readonly expected: string;
      readonly value: string;
    }
  >
> = {
  "milestone.setName": {
    field: "name",
    expected: "expectedName",
    value: "name",
  },
  "milestone.setDescription": {
    field: "description",
    expected: "expectedDescription",
    value: "description",
  },
  "milestone.setStatus": {
    field: "status",
    expected: "expectedStatus",
    value: "status",
  },
  "milestone.setStartAt": {
    field: "startAt",
    expected: "expectedStartAt",
    value: "startAt",
  },
  "milestone.setDueAt": {
    field: "dueAt",
    expected: "expectedDueAt",
    value: "dueAt",
  },
};

/** Tells whether an operation name is a single-field ticket operation. */
export function isAgentTicketFieldOperation(
  name: unknown,
): name is AgentTicketFieldOperation {
  return typeof name === "string" && Object.keys(TICKET_FIELDS).includes(name);
}

/** Tells whether an operation name is a ticket write. */
export function isAgentTicketOperation(
  name: unknown,
): name is AgentTicketOperation {
  return name === "ticket.create" || isAgentTicketFieldOperation(name);
}

/** Tells whether an operation name is a single-field milestone operation. */
export function isAgentMilestoneFieldOperation(
  name: unknown,
): name is AgentMilestoneFieldOperation {
  return (
    typeof name === "string" && Object.keys(MILESTONE_FIELDS).includes(name)
  );
}

/** Tells whether an operation name is a milestone write. */
export function isAgentMilestoneOperation(
  name: unknown,
): name is AgentMilestoneOperation {
  return (
    name === "milestone.create" ||
    name === "milestone.dependency.add" ||
    name === "milestone.dependency.remove" ||
    isAgentMilestoneFieldOperation(name)
  );
}

/**
 * Resolves a ticket identifier, key or Pages address to a reference.
 *
 * @param reference - An identifier, a key such as `PAGE-12`, or an address such
 * as `/tasks/PAGE-12` or `/aufgaben/PAGE-12`, with or without the address of
 * the server in front of it.
 * @returns The reference, or `null` when the text names no ticket.
 *
 * @remarks
 * Only the path matters, like for wiki links. The result names a ticket, it
 * does not prove that the ticket exists or is visible; the read decides that.
 */
export function resolveAgentTicketReference(
  reference: string,
): AgentTicketReference | null {
  const name = reference.trim();

  if (TICKET_KEY.test(name)) return { key: name.toUpperCase() };
  const addressed = TICKET_ADDRESS.exec(name)?.[1];
  if (addressed !== undefined) return { key: addressed.toUpperCase() };
  return TICKET_IDENTIFIER.test(name) ? { id: name } : null;
}

/**
 * Reads a parameter that names a ticket by identifier, key or Pages address.
 *
 * @param input - The raw value.
 * @returns The reference to the ticket.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a value that names no ticket.
 */
export function readAgentTicketReference(input: unknown): AgentTicketReference {
  const reference = resolveAgentTicketReference(readIdentifier(input));
  if (reference === null) throw new AgentOperationError("INVALID_REQUEST");
  return reference;
}

function nullableTicketReference(input: unknown): AgentTicketReference | null {
  return input === null ? null : readAgentTicketReference(input);
}

function text(input: unknown): string {
  if (typeof input !== "string")
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function nullableText(input: unknown): string | null {
  return input === null ? null : text(input);
}

function nullableIdentifier(input: unknown): string | null {
  return input === null ? null : readIdentifier(input);
}

/** An absent parameter reads as `null`, which takes the default of the operation. */
function optionalIdentifier(input: unknown): string | null {
  return input === undefined ? null : nullableIdentifier(input);
}

function readAssignee(input: unknown): AgentTicketAssignee | null {
  if (input === null) return null;
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["targetType", "targetId"]);
  const { targetType } = fields;
  if (targetType === "none") {
    if (fields.targetId !== null)
      throw new AgentOperationError("INVALID_REQUEST");
    return { targetType, targetId: null };
  }
  if (targetType !== "person" && targetType !== "group")
    throw new AgentOperationError("INVALID_REQUEST");
  return { targetType, targetId: readIdentifier(fields.targetId) };
}

/**
 * Validates the identifier or key of a ticket read.
 *
 * @param input - The raw operation parameters.
 * @returns The reference to the ticket.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentTicketRead(input: unknown): AgentTicketReference {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["ticketId"]);
  return readAgentTicketReference(fields.ticketId);
}

/**
 * Validates the project of a milestone read.
 *
 * @param input - The raw operation parameters.
 * @returns The project identifier.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentMilestonesRead(input: unknown): string {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["projectId"]);
  return readIdentifier(fields.projectId);
}

/**
 * Validates a local ticket create before any persistence or policy read.
 *
 * @param input - The raw operation parameters.
 * @returns The explicit create contract; what it leaves open is `null` or absent.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 *
 * @remarks
 * `description`, `statusId` and `parentId` are required, with `null` for "the
 * default status" and "no parent". `projectId`, `milestoneId`, `departmentId`
 * and `assignee` may be left out or be `null`: the project, milestone and
 * department are then taken from the parent, and the assignee is the account
 * that creates the ticket. Nothing is taken that the parent does not carry.
 */
export function readAgentTicketCreate(input: unknown): AgentTicketCreateInput {
  const fields = readParameterRecord(input);
  requireParameterKeys(
    fields,
    ["operationId", "type", "title", "description", "statusId", "parentId"],
    ["projectId", "milestoneId", "departmentId", "assignee"],
  );
  if (!isWorkItemType(fields.type))
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    operationId: readIdentifier(fields.operationId),
    projectId: optionalIdentifier(fields.projectId),
    type: fields.type,
    title: text(fields.title),
    description: text(fields.description),
    statusId: nullableIdentifier(fields.statusId),
    parent: nullableTicketReference(fields.parentId),
    milestoneId: optionalIdentifier(fields.milestoneId),
    ...(fields.departmentId === undefined
      ? {}
      : { departmentId: nullableIdentifier(fields.departmentId) }),
    ...(fields.assignee === undefined
      ? {}
      : { assignee: readAssignee(fields.assignee) }),
  };
}

/**
 * Validates one single-field ticket change before any persistence or policy read.
 *
 * @param operation - The field operation that was called.
 * @param input - The raw operation parameters.
 * @returns The ticket, the one field, the value it was read with and its new value.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 *
 * @remarks
 * The value the field had when the caller read it is required, so a change
 * never overwrites a field that was saved meanwhile. A parent is named by its
 * identifier, key or Pages address; `null` is no parent.
 */
export function readAgentTicketFieldChange(
  operation: AgentTicketFieldOperation,
  input: unknown,
): AgentTicketFieldInput {
  const fields = readParameterRecord(input);
  const names = TICKET_FIELDS[operation];
  requireParameterKeys(fields, [
    "operationId",
    "ticketId",
    names.expected,
    names.value,
  ]);
  const target = {
    operationId: readIdentifier(fields.operationId),
    ticket: readAgentTicketReference(fields.ticketId),
  };
  if (names.field === "parent")
    return {
      ...target,
      field: "parent",
      expected: nullableTicketReference(fields[names.expected]),
      value: nullableTicketReference(fields[names.value]),
    };
  const expected = text(fields[names.expected]);
  const value = text(fields[names.value]);
  if (names.field === "status" && !value.trim())
    throw new AgentOperationError("INVALID_REQUEST");
  return { ...target, field: names.field, expected, value };
}

/**
 * Validates a milestone create before any persistence or policy read.
 *
 * @param input - The raw operation parameters.
 * @returns The complete explicit create contract.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentMilestoneCreate(
  input: unknown,
): AgentMilestoneCreateInput {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, [
    "operationId",
    "projectId",
    "name",
    "description",
    "startAt",
    "dueAt",
  ]);
  return {
    operationId: readIdentifier(fields.operationId),
    projectId: readIdentifier(fields.projectId),
    name: text(fields.name),
    description: text(fields.description),
    startAt: nullableText(fields.startAt),
    dueAt: nullableText(fields.dueAt),
  };
}

/**
 * Validates one single-field milestone change before any persistence or policy read.
 *
 * @param operation - The field operation that was called.
 * @param input - The raw operation parameters.
 * @returns The milestone, the one field, the value it was read with and its new value.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentMilestoneFieldChange(
  operation: AgentMilestoneFieldOperation,
  input: unknown,
): AgentMilestoneFieldInput {
  const fields = readParameterRecord(input);
  const names = MILESTONE_FIELDS[operation];
  requireParameterKeys(fields, [
    "operationId",
    "milestoneId",
    names.expected,
    names.value,
  ]);
  const isDate = names.field === "startAt" || names.field === "dueAt";
  const read = isDate ? nullableText : text;
  return {
    operationId: readIdentifier(fields.operationId),
    milestoneId: readIdentifier(fields.milestoneId),
    field: names.field,
    expected: read(fields[names.expected]),
    value: read(fields[names.value]),
  };
}

/**
 * Validates a dependency add before any persistence or policy read.
 *
 * @param input - The raw operation parameters.
 * @returns The project, the two milestones and the link type.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentMilestoneDependencyAdd(
  input: unknown,
): AgentMilestoneDependencyAddInput {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, [
    "operationId",
    "projectId",
    "sourceId",
    "targetId",
    "linkType",
  ]);
  if (!isMilestoneLinkType(fields.linkType))
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    operationId: readIdentifier(fields.operationId),
    projectId: readIdentifier(fields.projectId),
    sourceId: readIdentifier(fields.sourceId),
    targetId: readIdentifier(fields.targetId),
    linkType: fields.linkType,
  };
}

/**
 * Validates a dependency removal before any persistence or policy read.
 *
 * @param input - The raw operation parameters.
 * @returns The project and the dependency.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 */
export function readAgentMilestoneDependencyRemove(
  input: unknown,
): AgentMilestoneDependencyRemoveInput {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["operationId", "projectId", "dependencyId"]);
  return {
    operationId: readIdentifier(fields.operationId),
    projectId: readIdentifier(fields.projectId),
    dependencyId: readIdentifier(fields.dependencyId),
  };
}
