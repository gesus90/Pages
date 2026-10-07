import { WORKFLOW_STATUS_KEY } from "@/definition/Task";

import type { WorkflowStatus } from "@/definition/Task";

/**
 * Finds the status a new ticket starts in when the form does not name one.
 *
 * @remarks
 * It is the status the board's first column stands for and the one GitHub
 * imports use: backlog, else the first status that is not done.
 *
 * @param statuses - Workflow statuses in board order.
 * @returns The identifier of the status, or an empty string without statuses.
 */
export function findDefaultStatusId(
  statuses: readonly WorkflowStatus[],
): string {
  const status =
    statuses.find(({ key }) => key === WORKFLOW_STATUS_KEY.BACKLOG) ??
    statuses.find(({ isDone }) => !isDone) ??
    statuses[0];

  return status?.id ?? "";
}
