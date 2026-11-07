import { randomUUID } from "node:crypto";

import { ProjectManagementDeniedError } from "@/backend/error/ProjectErrors";

import { ProjectAccessService } from "./ProjectAccessService";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  NewProjectGoal,
  ProjectRepository,
} from "@/backend/database/repositories/ProjectRepository";
import type { ProjectGoal } from "@/definition/Project";
import type { User } from "@/definition/User";

const MAXIMUM_GOAL_TITLE_LENGTH = 200;

function requireGoalTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > MAXIMUM_GOAL_TITLE_LENGTH)
    throw new Error("Goal title must be between 1 and 200 characters.");
  return trimmed;
}

/** Reads and changes the goals of a project with the project write rule. */
export class ProjectGoalService {
  private readonly repository: ProjectRepository;
  private readonly access: ProjectAccessService;

  /**
   * Creates the service.
   *
   * @param repository - Project persistence boundary.
   * @param cache - Shared server cache of the project access checks.
   * @param channel - Whether the administrator is read from the interface mode or from MCP eligibility.
   */
  public constructor(
    repository: ProjectRepository,
    cache: ServerCache,
    channel: ActorChannel = "ui",
  ) {
    this.repository = repository;
    this.access = new ProjectAccessService(repository, cache, channel);
  }

  /** Returns the goals of a project the actor may see. */
  public async findAll(actor: User, projectId: string): Promise<ProjectGoal[]> {
    await this.access.getById(actor, projectId);
    return this.repository.findGoals(projectId);
  }

  /** Creates a goal and records the change. */
  public async create(
    actor: User,
    projectId: string,
    title: string,
  ): Promise<void> {
    await this.requireWrite(actor, projectId);
    const trimmed = requireGoalTitle(title);
    const existing = await this.repository.findGoals(projectId);
    const goal: NewProjectGoal = {
      id: randomUUID(),
      projectId,
      title: trimmed,
      position: existing.length,
    };
    await this.repository.insertGoal(goal);
    await this.repository.insertActivity({
      id: randomUUID(),
      projectId,
      userId: actor.id,
      action: "goal_created",
      category: "planning",
      message: `Goal "${trimmed}" was created.`,
    });
  }

  /** Changes the title and the state of a goal. */
  public async update(
    actor: User,
    projectId: string,
    goalId: string,
    changes: { readonly title: string; readonly isDone: boolean },
  ): Promise<void> {
    await this.requireWrite(actor, projectId);
    await this.requireGoal(projectId, goalId);
    const trimmed = requireGoalTitle(changes.title);
    await this.repository.updateGoal(goalId, trimmed, changes.isDone);
  }

  /** Deletes a goal. */
  public async delete(
    actor: User,
    projectId: string,
    goalId: string,
  ): Promise<void> {
    await this.requireWrite(actor, projectId);
    await this.requireGoal(projectId, goalId);
    await this.repository.deleteGoal(goalId);
  }

  private async requireWrite(actor: User, projectId: string): Promise<void> {
    if (!(await this.access.canWrite(actor, projectId)))
      throw new ProjectManagementDeniedError();
    await this.access.getById(actor, projectId);
  }

  private async requireGoal(projectId: string, goalId: string): Promise<void> {
    const goals = await this.repository.findGoals(projectId);
    if (!goals.some((goal) => goal.id === goalId))
      throw new ProjectManagementDeniedError();
  }
}
