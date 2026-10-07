import { randomUUID } from "node:crypto";

import { CAPABILITY } from "@/definition/Authorization";
import { normalizeHexColorCode } from "@/definition/Task";

import { CACHE_TTLS, stableIdKey } from "@/backend/cache/ServerCache";
import { workItemScopeKey } from "@/backend/cache/WorkItemScopeKey";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type { Label } from "@/definition/Task";
import type { User } from "@/definition/User";

const MAXIMUM_LABEL_NAME_LENGTH = 40;

/** Values of a label as entered by the user. */
export interface LabelInput {
  readonly name: string;
  readonly color: string;
}

/** Trims and validates the entered values of a label. */
function parseLabelInput(input: LabelInput): LabelInput {
  const name = input.name.trim().slice(0, MAXIMUM_LABEL_NAME_LENGTH);

  if (!name) {
    throw new WorkItemValidationError("labelNameLength");
  }

  const color = normalizeHexColorCode(input.color);

  if (!color) {
    throw new WorkItemValidationError("labelColorUnsupported");
  }

  return { color, name };
}

/** Manages the global label catalog and the labels on work items. */
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

  /** Returns the global label catalog ordered by name. */
  public async findLabels(): Promise<Label[]> {
    const cacheKey = "labels:catalog";
    const cached = this.cache.get<Label[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const labels = await this.taskRepository.findLabels();
    this.cache.set(cacheKey, labels, CACHE_TTLS.labels);

    return labels;
  }

  /**
   * Returns how many tickets use each label, counting only tickets the actor
   * may see.
   *
   * @param actor - Account whose current ticket scope is enforced.
   * @returns Usage counts by label id; unused labels are absent.
   */
  public async countLabelUsage(
    actor: User,
  ): Promise<ReadonlyMap<string, number>> {
    const visibility = await this.access.visibility(actor);
    const cacheKey = `labels:usage:${workItemScopeKey(actor.id, visibility)}`;
    const cached = this.cache.get<ReadonlyMap<string, number>>(cacheKey);

    if (cached) {
      return cached;
    }

    const usage = await this.taskRepository.countLabelUsageByLabel(visibility);
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
  ): Promise<ReadonlyMap<string, readonly Label[]>> {
    const cacheKey = `labels:items:${stableIdKey(workItemIds)}`;
    const cached =
      this.cache.get<ReadonlyMap<string, readonly Label[]>>(cacheKey);

    if (cached) {
      return cached;
    }

    const labels =
      await this.taskRepository.findLabelsForWorkItemIds(workItemIds);
    this.cache.set(cacheKey, labels, CACHE_TTLS.labels);

    return labels;
  }

  /** Creates a label in the global catalog; anyone who may write tickets can. */
  public async createLabel(actor: User, input: LabelInput): Promise<Label> {
    await this.access.requireCapability(actor, CAPABILITY.WRITE);

    const { color, name } = parseLabelInput(input);

    await this.requireNameAvailable(name, null);

    const id = randomUUID();

    await this.taskRepository.insertLabel({ color, id, name });
    this.cache.invalidateLabels();

    const created = await this.taskRepository.findLabelById(id);

    if (!created) {
      throw new Error("Created label could not be retrieved.");
    }

    return created;
  }

  /** Renames or recolors a label; tickets pick it up by id. */
  public async updateLabel(
    actor: User,
    labelId: string,
    input: LabelInput,
  ): Promise<Label> {
    await this.access.requireCapability(actor, CAPABILITY.WRITE);
    await this.requireLabel(labelId);

    const { color, name } = parseLabelInput(input);

    await this.requireNameAvailable(name, labelId);
    await this.taskRepository.updateLabel(labelId, { color, name });
    this.cache.invalidateLabels();

    const updated = await this.taskRepository.findLabelById(labelId);

    if (!updated) {
      throw new Error("Updated label could not be retrieved.");
    }

    return updated;
  }

  /** Deletes a label after removing it from every ticket. */
  public async deleteLabel(actor: User, labelId: string): Promise<void> {
    await this.access.requireCapability(actor, CAPABILITY.WRITE);
    await this.requireLabel(labelId);
    await this.taskRepository.deleteLabel(labelId);
    this.cache.invalidateLabels();
  }

  /** Assigns a label to a work item and records the change. */
  public async assignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    await this.access.requireWritableWorkItem(actor, workItemId);
    const label = await this.taskRepository.findLabelById(labelId);

    if (!label) {
      throw new WorkItemValidationError("labelNotFound");
    }

    await this.taskRepository.assignLabel(workItemId, labelId);
    this.cache.invalidateLabels();
    await this.history.recordLabelAdded(actor, workItemId, label.name);
  }

  /** Removes a label from a work item and records the change. */
  public async unassignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    await this.access.requireWritableWorkItem(actor, workItemId);

    const label = await this.taskRepository.findLabelById(labelId);

    await this.taskRepository.unassignLabel(workItemId, labelId);
    this.cache.invalidateLabels();
    await this.history.recordLabelRemoved(
      actor,
      workItemId,
      label?.name ?? null,
    );
  }

  private async requireLabel(labelId: string): Promise<Label> {
    const label = await this.taskRepository.findLabelById(labelId);

    if (!label) {
      throw new WorkItemValidationError("labelNotFound");
    }

    return label;
  }

  private async requireNameAvailable(
    name: string,
    ownLabelId: string | null,
  ): Promise<void> {
    const existing = await this.taskRepository.findLabelByName(name);

    if (existing && existing.id !== ownLabelId) {
      throw new WorkItemValidationError("labelNameTaken");
    }
  }
}
