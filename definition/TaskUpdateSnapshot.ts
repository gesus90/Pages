import { z } from "zod";

import type { WorkItemDetail } from "./Task";

const snapshotSchema = z
  .object({
    title: z.string(),
    statusId: z.string(),
    priority: z.string(),
    assigneeId: z.string().nullable(),
    assigneeGroupId: z.string().nullable(),
    reporterId: z.string(),
    parentId: z.string().nullable(),
    milestoneId: z.string().nullable(),
    dueAt: z.string().nullable(),
    startAt: z.string().nullable(),
  })
  .strict();

/** The fields a complete ticket edit must not overwrite after a concurrent change. */
export interface TaskUpdateSnapshot {
  readonly title: string;
  readonly statusId: string;
  readonly priority: string;
  readonly assigneeId: string | null;
  readonly assigneeGroupId: string | null;
  readonly reporterId: string;
  readonly parentId: string | null;
  readonly milestoneId: string | null;
  readonly dueAt: string | null;
  readonly startAt: string | null;
}

/** The source project and fields shown when a project move was confirmed. */
export interface TaskMoveSnapshot {
  readonly projectId: string;
  readonly fields: TaskUpdateSnapshot;
  readonly githubIssueNumber: number | null;
}

/** Takes the editable values visible when a ticket edit begins. */
export function taskUpdateSnapshot(ticket: WorkItemDetail): TaskUpdateSnapshot {
  return {
    title: ticket.title,
    statusId: ticket.statusId,
    priority: ticket.priority,
    assigneeId: ticket.assigneeId,
    assigneeGroupId: ticket.assigneeGroupId,
    reporterId: ticket.createdBy,
    parentId: ticket.parentId,
    milestoneId: ticket.milestoneId,
    dueAt: ticket.dueAt,
    startAt: ticket.startAt,
  };
}

/** Validates an untrusted snapshot sent with an edit. */
export function parseTaskUpdateSnapshot(
  text: string,
): TaskUpdateSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = snapshotSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
