import { createHash } from "node:crypto";

import { CACHE_TTLS, stableIdKey } from "@/backend/cache/ServerCache";
import { workItemScopeKey } from "@/backend/cache/WorkItemScopeKey";
import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";

import { visibleTaskHistory } from "./TaskHistoryVisibility";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  FindWorkItemsOptions,
  ProjectWorkItemCounts,
  TaskRepository,
  WorkItemsOverview,
} from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type {
  WorkItemDetail,
  WorkItemHistory,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** Actor and day boundaries a dashboard overview is counted for. */
export interface WorkItemsOverviewScope {
  readonly userId: string;
  readonly todayDate: string;
  readonly weekAgoStart: string;
  readonly yesterdayDate: string;
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
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...options,
        projectIds: [...effectiveProjectIds].sort(),
        search: options.search?.trim().toLowerCase(),
      }),
    )
    .digest("hex");
}

/** Reads work items, statuses, assignees, history and dashboard counters. */
export class TaskReadService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;
  private readonly cache: ServerCache;

  /**
   * Creates a read service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Verifier of project access.
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

  /** Returns all available workflow statuses. */
  public async findAllStatuses(actor: User): Promise<WorkflowStatus[]> {
    const visibility = await this.access.visibility(actor);
    const accessibleIds = new Set(visibility.projectIds);
    const cacheKey = "statuses:all";
    const cached = this.cache.get<WorkflowStatus[]>(cacheKey);

    if (cached) {
      return cached.filter(
        (status) =>
          status.projectId === null || accessibleIds.has(status.projectId),
      );
    }

    const statuses = await this.taskRepository.findAllStatuses();
    this.cache.set(cacheKey, statuses, CACHE_TTLS.statuses);

    return statuses.filter(
      (status) =>
        status.projectId === null || accessibleIds.has(status.projectId),
    );
  }

  /** Returns work item history across all tasks of one project. */
  public async findHistoryByProject(
    actor: User,
    projectId: string,
  ): Promise<WorkItemHistory[]> {
    await this.access.requireProject(actor, projectId);

    const visibility = await this.access.visibility(actor);
    return visibleTaskHistory(
      this.taskRepository,
      await this.taskRepository.findHistoryByProjectId(projectId, visibility),
      visibility,
    );
  }

  /** Returns active users eligible for assignment in a project. */
  public async findEligibleAssignees(
    actor: User,
    projectId: string,
  ): Promise<User[]> {
    await this.access.requireProject(actor, projectId);

    const candidates =
      await this.taskRepository.findEligibleAssignees(projectId);
    const eligible = await this.access.filterAssignees(
      new Map([[projectId, candidates]]),
    );
    return [...(eligible.get(projectId) ?? [])];
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
      return this.access.filterAssignees(cached);
    }

    const assignees =
      await this.taskRepository.findEligibleAssigneesByProjectIds(projectIds);
    this.cache.set(cacheKey, assignees, CACHE_TTLS.assignees);

    return this.access.filterAssignees(assignees);
  }

  /** Returns non-archived work items across projects the actor has access to. */
  public async findAll(
    actor: User,
    options: FindWorkItemsOptions = {},
  ): Promise<WorkItemDetail[]> {
    const visibility = await this.access.visibility(actor);
    const requested = new Set(options.projectIds);
    const effectiveProjectIds = (visibility.projectIds ?? []).filter(
      (id) => options.projectIds === undefined || requested.has(id),
    );
    if (effectiveProjectIds.length === 0) {
      return [];
    }

    const scopedOptions = { ...options, visibility };
    const cacheKey = `workitems:q:${workItemScopeKey(actor.id, visibility)}:${stableWorkItemsKey(scopedOptions, effectiveProjectIds)}`;
    const cached = this.cache.get<WorkItemDetail[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const items = await this.taskRepository.findAll({
      ...scopedOptions,
      projectIds: effectiveProjectIds,
    });
    this.cache.set(cacheKey, items, CACHE_TTLS.workItems);

    return items;
  }

  /** Returns a single work item by its internal identifier. */
  public async getById(actor: User, id: string): Promise<WorkItemDetail> {
    return this.access.requireWorkItem(actor, id);
  }

  /** Returns a single work item by its public key (e.g. PAGE-12). */
  public async getByKey(actor: User, key: string): Promise<WorkItemDetail> {
    const item = await this.taskRepository.findByKey(
      key,
      await this.access.visibility(actor),
    );

    if (!item) {
      throw new WorkItemNotFoundError();
    }

    await this.access.requireProject(actor, item.projectId);

    return item;
  }

  /** Returns direct subtasks for a parent item. */
  public async findSubtasks(
    actor: User,
    parentId: string,
  ): Promise<WorkItemDetail[]> {
    const parent = await this.getById(actor, parentId);

    return this.taskRepository.findSubtasks(
      parent.id,
      await this.access.visibility(actor),
    );
  }

  /** Returns change history for a work item. */
  public async getHistory(
    actor: User,
    workItemId: string,
  ): Promise<WorkItemHistory[]> {
    await this.getById(actor, workItemId);

    return visibleTaskHistory(
      this.taskRepository,
      await this.taskRepository.findHistoryByWorkItemId(workItemId),
      await this.access.visibility(actor),
    );
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
    return this.taskRepository.countWorkItemsOverview(
      projectIds,
      { ...scope, userId: actor.id },
      await this.access.visibility(actor),
    );
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
    return this.taskRepository.countWorkItemsByProject(
      projectIds,
      await this.access.visibility(actor),
    );
  }
}
