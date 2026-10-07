import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Select } from "@/app/components/ui/select";

import type { WorkItemDetail } from "@/definition/Task";

interface TicketDepartmentSelectProps {
  readonly ticket: WorkItemDetail;
}

/** Reassigns a ticket to a selectable department, or removes its department. */
export function TicketDepartmentSelect({
  ticket,
}: TicketDepartmentSelectProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const { canWrite, departments } = useTicketAccess();

  function handleChange(departmentId: string): void {
    void submit(
      { departmentId, id: ticket.id, intent: "set-department" },
      { method: "post" },
    );
  }

  return (
    <Select
      ariaLabel={t("tasks.fields.department")}
      className="min-w-0"
      disabled={ticket.archivedAt !== null || !canWrite}
      onValueChange={handleChange}
      options={[
        { label: t("tasks.department.none"), value: "" },
        ...departments.map((department) => ({
          label: department.name,
          value: department.id,
        })),
      ]}
      value={ticket.departmentId ?? ""}
    />
  );
}
