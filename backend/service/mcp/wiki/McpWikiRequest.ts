import { z } from "zod";

import { WIKI_ANCHOR_KIND, WIKI_SCOPE } from "@/definition/Wiki";

import { McpWikiError } from "./McpWikiError";

const MAXIMUM_IDENTIFIER_LENGTH = 200;
const MAXIMUM_SEARCH_TEXT_LENGTH = 200;

const identifierField = z.string().trim().min(1).max(MAXIMUM_IDENTIFIER_LENGTH);
const optionalReference = identifierField.nullable().optional();
const revisionField = z.number().int().min(0);
const scopeField = z.enum(WIKI_SCOPE);
const iconField = z.string().nullable();

const treeSchema = z
  .object({
    projectId: identifierField.optional(),
    scope: scopeField.optional(),
  })
  .strict();

const searchSchema = z
  .object({
    text: z.string().min(1).max(MAXIMUM_SEARCH_TEXT_LENGTH),
    projectId: identifierField.optional(),
  })
  .strict();

const readSchema = z
  .object({ backlinks: z.enum(["0", "1"]).optional() })
  .strict();

const createSchema = z
  .object({
    scope: scopeField,
    projectId: optionalReference,
    parentId: optionalReference,
    title: z.string(),
    content: z.string().optional(),
    icon: iconField.optional(),
  })
  .strict();

const updateSchema = z
  .object({
    expectedRevision: revisionField,
    operationId: identifierField.optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    icon: iconField.optional(),
  })
  .strict();

const duplicateSchema = z
  .object({ title: z.string(), withChildren: z.boolean().optional() })
  .strict();

const moveSchema = z
  .object({
    expectedRevision: revisionField,
    scope: scopeField.optional(),
    projectId: optionalReference,
    parentId: optionalReference,
    beforeId: optionalReference,
    preview: z.boolean().optional(),
  })
  .strict();

const propertiesSchema = z
  .object({
    owner: identifierField.optional(),
    currentUntil: z.string().nullable().optional(),
    anchors: z
      .array(
        z
          .object({
            kind: z.enum(WIKI_ANCHOR_KIND),
            targetId: identifierField,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const revisionSchema = z.object({ expectedRevision: revisionField }).strict();

const patchSchema = z
  .object({
    expectedRevision: revisionField,
    oldText: z.string().min(1),
    newText: z.string(),
    operationId: identifierField.optional(),
  })
  .strict();

// The revision is required for a page the account reads; a private page of
// somebody else is a placeholder without one (PAGE-280).
const deleteSchema = z
  .object({
    expectedRevision: revisionField.optional(),
    confirmed: z.boolean().optional(),
  })
  .strict();

const confirmationSchema = z
  .object({ confirmed: z.boolean().optional() })
  .strict();

const commentCreateSchema = z
  .object({
    body: z.string(),
    parentId: optionalReference,
    quote: z.string().nullable().optional(),
  })
  .strict();

const commentEditSchema = z.object({ body: z.string() }).strict();

const commentResolveSchema = z.object({ resolved: z.boolean() }).strict();

const emptySchema = z.object({}).strict();

/** Query of `GET /wiki/pages`. */
export type McpWikiTreeRequest = z.infer<typeof treeSchema>;
/** Query of `GET /wiki/search`. */
export type McpWikiSearchRequest = z.infer<typeof searchSchema>;
/** Body of `POST /wiki/pages`. */
export type McpWikiCreateRequest = z.infer<typeof createSchema>;
/** Body of `PATCH /wiki/pages/{id}`. */
export type McpWikiUpdateRequest = z.infer<typeof updateSchema>;
/** Body of `POST /wiki/pages/{id}/duplicate`. */
export type McpWikiDuplicateRequest = z.infer<typeof duplicateSchema>;
/** Body of `POST /wiki/pages/{id}/move`. */
export type McpWikiMoveRequest = z.infer<typeof moveSchema>;
/** Body of `PATCH /wiki/pages/{id}/properties`. */
export type McpWikiPropertiesRequest = z.infer<typeof propertiesSchema>;
/** Body of `POST /wiki/pages/{id}/patch`. */
export type McpWikiPatchRequest = z.infer<typeof patchSchema>;
/** Body of `POST /wiki/pages/{id}/delete`. */
export type McpWikiDeleteRequest = z.infer<typeof deleteSchema>;
/** Body of `POST /wiki/pages/{id}/comments`. */
export type McpWikiCommentCreateRequest = z.infer<typeof commentCreateSchema>;

/** Parses untrusted input or rejects it with `invalid_request`. */
function parse<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const result = schema.safeParse(input);
  if (!result.success) throw new McpWikiError("invalid_request");
  return result.data;
}

/** Rejects a change that names none of the given fields. */
function requireSomeField(
  body: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): void {
  if (!fields.some((field) => Object.hasOwn(body, field)))
    throw new McpWikiError("invalid_request");
}

/**
 * Reads the query of a request as an object of single values.
 *
 * @throws {McpWikiError} `invalid_request` for a parameter named twice.
 */
function queryObject(query: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(values, name)) throw new McpWikiError("invalid_request");
    values[name] = value;
  }
  return values;
}

/** Validators of every body and query the wiki API takes (PAGE-257). */
export const McpWikiRequest = {
  tree: (query: URLSearchParams): McpWikiTreeRequest =>
    parse(treeSchema, queryObject(query)),
  search: (query: URLSearchParams): McpWikiSearchRequest =>
    parse(searchSchema, queryObject(query)),
  read: (query: URLSearchParams): { readonly withBacklinks: boolean } => ({
    withBacklinks: parse(readSchema, queryObject(query)).backlinks === "1",
  }),
  create: (body: unknown): McpWikiCreateRequest => parse(createSchema, body),
  update: (body: Readonly<Record<string, unknown>>): McpWikiUpdateRequest => {
    requireSomeField(body, ["title", "content", "icon"]);
    return parse(updateSchema, body);
  },
  duplicate: (body: unknown): McpWikiDuplicateRequest =>
    parse(duplicateSchema, body),
  move: (body: unknown): McpWikiMoveRequest => parse(moveSchema, body),
  properties: (
    body: Readonly<Record<string, unknown>>,
  ): McpWikiPropertiesRequest => {
    requireSomeField(body, ["owner", "currentUntil", "anchors"]);
    return parse(propertiesSchema, body);
  },
  revision: (body: unknown): { readonly expectedRevision: number } =>
    parse(revisionSchema, body),
  patch: (body: unknown): McpWikiPatchRequest => parse(patchSchema, body),
  delete: (body: unknown): McpWikiDeleteRequest => parse(deleteSchema, body),
  confirmation: (body: unknown): { readonly confirmed?: boolean } =>
    parse(confirmationSchema, body),
  commentCreate: (body: unknown): McpWikiCommentCreateRequest =>
    parse(commentCreateSchema, body),
  commentEdit: (body: unknown): { readonly body: string } =>
    parse(commentEditSchema, body),
  commentResolve: (body: unknown): { readonly resolved: boolean } =>
    parse(commentResolveSchema, body),
  empty: (body: unknown): void => {
    parse(emptySchema, body);
  },
} as const;
