import { vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { taskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";

import { RECORD_TIME, ticketRecord } from "./task-records";

import type { FindWorkItemsOptions } from "@/backend/database/repositories/TaskRepository";
import type {
  WorkItemDetail,
  WorkItemHistory,
  WorkItemVisibility,
} from "@/definition/Task";
import type { TaskState } from "./task-records";

/** Tells whether a stored ticket lies within a department and project scope. */
export function isTicketVisible(
  ticket: WorkItemDetail,
  visibility?: WorkItemVisibility,
): boolean {
  if (!visibility) return true;
  const isDepartmentVisible =
    visibility.departmentIds === null ||
    ticket.departmentId === null ||
    visibility.departmentIds.includes(ticket.departmentId);
  const isProjectVisible =
    !visibility.projectIds || visibility.projectIds.includes(ticket.projectId);
  return isDepartmentVisible && isProjectVisible;
}

/** Adds the joined display data the production queries return. */
export function presentTicket(
  state: TaskState,
  stored: WorkItemDetail,
  visibility?: WorkItemVisibility,
): WorkItemDetail {
  const parent = stored.parentId ? state.tickets.get(stored.parentId) : null;
  const isParentVisible = parent && isTicketVisible(parent, visibility);
  return {
    ...stored,
    ...describeStatus(state, stored),
    ...describePeople(state, stored),
    parentId: isParentVisible ? stored.parentId : null,
    parentKey: isParentVisible ? parent.key : null,
    parentTitle: isParentVisible ? parent.title : null,
    milestoneName: stored.milestoneId
      ? (state.milestones.get(stored.milestoneId)?.name ?? null)
      : null,
  };
}

function describeStatus(
  state: TaskState,
  stored: WorkItemDetail,
): Pick<WorkItemDetail, "statusKey" | "statusName" | "isDone"> {
  const status = state.statuses.find((entry) => entry.id === stored.statusId);
  return {
    statusKey: status?.key ?? stored.statusKey,
    statusName: status?.name ?? stored.statusName,
    isDone: status?.isDone ?? stored.isDone,
  };
}

function describePeople(
  state: TaskState,
  stored: WorkItemDetail,
): Pick<WorkItemDetail, "assigneeName" | "assigneeGroupName"> {
  return {
    assigneeName:
      state.people.find((person) => person.id === stored.assigneeId)
        ?.displayName ?? null,
    assigneeGroupName:
      state.groups.find((group) => group.id === stored.assigneeGroupId)?.name ??
      null,
  };
}

function collectSubtree(state: TaskState, rootId: string): string[] {
  const ids = [rootId];
  for (const id of ids)
    for (const ticket of state.tickets.values())
      if (ticket.parentId === id && !ids.includes(ticket.id))
        ids.push(ticket.id);
  return ids;
}

function matchesArchive(
  ticket: WorkItemDetail,
  options: FindWorkItemsOptions,
): boolean {
  const scope = options.archived ?? "active";
  const isArchived = ticket.archivedAt !== null;
  const isListed =
    options.archivedProjectIds === undefined ||
    options.archivedProjectIds.includes(ticket.projectId);
  if (scope === "active") return !isArchived;
  if (scope === "archived") return isArchived && isListed;
  return !isArchived || isListed;
}

function matches(
  ticket: WorkItemDetail,
  options: FindWorkItemsOptions,
): boolean {
  const isInProjects =
    !options.projectIds || options.projectIds.includes(ticket.projectId);
  const hasFields =
    (!options.type || ticket.type === options.type) &&
    (!options.parentId || ticket.parentId === options.parentId) &&
    (!options.milestoneId || ticket.milestoneId === options.milestoneId);
  return (
    matchesArchive(ticket, options) &&
    isTicketVisible(ticket, options.visibility) &&
    isInProjects &&
    hasFields
  );
}

/** Replaces the ticket read methods of the repository prototype. */
export function installTicketReads(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findAllStatuses").mockImplementation(
    async () => state.statuses,
  );
  vi.spyOn(proto, "findStatusById").mockImplementation(
    async (id) => state.statuses.find((entry) => entry.id === id) ?? null,
  );
  vi.spyOn(proto, "findById").mockImplementation(async (id, visibility) => {
    const stored = state.tickets.get(id);
    return stored && isTicketVisible(stored, visibility)
      ? presentTicket(state, stored, visibility)
      : null;
  });
  vi.spyOn(proto, "findByKey").mockImplementation(async (key, visibility) => {
    const stored = [...state.tickets.values()].find(
      (ticket) => ticket.key === key && ticket.archivedAt === null,
    );
    return stored && isTicketVisible(stored, visibility)
      ? presentTicket(state, stored, visibility)
      : null;
  });
  vi.spyOn(proto, "findParentReference").mockImplementation(async (id) => {
    const parentId = state.tickets.get(id)?.parentId ?? null;
    if (parentId === null) return null;
    return { id: parentId, key: state.tickets.get(parentId)?.key ?? null };
  });
  vi.spyOn(proto, "findVisibleKeys").mockImplementation(
    async (keys, visibility) =>
      new Set(
        [...state.tickets.values()]
          .filter(
            (ticket) =>
              keys.includes(ticket.key) && isTicketVisible(ticket, visibility),
          )
          .map((ticket) => ticket.key),
      ),
  );
  installTicketQueries(state);
}

function installTicketQueries(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findSubtasks").mockImplementation(
    async (parentId, visibility) =>
      [...state.tickets.values()]
        .filter(
          (ticket) =>
            ticket.parentId === parentId &&
            ticket.archivedAt === null &&
            isTicketVisible(ticket, visibility),
        )
        .map((ticket) => presentTicket(state, ticket, visibility)),
  );
  vi.spyOn(proto, "findAll").mockImplementation(async (options = {}) =>
    [...state.tickets.values()]
      .filter((ticket) => matches(ticket, options))
      .map((ticket) => presentTicket(state, ticket, options.visibility)),
  );
  vi.spyOn(proto, "countWorkItemsByProject").mockImplementation(
    async (projectIds, visibility) =>
      new Map(
        projectIds.map((projectId) => {
          const tickets = [...state.tickets.values()].filter(
            (ticket) =>
              ticket.projectId === projectId &&
              ticket.archivedAt === null &&
              isTicketVisible(ticket, visibility),
          );
          const done = tickets.filter(
            (ticket) =>
              state.statuses.find((entry) => entry.id === ticket.statusId)
                ?.isDone,
          );
          return [projectId, { done: done.length, total: tickets.length }];
        }),
      ),
  );
}

/** Replaces the ticket write methods that are plain statements. */
export function installTicketWrites(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findOrCreateProjectKey").mockImplementation(
    async (projectId, prefix) => {
      const existing = state.keyPrefixes.get(projectId);
      if (existing) return existing;
      state.keyPrefixes.set(projectId, prefix);
      return prefix;
    },
  );
  vi.spyOn(proto, "reserveNumbers").mockImplementation(
    async (projectId, count) => {
      const first = (state.counters.get(projectId) ?? 0) + 1;
      state.counters.set(projectId, first + count - 1);
      return first;
    },
  );
  vi.spyOn(proto, "insert").mockImplementation(async (item) => {
    state.writes.push("insert");
    state.tickets.set(
      item.id,
      ticketRecord(item.id, {
        ...item,
        projectName: item.projectId,
        reporterName: item.createdBy,
      }),
    );
  });
  vi.spyOn(proto, "updateParent").mockImplementation(async (id, parentId) => {
    state.writes.push("updateParent");
    patch(state, id, { parentId });
  });
  vi.spyOn(proto, "setDepartment").mockImplementation(
    async (id, departmentId) => {
      state.writes.push("setDepartment");
      patch(state, id, { departmentId });
    },
  );
  vi.spyOn(proto, "setGitHubError").mockImplementation(async (id, message) => {
    state.writes.push("setGitHubError");
    patch(state, id, { githubLastError: message });
  });
  vi.spyOn(proto, "moveToProject").mockImplementation(async (id, move) => {
    state.writes.push("moveToProject");
    patch(state, id, { ...move, projectName: move.projectId });
  });
}

/** Replaces a stored ticket with a changed copy. */
export function patch(
  state: TaskState,
  id: string,
  changes: Partial<WorkItemDetail>,
): void {
  const stored = state.tickets.get(id);
  if (!stored) throw new Error(`Unknown synthetic ticket ${id}`);
  state.tickets.set(id, { ...stored, ...changes, updatedAt: RECORD_TIME });
}

function runBeforeWrite(state: TaskState): void {
  const hook = state.beforeWrite;
  state.beforeWrite = null;
  hook?.();
}

/** Replaces the conditional statements that guard against concurrent saves. */
export function installConditionalWrites(state: TaskState): void {
  const proto = TaskRepository.prototype;
  const active = (id: string): WorkItemDetail | null => {
    const stored = state.tickets.get(id);
    return stored && stored.archivedAt === null ? stored : null;
  };
  vi.spyOn(proto, "updateTitle").mockImplementation(
    async (id, title, baseTitle) => {
      runBeforeWrite(state);
      if (active(id)?.title !== baseTitle) return false;
      state.writes.push("updateTitle");
      patch(state, id, { title });
      return true;
    },
  );
  vi.spyOn(proto, "setDepartmentIfCurrent").mockImplementation(
    async (id, departmentId, expected) => {
      runBeforeWrite(state);
      const stored = active(id);
      if (!stored || stored.departmentId !== expected) return false;
      state.writes.push("setDepartmentIfCurrent");
      patch(state, id, { departmentId });
      return true;
    },
  );
  installConditionalProjectMoves(state, active);
  vi.spyOn(proto, "updateStatus").mockImplementation(
    async (id, next, baseStatusId) => {
      runBeforeWrite(state);
      if (active(id)?.statusId !== baseStatusId) return false;
      state.writes.push("updateStatus");
      patch(state, id, { statusId: next.id });
      return true;
    },
  );
  vi.spyOn(proto, "replaceParent").mockImplementation(
    async (id, parentId, baseParentId) => {
      runBeforeWrite(state);
      const stored = active(id);
      if (!stored || stored.parentId !== baseParentId) return false;
      state.writes.push("replaceParent");
      patch(state, id, { parentId });
      return true;
    },
  );
  vi.spyOn(proto, "updateDescription").mockImplementation(
    async (id, description, baseDescription) => {
      runBeforeWrite(state);
      const stored = active(id);
      const isCurrent =
        stored?.description === baseDescription ||
        stored?.description === description;
      if (!stored || !isCurrent) return false;
      state.writes.push("updateDescription");
      patch(state, id, { description });
      return true;
    },
  );
  installFullUpdate(state, active);
}

function installConditionalProjectMoves(
  state: TaskState,
  active: (id: string) => WorkItemDetail | null,
): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "moveSubtreeIfCurrent").mockImplementation(
    async (rootId, moves) => {
      runBeforeWrite(state);
      const ids = [rootId];
      for (const id of ids) {
        for (const candidate of state.tickets.values()) {
          if (candidate.parentId === id && candidate.archivedAt === null)
            ids.push(candidate.id);
        }
      }
      if (
        ids.length !== moves.length ||
        ids.some((id) => !moves.some((move) => move.id === id))
      )
        return false;
      for (const entry of moves) {
        const stored = active(entry.id);
        if (
          !stored ||
          stored.projectId !== entry.expected.projectId ||
          stored.githubIssueNumber !== entry.expected.githubIssueNumber ||
          JSON.stringify(taskUpdateSnapshot(stored)) !==
            JSON.stringify(entry.expected.fields)
        )
          return false;
      }
      for (const entry of moves) {
        state.writes.push("moveSubtreeIfCurrent");
        patch(state, entry.id, {
          ...entry.move,
          projectName: entry.move.projectId,
        });
      }
      return true;
    },
  );
}

function installFullUpdate(
  state: TaskState,
  active: (id: string) => WorkItemDetail | null,
): void {
  vi.spyOn(TaskRepository.prototype, "update").mockImplementation(
    async (id, update) => {
      runBeforeWrite(state);
      const stored = active(id);
      if (!stored) return false;
      const isCurrent =
        update.shouldPreserveDescription === true ||
        update.baseDescription === undefined ||
        stored.description === update.baseDescription ||
        stored.description === update.description;
      if (!isCurrent) return false;
      state.writes.push("update");
      patch(state, id, {
        title: update.title,
        description: update.shouldPreserveDescription
          ? stored.description
          : update.description,
        statusId: update.statusId,
        priority: update.priority,
        assigneeId: update.assigneeId,
        assigneeGroupId: update.assigneeGroupId,
        createdBy: update.reporterId,
        parentId: update.parentId,
        milestoneId: update.milestoneId,
        dueAt: update.dueAt,
        startAt: update.startAt,
      });
      return true;
    },
  );
  vi.spyOn(TaskRepository.prototype, "updateStatusAndOrder").mockImplementation(
    async (id, statusId, sortOrder) => {
      state.writes.push("updateStatusAndOrder");
      patch(state, id, { statusId, sortOrder });
    },
  );
}

/** Replaces the archive, restore and deletion statements of whole subtrees. */
export function installTicketLifecycle(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findSubtreeIds").mockImplementation(async (id, visibility) =>
    collectSubtree(state, id).filter((ticketId) => {
      const stored = state.tickets.get(ticketId);
      return stored && isTicketVisible(stored, visibility);
    }),
  );
  vi.spyOn(proto, "countDescendants").mockImplementation(
    async (id, visibility) => {
      const counts = new Map<string, number>();
      for (const ticketId of collectSubtree(state, id).slice(1)) {
        const stored = state.tickets.get(ticketId);
        if (!stored || !isTicketVisible(stored, visibility)) continue;
        const key = `${stored.type}:${stored.archivedAt === null}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts].map(([key, count]) => {
        const [type = "", active = ""] = key.split(":");
        return { type, isActive: active === "true", count };
      });
    },
  );
  vi.spyOn(proto, "detachChildren").mockImplementation(async (id, scope) => {
    state.writes.push("detachChildren");
    const children = [...state.tickets.values()].filter(
      (ticket) =>
        ticket.parentId === id &&
        (scope === "all" || ticket.archivedAt === null),
    );
    for (const child of children) patch(state, child.id, { parentId: null });
    return children.map((child) => child.id);
  });
  installArchiveStatements(state);
}

function installArchiveStatements(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "archiveMany").mockImplementation(async (ids) => {
    const changed = ids.filter(
      (id) => state.tickets.get(id)?.archivedAt === null,
    );
    for (const id of changed) patch(state, id, { archivedAt: RECORD_TIME });
    if (changed.length > 0) state.writes.push("archiveMany");
    return changed;
  });
  vi.spyOn(proto, "restoreMany").mockImplementation(async (ids) => {
    state.writes.push("restoreMany");
    for (const id of ids) patch(state, id, { archivedAt: null });
  });
  vi.spyOn(proto, "findSubtreeStorageNames").mockImplementation(async (id) =>
    collectSubtree(state, id).flatMap(
      (ticketId) => state.storageNames.get(ticketId) ?? [],
    ),
  );
  vi.spyOn(proto, "deleteSubtree").mockImplementation(async (id) => {
    state.writes.push("deleteSubtree");
    const removed = collectSubtree(state, id);
    for (const ticketId of removed) state.tickets.delete(ticketId);
    return removed;
  });
}

/** Replaces history and eligible assignee reads. */
export function installTicketHistory(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "insertHistory").mockImplementation(async (entry) => {
    state.history.push(entry);
  });
  const present = (entry: TaskState["history"][number]): WorkItemHistory => ({
    ...entry,
    userDisplayName: entry.userId,
    createdAt: RECORD_TIME,
  });
  vi.spyOn(proto, "findHistoryByWorkItemId").mockImplementation(async (id) =>
    state.history.filter((entry) => entry.workItemId === id).map(present),
  );
  vi.spyOn(proto, "findHistoryByProjectId").mockImplementation(
    async (projectId, visibility) =>
      state.history
        .filter((entry) => {
          const stored = state.tickets.get(entry.workItemId);
          return (
            stored?.projectId === projectId &&
            isTicketVisible(stored, visibility)
          );
        })
        .map(present),
  );
  vi.spyOn(proto, "findEligibleAssignees").mockImplementation(
    async () => state.people,
  );
  vi.spyOn(proto, "findEligibleAssigneesByProjectIds").mockImplementation(
    async (ids) => new Map(ids.map((id) => [id, state.people])),
  );
}
