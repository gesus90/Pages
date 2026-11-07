import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";

import type {
  Label,
  WorkItemAttachment,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemLink,
  WorkItemType,
} from "@/definition/Task";
import type {
  McpTicket,
  McpTicketAttachment,
  McpTicketLabel,
  McpTicketNamed,
  McpTicketStatus,
  McpTicketSummary,
} from "./McpTicketContract";
import type { McpTicketContext } from "./McpTicketContext";

/** The records of a ticket that its answer object lists. */
interface RelatedRecords {
  readonly labels: readonly Label[];
  readonly subtasks: readonly WorkItemDetail[];
  readonly checklist: readonly WorkItemChecklistItem[];
  readonly links: readonly WorkItemLink[];
  readonly attachments: readonly WorkItemAttachment[];
}

/** The text form every time column stores: UTC without a zone. */
const STORED_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/u;

/**
 * Turns a stored time into ISO-8601.
 *
 * @param text - A stored time, `YYYY-MM-DD HH:MM:SS` in UTC or already ISO.
 */
export function toIsoTimestamp(text: string): string {
  const stored = STORED_TIMESTAMP_PATTERN.exec(text);
  if (stored) return `${stored[1] ?? ""}T${stored[2] ?? ""}Z`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

/** Turns a stored day into `YYYY-MM-DD`. */
function toDay(text: string | null): string | null {
  return text === null ? null : text.slice(0, 10);
}

/** The status of a ticket as the interface names it. */
function statusOf(item: WorkItemDetail): McpTicketStatus {
  return { id: item.statusId, name: item.statusName, isDone: item.isDone };
}

function labelOf(label: Label): McpTicketLabel {
  return { id: label.id, name: label.name, color: label.color };
}

function attachmentOf(attachment: WorkItemAttachment): McpTicketAttachment {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
    createdAt: toIsoTimestamp(attachment.createdAt),
  };
}

/**
 * Projects an attachment of a ticket for the interface.
 *
 * @param attachment - The attachment as the attachment service returns it.
 */
export function projectAttachment(
  attachment: WorkItemAttachment,
): McpTicketAttachment {
  return attachmentOf(attachment);
}

function groupOf(item: WorkItemDetail): McpTicketNamed | null {
  return item.assigneeGroupId === null
    ? null
    : { id: item.assigneeGroupId, name: item.assigneeGroupName ?? "" };
}

function milestoneOf(item: WorkItemDetail): McpTicketNamed | null {
  return item.milestoneId === null
    ? null
    : { id: item.milestoneId, name: item.milestoneName ?? "" };
}

/** Reads the type of the parent; a parent the account cannot see stays out. */
async function parentTypeOf(
  context: McpTicketContext,
  item: WorkItemDetail,
): Promise<WorkItemType | null> {
  if (item.parentId === null || item.parentKey === null) return null;
  try {
    return (await context.services.tasks.getById(context.actor, item.parentId))
      .type;
  } catch (error: unknown) {
    if (error instanceof WorkItemNotFoundError) return null;
    throw error;
  }
}

/** Names the department of a ticket from the departments the account knows. */
async function departmentOf(
  context: McpTicketContext,
  item: WorkItemDetail,
): Promise<McpTicketNamed | null> {
  if (item.departmentId === null) return null;
  const { available } = await context.services.tasks.departmentChoices(
    context.actor,
  );
  const department = available.find(
    (candidate) => candidate.id === item.departmentId,
  );
  return { id: item.departmentId, name: department?.name ?? "" };
}

/** Reads the related records of a ticket; each read applies the visibility of the account. */
async function relatedOf(
  context: McpTicketContext,
  item: WorkItemDetail,
): Promise<RelatedRecords> {
  const { actor, services } = context;
  const [labels, subtasks, checklist, links, attachments] = await Promise.all([
    services.tasks.findLabelsForWorkItems([item.id]),
    services.tasks.findSubtasks(actor, item.id),
    services.tasks.findChecklistItems(actor, item.id),
    services.tasks.findLinks(actor, item.id),
    services.attachments.list(actor, item.id),
  ]);
  return {
    labels: labels.get(item.id) ?? [],
    subtasks,
    checklist,
    links,
    attachments,
  };
}

/**
 * Builds the answer object "Ticket" of the interface.
 *
 * @param context - The request whose account decides what is visible.
 * @param item - A ticket the account may see.
 * @returns The ticket without GitHub fields and without hidden relatives.
 */
export async function projectTicket(
  context: McpTicketContext,
  item: WorkItemDetail,
): Promise<McpTicket> {
  const [related, parentType, department, assignee, reporter] =
    await Promise.all([
      relatedOf(context, item),
      parentTypeOf(context, item),
      departmentOf(context, item),
      context.person(item.assigneeId),
      context.person(item.createdBy),
    ]);
  return {
    id: item.id,
    key: item.key,
    type: item.type,
    project: { id: item.projectId, name: item.projectName },
    title: item.title,
    description: item.description,
    status: statusOf(item),
    priority: item.priority,
    assignee,
    assigneeGroup: groupOf(item),
    reporter,
    department,
    parent:
      parentType === null || item.parentKey === null
        ? null
        : {
            key: item.parentKey,
            type: parentType,
            title: item.parentTitle ?? "",
          },
    milestone: milestoneOf(item),
    labels: related.labels.map(labelOf),
    startAt: toDay(item.startAt),
    dueAt: toDay(item.dueAt),
    sortOrder: item.sortOrder,
    archived: item.archivedAt !== null,
    progress: {
      subtaskTotal: item.subtaskTotal,
      subtaskCompleted: item.subtaskCompleted,
      percentage: item.progressPercentage,
    },
    subtasks: related.subtasks.map((subtask) => ({
      key: subtask.key,
      type: subtask.type,
      title: subtask.title,
      status: statusOf(subtask),
    })),
    checklist: related.checklist.map((entry) => ({
      id: entry.id,
      title: entry.title,
      isDone: entry.isDone,
    })),
    links: related.links.map((link) => ({
      id: link.id,
      type: link.linkType,
      direction: link.direction,
      ticket: { key: link.linkedWorkItemKey, title: link.linkedWorkItemTitle },
    })),
    attachments: related.attachments.map(attachmentOf),
    createdAt: toIsoTimestamp(item.createdAt),
    updatedAt: toIsoTimestamp(item.updatedAt),
    completedAt:
      item.completedAt === null ? null : toIsoTimestamp(item.completedAt),
  };
}

/**
 * Reads a ticket again and builds its answer object, as every change answers.
 *
 * @param context - The request whose account decides what is visible.
 * @param id - Internal id of the ticket.
 */
export async function currentTicket(
  context: McpTicketContext,
  id: string,
): Promise<McpTicket> {
  return projectTicket(
    context,
    await context.services.tasks.getById(context.actor, id),
  );
}

/**
 * Builds one hit of a ticket search.
 *
 * @param context - The request whose account decides what is visible.
 * @param item - A ticket the account may see.
 * @param labels - The labels of the ticket.
 */
export async function projectSummary(
  context: McpTicketContext,
  item: WorkItemDetail,
  labels: readonly Label[],
): Promise<McpTicketSummary> {
  return {
    key: item.key,
    type: item.type,
    title: item.title,
    status: statusOf(item),
    priority: item.priority,
    assignee: await context.person(item.assigneeId),
    assigneeGroup: groupOf(item),
    parentKey: item.parentKey,
    milestone: milestoneOf(item),
    labels: labels.map(labelOf),
    archived: item.archivedAt !== null,
  };
}
