import { ServerCache } from "@/backend/cache/ServerCache";
import { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import { TaskChecklistService } from "@/backend/service/task/TaskChecklistService";
import { TaskGitHubPublisher } from "@/backend/service/task/TaskGitHubPublisher";
import { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import { TaskLabelService } from "@/backend/service/task/TaskLabelService";
import { TaskLinkService } from "@/backend/service/task/TaskLinkService";
import { TaskMilestoneService } from "@/backend/service/task/TaskMilestoneService";
import { TaskMoveService } from "@/backend/service/task/TaskMoveService";
import { TaskReadService } from "@/backend/service/task/TaskReadService";
import { TaskWriteService } from "@/backend/service/task/TaskWriteService";
import { WorkItemNumbering } from "@/backend/service/task/WorkItemNumbering";
import { WorkItemReferenceValidator } from "@/backend/service/task/WorkItemReferenceValidator";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type {
  FindWorkItemsOptions,
  ProjectWorkItemCounts,
  TaskRepository,
  WorkItemsOverview,
} from "@/backend/database/repositories/TaskRepository";
import type { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { LabelInput } from "@/backend/service/task/TaskLabelService";
import type {
  AddMilestoneDependencyInput,
  CreateMilestoneInput,
  UpdateMilestoneInput,
} from "@/backend/service/task/TaskMilestoneService";
import type { WorkItemsOverviewScope } from "@/backend/service/task/TaskReadService";
import type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
} from "@/backend/service/task/TaskWriteService";
import type {
  Milestone,
  MilestoneDependency,
  ProjectLabel,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkItemLinkType,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

export { generateProjectKey } from "@/backend/service/task/ProjectKey";
export type {
  CreateMilestoneInput,
  UpdateMilestoneInput,
} from "@/backend/service/task/TaskMilestoneService";
export type {
  CreateWorkItemInput,
  UpdateWorkItemInput,
} from "@/backend/service/task/TaskWriteService";

/**
 * Establishes the business-logic boundary for work items and kanban tracking.
 *
 * @remarks
 * A facade over one service per responsibility in `./task/`; it only wires
 * and forwards and holds no business logic of its own.
 */
export class TaskService {
  private readonly reader: TaskReadService;
  private readonly writer: TaskWriteService;
  private readonly mover: TaskMoveService;
  private readonly labels: TaskLabelService;
  private readonly checklists: TaskChecklistService;
  private readonly links: TaskLinkService;
  private readonly milestones: TaskMilestoneService;
  private readonly gitHubPublisher: TaskGitHubPublisher;

  /**
   * Creates a task service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param projectService - Project business-logic boundary deciding access.
   * @param permissionService - Authorization boundary; access decisions
   * currently go through the project service, so it is not consulted here.
   * @param cache - Shared server cache, disabled by default for test isolation.
   */
  public constructor(
    taskRepository: TaskRepository,
    projectService: ProjectService,
    permissionService: PermissionService,
    cache: ServerCache = ServerCache.disabled(),
  ) {
    const access = new TaskAccessGuard(
      taskRepository,
      projectService,
      permissionService,
    );
    const history = new TaskHistoryRecorder(taskRepository);
    const validator = new WorkItemReferenceValidator(taskRepository, access);
    const numbering = new WorkItemNumbering(taskRepository);

    this.gitHubPublisher = new TaskGitHubPublisher(
      taskRepository,
      history,
      cache,
    );
    this.reader = new TaskReadService(taskRepository, access, cache);
    this.writer = new TaskWriteService({
      access,
      cache,
      gitHubPublisher: this.gitHubPublisher,
      history,
      numbering,
      taskRepository,
      validator,
    });
    this.mover = new TaskMoveService({
      access,
      cache,
      history,
      numbering,
      taskRepository,
      validator,
    });
    this.labels = new TaskLabelService(taskRepository, access, history, cache);
    this.checklists = new TaskChecklistService(taskRepository, access);
    this.links = new TaskLinkService(taskRepository, access);
    this.milestones = new TaskMilestoneService(taskRepository, access, cache);
  }

  /**
   * Attaches the GitHub synchronization used for best-effort outbound updates.
   *
   * @param gitHubSync - Synchronization service publishing task changes.
   */
  public setGitHubSync(gitHubSync: GitHubSyncService): void {
    this.gitHubPublisher.attach(gitHubSync);
  }

  /** Returns all available workflow statuses. */
  public async findAllStatuses(actor: User): Promise<WorkflowStatus[]> {
    return this.reader.findAllStatuses(actor);
  }

  /** Returns non-archived milestones for projects accessible to the actor. */
  public async findMilestones(
    actor: User,
    projectIds: readonly string[],
  ): Promise<Milestone[]> {
    return this.milestones.findMilestones(actor, projectIds);
  }

  /** Creates a milestone after verifying project access and write permission. */
  public async createMilestone(
    actor: User,
    input: CreateMilestoneInput,
  ): Promise<Milestone> {
    return this.milestones.createMilestone(actor, input);
  }

  /** Updates a milestone after verifying project access and write permission. */
  public async updateMilestone(
    actor: User,
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone> {
    return this.milestones.updateMilestone(actor, id, input);
  }

  /** Soft-deletes a milestone together with its dependencies. */
  public async deleteMilestone(actor: User, id: string): Promise<void> {
    return this.milestones.deleteMilestone(actor, id);
  }

  /** Returns every dependency of the given projects. */
  public async findDependencies(
    actor: User,
    projectIds: readonly string[],
  ): Promise<MilestoneDependency[]> {
    return this.milestones.findDependencies(actor, projectIds);
  }

  /** Links two milestones of one project with a directed dependency. */
  public async addDependency(
    actor: User,
    input: AddMilestoneDependencyInput,
  ): Promise<MilestoneDependency> {
    return this.milestones.addDependency(actor, input);
  }

  /** Removes a single dependency after verifying write permission. */
  public async removeDependency(
    actor: User,
    projectId: string,
    dependencyId: string,
  ): Promise<void> {
    return this.milestones.removeDependency(actor, projectId, dependencyId);
  }

  /** Returns work item history across all tasks of one project. */
  public async findHistoryByProject(
    actor: User,
    projectId: string,
  ): Promise<WorkItemHistory[]> {
    return this.reader.findHistoryByProject(actor, projectId);
  }

  /** Returns active users eligible for assignment in a project. */
  public async findEligibleAssignees(
    actor: User,
    projectId: string,
  ): Promise<User[]> {
    return this.reader.findEligibleAssignees(actor, projectId);
  }

  /**
   * Returns eligible assignees for several projects with one query.
   *
   * @remarks
   * Callers must only pass project ids the actor may access (loaders pass
   * their already filtered project list).
   */
  public async findAssigneesByProjects(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly User[]>> {
    return this.reader.findAssigneesByProjects(projectIds);
  }

  /** Returns non-archived work items across projects the actor has access to. */
  public async findAll(
    actor: User,
    options: FindWorkItemsOptions = {},
  ): Promise<WorkItemDetail[]> {
    return this.reader.findAll(actor, options);
  }

  /** Returns a single work item by its internal identifier. */
  public async getById(actor: User, id: string): Promise<WorkItemDetail> {
    return this.reader.getById(actor, id);
  }

  /** Returns a single work item by its public key (e.g. PAGE-12). */
  public async getByKey(actor: User, key: string): Promise<WorkItemDetail> {
    return this.reader.getByKey(actor, key);
  }

  /** Returns direct subtasks for a parent item. */
  public async findSubtasks(
    actor: User,
    parentId: string,
  ): Promise<WorkItemDetail[]> {
    return this.reader.findSubtasks(actor, parentId);
  }

  /** Returns change history for a work item. */
  public async getHistory(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemHistory[]> {
    return this.reader.getHistory(actor, workItemId);
  }

  /** Creates a new work item after validating hierarchy and project constraints. */
  public async create(
    actor: User,
    input: CreateWorkItemInput,
  ): Promise<WorkItemDetail> {
    return this.writer.create(actor, input);
  }

  /** Updates an existing work item after validating constraints and logging changes. */
  public async update(
    actor: User,
    id: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItemDetail> {
    return this.writer.update(actor, id, input);
  }

  /** Updates status and column sort order via kanban drag & drop. */
  public async updateStatusAndOrder(
    actor: User,
    id: string,
    statusId: string,
    sortOrder: number,
  ): Promise<WorkItemDetail> {
    return this.writer.updateStatusAndOrder(actor, id, statusId, sortOrder);
  }

  /** Marks a work item as archived without physical deletion. */
  public async archive(actor: User, id: string): Promise<void> {
    return this.writer.archive(actor, id);
  }

  /** Restores an archived work item keeping its original workflow status. */
  public async restore(actor: User, id: string): Promise<void> {
    return this.writer.restore(actor, id);
  }

  /**
   * Moves a work item with its descendants to another project.
   *
   * @remarks
   * The internal id stays stable while every moved item receives a new
   * project-specific key. Project-bound relations that cannot travel
   * (parent outside the target, milestones, labels, GitHub links, and
   * ineligible assignees) are cleared and recorded in the history.
   *
   * @param actor - User moving the ticket; must hold write permission twice.
   * @param id - Work item starting the moved subtree.
   * @param targetProjectId - Project receiving the ticket.
   * @returns The moved top-level work item with its new key.
   */
  public async moveToProject(
    actor: User,
    id: string,
    targetProjectId: string,
  ): Promise<WorkItemDetail> {
    return this.mover.moveToProject(actor, id, targetProjectId);
  }

  /** Returns the shared label catalog of a project. */
  public async findLabels(
    actor: User,
    projectId: string,
  ): Promise<ProjectLabel[]> {
    return this.labels.findLabels(actor, projectId);
  }

  /** Returns label usage counts mapped by label id for a project. */
  public async countLabelUsage(
    actor: User,
    projectId: string,
  ): Promise<ReadonlyMap<string, number>> {
    return this.labels.countLabelUsage(actor, projectId);
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
    return this.labels.findLabelsByProjects(projectIds);
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
    return this.labels.countLabelUsageByProjects(actor, projectIds);
  }

  /**
   * Returns dashboard counters for projects within the current account scope.
   *
   * @param actor - Account whose current ticket scope is enforced.
   * @param projectIds - Requested projects, restricted to current actor access.
   * @param scope - Actor id, day boundaries, and the seven-day lower bound.
   */
  public async countWorkItemsOverview(
    actor: User,
    projectIds: readonly string[],
    scope: WorkItemsOverviewScope,
  ): Promise<WorkItemsOverview> {
    return this.reader.countWorkItemsOverview(actor, projectIds, scope);
  }

  /**
   * Returns done/total counters per already access-checked project.
   *
   * @param actor - Account whose current ticket scope is enforced.
   * @param projectIds - Requested projects, restricted to current actor access.
   */
  public async countWorkItemsByProject(
    actor: User,
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectWorkItemCounts>> {
    return this.reader.countWorkItemsByProject(actor, projectIds);
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
    return this.labels.findLabelsForWorkItems(workItemIds);
  }

  /** Creates a label in the shared catalog of a project. */
  public async createLabel(
    actor: User,
    projectId: string,
    input: LabelInput,
  ): Promise<ProjectLabel> {
    return this.labels.createLabel(actor, projectId, input);
  }

  /** Renames or recolors a project label; tickets pick it up by id. */
  public async updateLabel(
    actor: User,
    labelId: string,
    input: LabelInput,
  ): Promise<ProjectLabel> {
    return this.labels.updateLabel(actor, labelId, input);
  }

  /** Deletes a project label after removing it from every ticket. */
  public async deleteLabel(actor: User, labelId: string): Promise<void> {
    return this.labels.deleteLabel(actor, labelId);
  }

  /** Assigns a project label to a work item and records the change. */
  public async assignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    return this.labels.assignLabel(actor, workItemId, labelId);
  }

  /** Removes a project label from a work item and records the change. */
  public async unassignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    return this.labels.unassignLabel(actor, workItemId, labelId);
  }

  /** Returns the acceptance-criteria checklist of a work item, in order. */
  public async findChecklistItems(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemChecklistItem[]> {
    return this.checklists.findChecklistItems(actor, workItemId);
  }

  /** Appends a new checklist item to a work item. */
  public async addChecklistItem(
    actor: User,
    workItemId: string,
    title: string,
  ): Promise<WorkItemChecklistItem> {
    return this.checklists.addChecklistItem(actor, workItemId, title);
  }

  /** Toggles the done state of a checklist item. */
  public async setChecklistItemDone(
    actor: User,
    checklistItemId: string,
    isDone: boolean,
  ): Promise<WorkItemChecklistItem> {
    return this.checklists.setChecklistItemDone(actor, checklistItemId, isDone);
  }

  /** Deletes a checklist item after verifying write access to its ticket. */
  public async deleteChecklistItem(
    actor: User,
    checklistItemId: string,
  ): Promise<void> {
    return this.checklists.deleteChecklistItem(actor, checklistItemId);
  }

  /** Returns every link involving a work item, from its own point of view. */
  public async findLinks(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemLink[]> {
    return this.links.findLinks(actor, workItemId);
  }

  /** Creates a link from a work item to another ticket identified by key. */
  public async addLink(
    actor: User,
    workItemId: string,
    targetKey: string,
    linkType: WorkItemLinkType,
  ): Promise<WorkItemLink[]> {
    return this.links.addLink(actor, workItemId, targetKey, linkType);
  }

  /** Removes a link that involves the given work item, in either direction. */
  public async removeLink(
    actor: User,
    workItemId: string,
    linkId: string,
  ): Promise<WorkItemLink[]> {
    return this.links.removeLink(actor, workItemId, linkId);
  }
}
