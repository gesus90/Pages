import { randomUUID } from "node:crypto";

import {
  isWorkItemLinkType,
  isWorkItemPriority,
  isWorkItemType,
  normalizeHexColorCode,
  WORK_ITEM_PRIORITY,
  WORK_ITEM_TYPE,
} from "@/definition/Task";

import {
  CACHE_TTLS,
  ServerCache,
  stableIdKey,
} from "@/backend/cache/ServerCache";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type {
  FindWorkItemsOptions,
  NewWorkItem,
  ProjectWorkItemCounts,
  TaskRepository,
  WorkItemsOverview,
} from "@/backend/database/repositories/TaskRepository";
import type { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import type { ProjectService } from "@/backend/service/ProjectService";
import type {
  Milestone,
  ProjectLabel,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkItemLinkType,
  WorkItemPriority,
  WorkItemType,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

const MAXIMUM_DESCRIPTION_LENGTH = 10_000;
const MAXIMUM_TITLE_LENGTH = 200;
const MAXIMUM_CHECKLIST_ITEM_TITLE_LENGTH = 200;

/** Thrown when a requested work item does not exist or has been archived. */
export class WorkItemNotFoundError extends Error {
  public constructor() {
    super("The requested work item does not exist.");
  }
}

/** Thrown when a work item action violates hierarchy rules. */
export class WorkItemHierarchyError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

/** Thrown when a work item payload fails validation. */
export class WorkItemValidationError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

/** Thrown when an actor lacks access to the project associated with a task. */
export class WorkItemAccessDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to access tasks for this project.");
  }
}

/** Values required to create a milestone. */
export interface CreateMilestoneInput {
  readonly projectId: string;
  readonly name: string;
  readonly description?: string;
  readonly dueAt?: string | null;
}

/** Values that can be changed on a milestone. */
export interface UpdateMilestoneInput {
  readonly name: string;
  readonly description: string;
  readonly status: "open" | "completed" | "archived";
  readonly dueAt: string | null;
}

/** Values required to create a new work item. */
export interface CreateWorkItemInput {
  readonly projectId: string;
  readonly type: WorkItemType;
  readonly title: string;
  readonly description?: string;
  readonly statusId: string;
  readonly priority?: WorkItemPriority;
  readonly assigneeId?: string | null;
  readonly parentId?: string | null;
  readonly milestoneId?: string | null;
  readonly dueAt?: string | null;
  readonly startAt?: string | null;
  readonly skipGitHubSync?: boolean;
}

/** Values that can be changed on an existing work item. */
export interface UpdateWorkItemInput {
  readonly title: string;
  readonly description: string;
  readonly statusId: string;
  readonly priority: WorkItemPriority;
  readonly assigneeId: string | null;
  readonly reporterId: string;
  readonly parentId: string | null;
  readonly milestoneId: string | null;
  readonly dueAt: string | null;
  readonly startAt: string | null;
}

/**
 * Computes a default project key prefix from the project display name.
 *
 * @param name - Display name of the project.
 * @returns An uppercase prefix suitable for ticket keys (e.g. "PAGE", "ASTRO", "ANI").
 */
export function generateProjectKey(name: string): string {
  const trimmed = name.trim();

  if (!trimmed) {
    return "TASK";
  }

  const lower = trimmed.toLowerCase();

  if (lower === "pages") {
    return "PAGE";
  }

  if (lower === "astrolab") {
    return "ASTRO";
  }

  if (lower === "animus") {
    return "ANI";
  }

  const words = trimmed.split(/[\s\-_]+/);

  if (words.length > 1) {
    const initials = words
      .map((word) => word.replace(/[^a-zA-Z0-9]/g, "").charAt(0))
      .join("")
      .toUpperCase();

    if (initials.length >= 2) {
      return initials.slice(0, 5);
    }
  }

  const camelParts = trimmed.match(/[A-Z][a-z0-9]*/g);

  if (camelParts && camelParts.length > 1) {
    const first = camelParts[0].toUpperCase();

    if (first.length >= 3) {
      return first;
    }
  }

  const clean = trimmed.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  if (clean.length <= 4) {
    return clean;
  }

  return clean.slice(0, 4);
}

/**
 * Builds a stable cache key for a work item query.
 *
 * @param options - Query options as passed by the caller.
 * @param effectiveProjectIds - Project ids already intersected with actor access.
 */
function stableWorkItemsKey(
  options: FindWorkItemsOptions,
  effectiveProjectIds: readonly string[],
): string {
  const parts = [
    `projects:${stableIdKey(effectiveProjectIds)}`,
    `assignee:${options.assigneeId ?? ""}`,
    `type:${options.type ?? ""}`,
    `status:${options.statusId ?? ""}`,
    `priority:${options.priority ?? ""}`,
    `milestone:${options.milestoneId ?? ""}`,
    `search:${options.search?.trim().toLowerCase() ?? ""}`,
    `archived:${options.archived ?? "active"}`,
    `order:${options.orderBy ?? "board"}`,
    `limit:${options.limit ?? ""}`,
  ];

  return `workitems:q:${parts.join("|")}`;
}

/** Establishes the business-logic boundary for work items and kanban tracking. */
export class TaskService {
  private readonly taskRepository: TaskRepository;
  private readonly projectService: ProjectService;
  private readonly permissionService: PermissionService;
  private readonly cache: ServerCache;
  private gitHubSync: GitHubSyncService | null = null;

  /**
   * Creates a task service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param projectService - Project business-logic boundary.
   * @param permissionService - Authorization boundary.
   * @param cache - Shared server cache, disabled by default for test isolation.
   */
  public constructor(
    taskRepository: TaskRepository,
    projectService: ProjectService,
    permissionService: PermissionService,
    cache: ServerCache = ServerCache.disabled(),
  ) {
    this.taskRepository = taskRepository;
    this.projectService = projectService;
    this.permissionService = permissionService;
    this.cache = cache;
  }

  /**
   * Attaches the GitHub synchronization used for best-effort outbound updates.
   *
   * @param gitHubSync - Synchronization service publishing task changes.
   */
  public setGitHubSync(gitHubSync: GitHubSyncService): void {
    this.gitHubSync = gitHubSync;
  }

  /** Returns all available workflow statuses. */
  public async findAllStatuses(): Promise<WorkflowStatus[]> {
    const cacheKey = "statuses:all";
    const cached = this.cache.get<WorkflowStatus[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const statuses = await this.taskRepository.findAllStatuses();
    this.cache.set(cacheKey, statuses, CACHE_TTLS.statuses);

    return statuses;
  }

  /** Returns non-archived milestones for projects accessible to the actor. */
  public async findMilestones(
    actor: User,
    projectIds: readonly string[],
  ): Promise<Milestone[]> {
    const accessibleProjects = await this.projectService.findAll(actor);
    const accessibleIds = new Set(
      accessibleProjects.map((project) => project.id),
    );
    const validProjectIds = projectIds.filter((id) => accessibleIds.has(id));

    return this.taskRepository.findMilestonesByProjectIds(validProjectIds);
  }

  /** Creates a milestone after verifying project access and write permission. */
  public async createMilestone(
    actor: User,
    input: CreateMilestoneInput,
  ): Promise<Milestone> {
    await this.projectService.getById(actor, input.projectId);

    if (!(await this.projectService.canWriteProject(actor, input.projectId))) {
      throw new WorkItemAccessDeniedError();
    }

    const name = input.name.trim();
    const description = (input.description ?? "").trim();
    const dueAt = input.dueAt?.trim() || null;

    if (!name || name.length > 200) {
      throw new WorkItemValidationError(
        "Milestone name must be between 1 and 200 characters.",
      );
    }

    if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
      throw new WorkItemValidationError(
        "Milestone due date must use the format YYYY-MM-DD.",
      );
    }

    const id = randomUUID();

    await this.taskRepository.insertMilestone({
      description,
      dueAt,
      id,
      name,
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
    const existing = await this.taskRepository.findMilestoneById(id);

    if (!existing) {
      throw new WorkItemValidationError("Selected milestone does not exist.");
    }

    await this.projectService.getById(actor, existing.projectId);

    if (
      !(await this.projectService.canWriteProject(actor, existing.projectId))
    ) {
      throw new WorkItemAccessDeniedError();
    }

    const name = input.name.trim();

    if (!name || name.length > 200) {
      throw new WorkItemValidationError(
        "Milestone name must be between 1 and 200 characters.",
      );
    }

    if (input.dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueAt)) {
      throw new WorkItemValidationError(
        "Milestone due date must use the format YYYY-MM-DD.",
      );
    }

    if (
      input.status !== "open" &&
      input.status !== "completed" &&
      input.status !== "archived"
    ) {
      throw new WorkItemValidationError("Unsupported milestone status.");
    }

    await this.taskRepository.updateMilestone(id, {
      description: input.description.trim(),
      dueAt: input.dueAt?.trim() || null,
      name,
      status: input.status,
    });
    this.cache.invalidateWorkItems();

    const updated = await this.taskRepository.findMilestoneById(id);

    if (!updated) {
      throw new Error("Updated milestone could not be retrieved.");
    }

    return updated;
  }

  /** Returns work item history across all tasks of one project. */
  public async findHistoryByProject(
    actor: User,
    projectId: string,
  ): Promise<WorkItemHistory[]> {
    await this.projectService.getById(actor, projectId);

    return this.taskRepository.findHistoryByProjectId(projectId);
  }

  /** Returns active users eligible for assignment in a project. */
  public async findEligibleAssignees(
    actor: User,
    projectId: string,
  ): Promise<User[]> {
    await this.projectService.getById(actor, projectId);

    return this.taskRepository.findEligibleAssignees(projectId);
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
    const cacheKey = `assignees:projects:${stableIdKey(projectIds)}`;
    const cached =
      this.cache.get<ReadonlyMap<string, readonly User[]>>(cacheKey);

    if (cached) {
      return cached;
    }

    const assignees =
      await this.taskRepository.findEligibleAssigneesByProjectIds(projectIds);
    this.cache.set(cacheKey, assignees, CACHE_TTLS.assignees);

    return assignees;
  }

  /** Returns non-archived work items across projects the actor has access to. */
  public async findAll(
    actor: User,
    options: FindWorkItemsOptions = {},
  ): Promise<WorkItemDetail[]> {
    const accessibleProjects = await this.projectService.findAll(actor);
    const accessibleIds = new Set(
      accessibleProjects.map((project) => project.id),
    );

    let effectiveProjectIds: string[];

    if (options.projectIds) {
      effectiveProjectIds = options.projectIds.filter((id) =>
        accessibleIds.has(id),
      );
    } else {
      effectiveProjectIds = Array.from(accessibleIds);
    }

    if (effectiveProjectIds.length === 0) {
      return [];
    }

    const cacheKey = stableWorkItemsKey(options, effectiveProjectIds);
    const cached = this.cache.get<WorkItemDetail[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const items = await this.taskRepository.findAll({
      ...options,
      projectIds: effectiveProjectIds,
    });
    this.cache.set(cacheKey, items, CACHE_TTLS.workItems);

    return items;
  }

  /** Returns a single work item by its internal identifier. */
  public async getById(actor: User, id: string): Promise<WorkItemDetail> {
    const item = await this.taskRepository.findById(id);

    if (!item) {
      throw new WorkItemNotFoundError();
    }

    await this.projectService.getById(actor, item.projectId);

    return item;
  }

  /** Returns a single work item by its public key (e.g. PAGE-12). */
  public async getByKey(actor: User, key: string): Promise<WorkItemDetail> {
    const item = await this.taskRepository.findByKey(key);

    if (!item) {
      throw new WorkItemNotFoundError();
    }

    await this.projectService.getById(actor, item.projectId);

    return item;
  }

  /** Returns direct subtasks for a parent item. */
  public async findSubtasks(
    actor: User,
    parentId: string,
  ): Promise<WorkItemDetail[]> {
    const parent = await this.getById(actor, parentId);

    return this.taskRepository.findSubtasks(parent.id);
  }

  /** Returns change history for a work item. */
  public async getHistory(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemHistory[]> {
    await this.getById(actor, workItemId);

    return this.taskRepository.findHistoryByWorkItemId(workItemId);
  }

  /** Creates a new work item after validating hierarchy and project constraints. */
  public async create(
    actor: User,
    input: CreateWorkItemInput,
  ): Promise<WorkItemDetail> {
    const project = await this.projectService.getById(actor, input.projectId);

    const title = input.title.trim();
    const description = (input.description ?? "").trim();
    const priority = input.priority ?? WORK_ITEM_PRIORITY.NORMAL;
    const parentId = input.parentId ? input.parentId.trim() : null;
    const milestoneId = input.milestoneId ? input.milestoneId.trim() : null;
    const assigneeId = input.assigneeId ? input.assigneeId.trim() : null;
    const dueAt = input.dueAt ? input.dueAt.trim() : null;
    const startAt = input.startAt ? input.startAt.trim() : null;

    if (!title || title.length > MAXIMUM_TITLE_LENGTH) {
      throw new WorkItemValidationError(
        "Title must be between 1 and 200 characters.",
      );
    }

    if (description.length > MAXIMUM_DESCRIPTION_LENGTH) {
      throw new WorkItemValidationError(
        "Description must not exceed 10,000 characters.",
      );
    }

    if (!isWorkItemType(input.type)) {
      throw new WorkItemValidationError("Unsupported work item type.");
    }

    if (!isWorkItemPriority(priority)) {
      throw new WorkItemValidationError("Unsupported work item priority.");
    }

    const status = await this.taskRepository.findStatusById(input.statusId);

    if (!status) {
      throw new WorkItemValidationError("Selected status does not exist.");
    }

    await this.validateHierarchy(input.type, parentId, input.projectId, null);

    if (milestoneId) {
      await this.validateMilestone(milestoneId, input.projectId);
    }

    if (assigneeId) {
      await this.validateAssignee(assigneeId, input.projectId);
    }

    const defaultPrefix = generateProjectKey(project.name);
    const projectKey = await this.taskRepository.findOrCreateProjectKey(
      project.id,
      defaultPrefix,
    );
    const nextNumber = await this.taskRepository.getNextNumber(project.id);
    const itemKey = `${projectKey}-${nextNumber}`;
    const id = randomUUID();

    const newWorkItem: NewWorkItem = {
      assigneeId,
      createdBy: actor.id,
      description,
      dueAt,
      id,
      key: itemKey,
      milestoneId,
      number: nextNumber,
      parentId,
      priority,
      projectId: input.projectId,
      sortOrder: nextNumber,
      startAt,
      statusId: status.id,
      title,
      type: input.type,
    };

    await this.taskRepository.insert(newWorkItem);
    this.cache.invalidateWorkItems();

    await this.taskRepository.insertHistory({
      action: "created",
      field: null,
      id: randomUUID(),
      newValue: null,
      oldValue: null,
      userId: actor.id,
      workItemId: id,
    });

    const created = await this.taskRepository.findById(id);

    if (!created) {
      throw new Error("Created work item could not be retrieved.");
    }

    if (!input.skipGitHubSync) {
      // Local-first: return the SQLite row immediately and synchronize
      // with GitHub in the background without blocking the UI.
      void this.publishTaskUpdate(actor, created);
    }

    return created;
  }

  /** Updates an existing work item after validating constraints and logging changes. */
  public async update(
    actor: User,
    id: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItemDetail> {
    const existing = await this.getById(actor, id);

    const title = input.title.trim();
    const description = input.description.trim();
    const parentId = input.parentId ? input.parentId.trim() : null;
    const milestoneId = input.milestoneId ? input.milestoneId.trim() : null;
    const assigneeId = input.assigneeId ? input.assigneeId.trim() : null;
    const reporterId = input.reporterId.trim();
    const dueAt = input.dueAt ? input.dueAt.trim() : null;
    const startAt = input.startAt ? input.startAt.trim() : null;

    if (!title || title.length > MAXIMUM_TITLE_LENGTH) {
      throw new WorkItemValidationError(
        "Title must be between 1 and 200 characters.",
      );
    }

    if (description.length > MAXIMUM_DESCRIPTION_LENGTH) {
      throw new WorkItemValidationError(
        "Description must not exceed 10,000 characters.",
      );
    }

    if (!isWorkItemPriority(input.priority)) {
      throw new WorkItemValidationError("Unsupported work item priority.");
    }

    const newStatus = await this.taskRepository.findStatusById(input.statusId);

    if (!newStatus) {
      throw new WorkItemValidationError("Selected status does not exist.");
    }

    await this.validateHierarchy(
      existing.type,
      parentId,
      existing.projectId,
      existing.id,
    );

    if (milestoneId) {
      await this.validateMilestone(milestoneId, existing.projectId);
    }

    if (assigneeId) {
      await this.validateAssignee(assigneeId, existing.projectId);
    }

    if (!reporterId) {
      throw new WorkItemValidationError("A reporter must be selected.");
    }

    await this.validateAssignee(reporterId, existing.projectId);

    await this.taskRepository.update(id, {
      assigneeId,
      description,
      dueAt,
      milestoneId,
      parentId,
      priority: input.priority,
      reporterId,
      startAt,
      statusId: newStatus.id,
      title,
    });
    this.cache.invalidateWorkItems();

    await this.recordUpdateHistory(actor, existing, {
      assigneeId,
      description,
      dueAt,
      milestoneId,
      newStatus,
      parentId,
      priority: input.priority,
      reporterId,
      startAt,
      title,
    });

    const updated = await this.taskRepository.findById(id);

    if (!updated) {
      throw new Error("Updated work item could not be retrieved.");
    }

    // Local-first: the SQLite update is already visible; GitHub follows async.
    void this.publishTaskUpdate(actor, updated);

    return updated;
  }

  /** Updates status and column sort order via kanban drag & drop. */
  public async updateStatusAndOrder(
    actor: User,
    id: string,
    statusId: string,
    sortOrder: number,
  ): Promise<WorkItemDetail> {
    const existing = await this.getById(actor, id);
    const status = await this.taskRepository.findStatusById(statusId);

    if (!status) {
      throw new WorkItemValidationError("Target status does not exist.");
    }

    await this.taskRepository.updateStatusAndOrder(
      id,
      status.id,
      sortOrder,
      status.isDone,
    );
    this.cache.invalidateWorkItems();

    if (existing.statusId !== status.id) {
      await this.taskRepository.insertHistory({
        action: "status_changed",
        field: "status",
        id: randomUUID(),
        newValue: status.name,
        oldValue: existing.statusName,
        userId: actor.id,
        workItemId: id,
      });
    }

    const updated = await this.taskRepository.findById(id);

    if (!updated) {
      throw new Error("Work item could not be retrieved after status update.");
    }

    // Local-first: kanban moves stay instant while GitHub syncs in background.
    void this.publishTaskUpdate(actor, updated);

    return updated;
  }

  /** Marks a work item as archived without physical deletion. */
  public async archive(actor: User, id: string): Promise<void> {
    await this.getById(actor, id);
    await this.taskRepository.archive(id);
    this.cache.invalidateWorkItems();

    await this.taskRepository.insertHistory({
      action: "archived",
      field: null,
      id: randomUUID(),
      newValue: null,
      oldValue: null,
      userId: actor.id,
      workItemId: id,
    });
  }

  /** Restores an archived work item keeping its original workflow status. */
  public async restore(actor: User, id: string): Promise<void> {
    const existing = await this.getById(actor, id);

    if (
      !(await this.projectService.canWriteProject(actor, existing.projectId))
    ) {
      throw new WorkItemAccessDeniedError();
    }

    await this.taskRepository.restore(id);
    this.cache.invalidateWorkItems();

    await this.taskRepository.insertHistory({
      action: "restored",
      field: null,
      id: randomUUID(),
      newValue: null,
      oldValue: null,
      userId: actor.id,
      workItemId: id,
    });
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
    const existing = await this.getById(actor, id);
    const targetProject = await this.projectService.getById(
      actor,
      targetProjectId,
    );

    if (
      !(await this.projectService.canWriteProject(actor, existing.projectId)) ||
      !(await this.projectService.canWriteProject(actor, targetProjectId))
    ) {
      throw new WorkItemAccessDeniedError();
    }

    if (existing.projectId === targetProjectId) {
      throw new WorkItemValidationError(
        "The ticket already belongs to the selected project.",
      );
    }

    const subtree = await this.collectSubtree(existing.id);
    const defaultPrefix = generateProjectKey(targetProject.name);
    const projectKey = await this.taskRepository.findOrCreateProjectKey(
      targetProject.id,
      defaultPrefix,
    );
    let nextNumber = await this.taskRepository.getNextNumber(targetProject.id);

    for (const item of subtree) {
      const number = nextNumber;
      nextNumber += 1;
      const nextKey = `${projectKey}-${number}`;
      const keepParent =
        item.parentId !== null &&
        subtree.some((candidate) => candidate.id === item.parentId);
      const milestone = item.milestoneId
        ? await this.taskRepository.findMilestoneById(item.milestoneId)
        : null;
      const keepMilestone =
        milestone !== null && milestone.projectId === targetProject.id;
      const keepAssignee = item.assigneeId
        ? await this.isEligibleAssignee(item.assigneeId, targetProject.id)
        : false;

      await this.taskRepository.moveToProject(item.id, {
        assigneeId: keepAssignee ? item.assigneeId : null,
        key: nextKey,
        milestoneId: keepMilestone ? item.milestoneId : null,
        number,
        parentId: keepParent ? item.parentId : null,
        projectId: targetProject.id,
      });
      await this.taskRepository.removeAllLabelsFromWorkItem(item.id);

      await this.taskRepository.insertHistory({
        action: "project_changed",
        field: "project",
        id: randomUUID(),
        newValue: targetProject.name,
        oldValue: item.projectName,
        userId: actor.id,
        workItemId: item.id,
      });

      if (item.githubIssueNumber !== null) {
        await this.taskRepository.insertHistory({
          action: "github_unlinked",
          field: "github",
          id: randomUUID(),
          newValue: null,
          oldValue: `#${item.githubIssueNumber}`,
          userId: actor.id,
          workItemId: item.id,
        });
      }
    }

    this.cache.invalidateWorkItems();
    this.cache.invalidateLabels();

    const moved = await this.taskRepository.findById(existing.id);

    if (!moved) {
      throw new Error("Moved work item could not be retrieved.");
    }

    return moved;
  }

  /** Returns the shared label catalog of a project. */
  public async findLabels(
    actor: User,
    projectId: string,
  ): Promise<ProjectLabel[]> {
    await this.projectService.getById(actor, projectId);

    return this.taskRepository.findLabelsByProjectId(projectId);
  }

  /** Returns label usage counts mapped by label id for a project. */
  public async countLabelUsage(
    actor: User,
    projectId: string,
  ): Promise<ReadonlyMap<string, number>> {
    await this.projectService.getById(actor, projectId);
    const usageByProject = await this.countLabelUsageByProjects([projectId]);

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
   * @param projectIds - Project ids already verified as accessible, or a
   * single project after the usual access check by the caller.
   */
  public async countLabelUsageByProjects(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> {
    const cacheKey = `labels:usage:${stableIdKey(projectIds)}`;
    const cached =
      this.cache.get<ReadonlyMap<string, ReadonlyMap<string, number>>>(
        cacheKey,
      );

    if (cached) {
      return cached;
    }

    const usage =
      await this.taskRepository.countLabelUsageByProjectIds(projectIds);
    this.cache.set(cacheKey, usage, CACHE_TTLS.labelUsage);

    return usage;
  }

  /**
   * Returns dashboard counters for already access-checked projects.
   *
   * @param projectIds - Project ids the actor may access.
   * @param scope - Actor id, day boundaries, and the seven-day lower bound.
   */
  public async countWorkItemsOverview(
    projectIds: readonly string[],
    scope: {
      readonly userId: string;
      readonly todayDate: string;
      readonly weekAgoStart: string;
      readonly yesterdayDate: string;
    },
  ): Promise<WorkItemsOverview> {
    return this.taskRepository.countWorkItemsOverview(projectIds, scope);
  }

  /**
   * Returns done/total counters per already access-checked project.
   *
   * @param projectIds - Project ids the actor may access.
   */
  public async countWorkItemsByProject(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectWorkItemCounts>> {
    return this.taskRepository.countWorkItemsByProject(projectIds);
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
    input: { readonly name: string; readonly color: string },
  ): Promise<ProjectLabel> {
    await this.projectService.getById(actor, projectId);

    if (!(await this.projectService.canWriteProject(actor, projectId))) {
      throw new WorkItemAccessDeniedError();
    }

    const name = input.name.trim().slice(0, 40);

    if (!name) {
      throw new WorkItemValidationError(
        "Label name must be between 1 and 40 characters.",
      );
    }

    const color = normalizeHexColorCode(input.color);

    if (!color) {
      throw new WorkItemValidationError("Unsupported label color.");
    }

    const existing = await this.taskRepository.findLabelsByProjectId(projectId);

    if (
      existing.some((label) => label.name.toLowerCase() === name.toLowerCase())
    ) {
      throw new WorkItemValidationError(
        "A label with this name already exists in the project.",
      );
    }

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
    input: { readonly name: string; readonly color: string },
  ): Promise<ProjectLabel> {
    const existing = await this.taskRepository.findLabelById(labelId);

    if (!existing) {
      throw new WorkItemValidationError("Selected label does not exist.");
    }

    await this.projectService.getById(actor, existing.projectId);

    if (
      !(await this.projectService.canWriteProject(actor, existing.projectId))
    ) {
      throw new WorkItemAccessDeniedError();
    }

    const name = input.name.trim().slice(0, 40);

    if (!name) {
      throw new WorkItemValidationError(
        "Label name must be between 1 and 40 characters.",
      );
    }

    const color = normalizeHexColorCode(input.color);

    if (!color) {
      throw new WorkItemValidationError("Unsupported label color.");
    }

    const siblings = await this.taskRepository.findLabelsByProjectId(
      existing.projectId,
    );

    if (
      siblings.some(
        (label) =>
          label.id !== labelId &&
          label.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new WorkItemValidationError(
        "A label with this name already exists in the project.",
      );
    }

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
    const existing = await this.taskRepository.findLabelById(labelId);

    if (!existing) {
      throw new WorkItemValidationError("Selected label does not exist.");
    }

    await this.projectService.getById(actor, existing.projectId);

    if (
      !(await this.projectService.canWriteProject(actor, existing.projectId))
    ) {
      throw new WorkItemAccessDeniedError();
    }

    await this.taskRepository.deleteLabel(labelId);
    this.cache.invalidateLabels();
  }

  /** Assigns a project label to a work item and records the change. */
  public async assignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    const item = await this.getById(actor, workItemId);
    const label = await this.taskRepository.findLabelById(labelId);

    if (!label || label.projectId !== item.projectId) {
      throw new WorkItemValidationError(
        "Selected label does not belong to the ticket project.",
      );
    }

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new WorkItemAccessDeniedError();
    }

    await this.taskRepository.assignLabel(workItemId, labelId);
    this.cache.invalidateLabels();

    await this.taskRepository.insertHistory({
      action: "label_added",
      field: "label",
      id: randomUUID(),
      newValue: label.name,
      oldValue: null,
      userId: actor.id,
      workItemId,
    });
  }

  /** Removes a project label from a work item and records the change. */
  public async unassignLabel(
    actor: User,
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    const item = await this.getById(actor, workItemId);
    const label = await this.taskRepository.findLabelById(labelId);

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new WorkItemAccessDeniedError();
    }

    await this.taskRepository.unassignLabel(workItemId, labelId);
    this.cache.invalidateLabels();

    await this.taskRepository.insertHistory({
      action: "label_removed",
      field: "label",
      id: randomUUID(),
      newValue: null,
      oldValue: label?.name ?? null,
      userId: actor.id,
      workItemId,
    });
  }

  /** Returns the acceptance-criteria checklist of a work item, in order. */
  public async findChecklistItems(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemChecklistItem[]> {
    await this.getById(actor, workItemId);

    return this.taskRepository.findChecklistItemsByWorkItemId(workItemId);
  }

  /** Appends a new checklist item to a work item. */
  public async addChecklistItem(
    actor: User,
    workItemId: string,
    title: string,
  ): Promise<WorkItemChecklistItem> {
    const item = await this.getById(actor, workItemId);

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new WorkItemAccessDeniedError();
    }

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
    const existing =
      await this.taskRepository.findChecklistItemById(checklistItemId);

    if (!existing) {
      throw new WorkItemValidationError(
        "Selected checklist item does not exist.",
      );
    }

    const item = await this.getById(actor, existing.workItemId);

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new WorkItemAccessDeniedError();
    }

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
    const existing =
      await this.taskRepository.findChecklistItemById(checklistItemId);

    if (!existing) {
      throw new WorkItemValidationError(
        "Selected checklist item does not exist.",
      );
    }

    const item = await this.getById(actor, existing.workItemId);

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new WorkItemAccessDeniedError();
    }

    await this.taskRepository.deleteChecklistItem(checklistItemId);
  }

  /** Returns every link involving a work item, from its own point of view. */
  public async findLinks(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemLink[]> {
    await this.getById(actor, workItemId);

    return this.taskRepository.findLinksByWorkItemId(workItemId);
  }

  /** Creates a link from a work item to another ticket identified by key. */
  public async addLink(
    actor: User,
    workItemId: string,
    targetKey: string,
    linkType: WorkItemLinkType,
  ): Promise<WorkItemLink[]> {
    const item = await this.getById(actor, workItemId);

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new WorkItemAccessDeniedError();
    }

    if (!isWorkItemLinkType(linkType)) {
      throw new WorkItemValidationError("Unsupported link type.");
    }

    const trimmedKey = targetKey.trim();
    const target = trimmedKey
      ? await this.taskRepository.findByKey(trimmedKey)
      : null;

    if (!target) {
      throw new WorkItemValidationError("Selected ticket does not exist.");
    }

    if (target.id === item.id) {
      throw new WorkItemValidationError("A ticket cannot be linked to itself.");
    }

    await this.projectService.getById(actor, target.projectId);

    await this.taskRepository.insertLink({
      id: randomUUID(),
      linkType,
      linkedWorkItemId: target.id,
      workItemId: item.id,
    });

    return this.taskRepository.findLinksByWorkItemId(item.id);
  }

  /** Removes a link that involves the given work item, in either direction. */
  public async removeLink(
    actor: User,
    workItemId: string,
    linkId: string,
  ): Promise<WorkItemLink[]> {
    const item = await this.getById(actor, workItemId);

    if (!(await this.projectService.canWriteProject(actor, item.projectId))) {
      throw new WorkItemAccessDeniedError();
    }

    const link = await this.taskRepository.findLinkById(linkId);

    if (
      link &&
      link.workItemId !== item.id &&
      link.linkedWorkItemId !== item.id
    ) {
      throw new WorkItemValidationError(
        "Selected link does not belong to this ticket.",
      );
    }

    await this.taskRepository.deleteLink(linkId);

    return this.taskRepository.findLinksByWorkItemId(item.id);
  }

  /**
   * Publishes a mutated task to GitHub without failing the Pages mutation.
   *
   * @param actor - User owning the change.
   * @param item - Fresh work item detail after its Pages mutation.
   */
  private async publishTaskUpdate(
    actor: User,
    item: WorkItemDetail,
  ): Promise<void> {
    if (!this.gitHubSync) {
      return;
    }

    try {
      await this.gitHubSync.publishTaskUpdate(actor, item);

      if (item.githubLastError !== null) {
        await this.taskRepository.setGitHubError(item.id, null);
        this.cache.invalidateWorkItems();
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 200)
          : "GitHub synchronization failed.";

      console.error(
        `Pages could not publish task "${item.key}" to GitHub.`,
        error,
      );

      if (item.githubLastError !== message) {
        await this.taskRepository.setGitHubError(item.id, message);
        this.cache.invalidateWorkItems();

        await this.taskRepository.insertHistory({
          action: "github_sync_failed",
          field: "github",
          id: randomUUID(),
          newValue: message,
          oldValue: null,
          userId: actor.id,
          workItemId: item.id,
        });
      }
    }
  }

  private async collectSubtree(rootId: string): Promise<WorkItemDetail[]> {
    const root = await this.taskRepository.findById(rootId);

    if (!root) {
      throw new WorkItemNotFoundError();
    }

    const collected: WorkItemDetail[] = [root];
    const queue: WorkItemDetail[] = [root];
    let current: WorkItemDetail | undefined;

    while ((current = queue.pop()) !== undefined) {
      const children = await this.taskRepository.findSubtasks(current.id);

      for (const child of children) {
        collected.push(child);
        queue.push(child);
      }
    }

    return collected;
  }

  private async isEligibleAssignee(
    userId: string,
    projectId: string,
  ): Promise<boolean> {
    const eligible = await this.taskRepository.findEligibleAssignees(projectId);

    return eligible.some((user) => user.id === userId);
  }

  private async validateHierarchy(
    type: WorkItemType,
    parentId: string | null,
    projectId: string,
    selfId: string | null,
  ): Promise<void> {
    if (type === WORK_ITEM_TYPE.INITIATIVE) {
      if (parentId !== null) {
        throw new WorkItemHierarchyError(
          "An Initiative cannot have a parent work item.",
        );
      }

      return;
    }

    if (type === WORK_ITEM_TYPE.EPIC) {
      if (parentId === null) {
        return;
      }

      if (selfId && parentId === selfId) {
        throw new WorkItemHierarchyError("An Epic cannot be its own parent.");
      }

      const parent = await this.taskRepository.findById(parentId);

      if (!parent) {
        throw new WorkItemHierarchyError(
          "The specified Initiative does not exist.",
        );
      }

      if (parent.type !== WORK_ITEM_TYPE.INITIATIVE) {
        throw new WorkItemHierarchyError(
          "An Epic can only belong to an Initiative.",
        );
      }

      if (parent.projectId !== projectId) {
        throw new WorkItemHierarchyError(
          "Parent Initiative must belong to the same project.",
        );
      }

      return;
    }

    if (type === WORK_ITEM_TYPE.SUBTASK) {
      if (!parentId) {
        throw new WorkItemHierarchyError(
          "A Subtask must have an associated parent task.",
        );
      }

      if (selfId && parentId === selfId) {
        throw new WorkItemHierarchyError("A Subtask cannot be its own parent.");
      }

      const parent = await this.taskRepository.findById(parentId);

      if (!parent) {
        throw new WorkItemHierarchyError(
          "The specified parent task does not exist.",
        );
      }

      if (parent.type !== WORK_ITEM_TYPE.TASK) {
        throw new WorkItemHierarchyError(
          "A Subtask can only be attached to a Task.",
        );
      }

      if (parent.projectId !== projectId) {
        throw new WorkItemHierarchyError(
          "Parent task must belong to the same project.",
        );
      }

      return;
    }

    if (type === WORK_ITEM_TYPE.TASK && parentId) {
      if (selfId && parentId === selfId) {
        throw new WorkItemHierarchyError("A Task cannot be its own parent.");
      }

      const parent = await this.taskRepository.findById(parentId);

      if (!parent) {
        throw new WorkItemHierarchyError("The specified Epic does not exist.");
      }

      if (parent.type !== WORK_ITEM_TYPE.EPIC) {
        throw new WorkItemHierarchyError(
          "A Task can only have an Epic as its parent.",
        );
      }

      if (parent.projectId !== projectId) {
        throw new WorkItemHierarchyError(
          "Parent Epic must belong to the same project.",
        );
      }
    }
  }

  private async validateMilestone(
    milestoneId: string,
    projectId: string,
  ): Promise<void> {
    const milestone = await this.taskRepository.findMilestoneById(milestoneId);

    if (!milestone) {
      throw new WorkItemValidationError("Selected milestone does not exist.");
    }

    if (milestone.projectId !== projectId) {
      throw new WorkItemValidationError(
        "Milestone does not belong to the selected project.",
      );
    }
  }

  private async validateAssignee(
    assigneeId: string,
    projectId: string,
  ): Promise<void> {
    const eligible = await this.taskRepository.findEligibleAssignees(projectId);

    if (!eligible.some((user) => user.id === assigneeId)) {
      throw new WorkItemValidationError(
        "Selected assignee does not have access to this project.",
      );
    }
  }

  private async recordUpdateHistory(
    actor: User,
    existing: WorkItemDetail,
    update: {
      readonly title: string;
      readonly description: string;
      readonly priority: WorkItemPriority;
      readonly newStatus: WorkflowStatus;
      readonly assigneeId: string | null;
      readonly reporterId: string;
      readonly parentId: string | null;
      readonly milestoneId: string | null;
      readonly dueAt: string | null;
      readonly startAt: string | null;
    },
  ): Promise<void> {
    if (existing.title !== update.title) {
      await this.taskRepository.insertHistory({
        action: "title_changed",
        field: "title",
        id: randomUUID(),
        newValue: update.title,
        oldValue: existing.title,
        userId: actor.id,
        workItemId: existing.id,
      });
    }

    if (existing.description !== update.description) {
      await this.taskRepository.insertHistory({
        action: "description_changed",
        field: "description",
        id: randomUUID(),
        newValue: update.description,
        oldValue: existing.description,
        userId: actor.id,
        workItemId: existing.id,
      });
    }

    if (existing.statusId !== update.newStatus.id) {
      await this.taskRepository.insertHistory({
        action: "status_changed",
        field: "status",
        id: randomUUID(),
        newValue: update.newStatus.name,
        oldValue: existing.statusName,
        userId: actor.id,
        workItemId: existing.id,
      });
    }

    if (existing.priority !== update.priority) {
      await this.taskRepository.insertHistory({
        action: "priority_changed",
        field: "priority",
        id: randomUUID(),
        newValue: update.priority,
        oldValue: existing.priority,
        userId: actor.id,
        workItemId: existing.id,
      });
    }

    if (existing.assigneeId !== update.assigneeId) {
      const eligibleUsers = await this.taskRepository.findEligibleAssignees(
        existing.projectId,
      );
      const newAssignee = eligibleUsers.find((u) => u.id === update.assigneeId);

      await this.taskRepository.insertHistory({
        action: "assignee_changed",
        field: "assignee",
        id: randomUUID(),
        newValue: newAssignee?.displayName ?? null,
        oldValue: existing.assigneeName,
        userId: actor.id,
        workItemId: existing.id,
      });
    }

    if (existing.createdBy !== update.reporterId) {
      const eligibleUsers = await this.taskRepository.findEligibleAssignees(
        existing.projectId,
      );
      const newReporter = eligibleUsers.find((u) => u.id === update.reporterId);

      await this.taskRepository.insertHistory({
        action: "reporter_changed",
        field: "reporter",
        id: randomUUID(),
        newValue: newReporter?.displayName ?? null,
        oldValue: existing.reporterName,
        userId: actor.id,
        workItemId: existing.id,
      });
    }

    if (existing.parentId !== update.parentId) {
      let newParentKey: string | null = null;

      if (update.parentId) {
        const newParent = await this.taskRepository.findById(update.parentId);
        newParentKey = newParent?.key ?? null;
      }

      await this.taskRepository.insertHistory({
        action: "parent_changed",
        field: "parent",
        id: randomUUID(),
        newValue: newParentKey,
        oldValue: existing.parentKey,
        userId: actor.id,
        workItemId: existing.id,
      });
    }

    if (existing.milestoneId !== update.milestoneId) {
      let newMilestoneName: string | null = null;

      if (update.milestoneId) {
        const milestone = await this.taskRepository.findMilestoneById(
          update.milestoneId,
        );
        newMilestoneName = milestone?.name ?? null;
      }

      await this.taskRepository.insertHistory({
        action: "milestone_changed",
        field: "milestone",
        id: randomUUID(),
        newValue: newMilestoneName,
        oldValue: existing.milestoneName,
        userId: actor.id,
        workItemId: existing.id,
      });
    }

    if (existing.dueAt !== update.dueAt) {
      await this.taskRepository.insertHistory({
        action: "due_at_changed",
        field: "due_at",
        id: randomUUID(),
        newValue: update.dueAt,
        oldValue: existing.dueAt,
        userId: actor.id,
        workItemId: existing.id,
      });
    }
  }
}
