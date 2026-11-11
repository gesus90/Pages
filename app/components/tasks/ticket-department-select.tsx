import { useSubmit } from "react-router";

import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { TicketDepartmentChips } from "@/app/components/tasks/ticket-department-chips";

import type { WorkItemDetail } from "@/definition/Task";

interface TicketDepartmentSelectProps {
  readonly ticket: WorkItemDetail;
}

/** Changes the departments of a ticket: none, one or several. */
export function TicketDepartmentSelect({
  ticket,
}: TicketDepartmentSelectProps): React.ReactElement {
  const submit = useSubmit();
  const { canWrite, departments, knownDepartments } = useTicketAccess();

  function handleChange(departmentIds: string[]): void {
    void submit(
      {
        boardLocal: "true",
        departmentIds: JSON.stringify(departmentIds),
        expectedDepartmentIds: JSON.stringify(ticket.departmentIds),
        id: ticket.id,
        intent: "set-department",
      },
      { method: "post" },
    );
  }

  return (
    <TicketDepartmentChips
      disabled={ticket.archivedAt !== null || !canWrite}
      known={knownDepartments}
      onChange={handleChange}
      selectable={departments}
      selectedIds={ticket.departmentIds}
      shouldConfirmClear
    />
  );
}
