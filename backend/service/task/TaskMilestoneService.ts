import { randomUUID } from "node:crypto";

import { isMilestoneLinkType, isMilestoneStatus } from "@/definition/Task";

import {
  WorkItemConflictError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { validateMilestoneInput } from "@/backend/service/MilestoneValidation";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { MilestoneField } from "@/backend/database/repositories/task/MilestoneRepository";
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

/** One milestone field with the value it held when it was read, and its new value. */
export interface MilestoneFieldInput {
  readonly field: MilestoneField;
  readonly base: string | null;
  readonly value: string | null;
}

/** The milestone after a single-field change, and whether the change wrote anything. */
export interface MilestoneFieldUpdate {
  readonly milestone: Milestone;
  readonly isChanged: boolean;
}

/** Values required to link two milestones of one project. */
export interface AddMilestoneDependencyInput {
  readonly projectId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly linkType: MilestoneLinkType;
}

/**
 * Validates the new value of one milestone field against the milestone it
 * replaces a value of.
 *
 * @returns The normalized value to store.
 * @throws {WorkItemValidationError} When the value is unusable for the field.
 */
function readFieldValue(
  existing: Milestone,
  change: MilestoneFieldInput,
): string | null {
  const dates = { dueAt: existing.dueAt, startAt: existing.startAt };

  switch (change.field) {
    case "name":
      return validateMilestoneInput({ ...dates, name: change.value ?? "" })
        .name;
    case "description":
      return (change.value ?? "").trim();
    case "status":
      if (!isMilestoneStatus(change.value)) {
        throw new WorkItemValidationError("milestoneStatusUnsupported");
      }

      return change.value;
    case "startAt":
      return validateMilestoneInput({
        ...dates,
        name: existing.name,
        startAt: change.value,
      }).startAt;
    case "dueAt":
      return validateMilestoneInput({
        ...dates,
        dueAt: change.value,
        name: existing.name,
      }).dueAt;
  }
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
      throw new WorkItemValidationError("milestoneStatusUnsupported");
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

  /**
   * Replaces one field of a milestone while it still holds the value the
   * caller read; every other field stays as it is.
   *
   * @param actor - The person changing it; needs project management access.
   * @param id - Milestone identifier.
   * @param change - The field, the value it was read with, and the new value.
   * @returns The stored milestone and whether anything was written; nothing
   * is when the milestone already has the value.
   * @throws {WorkItemConflictError} When the field changed meanwhile.
   * @throws {WorkItemValidationError} When the value is unusable.
   */
  public async updateMilestoneField(
    actor: User,
    id: string,
    change: MilestoneFieldInput,
  ): Promise<MilestoneFieldUpdate> {
    const existing = await this.requireWritableMilestone(actor, id);
    const current = this.currentValue(existing, change.field);
    const value = readFieldValue(existing, change);

    // The stored value counts as the new one when someone saved it meanwhile.
    if (current !== change.base && current !== value) {
      throw new WorkItemConflictError(change.field);
    }

    if (value === current) {
      return { isChanged: false, milestone: existing };
    }

    const isUpdated = await this.taskRepository.updateMilestoneField(id, {
      base: current,
      field: change.field,
      value,
    });

    if (!isUpdated) {
      throw new WorkItemConflictError(change.field);
    }

    this.cache.invalidateWorkItems();

    const updated = await this.taskRepository.findMilestoneById(id);

    if (!updated) {
      throw new Error("Updated milestone could not be retrieved.");
    }

    return { isChanged: true, milestone: updated };
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
      throw new WorkItemValidationError("dependencyTypeUnsupported");
    }

    if (input.sourceId === input.targetId) {
      throw new WorkItemValidationError("dependencySelf");
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
      throw new WorkItemValidationError("dependencyNotFound");
    }

    await this.taskRepository.deleteDependency(dependencyId);
    this.cache.invalidateWorkItems();
  }

  private async requireWritableMilestone(
    actor: User,
    id: string,
  ): Promise<Milestone> {
    const existing = await this.taskRepository.findMilestoneById(id);

    if (!existing) {
      throw new WorkItemValidationError("milestoneNotFound");
    }

    await this.access.requirePlanningProject(actor, existing.projectId);

    return existing;
  }

  private currentValue(
    milestone: Milestone,
    field: MilestoneField,
  ): string | null {
    return {
      description: milestone.description,
      dueAt: milestone.dueAt,
      name: milestone.name,
      startAt: milestone.startAt,
      status: milestone.status,
    }[field];
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
      throw new WorkItemValidationError("dependencyPairInvalid");
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
      throw new WorkItemValidationError("dependencyExists");
    }
  }
}
