import { TaskService } from "@/backend/service/TaskService";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { PermissionService } from "@/backend/auth/PermissionService";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type {
  PagesEvent,
  PagesEventPublisher,
} from "@/backend/service/events/PagesEventPublisher";
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
  ChildHandling,
  Milestone,
  MilestoneDependency,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemLink,
  WorkItemLinkType,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { TaskMoveSnapshot } from "@/definition/TaskUpdateSnapshot";
import type { TaskLifecycleImpact } from "@/backend/service/task/TaskLifecycleService";

/**
 * Calls whose event needs nothing read before the change: they take the writer
 * at their first write, so their checks and reads do not hold it.
 */
const OPENS_AT_FIRST_WRITE = { opensAtFirstWrite: true } as const;

/** Where the announcements of committed changes go. */
export type TaskEventSink = Pick<PagesEventPublisher, "publish" | "announce">;

/** A ticket change announced as `ticket.updated`. */
function updatedTicket(id: string): PagesEvent[] {
  return [{ id, type: "ticket.updated" }];
}

/** A milestone change announced as `milestone.updated`. */
function updatedMilestone(id: string): PagesEvent[] {
  return [{ id, type: "milestone.updated" }];
}

/** Every ticket of a lifecycle change and its parent, announced as `ticket.changed`. */
function changedTickets(impact: TaskLifecycleImpact): PagesEvent[] {
  const ids = new Set(impact.ticketIds);
  if (impact.parentId) ids.add(impact.parentId);
  return [...ids].map((id) => ({ id, type: "ticket.changed" }));
}

/**
 * The ticket service of the interface, which announces every change it commits.
 *
 * @remarks
 * Agents announce their own changes through the same publisher, so both ways
 * of changing a ticket or a milestone reach the Discord notifications. Several
 * changes in a row, such as the labels and checklist items of a template, are
 * merged by the notification service into one message. Moving a card inside
 * its column, deleting a checklist item, archiving, restoring and deleting
 * change no field a message states; they announce `ticket.changed`,
 * `ticket.deleted` or `milestone.changed`, which only the live view of open
 * pages follows.
 *
 * Each call runs as one transaction through the publisher (see
 * `PagesEventPublisher.announce`): the ticket row, its history and milestone
 * links commit together with the outbox row of the event, which names what
 * the result of the call says changed. A call that changed no row, such as a
 * conditional write that lost against a concurrent change, announces nothing.
 * Calls whose event needs a value read before the change take the writer at
 * their start, so that read belongs to the same transaction.
 */
export class AnnouncingTaskService extends TaskService {
  private readonly events: TaskEventSink;
  private readonly taskRepository: TaskRepository;

  /**
   * Creates the announcing task service.
   *
   * @param repositories - Task persistence and the services deciding access.
   * @param events - Runs the announced calls and delivers their events.
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
    this.taskRepository = repositories.taskRepository;
  }

  /** Creates a work item and announces `ticket.created`. */
  public override async create(
    actor: User,
    input: CreateWorkItemInput,
  ): Promise<WorkItemDetail> {
    return this.events.announce(
      () => super.create(actor, input),
      (created) => [{ id: created.id, type: "ticket.created" }],
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Updates a work item and announces `ticket.updated`. */
  public override async update(
    actor: User,
    id: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, () => super.update(actor, id, input));
  }

  /** Saves a description and announces `ticket.updated`. */
  public override async updateDescription(
    actor: User,
    id: string,
    change: DescriptionChange,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, () =>
      super.updateDescription(actor, id, change),
    );
  }

  /** Changes the parent and announces `ticket.updated`. */
  public override async changeParent(
    actor: User,
    id: string,
    parentId: string | null,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, () =>
      super.changeParent(actor, id, parentId),
    );
  }

  /** Replaces the title and announces `ticket.updated`. */
  public override async updateTitle(
    actor: User,
    id: string,
    change: TitleChange,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, () => super.updateTitle(actor, id, change));
  }

  /** Moves the ticket to another status and announces `ticket.updated`. */
  public override async updateStatus(
    actor: User,
    id: string,
    change: StatusChange,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, () => super.updateStatus(actor, id, change));
  }

  /** Replaces the parent and announces `ticket.updated`. */
  public override async updateParent(
    actor: User,
    id: string,
    change: ParentChange,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, () => super.updateParent(actor, id, change));
  }

  /**
   * Moves a card; a change of the status announces `ticket.updated`, a move
   * inside the column `ticket.changed`.
   */
  public override async updateStatusAndOrder(
    actor: User,
    id: string,
    statusId: string,
    sortOrder: number,
  ): Promise<WorkItemDetail> {
    const { updated } = await this.events.announce(
      async () => {
        const before = await this.getById(actor, id);
        return {
          before,
          updated: await super.updateStatusAndOrder(
            actor,
            id,
            statusId,
            sortOrder,
          ),
        };
      },
      (move): PagesEvent[] => [
        {
          id,
          type:
            move.before.statusId === move.updated.statusId
              ? "ticket.changed"
              : "ticket.updated",
        },
      ],
    );

    return updated;
  }

  /** Sets the departments and announces `ticket.updated`. */
  public override async setDepartments(
    actor: User,
    id: string,
    departmentIds: readonly string[],
    expected?: readonly string[],
  ): Promise<void> {
    await this.announceTicket(id, () =>
      super.setDepartments(actor, id, departmentIds, expected),
    );
  }

  /** Moves the ticket to another project and announces `ticket.updated`. */
  public override async moveToProject(
    actor: User,
    id: string,
    targetProjectId: string,
    expected?: TaskMoveSnapshot,
  ): Promise<WorkItemDetail> {
    return this.announceTicket(id, () =>
      super.moveToProject(actor, id, targetProjectId, expected),
    );
  }

  /** Assigns a label and announces `ticket.updated` when it was not assigned yet. */
  public override async assignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    await this.announceTicket(workItemId, () =>
      super.assignLabel(actor, workItemId, labelId),
    );
  }

  /** Removes a label and announces `ticket.updated` when it was assigned. */
  public override async unassignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    await this.announceTicket(workItemId, () =>
      super.unassignLabel(actor, workItemId, labelId),
    );
  }

  /** Adds a checklist item and announces `ticket.updated`. */
  public override async addChecklistItem(
    actor: User,
    workItemId: string,
    title: string,
  ): Promise<WorkItemChecklistItem> {
    return this.announceTicket(workItemId, () =>
      super.addChecklistItem(actor, workItemId, title),
    );
  }

  /** Ticks a checklist item and announces `ticket.updated` for the ticket the result names. */
  public override async setChecklistItemDone(
    actor: User,
    checklistItemId: string,
    isDone: boolean,
    expected?: { readonly title: string; readonly isDone: boolean },
  ): Promise<WorkItemChecklistItem> {
    return this.events.announce(
      () =>
        super.setChecklistItemDone(actor, checklistItemId, isDone, expected),
      (item) => updatedTicket(item.workItemId),
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Links two tickets and announces `ticket.updated` when the link is new. */
  public override async addLink(
    actor: User,
    workItemId: string,
    targetKey: string,
    linkType: WorkItemLinkType,
  ): Promise<WorkItemLink[]> {
    return this.announceTicket(workItemId, () =>
      super.addLink(actor, workItemId, targetKey, linkType),
    );
  }

  /** Removes a link and announces `ticket.updated` when one went. */
  public override async removeLink(
    actor: User,
    workItemId: string,
    linkId: string,
  ): Promise<WorkItemLink[]> {
    return this.announceTicket(workItemId, () =>
      super.removeLink(actor, workItemId, linkId),
    );
  }

  /** Creates a milestone and announces `milestone.created`. */
  public override async createMilestone(
    actor: User,
    input: CreateMilestoneInput,
  ): Promise<Milestone> {
    return this.events.announce(
      () => super.createMilestone(actor, input),
      (created) => [{ id: created.id, type: "milestone.created" }],
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Updates a milestone and announces `milestone.updated`. */
  public override async updateMilestone(
    actor: User,
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone> {
    return this.announceMilestone(id, () =>
      super.updateMilestone(actor, id, input),
    );
  }

  /** Changes one milestone field; only a change that wrote something is announced. */
  public override async updateMilestoneField(
    actor: User,
    id: string,
    change: MilestoneFieldInput,
  ): Promise<MilestoneFieldUpdate> {
    return this.announceMilestone(id, () =>
      super.updateMilestoneField(actor, id, change),
    );
  }

  /** Links two milestones and announces `milestone.updated` for the source. */
  public override async addDependency(
    actor: User,
    input: AddMilestoneDependencyInput,
  ): Promise<MilestoneDependency> {
    return this.events.announce(
      () => super.addDependency(actor, input),
      (dependency) => updatedMilestone(dependency.sourceId),
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Removes a dependency and announces `milestone.updated` for its source. */
  public override async removeDependency(
    actor: User,
    projectId: string,
    dependencyId: string,
  ): Promise<void> {
    // The removal drops the link, so its source is read before, in the same transaction.
    await this.events.announce(
      async () => {
        const dependencies = await this.findDependencies(actor, [projectId]);
        await super.removeDependency(actor, projectId, dependencyId);
        return dependencies.find((candidate) => candidate.id === dependencyId);
      },
      (dependency) => (dependency ? updatedMilestone(dependency.sourceId) : []),
    );
  }

  /** Links an initiative with a milestone and announces `milestone.updated`. */
  public override async linkInitiativeToMilestone(
    actor: User,
    milestoneId: string,
    initiativeId: string,
  ): Promise<MilestoneInitiativeChange> {
    return this.announceMilestone(milestoneId, () =>
      super.linkInitiativeToMilestone(actor, milestoneId, initiativeId),
    );
  }

  /** Unlinks an initiative from a milestone and announces `milestone.updated`. */
  public override async unlinkInitiativeFromMilestone(
    actor: User,
    milestoneId: string,
    initiativeId: string,
  ): Promise<MilestoneInitiativeChange> {
    return this.announceMilestone(milestoneId, () =>
      super.unlinkInitiativeFromMilestone(actor, milestoneId, initiativeId),
    );
  }

  /** Archives a subtree and announces `ticket.changed` for every changed ticket. */
  public override async archive(
    actor: User,
    id: string,
    handling: ChildHandling = "include",
  ): Promise<number> {
    return (await this.archiveWithImpact(actor, id, handling)).changedCount;
  }

  /** Archives a subtree and announces `ticket.changed` for every changed ticket. */
  public override async archiveWithImpact(
    actor: User,
    id: string,
    handling: ChildHandling = "include",
  ): Promise<TaskLifecycleImpact> {
    return this.events.announce(
      () => super.archiveWithImpact(actor, id, handling),
      changedTickets,
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Restores a subtree and announces `ticket.changed` for every changed ticket. */
  public override async restore(actor: User, id: string): Promise<void> {
    await this.restoreWithImpact(actor, id);
  }

  /** Restores a subtree and announces `ticket.changed` for every changed ticket. */
  public override async restoreWithImpact(
    actor: User,
    id: string,
  ): Promise<TaskLifecycleImpact> {
    return this.events.announce(
      () => super.restoreWithImpact(actor, id),
      changedTickets,
      OPENS_AT_FIRST_WRITE,
    );
  }

  /**
   * Deletes a subtree and announces `ticket.deleted` with where it was visible.
   *
   * @remarks
   * The deleted row can no longer decide who saw it, so its project and
   * department are read before, in the transaction of the deletion. Children
   * kept without a parent announce `ticket.changed`.
   */
  public override async deletePermanently(
    actor: User,
    id: string,
    handling: ChildHandling = "include",
  ): Promise<void> {
    await this.events.announce(
      async () => {
        const before = await this.getById(actor, id);
        // Kept children lose their parent with the deletion; they are read in its transaction.
        const released =
          handling === "keep"
            ? await this.taskRepository.findAll({
                parentId: id,
                archived: "all",
              })
            : [];
        await super.deletePermanently(actor, id, handling);
        return { before, released };
      },
      ({ before, released }): PagesEvent[] => [
        {
          id,
          type: "ticket.deleted",
          audience: {
            projectId: before.projectId,
            departmentIds: before.departmentIds,
          },
        },
        ...released.map((child): PagesEvent => ({
          id: child.id,
          type: "ticket.changed",
        })),
      ],
    );
  }

  /** Deletes a checklist item and announces `ticket.changed` for its ticket. */
  public override async deleteChecklistItem(
    actor: User,
    checklistItemId: string,
    expected?: { readonly title: string; readonly isDone: boolean },
  ): Promise<void> {
    await this.events.announce(
      async () => {
        const item =
          await this.taskRepository.findChecklistItemById(checklistItemId);
        await super.deleteChecklistItem(actor, checklistItemId, expected);
        return item;
      },
      (item): PagesEvent[] =>
        item ? [{ id: item.workItemId, type: "ticket.changed" }] : [],
    );
  }

  /** Archives a milestone and announces `milestone.changed`. */
  public override async archiveMilestone(
    actor: User,
    id: string,
  ): Promise<void> {
    await this.events.announce(
      () => super.archiveMilestone(actor, id),
      (): PagesEvent[] => [{ id, type: "milestone.changed" }],
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Runs a ticket change and announces `ticket.updated` when it changed a row. */
  private async announceTicket<Result>(
    id: string,
    work: () => Promise<Result>,
  ): Promise<Result> {
    return this.events.announce(
      work,
      () => updatedTicket(id),
      OPENS_AT_FIRST_WRITE,
    );
  }

  /** Runs a milestone change and announces `milestone.updated` when it changed a row. */
  private async announceMilestone<Result>(
    id: string,
    work: () => Promise<Result>,
  ): Promise<Result> {
    return this.events.announce(
      work,
      () => updatedMilestone(id),
      OPENS_AT_FIRST_WRITE,
    );
  }
}
