import { logCaughtError } from "@/backend/logging/Logger";

import type { TaskService } from "@/backend/service/TaskService";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

interface ImpactRequest {
  readonly key: string;
  readonly rootId: string;
  readonly ids: readonly string[];
}

/** Reads the moved subtree, whose descendants receive new project keys. */
export async function movedTicketIds(
  tasks: TaskService,
  actor: User,
  rootId: string,
): Promise<string[]> {
  const ids = [rootId];
  for (const id of ids) {
    const children = await tasks.findSubtasks(actor, id);
    for (const child of children) ids.push(child.id);
  }
  return ids;
}

/** Reads only affected visible tickets; a failed read asks the caller to reload. */
export async function ticketImpact(
  tasks: TaskService,
  actor: User,
  { key, rootId, ids }: ImpactRequest,
): Promise<{
  readonly key: string;
  readonly ticket?: WorkItemDetail;
  readonly related?: readonly WorkItemDetail[];
}> {
  try {
    const uniqueIds = [...new Set([rootId, ...ids])];
    const tickets = await Promise.all(
      uniqueIds.map((id) => tasks.getById(actor, id)),
    );
    const ticket = tickets.find((entry) => entry.id === rootId);
    if (!ticket) return { key };
    return {
      key,
      related: tickets.filter((entry) => entry.id !== rootId),
      ticket,
    };
  } catch (error: unknown) {
    logCaughtError("task_action_impact", error);
    return { key };
  }
}

/** Reads a moved subtree and its former parent after the move has committed. */
export async function movedTicketImpact(
  tasks: TaskService,
  actor: User,
  ticket: WorkItemDetail,
  formerParentId: string | null,
): ReturnType<typeof ticketImpact> {
  try {
    const ids = await movedTicketIds(tasks, actor, ticket.id);
    if (formerParentId) ids.push(formerParentId);
    return ticketImpact(tasks, actor, {
      key: ticket.key,
      rootId: ticket.id,
      ids,
    });
  } catch (error: unknown) {
    logCaughtError("task_move_impact", error);
    return { key: ticket.key };
  }
}
