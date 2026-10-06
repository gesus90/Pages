import { randomUUID } from "node:crypto";

import { isMilestoneLinkType, isMilestoneStatus } from "@/definition/Task";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { validateMilestoneInput } from "@/backend/service/MilestoneValidation";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type {
  Milestone,
  MilestoneColor,
  MilestoneDependency,
  MilestoneIcon,
  MilestoneLinkType,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** Values required to create a milestone. */
export interface CreateMilestoneInput {
  readonly projectId: string;
  readonly name: string;
  readonly description?: string;
  readonly startAt?: string | null;
  readonly dueAt?: string | null;
  readonly colorKey?: MilestoneColor | null;
  readonly iconKey?: MilestoneIcon | null;
  readonly colorCustom?: string | null;
}

/** Values that can be changed on a milestone. */
export interface UpdateMilestoneInput {
  readonly name: string;
  readonly description: string;
  readonly status: "open" | "completed" | "archived";
  readonly startAt?: string | null;
  readonly dueAt: string | null;
  readonly colorKey?: MilestoneColor | null;
  readonly iconKey?: MilestoneIcon | null;
  readonly colorCustom?: string | null;
}

/** Values required to link two milestones of one project. */
export interface AddMilestoneDependencyInput {
  readonly projectId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly linkType: MilestoneLinkType;
}

/** Manages the milestones of projects and the dependencies between them. */
export class TaskMilestoneService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;
  private readonly cache: ServerCache;

  /**
   * Creates a milestone service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Verifier of project access and write permission.
   * @param cache - Shared server cache.
   */
  public constructor(
    taskRepository: TaskRepository,
    access: TaskAccessGuard,
    cache: ServerCache,
  ) {
    this.taskRepository = taskRepository;
    this.access = access;
    this.cache = cache;
  }

  /** Returns non-archived milestones for projects accessible to the actor. */
  public async findMilestones(
    actor: User,
    projectIds: readonly string[],
  ): Promise<Milestone[]> {
    const validProjectIds = await this.access.resolveAccessibleProjectIds(
      actor,
      projectIds,
    );

    return this.taskRepository.findMilestonesByProjectIds(validProjectIds);
  }

  /** Creates a milestone after verifying project access and write permission. */
  public async createMilestone(
    actor: User,
    input: CreateMilestoneInput,
  ): Promise<Milestone> {
    await this.access.requirePlanningProject(actor, input.projectId);

    const fields = validateMilestoneInput(input);
    const description = (input.description ?? "").trim();

    const id = randomUUID();

    await this.taskRepository.insertMilestone({
      ...fields,
      description,
      id,
      projectId: input.projectId,
    });
    this.cache.invalidateWorkItems();

    const created = await this.taskRepository.findMilestoneById(id);

    if (!created) {
      throw new Error("Created milestone could not be retrieved.");
    }

    return created;
  }

  /** Updates a milestone after verifying project access and write permission. */
  public async updateMilestone(
    actor: User,
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone> {
    await this.requireWritableMilestone(actor, id);

    const fields = validateMilestoneInput(input);

    if (!isMilestoneStatus(input.status)) {
      throw new WorkItemValidationError("Unsupported milestone status.");
    }

    await this.taskRepository.updateMilestone(id, {
      ...fields,
      description: input.description.trim(),
      status: input.status,
    });
    this.cache.invalidateWorkItems();

    const updated = await this.taskRepository.findMilestoneById(id);

    if (!updated) {
      throw new Error("Updated milestone could not be retrieved.");
    }

    return updated;
  }

  /** Soft-deletes a milestone together with its dependencies. */
  public async deleteMilestone(actor: User, id: string): Promise<void> {
    await this.requireWritableMilestone(actor, id);
    await this.taskRepository.deleteDependenciesByMilestone(id);
    await this.taskRepository.archiveMilestone(id);
    this.cache.invalidateWorkItems();
  }

  /** Returns every dependency of the given projects. */
  public async findDependencies(
    actor: User,
    projectIds: readonly string[],
  ): Promise<MilestoneDependency[]> {
    const validProjectIds = await this.access.resolveAccessibleProjectIds(
      actor,
      projectIds,
    );

    return this.taskRepository.findDependenciesByProjectIds(validProjectIds);
  }

  /** Links two milestones of one project with a directed dependency. */
  public async addDependency(
    actor: User,
    input: AddMilestoneDependencyInput,
  ): Promise<MilestoneDependency> {
    await this.access.requirePlanningProject(actor, input.projectId);

    if (!isMilestoneLinkType(input.linkType)) {
      throw new WorkItemValidationError("Unsupported dependency type.");
    }

    if (input.sourceId === input.targetId) {
      throw new WorkItemValidationError("A milestone cannot depend on itself.");
    }

    await this.requireMilestonePair(input);
    await this.requireNotLinked(input);

    const id = randomUUID();

    await this.taskRepository.insertDependency({
      id,
      linkType: input.linkType,
      projectId: input.projectId,
      sourceId: input.sourceId,
      targetId: input.targetId,
    });
    this.cache.invalidateWorkItems();

    const created = (
      await this.taskRepository.findDependenciesByProjectIds([input.projectId])
    ).find((dependency) => dependency.id === id);

    if (!created) {
      throw new Error("Created dependency could not be retrieved.");
    }

    return created;
  }

  /** Removes a single dependency after verifying write permission. */
  public async removeDependency(
    actor: User,
    projectId: string,
    dependencyId: string,
  ): Promise<void> {
    await this.access.requirePlanningProject(actor, projectId);

    const existing = await this.taskRepository.findDependenciesByProjectIds([
      projectId,
    ]);

    if (!existing.some((dependency) => dependency.id === dependencyId)) {
      throw new WorkItemValidationError("Selected dependency does not exist.");
    }

    await this.taskRepository.deleteDependency(dependencyId);
    this.cache.invalidateWorkItems();
  }

  private async requireWritableMilestone(
    actor: User,
    id: string,
  ): Promise<void> {
    const existing = await this.taskRepository.findMilestoneById(id);

    if (!existing) {
      throw new WorkItemValidationError("Selected milestone does not exist.");
    }

    await this.access.requirePlanningProject(actor, existing.projectId);
  }

  private async requireMilestonePair(
    input: AddMilestoneDependencyInput,
  ): Promise<void> {
    const milestones = await this.taskRepository.findMilestonesByProjectIds([
      input.projectId,
    ]);
    const hasSource = milestones.some(
      (milestone) => milestone.id === input.sourceId,
    );
    const hasTarget = milestones.some(
      (milestone) => milestone.id === input.targetId,
    );

    if (!hasSource || !hasTarget) {
      throw new WorkItemValidationError(
        "Dependencies require two milestones of the same project.",
      );
    }
  }

  private async requireNotLinked(
    input: AddMilestoneDependencyInput,
  ): Promise<void> {
    const existing = await this.taskRepository.findDependenciesByProjectIds([
      input.projectId,
    ]);
    const isLinked = existing.some(
      (dependency) =>
        (dependency.sourceId === input.sourceId &&
          dependency.targetId === input.targetId) ||
        (dependency.sourceId === input.targetId &&
          dependency.targetId === input.sourceId),
    );

    if (isLinked) {
      throw new WorkItemValidationError("These milestones are already linked.");
    }
  }
}
