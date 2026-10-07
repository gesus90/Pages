import type { WorkItemDetail } from "@/definition/Task";

const GROUP_PREFIX = "group:";

/** The two columns a ticket is assigned through; at most one of them is set. */
export interface AssigneeFields {
  readonly assigneeId: string;
  readonly assigneeGroupId: string;
}

/**
 * Encodes the assignment of a ticket as the single value of an assignee select.
 *
 * @param item - Ticket whose person or group is selected.
 * @returns A user id, `group:<id>`, or the empty string for nobody.
 */
export function toAssigneeValue(
  item: Pick<WorkItemDetail, "assigneeGroupId" | "assigneeId">,
): string {
  return item.assigneeGroupId
    ? `${GROUP_PREFIX}${item.assigneeGroupId}`
    : (item.assigneeId ?? "");
}

/**
 * Decodes the value of an assignee select into the fields a form posts.
 *
 * @param value - A user id, `group:<id>`, or the empty string for nobody.
 */
export function splitAssigneeValue(value: string): AssigneeFields {
  return value.startsWith(GROUP_PREFIX)
    ? { assigneeGroupId: value.slice(GROUP_PREFIX.length), assigneeId: "" }
    : { assigneeGroupId: "", assigneeId: value };
}

/**
 * Builds the select value that picks a group.
 *
 * @param groupId - Identifier of the group.
 */
export function toGroupAssigneeValue(groupId: string): string {
  return `${GROUP_PREFIX}${groupId}`;
}
