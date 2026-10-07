import { randomUUID } from "node:crypto";

import { isWorkItemLinkType } from "@/definition/Task";

import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type {
  WorkItemDetail,
  WorkItemLink,
  WorkItemLinkType,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** Manages the links between work items. */
export class TaskLinkService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;

  /**
   * Creates a link service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Verifier of project access and write permission.
   */
  public constructor(taskRepository: TaskRepository, access: TaskAccessGuard) {
    this.taskRepository = taskRepository;
    this.access = access;
  }

  /** Returns every link involving a work item, from its own point of view. */
  public async findLinks(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemLink[]> {
    await this.access.requireWorkItem(actor, workItemId);

    return this.taskRepository.findLinksByWorkItemId(
      workItemId,
      await this.access.visibility(actor),
    );
  }

  /** Creates a link from a work item to another ticket identified by key. */
  public async addLink(
    actor: User,
    workItemId: string,
    targetKey: string,
    linkType: WorkItemLinkType,
  ): Promise<WorkItemLink[]> {
    const item = await this.access.requireWritableWorkItem(actor, workItemId);

    if (!isWorkItemLinkType(linkType)) {
      throw new WorkItemValidationError("linkTypeUnsupported");
    }

    const target = await this.findLinkTarget(actor, item, targetKey);

    await this.access.requireProject(actor, target.projectId);
    await this.taskRepository.insertLink({
      id: randomUUID(),
      linkType,
      linkedWorkItemId: target.id,
      workItemId: item.id,
    });

    return this.taskRepository.findLinksByWorkItemId(
      item.id,
      await this.access.visibility(actor),
    );
  }

  /** Removes a link that involves the given work item, in either direction. */
  public async removeLink(
    actor: User,
    workItemId: string,
    linkId: string,
  ): Promise<WorkItemLink[]> {
    const item = await this.access.requireWritableWorkItem(actor, workItemId);
    const link = await this.taskRepository.findLinkById(linkId);

    if (
      link &&
      link.workItemId !== item.id &&
      link.linkedWorkItemId !== item.id
    ) {
      throw new WorkItemValidationError("linkNotOfTicket");
    }

    await this.taskRepository.deleteLink(linkId);

    return this.taskRepository.findLinksByWorkItemId(
      item.id,
      await this.access.visibility(actor),
    );
  }

  private async findLinkTarget(
    actor: User,
    item: WorkItemDetail,
    targetKey: string,
  ): Promise<WorkItemDetail> {
    const trimmedKey = targetKey.trim();
    const target = trimmedKey
      ? await this.taskRepository.findByKey(
          trimmedKey,
          await this.access.visibility(actor),
        )
      : null;

    if (!target) {
      throw new WorkItemValidationError("linkTargetNotFound");
    }

    if (target.id === item.id) {
      throw new WorkItemValidationError("linkSelf");
    }

    return target;
  }
}
