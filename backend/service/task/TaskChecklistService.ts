import { randomUUID } from "node:crypto";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { WorkItemChecklistItem } from "@/definition/Task";
import type { User } from "@/definition/User";

const MAXIMUM_CHECKLIST_ITEM_TITLE_LENGTH = 200;

/** Manages the acceptance-criteria checklists of work items. */
export class TaskChecklistService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;

  /**
   * Creates a checklist service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Verifier of project access and write permission.
   */
  public constructor(taskRepository: TaskRepository, access: TaskAccessGuard) {
    this.taskRepository = taskRepository;
    this.access = access;
  }

  /** Returns the acceptance-criteria checklist of a work item, in order. */
  public async findChecklistItems(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemChecklistItem[]> {
    await this.access.requireWorkItem(actor, workItemId);

    return this.taskRepository.findChecklistItemsByWorkItemId(workItemId);
  }

  /** Appends a new checklist item to a work item. */
  public async addChecklistItem(
    actor: User,
    workItemId: string,
    title: string,
  ): Promise<WorkItemChecklistItem> {
    await this.access.requireWritableWorkItem(actor, workItemId);

    const trimmedTitle = title
      .trim()
      .slice(0, MAXIMUM_CHECKLIST_ITEM_TITLE_LENGTH);

    if (!trimmedTitle) {
      throw new WorkItemValidationError(
        "Checklist item title must not be empty.",
      );
    }

    const id = randomUUID();

    await this.taskRepository.insertChecklistItem({
      id,
      title: trimmedTitle,
      workItemId,
    });

    const created = await this.taskRepository.findChecklistItemById(id);

    if (!created) {
      throw new Error("Created checklist item could not be retrieved.");
    }

    return created;
  }

  /** Toggles the done state of a checklist item. */
  public async setChecklistItemDone(
    actor: User,
    checklistItemId: string,
    isDone: boolean,
  ): Promise<WorkItemChecklistItem> {
    const existing = await this.requireWritableChecklistItem(
      actor,
      checklistItemId,
    );

    await this.taskRepository.updateChecklistItem(checklistItemId, {
      isDone,
      title: existing.title,
    });

    const updated =
      await this.taskRepository.findChecklistItemById(checklistItemId);

    if (!updated) {
      throw new Error("Updated checklist item could not be retrieved.");
    }

    return updated;
  }

  /** Deletes a checklist item after verifying write access to its ticket. */
  public async deleteChecklistItem(
    actor: User,
    checklistItemId: string,
  ): Promise<void> {
    await this.requireWritableChecklistItem(actor, checklistItemId);
    await this.taskRepository.deleteChecklistItem(checklistItemId);
  }

  private async requireWritableChecklistItem(
    actor: User,
    checklistItemId: string,
  ): Promise<WorkItemChecklistItem> {
    const existing =
      await this.taskRepository.findChecklistItemById(checklistItemId);

    if (!existing) {
      throw new WorkItemValidationError(
        "Selected checklist item does not exist.",
      );
    }

    await this.access.requireWritableWorkItem(actor, existing.workItemId);

    return existing;
  }
}
