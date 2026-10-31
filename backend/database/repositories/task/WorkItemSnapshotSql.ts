import type { TaskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";

/** Parameters for an optional atomic comparison of the displayed fields. */
export function snapshotParameters(expected: TaskUpdateSnapshot | undefined): {
  readonly has_expected: boolean;
  readonly base_title: string | null;
  readonly base_status_id: string | null;
  readonly base_priority: string | null;
  readonly base_assignee_id: string | null;
  readonly base_assignee_group_id: string | null;
  readonly base_reporter_id: string | null;
  readonly base_parent_id: string | null;
  readonly base_milestone_id: string | null;
  readonly base_due_at: string | null;
  readonly base_start_at: string | null;
} {
  if (!expected) {
    return {
      has_expected: false,
      base_title: null,
      base_status_id: null,
      base_priority: null,
      base_assignee_id: null,
      base_assignee_group_id: null,
      base_reporter_id: null,
      base_parent_id: null,
      base_milestone_id: null,
      base_due_at: null,
      base_start_at: null,
    };
  }

  return {
    has_expected: true,
    base_title: expected.title,
    base_status_id: expected.statusId,
    base_priority: expected.priority,
    base_assignee_id: expected.assigneeId,
    base_assignee_group_id: expected.assigneeGroupId,
    base_reporter_id: expected.reporterId,
    base_parent_id: expected.parentId,
    base_milestone_id: expected.milestoneId,
    base_due_at: expected.dueAt,
    base_start_at: expected.startAt,
  };
}
