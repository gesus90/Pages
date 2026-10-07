import { randomUUID } from "node:crypto";

import { normalizeHexColorCode } from "@/definition/Task";

import { CACHE_TTLS, stableIdKey } from "@/backend/cache/ServerCache";
import { workItemScopeKey } from "@/backend/cache/WorkItemScopeKey";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type { ProjectLabel } from "@/definition/Task";
import type { User } from "@/definition/User";

const MAXIMUM_LABEL_NAME_LENGTH = 40;

/** Values of a project label as entered by the user. */
export interface LabelInput {
  readonly name: string;
  readonly color: string;
}

/** Trims and validates the entered values of a label. */
function parseLabelInput(input: LabelInput): LabelInput {
  const name = input.name.trim().slice(0, MAXIMUM_LABEL_NAME_LENGTH);

  if (!name) {
    throw new WorkItemValidationError(
      "Label name must be between 1 and 40 characters.",
    );
  }

  const color = normalizeHexColorCode(input.color);

  if (!color) {
    throw new WorkItemValidationError("Unsupported label color.");
  }

  return { color, name };
}

/** Manages the label catalog of projects and the labels on work items. */
export class TaskLabelService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;
  private readonly history: TaskHistoryRecorder;
  private readonly cache: ServerCache;

  /**
   * Creates a label service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Verifier of project access and write permission.
   * @param history - Audit trail receiving label changes of work items.
   * @param cache - Shared server cache.
   */
  public constructor(
    taskRepository: TaskRepository,
    access: TaskAccessGuard,
    history: TaskHistoryRecorder,
    cache: ServerCache,
  ) {
    this.taskRepository = taskRepository;
    this.access = access;
    this.history = history;
    this.cache = cache;
  }

  /** Returns the shared label catalog of a project. */
  public async findLabels(
    actor: User,
    projectId: string,
  ): Promise<ProjectLabel[]> {
    await this.access.requireProject(actor, projectId);

    return this.taskRepository.findLabelsByProjectId(projectId);
  }

  /** Returns label usage counts mapped by label id for a project. */
  public async countLabelUsage(
    actor: User,
    projectId: string,
  ): Promise<ReadonlyMap<string, number>> {
    await this.access.requireProject(actor, projectId);
    const usageByProject = await this.countLabelUsageByProjects(actor, [
      projectId,
    ]);

    return usageByProject.get(projectId) ?? new Map<string, number>();
  }

  /**
   * Returns label catalogs for several already access-checked projects.
   *
   * @remarks
   * Callers must only pass project ids the actor may access (loaders pass
   * their already filtered project list).
   */
  public async findLabelsByProjects(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ProjectLabel[]>> {
    const cacheKey = `labels:projects:${stableIdKey(projectIds)}`;
    const cached =
      this.cache.get<ReadonlyMap<string, readonly ProjectLabel[]>>(cacheKey);

    if (cached) {
      return cached;
    }

    const labels = await this.taskRepository.findLabelsByProjectIds(projectIds);
    this.cache.set(cacheKey, labels, CACHE_TTLS.labels);

    return labels;
  }

  /**
   * Returns label usage counts for several projects with one query.
   *
   * @param actor - Account whose current ticket scope is enforced.
   * @param projectIds - Project ids requested by the caller, or a
   * single project after the usual access check by the caller.
   */
  public async countLabelUsageByProjects(
    actor: User,
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> {
    const visibility = await this.access.visibility(actor);
    const cacheKey = `labels:usage:${workItemScopeKey(actor.id, visibility)}:${JSON.stringify([...projectIds].sort())}`;
    const cached =
      this.cache.get<ReadonlyMap<string, ReadonlyMap<string, number>>>(
        cacheKey,
      );

    if (cached) {
      return cached;
    }

    const usage = await this.taskRepository.countLabelUsageByProjectIds(
      projectIds,
      visibility,
    );
    this.cache.set(cacheKey, usage, CACHE_TTLS.labelUsage);

    return usage;
  }

  /**
   * Returns the labels of the given work items mapped by work item id.
   *
   * @remarks
   * Callers must only pass work items the actor may access; the labels
   * themselves carry no additional access restrictions. Newly created items
   * carry no labels, so entries cached for a scope stay correct when items
   * are added; assignment changes invalidate the scope explicitly.
   *
   * @param workItemIds - Work items to resolve labels for.
   */
  public async findLabelsForWorkItems(
    workItemIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ProjectLabel[]>> {
    const cacheKey = `labels:items:${stableIdKey(workItemIds)}`;
    const cached =
      this.cache.get<ReadonlyMap<string, readonly ProjectLabel[]>>(cacheKey);

    if (cached) {
      return cached;
    }

    const labels =
      await this.taskRepository.findLabelsForWorkItemIds(workItemIds);
    this.cache.set(cacheKey, labels, CACHE_TTLS.labels);

    return labels;
  }

  /** Creates a label in the shared catalog of a project. */
  public async createLabel(
    actor: User,
    projectId: string,
    input: LabelInput,
  ): Promise<ProjectLabel> {
    await this.access.requireWritableProject(actor, projectId);

    const { color, name } = parseLabelInput(input);

    await this.requireNameAvailable(projectId, name, null);

    const id = randomUUID();

    await this.taskRepository.insertLabel({
      color,
      id,
      name,
      projectId,
    });
    this.cache.invalidateLabels();

    const created = await this.taskRepository.findLabelById(id);

    if (!created) {
      throw new Error("Created label could not be retrieved.");
    }

    return created;
  }

  /** Renames or recolors a project label; tickets pick it up by id. */
  public async updateLabel(
    actor: User,
    labelId: string,
    input: LabelInput,
  ): Promise<ProjectLabel> {
    const existing = await this.requireLabel(labelId);

    await this.access.requireWritableProject(actor, existing.projectId);

    const { color, name } = parseLabelInput(input);

    await this.requireNameAvailable(existing.projectId, name, labelId);
    await this.taskRepository.updateLabel(labelId, {
      color,
      name,
    });
    this.cache.invalidateLabels();

    const updated = await this.taskRepository.findLabelById(labelId);

    if (!updated) {
      throw new Error("Updated label could not be retrieved.");
    }

    return updated;
  }

  /** Deletes a project label after removing it from every ticket. */
  public async deleteLabel(actor: User, labelId: string): Promise<void> {
    const existing = await this.requireLabel(labelId);

    await this.access.requireWritableProject(actor, existing.projectId);
    await this.taskRepository.deleteLabel(labelId);
    this.cache.invalidateLabels();
  }

  /** Assigns a project label to a work item and records the change. */
  public async assignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    const item = await this.access.requireWorkItem(actor, workItemId);
    const label = await this.taskRepository.findLabelById(labelId);

    if (!label || label.projectId !== item.projectId) {
      throw new WorkItemValidationError(
        "Selected label does not belong to the ticket project.",
      );
    }

    await this.access.requireWriteAccess(actor, item.projectId);
    await this.taskRepository.assignLabel(workItemId, labelId);
    this.cache.invalidateLabels();
    await this.history.recordLabelAdded(actor, workItemId, label.name);
  }

  /** Removes a project label from a work item and records the change. */
  public async unassignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    const item = await this.access.requireWorkItem(actor, workItemId);
    const label = await this.taskRepository.findLabelById(labelId);

    await this.access.requireWriteAccess(actor, item.projectId);
    await this.taskRepository.unassignLabel(workItemId, labelId);
    this.cache.invalidateLabels();
    await this.history.recordLabelRemoved(
      actor,
      workItemId,
      label?.name ?? null,
    );
  }

  private async requireLabel(labelId: string): Promise<ProjectLabel> {
    const label = await this.taskRepository.findLabelById(labelId);

    if (!label) {
      throw new WorkItemValidationError("Selected label does not exist.");
    }

    return label;
  }

  private async requireNameAvailable(
    projectId: string,
    name: string,
    ownLabelId: string | null,
  ): Promise<void> {
    const labels = await this.taskRepository.findLabelsByProjectId(projectId);
    const isTaken = labels.some(
      (label) =>
        label.id !== ownLabelId &&
        label.name.toLowerCase() === name.toLowerCase(),
    );

    if (isTaken) {
      throw new WorkItemValidationError(
        "A label with this name already exists in the project.",
      );
    }
  }
}
