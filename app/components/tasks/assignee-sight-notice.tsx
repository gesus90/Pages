import { useTranslation } from "react-i18next";

import type { Department } from "@/definition/Authorization";
import type { TicketAssigneeSight } from "@/definition/Task";

interface AssigneeSightNoticeProps {
  readonly sight: TicketAssigneeSight;
  /** Adds a department of those without sight to the ticket. */
  readonly onAddDepartment: (department: Department) => void;
  readonly onDismiss: () => void;
}

/**
 * Warns that the assignee cannot see the ticket because of its departments.
 *
 * @remarks
 * Offers the departments of those without sight that the visitor may add.
 */
export function AssigneeSightNotice({
  sight,
  onAddDepartment,
  onDismiss,
}: AssigneeSightNoticeProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-warning-subtle px-3 py-2 text-xs text-warning"
      role="status"
    >
      <p>
        {t(
          sight.isGroup
            ? "tasks.department.groupNoSight"
            : "tasks.department.assigneeNoSight",
          { name: sight.targetName },
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {sight.offer.map((department) => (
          <button
            key={department.id}
            className="font-semibold underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            onClick={() => onAddDepartment(department)}
            type="button"
          >
            {t("tasks.department.assigneeAddDepartment", {
              department: department.name,
            })}
          </button>
        ))}
        <button
          className="text-muted-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          onClick={onDismiss}
          type="button"
        >
          {t("tasks.department.assigneeDismiss")}
        </button>
      </div>
    </div>
  );
}
