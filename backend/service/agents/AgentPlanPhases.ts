import { AgentError } from "@/backend/error/AgentErrors";

import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentPlanPhase } from "@/definition/AgentPlan";

/** Reads the Kanban workflow of a plan's project, the phases its ticket choice filters by. */
export class AgentPlanPhases {
  private readonly tasks: Pick<TaskService, "findAllStatuses">;
  private readonly users: Pick<UserService, "getById">;

  public constructor(
    tasks: Pick<TaskService, "findAllStatuses">,
    users: Pick<UserService, "getById">,
  ) {
    this.tasks = tasks;
    this.users = users;
  }

  /**
   * Lists the shared and the project's own workflow statuses in board order.
   *
   * @remarks
   * The task service only returns statuses of projects the person may open.
   * A key appears once, as on the board, so a filter by key stays unambiguous.
   */
  public async list(
    userId: string,
    projectId: string,
  ): Promise<readonly AgentPlanPhase[]> {
    const actor = await this.users.getById(userId);
    if (!actor?.isActive) throw new AgentError("plan_access_denied");
    const statuses = await this.tasks.findAllStatuses(actor);
    const phases = new Map<string, AgentPlanPhase>();
    for (const status of [...statuses].sort(
      (left, right) => left.position - right.position,
    )) {
      if (status.projectId !== null && status.projectId !== projectId) continue;
      if (phases.has(status.key)) continue;
      phases.set(status.key, {
        key: status.key,
        name: status.name,
        isDone: status.isDone,
      });
    }
    return [...phases.values()];
  }
}
