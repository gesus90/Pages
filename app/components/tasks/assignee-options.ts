import { useTranslation } from "react-i18next";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { toGroupAssigneeValue } from "@/app/lib/assignee-value";

import type { User } from "@/definition/User";

/** One entry of an assignee select; a group's value carries its prefix. */
export interface AssigneeOption {
  readonly value: string;
  readonly label: string;
}

/** The ticket an assignee select is built for. */
export interface AssigneeScope {
  /**
   * Group the edited ticket already has; it stays selectable (marked as empty)
   * when its members are gone.
   */
  readonly currentGroupId?: string | null;
  /** Project of the ticket; without it every group with members is offered. */
  readonly projectId?: string | null;
}

/**
 * Returns the assignee choices: nobody, the people of the project and the groups.
 *
 * @remarks
 * For a project, only groups with at least one member who can work in it are
 * offered, because a ticket assigned to any other group has nobody to do it.
 *
 * @param users - People who may work in the project.
 * @param scope - The ticket the choices are for.
 */
export function useAssigneeOptions(
  users: readonly User[],
  scope: AssigneeScope = {},
): readonly AssigneeOption[] {
  const { t } = useTranslation();
  const { assigneeGroupIdsByProject, assigneeGroups } = useTicketAccess();
  const { currentGroupId = null, projectId = null } = scope;
  const projectGroupIds = projectId
    ? (assigneeGroupIdsByProject[projectId] ?? [])
    : null;

  return [
    { label: t("tasks.unassigned"), value: "" },
    ...users.map((user) => ({ label: user.displayName, value: user.id })),
    ...assigneeGroups
      .filter(
        (group) =>
          group.id === currentGroupId ||
          (group.memberCount > 0 &&
            (projectGroupIds === null || projectGroupIds.includes(group.id))),
      )
      .map((group) => ({
        label: t(
          group.memberCount > 0
            ? "tasks.assignee.group"
            : "tasks.assignee.emptyGroup",
          { name: group.name },
        ),
        value: toGroupAssigneeValue(group.id),
      })),
  ];
}
