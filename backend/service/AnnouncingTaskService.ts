import { TaskService } from "@/backend/service/TaskService";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { PermissionService } from "@/backend/auth/PermissionService";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { MilestoneInitiativeChange } from "@/backend/service/task/TaskMilestoneLinkService";
import type {
  AddMilestoneDependencyInput,
  CreateMilestoneInput,
  MilestoneFieldInput,
  MilestoneFieldUpdate,
  UpdateMilestoneInput,
} from "@/backend/service/task/TaskMilestoneService";
import type {
  ParentChange,
  StatusChange,
  TitleChange,
} from "@/backend/service/task/TaskFieldService";
import type {
  CreateWorkItemInput,
  DescriptionChange,
  UpdateWorkItemInput,
} from "@/backend/service/task/TaskWriteService";
import type {
  Milestone,
  MilestoneDependency,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemLink,
  WorkItemLinkType,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { TaskMoveSnapshot } from "@/definition/TaskUpdateSnapshot";

/** Where the announcements of committed changes go. */
export interface TaskEventSink {
  publish(event: PagesEvent): void;
}

/**
 * The ticket service of the interface, which announces every change it commits.
 *
 * @remarks
 * Agents announce their own changes through the same publisher, so both ways
 * of changing a ticket or a milestone reach the Discord notifications. An
 * announcement follows the stored change; a call that throws announces
 * nothing. Several changes in a row, such as the labels and checklist items of
 * a template, are merged by the notification service into one message. Moving a card inside its column and deleting a checklist item
 * announce nothing: the first changes no field a message states, and the
 * second does not name its ticket.
 */
export class AnnouncingTaskService extends TaskService {
  private readonly events: TaskEventSink;

  /**
   * Creates the announcing task service.
   *
   * @param repositories - Task persistence and the services deciding access.
   * @param events - Receiver of the announcements.
   */
  public constructor(
    repositories: {
      readonly taskRepository: TaskRepository;
      readonly projectService: ProjectService;
      readonly permissionService: PermissionService;
      readonly cache?: ServerCache;
    },
    events: TaskEventSink,
  ) {
    super(
      repositories.taskRepository,
      repositories.projectService,
      repositories.permissionService,
      repositories.cache,
    );
    this.events = events;
  }

  /** Creates a work item and announces `ticket.created`. */
  public override async create(
    actor: User,
    input: CreateWorkItemInput,
  ): Promise<WorkItemDetail> {
    const created = await super.create(actor, input);

    this.events.publish({ id: created.id, type: "ticket.created" });

    return created;
  }

  /** Updates a work item and announces `ticket.updated`. */
  public override async update(
    actor: User,
    id: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, await super.update(actor, id, input));
  }

  /** Saves a description and announces `ticket.updated`. */
  public override async updateDescription(
    actor: User,
    id: string,
    change: DescriptionChange,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(
      id,
      await super.updateDescription(actor, id, change),
    );
  }

  /** Changes the parent and announces `ticket.updated`. */
  public override async changeParent(
    actor: User,
    id: string,
    parentId: string | null,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(
      id,
      await super.changeParent(actor, id, parentId),
    );
  }

  /** Replaces the title and announces `ticket.updated`. */
  public override async updateTitle(
    actor: User,
    id: string,
    change: TitleChange,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, await super.updateTitle(actor, id, change));
  }

  /** Moves the ticket to another status and announces `ticket.updated`. */
  public override async updateStatus(
    actor: User,
    id: string,
    change: StatusChange,
  ): Promise<WorkItemDetail> {
    const updated = await super.updateStatus(actor, id, change);

    return change.statusId === change.baseStatusId
      ? updated
      : this.announceTicket(id, updated);
  }

  /** Replaces the parent and announces `ticket.updated`. */
  public override async updateParent(
    actor: User,
    id: string,
    change: ParentChange,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, await super.updateParent(actor, id, change));
  }

  /** Moves a card; only a change of the status is announced. */
  public override async updateStatusAndOrder(
    actor: User,
    id: string,
    statusId: string,
    sortOrder: number,
  ): Promise<WorkItemDetail> {
    // A failed read here is left to the write below, which reports it.
    const before = await this.getById(actor, id).catch(
      (caughtError: unknown) => {
        logCaughtError("AnnouncingTaskService", caughtError);
        return null;
      },
    );
    const updated = await super.updateStatusAndOrder(
      actor,
      id,
      statusId,
      sortOrder,
    );

    return before?.statusId === updated.statusId
      ? updated
      : this.announceTicket(id, updated);
  }

  /** Sets the department and announces `ticket.updated`. */
  public override async setDepartment(
    actor: User,
    id: string,
    departmentId: string | null,
    expected?: string | null,
  ): Promise<void> {
    await super.setDepartment(actor, id, departmentId, expected);
    this.announceTicket(id, null);
  }

  /** Moves the ticket to another project and announces `ticket.updated`. */
  public override async moveToProject(
    actor: User,
    id: string,
    targetProjectId: string,
    expected?: TaskMoveSnapshot,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(
      id,
      await super.moveToProject(actor, id, targetProjectId, expected),
    );
  }

  /** Assigns a label and announces `ticket.updated`. */
  public override async assignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    await super.assignLabel(actor, workItemId, labelId);
    this.announceTicket(workItemId, null);
  }

  /** Removes a label and announces `ticket.updated`. */
  public override async unassignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    await super.unassignLabel(actor, workItemId, labelId);
    this.announceTicket(workItemId, null);
  }

  /** Adds a checklist item and announces `ticket.updated`. */
  public override async addChecklistItem(
    actor: User,
    workItemId: string,
    title: string,
  ): Promise<WorkItemChecklistItem> {
    const item = await super.addChecklistItem(actor, workItemId, title);

    return this.announceItem(item);
  }

  /** Ticks a checklist item and announces `ticket.updated`. */
  public override async setChecklistItemDone(
    actor: User,
    checklistItemId: string,
    isDone: boolean,
    expected?: { readonly title: string; readonly isDone: boolean },
  ): Promise<WorkItemChecklistItem> {
    const item = await super.setChecklistItemDone(
      actor,
      checklistItemId,
      isDone,
      expected,
    );

    return this.announceItem(item);
  }

  /** Links two tickets and announces `ticket.updated`. */
  public override async addLink(
    actor: User,
    workItemId: string,
    targetKey: string,
    linkType: WorkItemLinkType,
  ): Promise<WorkItemLink[]> {
    const links = await super.addLink(actor, workItemId, targetKey, linkType);

    this.announceTicket(workItemId, null);

    return links;
  }

  /** Removes a link and announces `ticket.updated`. */
  public override async removeLink(
    actor: User,
    workItemId: string,
    linkId: string,
  ): Promise<WorkItemLink[]> {
    const links = await super.removeLink(actor, workItemId, linkId);

    this.announceTicket(workItemId, null);

    return links;
  }

  /** Creates a milestone and announces `milestone.created`. */
  public override async createMilestone(
    actor: User,
    input: CreateMilestoneInput,
  ): Promise<Milestone> {
    const created = await super.createMilestone(actor, input);

    this.events.publish({ id: created.id, type: "milestone.created" });

    return created;
  }

  /** Updates a milestone and announces `milestone.updated`. */
  public override async updateMilestone(
    actor: User,
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone> {
    const updated = await super.updateMilestone(actor, id, input);

    this.events.publish({ id, type: "milestone.updated" });

    return updated;
  }

  /** Changes one milestone field; only a change that wrote something is announced. */
  public override async updateMilestoneField(
    actor: User,
    id: string,
    change: MilestoneFieldInput,
  ): Promise<MilestoneFieldUpdate> {
    const update = await super.updateMilestoneField(actor, id, change);

    if (update.isChanged) {
      this.events.publish({ id, type: "milestone.updated" });
    }

    return update;
  }

  /** Links two milestones and announces `milestone.updated` for the source. */
  public override async addDependency(
    actor: User,
    input: AddMilestoneDependencyInput,
  ): Promise<MilestoneDependency> {
    const dependency = await super.addDependency(actor, input);

    this.events.publish({ id: dependency.sourceId, type: "milestone.updated" });

    return dependency;
  }

  /** Removes a dependency and announces `milestone.updated` for its source. */
  public override async removeDependency(
    actor: User,
    projectId: string,
    dependencyId: string,
  ): Promise<void> {
    // The removal drops the link, so its source is read before. A failed read
    // is left to the removal, which reports it.
    const dependencies = await this.findDependencies(actor, [projectId]).catch(
      (caughtError: unknown) => {
        logCaughtError("AnnouncingTaskService", caughtError);
        return [];
      },
    );
    const dependency = dependencies.find(
      (candidate) => candidate.id === dependencyId,
    );

    await super.removeDependency(actor, projectId, dependencyId);

    if (dependency) {
      this.events.publish({
        id: dependency.sourceId,
        type: "milestone.updated",
      });
    }
  }

  /** Links an initiative with a milestone and announces `milestone.updated`. */
  public override async linkInitiativeToMilestone(
    actor: User,
    milestoneId: string,
    initiativeId: string,
  ): Promise<MilestoneInitiativeChange> {
    const change = await super.linkInitiativeToMilestone(
      actor,
      milestoneId,
      initiativeId,
    );

    this.events.publish({ id: milestoneId, type: "milestone.updated" });

    return change;
  }

  /** Unlinks an initiative from a milestone and announces `milestone.updated`. */
  public override async unlinkInitiativeFromMilestone(
    actor: User,
    milestoneId: string,
    initiativeId: string,
  ): Promise<MilestoneInitiativeChange> {
    const change = await super.unlinkInitiativeFromMilestone(
      actor,
      milestoneId,
      initiativeId,
    );

    this.events.publish({ id: milestoneId, type: "milestone.updated" });

    return change;
  }

  private announceTicket<Result extends WorkItemDetail | null>(
    id: string,
    result: Result,
  ): Result {
    this.events.publish({ id, type: "ticket.updated" });

    return result;
  }

  private announceItem(item: WorkItemChecklistItem): WorkItemChecklistItem {
    this.events.publish({ id: item.workItemId, type: "ticket.updated" });

    return item;
  }
}
