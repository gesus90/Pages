import { useTranslation } from "react-i18next";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { toGroupAssigneeValue } from "@/app/lib/assignee-value";

import type { User } from "@/definition/User";

/** One entry of an assignee select; a group's value carries its prefix. */
export interface AssigneeOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Returns the assignee choices: nobody, the people of the project and the groups.
 *
 * @param users - People who may work in the project.
 * @param currentGroupId - Group the edited ticket already has; it stays
 * selectable (marked as empty) when its members are gone.
 */
export function useAssigneeOptions(
  users: readonly User[],
  currentGroupId: string | null = null,
): readonly AssigneeOption[] {
  const { t } = useTranslation();
  const { assigneeGroups } = useTicketAccess();

  return [
    { label: t("tasks.unassigned"), value: "" },
    ...users.map((user) => ({ label: user.displayName, value: user.id })),
    ...assigneeGroups
      .filter((group) => group.memberCount > 0 || group.id === currentGroupId)
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
