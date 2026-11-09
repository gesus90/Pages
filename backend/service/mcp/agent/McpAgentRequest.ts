import { z } from "zod";

import {
  AGENT_DOCUMENT_LIMITS,
  AGENT_EMPLOYEE_ACCESS_MODES,
} from "@/definition/AgentEmployee";
import { MAXIMUM_AVATAR_BYTES } from "@/definition/User";
import { ROLE } from "@/definition/Role";

import { McpAgentError } from "./McpAgentError";

const MAXIMUM_IDENTIFIER_LENGTH = 100;
const MAXIMUM_NAME_LENGTH = 200;
const MAXIMUM_MODEL_LENGTH = 300;
const MAXIMUM_REASONING_LENGTH = 40;
const MAXIMUM_SEARCH_LENGTH = 200;
const MAXIMUM_DEPARTMENTS = 100;
/** Generous for `MEMORY.md`: 5,000 words; the service counts the words. */
const MAXIMUM_MEMORY_LENGTH = 100_000;
/** Base64 holds three bytes in four characters. */
const MAXIMUM_IMAGE_BASE64_LENGTH = Math.ceil(MAXIMUM_AVATAR_BYTES / 3) * 4;
/** A cursor is the position of the next page in the list. */
const CURSOR_PATTERN = /^\d{1,6}$/u;

const identifierField = z.string().trim().min(1).max(MAXIMUM_IDENTIFIER_LENGTH);
const nameField = z.string().trim().min(1).max(MAXIMUM_NAME_LENGTH);
const revisionField = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
// The administrator is no role an agent may hold, whatever its identifier.
const roleField = identifierField.refine((roleId) => roleId !== ROLE.ADMIN);
const modelField = z
  .object({
    connectionId: identifierField,
    modelId: z.string().trim().min(1).max(MAXIMUM_MODEL_LENGTH),
  })
  .strict();
const reasoningField = z
  .string()
  .trim()
  .max(MAXIMUM_REASONING_LENGTH)
  .nullable()
  .optional();
const colorField = z.string().max(20).nullable().optional();
// Pages sets no cost limit any more (PAGE-283); an older client may still send
// one, which is accepted and ignored.
const ignoredCostField = z.unknown().optional();
const departmentsField = z
  .array(identifierField)
  .max(MAXIMUM_DEPARTMENTS)
  .optional();
const soulField = z
  .string()
  .max(AGENT_DOCUMENT_LIMITS.soulCharacters * 2)
  .optional();
const instructionsField = z
  .string()
  .max(AGENT_DOCUMENT_LIMITS.instructionsCharacters * 2)
  .optional();
const cursorField = z.string().regex(CURSOR_PATTERN).optional();
const textField = z.string().max(MAXIMUM_SEARCH_LENGTH).optional();

// Every body is strict: `password`, `isAdmin` or any other unknown field is refused.
const createSchema = z
  .object({
    name: nameField,
    username: nameField,
    position: nameField,
    model: modelField,
    access: z.enum(AGENT_EMPLOYEE_ACCESS_MODES),
    roleId: roleField,
    reasoning: reasoningField,
    color: colorField,
    departmentIds: departmentsField,
    costLimitUsdPerMonth: ignoredCostField,
    soul: soulField,
    agentInstructions: instructionsField,
    templateId: identifierField.optional(),
    isLearningEnabled: z.boolean().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    revision: revisionField,
    name: nameField.optional(),
    username: nameField.optional(),
    position: nameField.optional(),
    color: colorField,
    model: modelField.optional(),
    reasoning: reasoningField,
    access: z.enum(AGENT_EMPLOYEE_ACCESS_MODES).optional(),
    costLimitUsdPerMonth: ignoredCostField,
    roleId: roleField.optional(),
    departmentIds: departmentsField,
    soul: soulField,
    agentInstructions: instructionsField,
    memory: z.string().max(MAXIMUM_MEMORY_LENGTH).optional(),
    isLearningEnabled: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const imageSchema = z
  .object({
    mimeType: z.string().max(100),
    dataBase64: z.string().min(1).max(MAXIMUM_IMAGE_BASE64_LENGTH),
  })
  .strict();

const removalSchema = z
  .object({ revision: revisionField, confirmed: z.boolean().optional() })
  .strict();

const restoreSchema = z.object({ revision: revisionField }).strict();

const listSchema = z
  .object({
    text: textField,
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();

const archiveSchema = z
  .object({ text: textField, cursor: cursorField })
  .strict();

const activitySchema = z.object({ cursor: cursorField }).strict();

const emptySchema = z.object({}).strict();

/** Body of `POST /agents`. */
export type McpAgentCreateRequest = z.infer<typeof createSchema>;
/** Body of `PATCH /agents/{id}`; an absent field stays unchanged. */
export type McpAgentUpdateRequest = z.infer<typeof updateSchema>;
/** Body of `PUT /agents/{id}/image`. */
export type McpAgentImageRequest = z.infer<typeof imageSchema>;
/** Body of `POST /agents/{id}/remove`. */
export type McpAgentRemovalRequest = z.infer<typeof removalSchema>;
/** Body of `POST /agents/{id}/memory/versions/{versionId}/restore`. */
export type McpAgentRestoreRequest = z.infer<typeof restoreSchema>;
/** Query of `GET /agents`. */
export type McpAgentListRequest = z.infer<typeof listSchema>;
/** Query of `GET /agents/{id}/memory/archive`. */
export type McpAgentArchiveRequest = z.infer<typeof archiveSchema>;
/** Query of `GET /agents/{id}/activity`. */
export type McpAgentActivityRequest = z.infer<typeof activitySchema>;

/** Parses untrusted input or rejects it with `invalid_request`; the input is never quoted. */
function parse<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const result = schema.safeParse(input);
  if (!result.success) throw new McpAgentError("invalid_request");
  return result.data;
}

/** Rejects a change that names none of its fields. */
function requireSomeField(body: Readonly<Record<string, unknown>>): void {
  if (!Object.keys(body).some((key) => key !== "revision"))
    throw new McpAgentError("invalid_request");
}

/**
 * Reads the query of a request as an object of single values.
 *
 * @throws {McpAgentError} `invalid_request` for a parameter named twice.
 */
function queryObject(query: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(values, name)) throw new McpAgentError("invalid_request");
    values[name] = value;
  }
  return values;
}

/**
 * Validators of every body and query the agent API takes (PAGE-267).
 *
 * @remarks
 * Every body is a strict object: an unknown field such as `password` or
 * `isAdmin` is `invalid_request`, and a rejected input is never quoted. The
 * services of the user administration apply the rest of the rules, such as
 * the palette, the document limits and the word limit of `MEMORY.md`.
 */
export const McpAgentRequest = {
  list: (query: URLSearchParams): McpAgentListRequest =>
    parse(listSchema, queryObject(query)),
  create: (body: unknown): McpAgentCreateRequest => parse(createSchema, body),
  update: (body: Readonly<Record<string, unknown>>): McpAgentUpdateRequest => {
    requireSomeField(body);
    return parse(updateSchema, body);
  },
  image: (body: unknown): McpAgentImageRequest => parse(imageSchema, body),
  removal: (body: unknown): McpAgentRemovalRequest =>
    parse(removalSchema, body),
  restore: (body: unknown): McpAgentRestoreRequest =>
    parse(restoreSchema, body),
  archive: (query: URLSearchParams): McpAgentArchiveRequest =>
    parse(archiveSchema, queryObject(query)),
  activity: (query: URLSearchParams): McpAgentActivityRequest =>
    parse(activitySchema, queryObject(query)),
  empty: (query: URLSearchParams): void => {
    parse(emptySchema, queryObject(query));
  },
};
