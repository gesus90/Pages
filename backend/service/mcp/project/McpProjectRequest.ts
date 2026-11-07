import { z } from "zod";

import {
  GITHUB_SYNC_INTERVAL,
  PROJECT_ROLE,
  PROJECT_STATUS,
} from "@/definition/Project";

import { McpProjectError } from "./McpProjectError";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const REPOSITORY_PATTERN = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;
const MAXIMUM_NAME_LENGTH = 200;
const MAXIMUM_TEXT_LENGTH = 10_000;
const MAXIMUM_TITLE_LENGTH = 200;
const MAXIMUM_EVENT_TYPE_LENGTH = 40;
const MAXIMUM_TAG_LENGTH = 40;
const MAXIMUM_TAG_COUNT = 20;
const MAXIMUM_IDENTIFIER_LENGTH = 200;
const MAXIMUM_USERNAME_LENGTH = 200;
const MAXIMUM_TOKEN_LENGTH = 1000;

/** Largest icon after decoding: 2 MiB, like the upload of the interface. */
export const MAXIMUM_MCP_PROJECT_ICON_BYTES = 2 * 1024 * 1024;

/** Whether a `YYYY-MM-DD` text names a day of the calendar. */
function isCalendarDate(text: string): boolean {
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

const identifierField = z.string().trim().min(1).max(MAXIMUM_IDENTIFIER_LENGTH);
const usernameField = z.string().trim().min(1).max(MAXIMUM_USERNAME_LENGTH);
const nameField = z.string().trim().min(1).max(MAXIMUM_NAME_LENGTH);
const textField = z.string().max(MAXIMUM_TEXT_LENGTH);
const titleField = z.string().trim().min(1).max(MAXIMUM_TITLE_LENGTH);
const statusField = z.enum(PROJECT_STATUS);
const dayField = z.string().regex(DATE_PATTERN).refine(isCalendarDate);
const tagField = z.string().trim().min(1).max(MAXIMUM_TAG_LENGTH);
const confirmedField = z.literal(true).optional();

const createSchema = z
  .object({
    name: nameField,
    description: textField.optional(),
    status: statusField.optional(),
    departmentIds: z.array(identifierField).optional(),
    templateId: identifierField.optional(),
  })
  .strict();

const patchSchema = z
  .object({
    name: nameField,
    description: textField,
    status: statusField,
    startDate: dayField.nullable(),
    targetDate: dayField.nullable(),
    notes: textField,
    manager: usernameField.nullable(),
    tags: z.array(tagField).max(MAXIMUM_TAG_COUNT),
    departmentIds: z.array(identifierField),
  })
  .partial()
  .strict();

const memberSchema = z.object({ role: z.enum(PROJECT_ROLE) }).strict();

const goalCreateSchema = z.object({ title: titleField }).strict();

const goalUpdateSchema = z.object({ isDone: z.boolean() }).strict();

const eventCreateSchema = z
  .object({
    title: titleField,
    date: dayField,
    time: z.string().regex(TIME_PATTERN).optional(),
    type: z.string().trim().min(1).max(MAXIMUM_EVENT_TYPE_LENGTH).optional(),
    description: textField.optional(),
  })
  .strict();

const iconSchema = z
  .object({
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    dataBase64: z.string().min(1).regex(BASE64_PATTERN),
  })
  .strict();

const gitHubSchema = z
  .object({
    repoUrl: z.string().trim().regex(REPOSITORY_PATTERN),
    token: z.string().trim().min(1).max(MAXIMUM_TOKEN_LENGTH).optional(),
    syncIssues: z.boolean(),
    syncStatus: z.boolean(),
    syncComments: z.boolean(),
    syncPullRequests: z.boolean(),
    syncCommits: z.boolean(),
    syncDirection: z.enum(["bidirectional", "push", "pull"]),
    syncIntervalMinutes: z.literal(Object.values(GITHUB_SYNC_INTERVAL)),
  })
  .strict();

const gitHubSwitchSchema = z.object({ syncEnabled: z.boolean() }).strict();

const confirmationSchema = z.object({ confirmed: confirmedField }).strict();

const overviewQuerySchema = z
  .object({ archived: z.literal("1").optional() })
  .strict();

const emptySchema = z.object({}).strict();

/** Body of `POST /projects`. */
export type McpProjectCreateRequest = z.infer<typeof createSchema>;
/** Body of `PATCH /projects/{id}`. */
export type McpProjectPatchRequest = z.infer<typeof patchSchema>;
/** Body of `POST /projects/{id}/events`. */
export type McpProjectEventRequest = z.infer<typeof eventCreateSchema>;
/** Body of `PUT /projects/{id}/github`. */
export type McpProjectGitHubRequest = z.infer<typeof gitHubSchema>;
/** Body of an archive or a permanent deletion. */
export type McpProjectConfirmation = z.infer<typeof confirmationSchema>;

/** A decoded icon of `PUT /projects/{id}/icon`. */
export interface McpProjectIconRequest {
  readonly mimeType: string;
  readonly data: Buffer;
}

/** Parses untrusted input or rejects it with `invalid_request`. */
function parse<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const result = schema.safeParse(input);
  if (!result.success) throw new McpProjectError("invalid_request");
  return result.data;
}

/**
 * Reads the query of a request as an object of single values.
 *
 * @throws {McpProjectError} `invalid_request` for a parameter named twice.
 */
function queryObject(query: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(values, name))
      throw new McpProjectError("invalid_request");
    values[name] = value;
  }
  return values;
}

/** Decodes the icon and checks its size after decoding. */
function decodeIcon(body: unknown): McpProjectIconRequest {
  const icon = parse(iconSchema, body);
  if (icon.dataBase64.length % 4 !== 0)
    throw new McpProjectError("invalid_request");
  const image = Buffer.from(icon.dataBase64, "base64");
  if (
    image.byteLength === 0 ||
    image.byteLength > MAXIMUM_MCP_PROJECT_ICON_BYTES
  )
    throw new McpProjectError("invalid_request");
  return { mimeType: icon.mimeType, data: image };
}

/** Validators of every body and query the project API takes (PAGE-244). */
export const McpProjectRequest = {
  overview: (query: URLSearchParams): { readonly isArchived: boolean } => ({
    isArchived: parse(overviewQuerySchema, queryObject(query)).archived === "1",
  }),
  create: (body: unknown): McpProjectCreateRequest => parse(createSchema, body),
  patch: (body: Readonly<Record<string, unknown>>): McpProjectPatchRequest => {
    if (Object.keys(body).length === 0)
      throw new McpProjectError("invalid_request");
    return parse(patchSchema, body);
  },
  member: (body: unknown): z.infer<typeof memberSchema> =>
    parse(memberSchema, body),
  goalCreate: (body: unknown): { readonly title: string } =>
    parse(goalCreateSchema, body),
  goalUpdate: (body: unknown): { readonly isDone: boolean } =>
    parse(goalUpdateSchema, body),
  eventCreate: (body: unknown): McpProjectEventRequest =>
    parse(eventCreateSchema, body),
  icon: decodeIcon,
  gitHub: (body: unknown): McpProjectGitHubRequest => parse(gitHubSchema, body),
  gitHubSwitch: (body: unknown): { readonly syncEnabled: boolean } =>
    parse(gitHubSwitchSchema, body),
  confirmation: (body: unknown): McpProjectConfirmation =>
    parse(confirmationSchema, body),
  empty: (body: unknown): void => {
    parse(emptySchema, body);
  },
} as const;
