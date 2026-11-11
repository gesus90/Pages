import { useState } from "react";

import { splitAssigneeValue } from "@/app/lib/assignee-value";

import type { TicketAssigneeSight } from "@/definition/Task";

/** The ticket an assignment is checked for. */
interface AssigneeSightScope {
  /** An existing ticket; its stored departments decide. */
  readonly ticketId?: string;
  /** Departments chosen for a ticket that does not exist yet. */
  readonly departmentIds?: readonly string[];
}

/** The state of the notice and the check that fills it. */
interface AssigneeSightState {
  /** The answer for the last assignment, only while someone lacks sight. */
  readonly warning: TicketAssigneeSight | null;
  /** Asks the server whether the person or group of an assignee value sees the ticket. */
  readonly check: (assigneeValue: string) => void;
  readonly dismiss: () => void;
}

function isSight(value: unknown): value is TicketAssigneeSight {
  return (
    typeof value === "object" &&
    value !== null &&
    "canSee" in value &&
    typeof value.canSee === "boolean" &&
    "offer" in value &&
    Array.isArray(value.offer)
  );
}

/**
 * Checks, when a ticket is assigned, whether the assignee can see it.
 *
 * @param scope - The ticket, or the departments chosen for a new one.
 * @returns The notice to show and the check to run on every assignment.
 *
 * @remarks
 * Assigning to a person or group gives no sight of the ticket. The answer comes
 * from the server, which knows the memberships; a failed check shows nothing,
 * because the notice is a courtesy and the assignment itself is not blocked.
 */
export function useAssigneeSight(
  scope: AssigneeSightScope,
): AssigneeSightState {
  const [warning, setWarning] = useState<TicketAssigneeSight | null>(null);

  function check(assigneeValue: string): void {
    const { assigneeGroupId, assigneeId } = splitAssigneeValue(assigneeValue);
    if (assigneeGroupId === "" && assigneeId === "") {
      setWarning(null);
      return;
    }
    const query = new URLSearchParams();
    if (assigneeId !== "") query.set("personId", assigneeId);
    if (assigneeGroupId !== "") query.set("groupId", assigneeGroupId);
    if (scope.ticketId) query.set("ticketId", scope.ticketId);
    for (const departmentId of scope.departmentIds ?? []) {
      query.append("departmentId", departmentId);
    }
    void fetch(`/aufgaben-api/assignee-sight?${query.toString()}`, {
      credentials: "same-origin",
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((answer: unknown) => {
        setWarning(isSight(answer) && !answer.canSee ? answer : null);
      })
      .catch(() => setWarning(null));
  }

  return { check, dismiss: () => setWarning(null), warning };
}
