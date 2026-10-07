import { EligibleAssigneeRepository } from "./task/EligibleAssigneeRepository";
import { MilestoneDependencyRepository } from "./task/MilestoneDependencyRepository";
import { MilestoneRepository } from "./task/MilestoneRepository";
import { TaskLabelRepository } from "./task/TaskLabelRepository";
import { WorkflowStatusRepository } from "./task/WorkflowStatusRepository";
import { WorkItemChecklistRepository } from "./task/WorkItemChecklistRepository";
import { WorkItemCountRepository } from "./task/WorkItemCountRepository";
import { WorkItemHistoryRepository } from "./task/WorkItemHistoryRepository";
import { WorkItemKeyRepository } from "./task/WorkItemKeyRepository";
import { WorkItemLinkRepository } from "./task/WorkItemLinkRepository";
import { WorkItemQueryRepository } from "./task/WorkItemQueryRepository";
import { WorkItemWriteRepository } from "./task/WorkItemWriteRepository";

import type { Database } from "@/backend/database/Database";
import type {
  Milestone,
  MilestoneDependency,
  ProjectLabel,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkItemVisibility,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";
import type { NewMilestoneDependency } from "./task/MilestoneDependencyRepository";
import type { MilestoneUpdate, NewMilestone } from "./task/MilestoneRepository";
import type {
  NewProjectLabel,
  ProjectLabelUpdate,
} from "./task/TaskLabelRepository";
import type {
  ChecklistItemUpdate,
  NewChecklistItem,
} from "./task/WorkItemChecklistRepository";
import type {
  ProjectWorkItemCounts,
  WorkItemsOverview,
  WorkItemsOverviewScope,
} from "./task/WorkItemCountRepository";
import type { FindWorkItemsOptions } from "./task/WorkItemFilter";
import type { NewWorkItemHistory } from "./task/WorkItemHistoryRepository";
import type {
  NewWorkItemLink,
  StoredWorkItemLink,
} from "./task/WorkItemLinkRepository";
import type {
  NewWorkItem,
  WorkItemGitHubLink,
  WorkItemMove,
  WorkItemUpdate,
} from "./task/WorkItemWriteRepository";

export type { MilestoneUpdate, NewMilestone } from "./task/MilestoneRepository";
export type {
  ProjectWorkItemCounts,
  WorkItemsOverview,
} from "./task/WorkItemCountRepository";
export type { FindWorkItemsOptions } from "./task/WorkItemFilter";
export type { NewWorkItemHistory } from "./task/WorkItemHistoryRepository";
export type {
  NewWorkItem,
  WorkItemGitHubLink,
  WorkItemUpdate,
} from "./task/WorkItemWriteRepository";

/**
 * Establishes the persistence boundary for tasks, statuses, milestones, and audit records.
 *
 * @remarks
 * A facade over one repository per aggregate in `./task/`; it only forwards
 * and holds no persistence logic of its own.
 */
export class TaskRepository {
  private readonly statuses: WorkflowStatusRepository;
  private readonly milestones: MilestoneRepository;
  private readonly dependencies: MilestoneDependencyRepository;
  private readonly history: WorkItemHistoryRepository;
  private readonly keys: WorkItemKeyRepository;
  private readonly queries: WorkItemQueryRepository;
  private readonly counts: WorkItemCountRepository;
  private readonly writes: WorkItemWriteRepository;
  private readonly labels: TaskLabelRepository;
  private readonly checklist: WorkItemChecklistRepository;
  private readonly links: WorkItemLinkRepository;
  private readonly assignees: EligibleAssigneeRepository;

  /**
   * Creates a task repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.statuses = new WorkflowStatusRepository(database);
    this.milestones = new MilestoneRepository(database);
    this.dependencies = new MilestoneDependencyRepository(database);
    this.history = new WorkItemHistoryRepository(database);
    this.keys = new WorkItemKeyRepository(database);
    this.queries = new WorkItemQueryRepository(database);
    this.counts = new WorkItemCountRepository(database);
    this.writes = new WorkItemWriteRepository(database);
    this.labels = new TaskLabelRepository(database);
    this.checklist = new WorkItemChecklistRepository(database);
    this.links = new WorkItemLinkRepository(database);
    this.assignees = new EligibleAssigneeRepository(database);
  }

  /** Returns all workflow statuses ordered by position. */
  public async findAllStatuses(): Promise<WorkflowStatus[]> {
    return this.statuses.findAll();
  }

  /** Returns a workflow status by its identifier. */
  public async findStatusById(id: string): Promise<WorkflowStatus | null> {
    return this.statuses.findById(id);
  }

  /** Returns all non-archived milestones for the given projects. */
  public async findMilestonesByProjectIds(
    projectIds: readonly string[],
  ): Promise<Milestone[]> {
    return this.milestones.findByProjectIds(projectIds);
  }

  /** Returns a milestone by its identifier. */
  public async findMilestoneById(id: string): Promise<Milestone | null> {
    return this.milestones.findById(id);
  }

  /** Inserts a milestone for the given project. */
  public async insertMilestone(milestone: NewMilestone): Promise<void> {
    return this.milestones.insert(milestone);
  }

  /** Updates the editable values of a milestone. */
  public async updateMilestone(
    id: string,
    milestone: MilestoneUpdate,
  ): Promise<void> {
    return this.milestones.update(id, milestone);
  }

  /** Soft-deletes a milestone without removing its row. */
  public async archiveMilestone(id: string): Promise<void> {
    return this.milestones.archive(id);
  }

  /** Returns every dependency of the given projects. */
  public async findDependenciesByProjectIds(
    projectIds: readonly string[],
  ): Promise<MilestoneDependency[]> {
    return this.dependencies.findByProjectIds(projectIds);
  }

  /** Persists a directed dependency between two milestones. */
  public async insertDependency(
    dependency: NewMilestoneDependency,
  ): Promise<void> {
    return this.dependencies.insert(dependency);
  }

  /** Removes a single dependency by its identifier. */
  public async deleteDependency(id: string): Promise<void> {
    return this.dependencies.delete(id);
  }

  /** Removes every dependency touching the given milestone. */
  public async deleteDependenciesByMilestone(
    milestoneId: string,
  ): Promise<void> {
    return this.dependencies.deleteByMilestone(milestoneId);
  }

  /** Returns work item history across all tasks of one project, newest last. */
  public async findHistoryByProjectId(
    projectId: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemHistory[]> {
    return this.history.findByProjectId(projectId, visibility);
  }

  /** Returns the prefix key stored for a project or registers a newly generated one. */
  public async findOrCreateProjectKey(
    projectId: string,
    defaultKey: string,
  ): Promise<string> {
    return this.keys.findOrCreateProjectKey(projectId, defaultKey);
  }

  /** Returns the next sequential ticket number for the given project. */
  public async getNextNumber(projectId: string): Promise<number> {
    return this.keys.getNextNumber(projectId);
  }

  /** Returns non-archived work items matching the given filters. */
  public async findAll(
    options: FindWorkItemsOptions = {},
  ): Promise<WorkItemDetail[]> {
    return this.queries.findAll(options);
  }

  /**
   * Returns dashboard counters for several projects with a single query.
   *
   * @param projectIds - Projects already verified as accessible to the actor.
   * @param scope - Actor id, day boundaries as UTC calendar dates
   * (`YYYY-MM-DD`, matching how the dashboard compares due dates), and a
   * full-precision lower bound for the seven-day delta.
   */
  public async countWorkItemsOverview(
    projectIds: readonly string[],
    scope: WorkItemsOverviewScope,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemsOverview> {
    return this.counts.countOverview(projectIds, scope, visibility);
  }

  /**
   * Returns done/total counters per project with a single query.
   *
   * @param projectIds - Projects already verified as accessible to the actor.
   */
  public async countWorkItemsByProject(
    projectIds: readonly string[],
    visibility?: WorkItemVisibility,
  ): Promise<ReadonlyMap<string, ProjectWorkItemCounts>> {
    return this.counts.countByProject(projectIds, visibility);
  }

  /** Returns one non-archived work item by identifier. */
  public async findById(
    id: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail | null> {
    return this.queries.findById(id, visibility);
  }

  /** Returns one non-archived work item by its key (e.g. PAGE-12). */
  public async findByKey(
    key: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail | null> {
    return this.queries.findByKey(key, visibility);
  }

  /** Returns the stored relation for server-side preservation after authorizing the child. */
  public async findParentReference(
    id: string,
  ): Promise<{ readonly id: string; readonly key: string | null } | null> {
    return this.queries.findParentReference(id);
  }

  /** Resolves only currently visible ticket keys for historical references. */
  public async findVisibleKeys(
    keys: readonly string[],
    visibility: WorkItemVisibility,
  ): Promise<ReadonlySet<string>> {
    return this.queries.findVisibleKeys(keys, visibility);
  }

  /** Returns all non-archived subtasks belonging to a parent item. */
  public async findSubtasks(
    parentId: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail[]> {
    return this.queries.findSubtasks(parentId, visibility);
  }

  /** Returns non-archived tasks of a project linked to a GitHub issue. */
  public async findLinkedWorkItems(
    projectId: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemDetail[]> {
    return this.queries.findLinkedWorkItems(projectId, visibility);
  }

  /** Replaces the GitHub linkage stored on a work item. */
  public async updateGitHubLink(
    id: string,
    link: WorkItemGitHubLink,
  ): Promise<void> {
    return this.writes.updateGitHubLink(id, link);
  }

  /** Sets or clears the synchronization conflict flag on a work item. */
  public async setGitHubConflict(id: string, conflict: boolean): Promise<void> {
    return this.writes.setGitHubConflict(id, conflict);
  }

  /** Inserts a new work item. */
  public async insert(item: NewWorkItem): Promise<void> {
    return this.writes.insert(item);
  }

  /** Returns known GitHub links without exposing any ticket details to an actor. */
  public async findKnownGitHubIssueNumbers(
    projectId: string,
  ): Promise<ReadonlySet<number>> {
    return this.queries.findKnownGitHubIssueNumbers(projectId);
  }

  /** Updates fields on an existing work item. */
  public async update(id: string, update: WorkItemUpdate): Promise<void> {
    return this.writes.update(id, update);
  }

  /** Updates synchronized content without overwriting redacted local relationships. */
  public async updateFromGitHub(
    id: string,
    update: Pick<WorkItemUpdate, "title" | "description" | "statusId">,
  ): Promise<void> {
    return this.writes.updateFromGitHub(id, update);
  }

  /** Updates the workflow status, ordering, and completion timestamp of a work item. */
  public async updateStatusAndOrder(
    id: string,
    statusId: string,
    sortOrder: number,
    isDone: boolean,
  ): Promise<void> {
    return this.writes.updateStatusAndOrder(id, statusId, sortOrder, isDone);
  }

  /** Marks a work item as archived without deleting its row. */
  public async archive(id: string): Promise<void> {
    return this.writes.archive(id);
  }

  /** Restores an archived work item keeping its original workflow status. */
  public async restore(id: string): Promise<void> {
    return this.writes.restore(id);
  }

  /** Stores or clears the last GitHub synchronization error of a work item. */
  public async setGitHubError(
    id: string,
    message: string | null,
  ): Promise<void> {
    return this.writes.setGitHubError(id, message);
  }

  /**
   * Moves a work item to another project with a new project-specific key.
   * Project-bound relations travel in the `move` mapping while the
   * GitHub linkage is cleared because integrations belong to projects.
   *
   * @param id - Work item kept under its stable internal identifier.
   * @param move - Target project, new key, and cleared project-bound relations.
   */
  public async moveToProject(id: string, move: WorkItemMove): Promise<void> {
    return this.writes.moveToProject(id, move);
  }

  /** Returns the shared label catalog of a project ordered by name. */
  public async findLabelsByProjectId(
    projectId: string,
  ): Promise<ProjectLabel[]> {
    return this.labels.findByProjectId(projectId);
  }

  /** Returns the shared label catalogs of several projects ordered by name. */
  public async findLabelsByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ProjectLabel[]>> {
    return this.labels.findByProjectIds(projectIds);
  }

  /** Returns a project label by its identifier. */
  public async findLabelById(id: string): Promise<ProjectLabel | null> {
    return this.labels.findById(id);
  }

  /** Returns how many tickets currently use a label. */
  public async countLabelUsage(
    labelId: string,
    visibility?: WorkItemVisibility,
  ): Promise<number> {
    return this.labels.countUsage(labelId, visibility);
  }

  /**
   * Returns label usage counts for several projects with a single query.
   *
   * @returns Usage counts grouped by project id, then by label id.
   */
  public async countLabelUsageByProjectIds(
    projectIds: readonly string[],
    visibility?: WorkItemVisibility,
  ): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> {
    return this.labels.countUsageByProjectIds(projectIds, visibility);
  }

  /** Inserts a label into the shared catalog of a project. */
  public async insertLabel(label: NewProjectLabel): Promise<void> {
    return this.labels.insert(label);
  }

  /** Renames or recolors a project label; tickets reference it by id. */
  public async updateLabel(
    id: string,
    label: ProjectLabelUpdate,
  ): Promise<void> {
    return this.labels.update(id, label);
  }

  /** Deletes a project label and all of its ticket assignments. */
  public async deleteLabel(id: string): Promise<void> {
    return this.labels.delete(id);
  }

  /** Returns the labels of the given work items mapped by work item id. */
  public async findLabelsForWorkItemIds(
    workItemIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ProjectLabel[]>> {
    return this.labels.findByWorkItemIds(workItemIds);
  }

  /** Assigns a project label to a work item. */
  public async assignLabel(workItemId: string, labelId: string): Promise<void> {
    return this.labels.assign(workItemId, labelId);
  }

  /** Removes a project label from a work item. */
  public async unassignLabel(
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    return this.labels.unassign(workItemId, labelId);
  }

  /** Removes every label assignment from a work item. */
  public async removeAllLabelsFromWorkItem(workItemId: string): Promise<void> {
    return this.labels.removeAllFromWorkItem(workItemId);
  }

  /** Returns the checklist items of a work item, in their persisted order. */
  public async findChecklistItemsByWorkItemId(
    workItemId: string,
  ): Promise<WorkItemChecklistItem[]> {
    return this.checklist.findByWorkItemId(workItemId);
  }

  /** Returns a single checklist item by its identifier. */
  public async findChecklistItemById(
    id: string,
  ): Promise<WorkItemChecklistItem | null> {
    return this.checklist.findById(id);
  }

  /** Appends a checklist item after the ticket's existing entries. */
  public async insertChecklistItem(item: NewChecklistItem): Promise<void> {
    return this.checklist.insert(item);
  }

  /** Renames a checklist item, toggles its done state, or both. */
  public async updateChecklistItem(
    id: string,
    update: ChecklistItemUpdate,
  ): Promise<void> {
    return this.checklist.update(id, update);
  }

  /** Deletes a checklist item. */
  public async deleteChecklistItem(id: string): Promise<void> {
    return this.checklist.delete(id);
  }

  /**
   * Returns every link involving a work item, from that item's own point
   * of view (outgoing rows stored on it, plus incoming rows stored on the
   * other side of the relation).
   */
  public async findLinksByWorkItemId(
    workItemId: string,
    visibility?: WorkItemVisibility,
  ): Promise<WorkItemLink[]> {
    return this.links.findByWorkItemId(workItemId, visibility);
  }

  /** Returns a single link by its identifier. */
  public async findLinkById(id: string): Promise<StoredWorkItemLink | null> {
    return this.links.findById(id);
  }

  /** Persists a new link between two work items. */
  public async insertLink(link: NewWorkItemLink): Promise<void> {
    return this.links.insert(link);
  }

  /** Deletes a link by its identifier. */
  public async deleteLink(id: string): Promise<void> {
    return this.links.delete(id);
  }

  /** Records a history event for a work item. */
  public async insertHistory(entry: NewWorkItemHistory): Promise<void> {
    return this.history.insert(entry);
  }

  /** Returns history records for a work item ordered from newest to oldest. */
  public async findHistoryByWorkItemId(
    workItemId: string,
  ): Promise<WorkItemHistory[]> {
    return this.history.findByWorkItemId(workItemId);
  }

  /** Returns all active users eligible to be assigned to work items in a project. */
  public async findEligibleAssignees(projectId: string): Promise<User[]> {
    return this.assignees.findByProjectId(projectId);
  }

  /**
   * Returns eligible assignees for several projects with a single query.
   *
   * @remarks
   * Administrators and managers are eligible in every requested project,
   * members only in their own projects, mirroring {@link findEligibleAssignees}.
   *
   * @returns Eligible users grouped by project id, ordered by display name.
   */
  public async findEligibleAssigneesByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly User[]>> {
    return this.assignees.findByProjectIds(projectIds);
  }
}
