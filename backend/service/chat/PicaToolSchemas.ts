import { z } from "zod";

import { CHAT_LIMITS } from "@/definition/Chat";
import { PROJECT_STATUS } from "@/definition/Project";
import { WORK_ITEM_TYPE } from "@/definition/Task";

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/u);

const cursor = z.string().max(4000);

const ticketType = z.enum(Object.values(WORK_ITEM_TYPE));

/**
 * The longest text a write takes, such as a description, a page or a comment.
 *
 * @remarks
 * A tool result reaches the model with at most 20 000 characters, so a longer
 * text could never have been read completely before it is replaced.
 */
const WRITE_TEXT_CHARACTERS = 20_000;

const writeText = z.string().max(WRITE_TEXT_CHARACTERS);

const title = z.string().trim().min(1).max(500);

const projectName = z.string().trim().min(1).max(200);

/** Projects keep a shorter description than tickets, pages and milestones. */
const projectDescription = z.string().max(10_000);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const revision = z.number().int().min(1);

const wikiScope = z.enum(["project", "instance", "private"]);

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
  departments_list: z.object({ cursor: cursor.optional() }).strict(),
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
  milestones_read: z.object({ projectId: identifier }).strict(),
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

const TICKET_WRITE_SCHEMAS = {
  tickets_create: z
    .object({
      projectId: identifier,
      type: ticketType,
      title,
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
      title,
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
  tickets_set_parent: z
    .object({
      ticketId: identifier,
      expectedParentId: identifier.nullable(),
      parentId: identifier.nullable(),
    })
    .strict(),
  tickets_set_milestone: z
    .object({
      ticketId: identifier,
      expectedMilestoneId: identifier.nullable(),
      milestoneId: identifier.nullable(),
    })
    .strict(),
  tickets_delete: z.object({ ticketId: identifier }).strict(),
} as const;

const PROJECT_WRITE_SCHEMAS = {
  projects_create: z
    .object({
      name: projectName,
      description: projectDescription,
      status: z.enum(Object.values(PROJECT_STATUS)),
      departmentIds: z.array(identifier).max(100),
    })
    .strict(),
  projects_set_name: z
    .object({ projectId: identifier, name: projectName })
    .strict(),
  projects_set_description: z
    .object({ projectId: identifier, description: projectDescription })
    .strict(),
  projects_set_status: z
    .object({
      projectId: identifier,
      status: z.enum(Object.values(PROJECT_STATUS)),
    })
    .strict(),
  projects_set_dates: z
    .object({
      projectId: identifier,
      startDate: date.nullable(),
      targetDate: date.nullable(),
    })
    .strict(),
} as const;

const MILESTONE_WRITE_SCHEMAS = {
  milestones_create: z
    .object({
      projectId: identifier,
      name: title,
      description: writeText,
      startAt: date.nullable(),
      dueAt: date.nullable(),
    })
    .strict(),
  milestones_set_name: z
    .object({
      milestoneId: identifier,
      expectedName: z.string().max(500),
      name: title,
    })
    .strict(),
  milestones_set_description: z
    .object({
      milestoneId: identifier,
      expectedDescription: writeText,
      description: writeText,
    })
    .strict(),
  milestones_set_status: z
    .object({
      milestoneId: identifier,
      expectedStatus: z.enum(["open", "completed", "archived"]),
      status: z.enum(["open", "completed", "archived"]),
    })
    .strict(),
  milestones_set_start_at: z
    .object({
      milestoneId: identifier,
      expectedStartAt: date.nullable(),
      startAt: date.nullable(),
    })
    .strict(),
  milestones_set_due_at: z
    .object({
      milestoneId: identifier,
      expectedDueAt: date.nullable(),
      dueAt: date.nullable(),
    })
    .strict(),
  milestones_delete: z
    .object({ projectId: identifier, milestoneId: identifier })
    .strict(),
} as const;

const WIKI_WRITE_SCHEMAS = {
  wiki_page_create: z
    .object({
      projectId: identifier.nullable(),
      scope: wikiScope.optional(),
      parentId: identifier.nullable(),
      title,
      content: writeText,
      icon: z.string().min(1).max(50).nullable().optional(),
    })
    .strict(),
  wiki_page_set_title: z
    .object({ pageId: identifier, expectedRevision: revision, title })
    .strict(),
  wiki_page_set_content: z
    .object({
      pageId: identifier,
      expectedRevision: revision,
      content: writeText,
    })
    .strict(),
  wiki_page_move: z
    .object({
      pageId: identifier,
      expectedRevision: revision,
      projectId: identifier.nullable(),
      scope: wikiScope.optional(),
      parentId: identifier.nullable(),
      beforeId: identifier.nullable(),
    })
    .strict(),
  wiki_page_delete: z
    .object({ pageId: identifier, expectedRevision: revision })
    .strict(),
  wiki_comment_add: z
    .object({
      pageId: identifier,
      body: writeText.trim().min(1),
      parentId: identifier.nullable(),
      quote: z.string().trim().min(1).max(500).nullable(),
    })
    .strict(),
  wiki_comment_edit: z
    .object({ commentId: identifier, body: writeText.trim().min(1) })
    .strict(),
  wiki_comment_resolve: z
    .object({ commentId: identifier, resolved: z.boolean() })
    .strict(),
  wiki_comment_delete: z.object({ commentId: identifier }).strict(),
} as const;

/**
 * The native inputs of the writes on user level: tickets, projects,
 * milestones, wiki pages and comments.
 *
 * @remarks
 * Changes carry the value or revision the model read last wherever the
 * operation behind them checks one, so a concurrent change ends in `CONFLICT`
 * instead of being overwritten; `null` stands for "none". No write manages
 * accounts, agents, connections, tags of the catalog or instance settings.
 */
export const PICA_WRITE_SCHEMAS = {
  ...TICKET_WRITE_SCHEMAS,
  ...PROJECT_WRITE_SCHEMAS,
  ...MILESTONE_WRITE_SCHEMAS,
  ...WIKI_WRITE_SCHEMAS,
} as const;

/** The tool with which Pica attaches a file it wrote to its answer (PAGE-92). */
export const PICA_FILE_TOOL = "chat_file_create";

/** The extensions of the files Pica writes: text documents and SVG images. */
export const PICA_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "markdown",
  "txt",
  "csv",
  "json",
  "svg",
]);

/** A file name with one of {@link PICA_FILE_EXTENSIONS} and the complete text of the file. */
export const PICA_FILE_SCHEMA = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(3)
      .max(CHAT_LIMITS.fileNameCharacters)
      .regex(/\.(?:md|markdown|txt|csv|json|svg)$/iu),
    content: z.string().min(1).max(CHAT_LIMITS.answerFileCharacters),
  })
  .strict();

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

/** Tells whether a name is one of the native writes. */
export function isPicaWriteTool(name: string): name is PicaWriteTool {
  return Object.hasOwn(PICA_WRITE_SCHEMAS, name);
}
