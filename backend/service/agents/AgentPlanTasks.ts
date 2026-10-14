import { AgentError } from "@/backend/error/AgentErrors";
import { materializeTicketChecklist } from "@/backend/service/task/TicketChecklist";

import type { MaterializedChecklist } from "@/backend/service/task/TicketChecklist";
import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentPlanTask } from "@/definition/AgentPlan";
import type { AgentPlanTaskSnapshot } from "./AgentPlanBindings";

/** A ticket bound to a plan node and its checklist as the executor sees it now. */
export interface AgentPlanTicketChecklist {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly checklist: MaterializedChecklist;
}

/** Reuses ticket visibility, including department restrictions, instead of reading raw project tickets. */
export class AgentPlanTasks {
  private readonly tasks: Pick<
    TaskService,
    "findAll" | "getById" | "findChecklistItems"
  >;
  private readonly users: Pick<UserService, "getById">;

  public constructor(
    tasks: Pick<TaskService, "findAll" | "getById" | "findChecklistItems">,
    users: Pick<UserService, "getById">,
  ) {
    this.tasks = tasks;
    this.users = users;
  }

  /** Lists tasks and subtasks without unrelated ticket integrations or backend-only fields. */
  public async list(
    userId: string,
    projectId: string,
  ): Promise<readonly AgentPlanTask[]> {
    const actor = await this.users.getById(userId);
    if (!actor?.isActive) throw new AgentError("plan_access_denied");
    const items = await this.tasks.findAll(actor, {
      projectIds: [projectId],
      archived: "active",
    });
    return items.flatMap((item) => {
      if (item.type !== "task" && item.type !== "subtask") return [];
      return [
        {
          id: item.id,
          key: item.key,
          title: item.title,
          type: item.type,
          parentId: item.parentId,
          statusKey: item.statusKey,
          statusName: item.statusName,
          isDone: item.isDone,
        },
      ];
    });
  }

  /**
   * Reads the checklist of a bound ticket with the rights of the executor.
   *
   * @throws {AgentError} `plan_binding_invalid` when the ticket is no longer
   * a visible, active task of the project.
   */
  public async checklist(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<AgentPlanTicketChecklist> {
    const actor = await this.users.getById(userId);
    if (!actor?.isActive) throw new AgentError("plan_access_denied");
    try {
      const task = await this.tasks.getById(actor, taskId);
      if (task.projectId !== projectId || task.archivedAt !== null)
        throw new AgentError("plan_binding_invalid");
      const criteria = await this.tasks.findChecklistItems(actor, task.id);
      return {
        id: task.id,
        key: task.key,
        title: task.title,
        checklist: materializeTicketChecklist(task.description, criteria),
      };
    } catch (error: unknown) {
      if (error instanceof AgentError) throw error;
      throw new AgentError("plan_binding_invalid");
    }
  }

  /** Captures plain markdown and its revision, without changing the ticket's status. */
  public async snapshot(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<AgentPlanTaskSnapshot> {
    const actor = await this.users.getById(userId);
    if (!actor?.isActive) throw new AgentError("plan_access_denied");
    try {
      const task = await this.tasks.getById(actor, taskId);
      if (
        task.projectId !== projectId ||
        task.archivedAt !== null ||
        (task.type !== "task" && task.type !== "subtask")
      )
        throw new AgentError("plan_binding_invalid");
      return {
        id: task.id,
        markdown: `# ${task.key}: ${task.title}\n\n${task.description}`,
        version: task.updatedAt,
      };
    } catch (error: unknown) {
      if (error instanceof AgentError) throw error;
      throw new AgentError("plan_binding_invalid");
    }
  }
}
