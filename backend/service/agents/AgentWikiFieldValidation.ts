import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { resolveWikiPageReference } from "@/backend/service/wiki/WikiLinks";
import { WIKI_COVER_PRESETS } from "@/definition/Wiki";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type {
  AgentWikiCoverInput,
  AgentWikiField,
  AgentWikiFieldInput,
  AgentWikiFieldOperation,
  AgentWikiMoveInput,
  AgentWikiPageOperation,
  AgentWikiPageRequest,
  AgentWikiPageTarget,
} from "@/definition/AgentWikiFields";
import type { WikiCover } from "@/definition/Wiki";

const FIELD_OPERATIONS: Readonly<
  Record<AgentWikiFieldOperation, AgentWikiField>
> = {
  "wiki.page.setTitle": "title",
  "wiki.page.setContent": "content",
  "wiki.page.setIcon": "icon",
};
const TARGET_KEYS = ["operationId", "pageId", "expectedRevision"];

/** Tells whether an operation name is one of the single-field page operations. */
export function isAgentWikiFieldOperation(
  name: unknown,
): name is AgentWikiFieldOperation {
  return (
    typeof name === "string" && Object.keys(FIELD_OPERATIONS).includes(name)
  );
}

/** Tells whether an operation name is any page operation of this family. */
export function isAgentWikiPageOperation(
  name: unknown,
): name is AgentWikiPageOperation {
  return (
    isAgentWikiFieldOperation(name) ||
    name === "wiki.page.setCover" ||
    name === "wiki.page.move"
  );
}

/**
 * Reads the page an operation names: its identifier or its Pages address, never its title.
 *
 * @param input - The raw value.
 * @returns The page identifier.
 * @throws {AgentOperationError} `INVALID_REQUEST` for anything that is not a page identifier or address.
 */
export function readWikiPageReference(input: unknown): string {
  const id = resolveWikiPageReference(readIdentifier(input));
  if (id === null) throw new AgentOperationError("INVALID_REQUEST");
  return id;
}

function nullablePageReference(input: unknown): string | null {
  return input === null ? null : readWikiPageReference(input);
}

function revision(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1)
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function target(
  fields: Readonly<Record<string, unknown>>,
): AgentWikiPageTarget {
  return {
    operationId: readIdentifier(fields.operationId),
    pageId: readWikiPageReference(fields.pageId),
    expectedRevision: revision(fields.expectedRevision),
  };
}

/**
 * Validates one single-field change before any persistence or policy read.
 *
 * @param operation - The field operation that was called.
 * @param input - The raw operation parameters.
 * @returns The page, its expected revision and the one new value.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 *
 * @remarks
 * Every parameter is required, so a call never changes a field implicitly. Setting the
 * icon to `null` removes it.
 */
export function readAgentWikiFieldChange(
  operation: AgentWikiFieldOperation,
  input: unknown,
): AgentWikiFieldInput {
  const fields = normalizeRevision(readParameterRecord(input));
  const field = FIELD_OPERATIONS[operation];
  requireParameterKeys(fields, [...TARGET_KEYS, field]);
  const base = target(fields);
  const value = fields[field];
  if (field === "icon") {
    if (value !== null && typeof value !== "string")
      throw new AgentOperationError("INVALID_REQUEST");
    return { ...base, field, value };
  }
  if (typeof value !== "string")
    throw new AgentOperationError("INVALID_REQUEST");
  if (
    field === "content" &&
    Buffer.byteLength(value, "utf8") > PAGES_AGENT_LIMITS.wikiContentBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "wikiContentBytes",
      limit: PAGES_AGENT_LIMITS.wikiContentBytes,
    });
  return { ...base, field, value };
}

function readCover(input: unknown): WikiCover | null {
  if (input === null) return null;
  const fields = readParameterRecord(input);
  if (fields.kind === "preset") {
    requireParameterKeys(fields, ["kind", "preset"]);
    const preset = WIKI_COVER_PRESETS.find(
      (candidate) => candidate === fields.preset,
    );
    if (preset === undefined) throw new AgentOperationError("INVALID_REQUEST");
    return { kind: "preset", preset };
  }
  if (fields.kind === "attachment") {
    requireParameterKeys(fields, ["kind", "attachmentId"]);
    return {
      kind: "attachment",
      attachmentId: readIdentifier(fields.attachmentId),
    };
  }
  throw new AgentOperationError("INVALID_REQUEST");
}

/**
 * Validates a cover change before any persistence or policy read.
 *
 * @param input - The raw operation parameters.
 * @returns The page and the new cover; `null` removes the cover.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 *
 * @remarks
 * The cover is `{kind: "preset", preset}` with one of the six prepared names,
 * `{kind: "attachment", attachmentId}` or `null`, the shape `read_wiki_page`
 * returns. It takes no revision: a cover is no part of the text.
 */
export function readAgentWikiCoverChange(input: unknown): AgentWikiCoverInput {
  const fields = readParameterRecord(input);
  requireParameterKeys(fields, ["operationId", "pageId", "cover"]);
  return {
    operationId: readIdentifier(fields.operationId),
    pageId: readWikiPageReference(fields.pageId),
    cover: readCover(fields.cover),
  };
}

/**
 * Validates the parameters of any page operation of this family.
 *
 * @param operation - The operation that was called.
 * @param input - The raw operation parameters.
 * @returns The validated request.
 * @throws {AgentOperationError} `INVALID_REQUEST` or `PAYLOAD_TOO_LARGE`.
 */
export function readAgentWikiPageRequest(
  operation: AgentWikiPageOperation,
  input: unknown,
): AgentWikiPageRequest {
  if (isAgentWikiFieldOperation(operation))
    return readAgentWikiFieldChange(operation, input);
  if (operation === "wiki.page.setCover")
    return readAgentWikiCoverChange(input);
  return readAgentWikiMove(input);
}

/**
 * Validates a move to an explicit place before any persistence or policy read.
 *
 * @param input - The raw operation parameters.
 * @returns The page, its expected revision and the target project, parent and sibling.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or malformed parameter.
 *
 * @remarks
 * The target is always named in full: `parentId` and `beforeId` are `null` to say
 * "project root" and "at the end".
 */
export function readAgentWikiMove(input: unknown): AgentWikiMoveInput {
  const fields = normalizeRevision(readParameterRecord(input));
  const { scope, ...location } = fields;
  if (fields.projectId === null && (scope === undefined || scope === "project"))
    throw new AgentOperationError("INVALID_REQUEST");
  requireParameterKeys(location, [
    ...TARGET_KEYS,
    "projectId",
    "parentId",
    "beforeId",
  ]);
  return {
    ...target(fields),
    projectId:
      fields.projectId === null ? null : readIdentifier(fields.projectId),
    ...(scope === undefined ? {} : { scope: readScope(scope) }),
    parentId: nullablePageReference(fields.parentId),
    beforeId: nullablePageReference(fields.beforeId),
  };
}

function readScope(input: unknown): "project" | "instance" | "private" {
  if (input !== "project" && input !== "instance" && input !== "private")
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

/** Accepts the specified revision spelling while retaining established camel-case clients. */
export function normalizeRevision(
  parameters: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (!("expected_revision" in parameters)) return parameters;
  if ("expectedRevision" in parameters)
    throw new AgentOperationError("INVALID_REQUEST");
  const { expected_revision: expectedRevision, ...fields } = parameters;
  return { ...fields, expectedRevision };
}
