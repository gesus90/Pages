import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";
import { CAPABILITY } from "@/definition/Authorization";
import type { Capability } from "@/definition/Authorization";
import type { PermissionService } from "@/backend/auth/PermissionService";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { Project } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Verifies that an actor may reach, and change, projects and their work items. */
export class TaskAccessGuard {
  private readonly taskRepository: TaskRepository;
  private readonly projectService: ProjectService;
  private readonly permissions: PermissionService;

  /**
   * Creates an access guard.
   *
   * @param taskRepository - Task persistence boundary.
   * @param projectService - Project business-logic boundary deciding access.
   */
  public constructor(
    taskRepository: TaskRepository,
    projectService: ProjectService,
    permissions: PermissionService,
  ) {
    this.taskRepository = taskRepository;
    this.projectService = projectService;
    this.permissions = permissions;
  }

  /** Checks the global action capability without bypassing project visibility. */
  public async requireCapability(
    actor: User,
    capability: Capability,
  ): Promise<void> {
    if (!(await this.permissions.hasCapability(actor, capability)))
      throw new WorkItemAccessDeniedError();
  }

  /** Returns the project after verifying that the actor may see it. */
  public async requireProject(
    actor: User,
    projectId: string,
  ): Promise<Project> {
    return this.projectService.getById(actor, projectId);
  }

  /**
   * Verifies that the actor may change work in a project.
   *
   * @throws {WorkItemAccessDeniedError} When the actor lacks write permission.
   */
  public async requireWriteAccess(
    actor: User,
    projectId: string,
    capability: Capability = CAPABILITY.WRITE,
  ): Promise<void> {
    await this.requireCapability(actor, capability);
    if (!(await this.projectService.canWriteProject(actor, projectId))) {
      throw new WorkItemAccessDeniedError();
    }
  }

  /** Verifies that the actor may see a project and change work in it. */
  public async requireWritableProject(
    actor: User,
    projectId: string,
    capability: Capability = CAPABILITY.WRITE,
  ): Promise<void> {
    await this.requireProject(actor, projectId);
    await this.requireWriteAccess(actor, projectId, capability);
  }

  /**
   * Returns a work item after verifying that the actor may see its project.
   *
   * @throws {WorkItemNotFoundError} When no such work item exists.
   */
  public async requireWorkItem(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemDetail> {
    const item = await this.taskRepository.findById(workItemId);

    if (!item) {
      throw new WorkItemNotFoundError();
    }

    await this.requireProject(actor, item.projectId);

    return item;
  }

  /** Preserves existing planning access until A3 defines the milestone capability. */
  public async requirePlanningProject(
    actor: User,
    projectId: string,
  ): Promise<void> {
    await this.requireProject(actor, projectId);
    if (!(await this.projectService.canWriteProject(actor, projectId))) {
      throw new WorkItemAccessDeniedError();
    }
  }

  /** Returns a work item the actor may see and change. */
  public async requireWritableWorkItem(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemDetail> {
    const item = await this.requireWorkItem(actor, workItemId);

    await this.requireWriteAccess(actor, item.projectId);

    return item;
  }

  /**
   * Resolves the projects of a query to those the actor may see.
   *
   * @param actor - User asking.
   * @param requestedIds - Projects the caller asked for, or `undefined` for all of the actor.
   */
  public async resolveAccessibleProjectIds(
    actor: User,
    requestedIds?: readonly string[],
  ): Promise<string[]> {
    const accessibleProjects = await this.projectService.findAll(actor);
    const accessibleIds = new Set(
      accessibleProjects.map((project) => project.id),
    );

    if (!requestedIds) {
      return Array.from(accessibleIds);
    }

    return requestedIds.filter((id) => accessibleIds.has(id));
  }
}
