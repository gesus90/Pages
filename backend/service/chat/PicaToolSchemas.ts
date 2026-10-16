import { z } from "zod";

import { WORK_ITEM_TYPE } from "@/definition/Task";

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/u);

const cursor = z.string().max(4000);

const ticketType = z.enum(Object.values(WORK_ITEM_TYPE));

/**
 * The longest text a write takes, such as a description or a comment.
 *
 * @remarks
 * A write runs only for a confirmation line in a chat message of at most
 * 20 000 characters; old and new description must fit into it together.
 */
const WRITE_TEXT_CHARACTERS = 6_000;

const writeText = z.string().max(WRITE_TEXT_CHARACTERS);

const assignee = z
  .object({
    targetType: z.enum(["person", "group", "none"]),
    targetId: identifier.nullable(),
  })
  .strict();

/** Deliberately narrow native inputs of the reads; identity and execution options are never model arguments. */
export const PICA_READ_SCHEMAS = {
  projects_list: z.object({}).strict(),
  projects_read: z.object({ projectId: identifier }).strict(),
  tickets_search: z
    .object({
      projectId: identifier,
      text: z.string().max(500).optional(),
      /** The server fills in the person of the conversation; the model never names it. */
      assignedToMe: z.boolean().optional(),
      statusId: identifier.optional(),
      type: ticketType.optional(),
      limit: z.number().int().min(1).max(20).optional(),
      cursor: cursor.optional(),
    })
    .strict(),
  tickets_read: z.object({ ticketId: identifier }).strict(),
  assignment_targets_search: z
    .object({
      text: z.string().min(1).max(200).optional(),
      targetType: z.enum(["person", "group"]).optional(),
      projectId: identifier.optional(),
    })
    .strict(),
  tags_list: z.object({ cursor: cursor.optional() }).strict(),
  wiki_search: z
    .object({
      text: z.string().trim().min(1).max(200),
      projectId: identifier.optional(),
      cursor: cursor.optional(),
    })
    .strict(),
  wiki_tree_read: z
    .object({ projectId: identifier.optional(), cursor: cursor.optional() })
    .strict(),
  wiki_page_read: z.object({ pageId: identifier }).strict(),
  wiki_comments_read: z.object({ pageId: identifier }).strict(),
} as const;

/**
 * The native inputs of the writes; each one is confirmed with exactly these fields.
 *
 * @remarks
 * Every field a confirmation binds is required, so a confirmed call and the
 * line of the person parse to the same value; `null` stands for "none".
 */
export const PICA_WRITE_SCHEMAS = {
  tickets_create: z
    .object({
      projectId: identifier,
      type: ticketType,
      title: z.string().trim().min(1).max(500),
      description: writeText,
      statusId: identifier.nullable(),
      parentId: identifier.nullable(),
      assignee: assignee.optional(),
    })
    .strict(),
  tickets_set_title: z
    .object({
      ticketId: identifier,
      expectedTitle: z.string().max(500),
      title: z.string().trim().min(1).max(500),
    })
    .strict(),
  tickets_set_status: z
    .object({
      ticketId: identifier,
      expectedStatusId: identifier,
      statusId: identifier,
    })
    .strict(),
  tickets_set_description: z
    .object({
      ticketId: identifier,
      expectedDescription: writeText,
      description: writeText,
    })
    .strict(),
  tickets_set_assignee: z
    .object({
      ticketId: identifier,
      targetType: assignee.shape.targetType,
      targetId: identifier.nullable(),
      expectedAssigneeId: identifier.nullable(),
      expectedAssigneeGroupId: identifier.nullable(),
    })
    .strict(),
  tickets_set_tags: z
    .object({
      ticketId: identifier,
      tagIds: z.array(identifier).max(50),
      expectedTagIds: z.array(identifier).max(50),
    })
    .strict(),
  wiki_comment_add: z
    .object({
      pageId: identifier,
      body: writeText.trim().min(1),
      parentId: identifier.nullable(),
      quote: z.string().trim().min(1).max(500).nullable(),
    })
    .strict(),
} as const;

/** Bounded, credential-redacted JSON from existing services; no human-only receipts. */
export const PICA_TOOL_OUTCOME = z
  .object({
    ok: z.boolean(),
    result: z.string().max(20_000).nullable(),
    error: z.string().max(100).nullable(),
  })
  .strict();

export type PicaToolOutcome = z.infer<typeof PICA_TOOL_OUTCOME>;
export type PicaReadTool = keyof typeof PICA_READ_SCHEMAS;
export type PicaWriteTool = keyof typeof PICA_WRITE_SCHEMAS;

/** Tells whether a name is one of the native writes, as a confirmation line names it. */
export function isPicaWriteTool(name: string): name is PicaWriteTool {
  return Object.hasOwn(PICA_WRITE_SCHEMAS, name);
}

/** Parses the input of one write, including its concurrency preconditions. */
export function readPicaWrite(
  tool: PicaWriteTool,
  input: unknown,
): Readonly<Record<string, unknown>> | null {
  const parsed = PICA_WRITE_SCHEMAS[tool].safeParse(input);
  return parsed.success ? parsed.data : null;
}
