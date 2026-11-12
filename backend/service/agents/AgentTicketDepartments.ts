import type { AgentDirectoryEntry } from "@/definition/AgentExtensions";
import type { WorkItemDetail } from "@/definition/Task";

/**
 * Names the departments of a ticket for an agent.
 *
 * @param directory - The departments the account sees.
 * @param ticket - The visible ticket.
 * @returns `departments` with every department of the ticket, and `department`,
 * the first of them or `null`, kept for older callers.
 *
 * @remarks
 * A department outside the directory keeps its id and an empty name, so the
 * list still equals what `expectedDepartmentIds` of a change must carry.
 */
export function describeTicketDepartments(
  directory: readonly AgentDirectoryEntry[],
  ticket: Pick<WorkItemDetail, "departmentIds">,
): {
  readonly department: AgentDirectoryEntry | null;
  readonly departments: readonly AgentDirectoryEntry[];
} {
  const departments = ticket.departmentIds.map((id) => ({
    id,
    name: directory.find((entry) => entry.id === id)?.name ?? "",
  }));

  return { department: departments[0] ?? null, departments };
}
