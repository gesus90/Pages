import { useSubmit } from "react-router";

import { AssigneeSightNotice } from "@/app/components/tasks/assignee-sight-notice";
import { useAssigneeSight } from "@/app/components/tasks/use-assignee-sight";

import type { WorkItemDetail } from "@/definition/Task";

/** What a ticket view needs to warn about an assignee without sight. */
interface TicketAssigneeSightControls {
  /** Call it with the assignee value that was just chosen. */
  readonly checkAssignee: (assigneeValue: string) => void;
  /** The warning with its offer, or `null` while nothing is wrong. */
  readonly notice: React.ReactElement | null;
}

/**
 * Warns when the person or group assigned to a ticket cannot see it.
 *
 * @param ticket - The ticket being assigned.
 * @returns The check to run on each assignment and the notice to render.
 *
 * @remarks
 * The offer adds a department of the assignee to the ticket through the same
 * action as the department chips, so the server applies the usual rights.
 */
export function useTicketAssigneeSight(
  ticket: Pick<WorkItemDetail, "departmentIds" | "id">,
): TicketAssigneeSightControls {
  const submit = useSubmit();
  const { check, dismiss, warning } = useAssigneeSight({ ticketId: ticket.id });

  function handleAdd(departmentId: string): void {
    const next = [...ticket.departmentIds, departmentId];
    void submit(
      {
        boardLocal: "true",
        departmentIds: JSON.stringify(next),
        expectedDepartmentIds: JSON.stringify(ticket.departmentIds),
        id: ticket.id,
        intent: "set-department",
      },
      { method: "post" },
    );
    dismiss();
  }

  return {
    checkAssignee: check,
    notice: warning ? (
      <AssigneeSightNotice
        onAddDepartment={(department) => handleAdd(department.id)}
        onDismiss={dismiss}
        sight={warning}
      />
    ) : null,
  };
}
