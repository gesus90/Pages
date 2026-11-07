import { z } from "zod";

import {
  LABEL_COLORS,
  WORK_ITEM_LIMITS,
  WORK_ITEM_LINK_TYPE,
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
} from "@/definition/Task";
import { TEMPLATE_SCOPE } from "@/definition/WorkItemTemplate";

import { McpTicketError } from "./McpTicketError";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAXIMUM_SEARCH_LIMIT = 500;
const DEFAULT_SEARCH_LIMIT = 100;
const MAXIMUM_SEARCH_TEXT_LENGTH = 200;
const MAXIMUM_LABEL_NAME_LENGTH = 40;
const MAXIMUM_TEMPLATE_NAME_LENGTH = 80;
const MAXIMUM_CHECKLIST_TITLE_LENGTH = 200;
const MAXIMUM_IDENTIFIER_LENGTH = 200;

/** Whether a `YYYY-MM-DD` text names a day of the calendar. */
function isCalendarDate(text: string): boolean {
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

const identifierField = z.string().trim().min(1).max(MAXIMUM_IDENTIFIER_LENGTH);
const dayField = z
  .string()
  .regex(DATE_PATTERN)
  .refine(isCalendarDate)
  .nullable();
const typeField = z.enum(WORK_ITEM_TYPE);
const priorityField = z.enum(WORK_ITEM_PRIORITY);
const titleField = z.string().trim().min(1).max(WORK_ITEM_LIMITS.titleLength);
const descriptionField = z.string().max(WORK_ITEM_LIMITS.descriptionLength);
const childrenField = z.enum(["include", "keep"]);
const scopeField = z.enum(TEMPLATE_SCOPE);

/** The fields `PATCH /tickets/{key}` changes, also the names of `expected`. */
const ticketFields = {
  title: titleField,
  description: descriptionField,
  statusId: identifierField,
  priority: priorityField,
  assignee: identifierField.nullable(),
  assigneeGroupId: identifierField.nullable(),
  reporter: identifierField,
  departmentId: identifierField.nullable(),
  parent: identifierField.nullable(),
  milestoneId: identifierField.nullable(),
  startAt: dayField,
  dueAt: dayField,
  labelIds: z.array(identifierField),
};

const createSchema = z
  .object({
    projectId: identifierField,
    type: typeField.optional(),
    title: titleField.optional(),
    description: descriptionField.optional(),
    statusId: identifierField.optional(),
    priority: priorityField.optional(),
    assignee: identifierField.nullable().optional(),
    assigneeGroupId: identifierField.nullable().optional(),
    departmentId: identifierField.nullable().optional(),
    parent: identifierField.nullable().optional(),
    milestoneId: identifierField.nullable().optional(),
    startAt: dayField.optional(),
    dueAt: dayField.optional(),
    labelIds: z.array(identifierField).optional(),
    templateId: identifierField.optional(),
  })
  .strict();

const expectedSchema = z.object(ticketFields).partial().strict();

const patchSchema = z
  .object({ ...ticketFields, expected: expectedSchema })
  .partial()
  .strict();

const positionSchema = z
  .object({ statusId: identifierField, sortOrder: z.number() })
  .strict();

const moveSchema = z.object({ projectId: identifierField }).strict();

const checklistCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(MAXIMUM_CHECKLIST_TITLE_LENGTH),
  })
  .strict();

const checklistUpdateSchema = z.object({ isDone: z.boolean() }).strict();

const linkSchema = z
  .object({
    type: z.enum(WORK_ITEM_LINK_TYPE),
    target: identifierField,
  })
  .strict();

const labelName = z.string().trim().min(1).max(MAXIMUM_LABEL_NAME_LENGTH);
const labelColor = z.enum(LABEL_COLORS);

const labelCreateSchema = z
  .object({ name: labelName, color: labelColor })
  .strict();

const labelUpdateSchema = z
  .object({ name: labelName, color: labelColor })
  .partial()
  .strict();

const confirmationSchema = z
  .object({ confirmed: z.literal(true).optional() })
  .strict();

const lifecycleSchema = z
  .object({
    children: childrenField.optional(),
    confirmed: z.literal(true).optional(),
  })
  .strict();

const templateName = z.string().trim().min(1).max(MAXIMUM_TEMPLATE_NAME_LENGTH);

const templateCreateSchema = z
  .object({
    ticket: identifierField,
    name: templateName,
    scope: scopeField,
    departmentIds: z.array(identifierField).optional(),
    projectIds: z.array(identifierField).optional(),
  })
  .strict();

const templateUpdateSchema = z
  .object({
    name: templateName,
    scope: scopeField,
    departmentIds: z.array(identifierField),
    projectIds: z.array(identifierField),
  })
  .partial()
  .strict();

const searchSchema = z
  .object({
    projectId: identifierField,
    text: z.string().min(1).max(MAXIMUM_SEARCH_TEXT_LENGTH).optional(),
    type: typeField.optional(),
    statusId: identifierField.optional(),
    assignee: identifierField.optional(),
    assigneeGroupId: identifierField.optional(),
    labelId: identifierField.optional(),
    milestoneId: identifierField.optional(),
    parent: identifierField.optional(),
    archived: z.literal("1").optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAXIMUM_SEARCH_LIMIT)
      .default(DEFAULT_SEARCH_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const optionsQuerySchema = z.object({ projectId: identifierField }).strict();

const emptySchema = z.object({}).strict();

/** Body of `POST /tickets`. */
export type McpTicketCreateRequest = z.infer<typeof createSchema>;
/** Body of `PATCH /tickets/{key}`. */
export type McpTicketPatchRequest = z.infer<typeof patchSchema>;
/** The values a client last read, named like the fields of a change. */
export type McpTicketExpected = z.infer<typeof expectedSchema>;
/** Body of `PUT /tickets/{key}/position`. */
export type McpTicketPositionRequest = z.infer<typeof positionSchema>;
/** Body of `POST /tickets/{key}/links`. */
export type McpTicketLinkRequest = z.infer<typeof linkSchema>;
/** Body of `POST /ticket-labels`. */
export type McpTicketLabelCreateRequest = z.infer<typeof labelCreateSchema>;
/** Body of `PATCH /ticket-labels/{labelId}`. */
export type McpTicketLabelUpdateRequest = z.infer<typeof labelUpdateSchema>;
/** Body of an archive or a permanent deletion. */
export type McpTicketLifecycleRequest = z.infer<typeof lifecycleSchema>;
/** Body of `POST /ticket-templates`. */
export type McpTicketTemplateCreateRequest = z.infer<
  typeof templateCreateSchema
>;
/** Body of `PATCH /ticket-templates/{templateId}`. */
export type McpTicketTemplateUpdateRequest = z.infer<
  typeof templateUpdateSchema
>;
/** Query of `GET /tickets`. */
export type McpTicketSearchRequest = z.infer<typeof searchSchema>;

/** Parses untrusted input or rejects it with `invalid_request`. */
function parse<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const result = schema.safeParse(input);
  if (!result.success) throw new McpTicketError("invalid_request");
  return result.data;
}

/** Rejects a change that names none of its fields. */
function requireSomeField(
  body: Readonly<Record<string, unknown>>,
  ignored: readonly string[] = [],
): void {
  if (!Object.keys(body).some((key) => !ignored.includes(key)))
    throw new McpTicketError("invalid_request");
}

/**
 * Reads the query of a request as an object of single values.
 *
 * @throws {McpTicketError} `invalid_request` for a parameter named twice.
 */
function queryObject(query: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(values, name))
      throw new McpTicketError("invalid_request");
    values[name] = value;
  }
  return values;
}

/** Validators of every body and query the ticket API takes (PAGE-242). */
export const McpTicketRequest = {
  create: (body: unknown): McpTicketCreateRequest => parse(createSchema, body),
  patch: (body: Readonly<Record<string, unknown>>): McpTicketPatchRequest => {
    requireSomeField(body, ["expected"]);
    return parse(patchSchema, body);
  },
  position: (body: unknown): McpTicketPositionRequest =>
    parse(positionSchema, body),
  move: (body: unknown): { readonly projectId: string } =>
    parse(moveSchema, body),
  checklistCreate: (body: unknown): { readonly title: string } =>
    parse(checklistCreateSchema, body),
  checklistUpdate: (body: unknown): { readonly isDone: boolean } =>
    parse(checklistUpdateSchema, body),
  link: (body: unknown): McpTicketLinkRequest => parse(linkSchema, body),
  labelCreate: (body: unknown): McpTicketLabelCreateRequest =>
    parse(labelCreateSchema, body),
  labelUpdate: (
    body: Readonly<Record<string, unknown>>,
  ): McpTicketLabelUpdateRequest => {
    requireSomeField(body);
    return parse(labelUpdateSchema, body);
  },
  confirmation: (body: unknown): { readonly confirmed?: true } =>
    parse(confirmationSchema, body),
  lifecycle: (body: unknown): McpTicketLifecycleRequest =>
    parse(lifecycleSchema, body),
  templateCreate: (body: unknown): McpTicketTemplateCreateRequest =>
    parse(templateCreateSchema, body),
  templateUpdate: (
    body: Readonly<Record<string, unknown>>,
  ): McpTicketTemplateUpdateRequest => {
    requireSomeField(body);
    return parse(templateUpdateSchema, body);
  },
  empty: (body: unknown): void => {
    parse(emptySchema, body);
  },
  search: (query: URLSearchParams): McpTicketSearchRequest =>
    parse(searchSchema, queryObject(query)),
  options: (query: URLSearchParams): { readonly projectId: string } =>
    parse(optionsQuerySchema, queryObject(query)),
} as const;
