import { ProjectManagementDeniedError } from "@/backend/error/ProjectErrors";

import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type { WorkItemDetail, WorkItemVisibility } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Verifies that an actor may change the GitHub synchronization of a project. */
export class GitHubSyncAccessGuard {
  private readonly projectService: ProjectService;
  private readonly taskService: TaskService;

  /**
   * Creates an access guard.
   *
   * @param projectService - Project business-logic boundary deciding access.
   * @param taskService - Task business-logic boundary resolving work items.
   */
  public constructor(projectService: ProjectService, taskService: TaskService) {
    this.projectService = projectService;
    this.taskService = taskService;
  }

  /**
   * Verifies that the actor may see a project and change it.
   *
   * @throws {ProjectManagementDeniedError} When the actor lacks write permission.
   */
  public async requireWritableProject(
    actor: User,
    projectId: string,
  ): Promise<void> {
    await this.projectService.getById(actor, projectId);
    await this.requireWriteAccess(actor, projectId);
  }

  /**
   * Returns a task after verifying that the actor may change its project.
   *
   * @throws {ProjectManagementDeniedError} When the actor lacks write permission.
   */
  public async requireWritableTask(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemDetail> {
    const item = await this.taskService.getById(actor, workItemId);

    await this.requireWriteAccess(actor, item.projectId);

    return item;
  }

  /** Resolves the current account's ticket scope for sync reads and returned metadata. */
  public async visibility(actor: User): Promise<WorkItemVisibility> {
    return this.projectService.workItemVisibility(actor);
  }

  private async requireWriteAccess(
    actor: User,
    projectId: string,
  ): Promise<void> {
    if (!(await this.projectService.canWriteProject(actor, projectId))) {
      throw new ProjectManagementDeniedError();
    }
  }
}
