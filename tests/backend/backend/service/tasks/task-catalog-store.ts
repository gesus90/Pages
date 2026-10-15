import { vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";

import { RECORD_TIME } from "./task-records";
import { isTicketVisible } from "./task-ticket-store";

import type { WorkItemLink } from "@/definition/Task";
import type { TaskState } from "./task-records";

/** Replaces the label and checklist methods of the repository prototype. */
export function installLabelStore(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findLabels").mockImplementation(async () =>
    [...state.labels.values()].sort((a, b) => a.name.localeCompare(b.name)),
  );
  vi.spyOn(proto, "findLabelById").mockImplementation(
    async (id) => state.labels.get(id) ?? null,
  );
  vi.spyOn(proto, "findLabelByName").mockImplementation(
    async (name) =>
      [...state.labels.values()].find(
        (label) => label.name.toLowerCase() === name.toLowerCase(),
      ) ?? null,
  );
  vi.spyOn(proto, "insertLabel").mockImplementation(async (label) => {
    state.writes.push("insertLabel");
    state.labels.set(label.id, {
      ...label,
      createdAt: RECORD_TIME,
      updatedAt: RECORD_TIME,
    });
  });
  vi.spyOn(proto, "updateLabel").mockImplementation(async (id, update) => {
    state.writes.push("updateLabel");
    const stored = state.labels.get(id);
    if (stored) state.labels.set(id, { ...stored, ...update });
  });
  vi.spyOn(proto, "deleteLabel").mockImplementation(async (id) => {
    state.writes.push("deleteLabel");
    state.labels.delete(id);
    for (const assigned of state.assignedLabels.values()) assigned.delete(id);
  });
  installLabelAssignments(state);
}

function installLabelAssignments(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "assignLabel").mockImplementation(
    async (workItemId, labelId) => {
      state.writes.push("assignLabel");
      const assigned = state.assignedLabels.get(workItemId) ?? new Set();
      assigned.add(labelId);
      state.assignedLabels.set(workItemId, assigned);
    },
  );
  vi.spyOn(proto, "unassignLabel").mockImplementation(
    async (workItemId, labelId) => {
      state.writes.push("unassignLabel");
      state.assignedLabels.get(workItemId)?.delete(labelId);
    },
  );
  vi.spyOn(proto, "findLabelsForWorkItemIds").mockImplementation(
    async (ids) =>
      new Map(
        ids.map((id) => [
          id,
          [...(state.assignedLabels.get(id) ?? [])].flatMap((labelId) => {
            const label = state.labels.get(labelId);
            return label ? [label] : [];
          }),
        ]),
      ),
  );
  vi.spyOn(proto, "countLabelUsageByLabel").mockImplementation(
    async (visibility) => {
      const usage = new Map<string, number>();
      for (const [ticketId, labelIds] of state.assignedLabels) {
        const stored = state.tickets.get(ticketId);
        if (!stored || !isTicketVisible(stored, visibility)) continue;
        for (const labelId of labelIds)
          usage.set(labelId, (usage.get(labelId) ?? 0) + 1);
      }
      return usage;
    },
  );
}

/** Replaces the checklist, link and group methods of the repository prototype. */
export function installChecklistAndLinks(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findChecklistItemsByWorkItemId").mockImplementation(
    async (id) =>
      state.checklist
        .filter((item) => item.workItemId === id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
  );
  vi.spyOn(proto, "findChecklistItemById").mockImplementation(
    async (id) => state.checklist.find((item) => item.id === id) ?? null,
  );
  vi.spyOn(proto, "insertChecklistItem").mockImplementation(async (item) => {
    state.writes.push("insertChecklistItem");
    const siblings = state.checklist.filter(
      (entry) => entry.workItemId === item.workItemId,
    );
    state.checklist.push({
      ...item,
      isDone: false,
      sortOrder: siblings.length + 1,
      createdAt: RECORD_TIME,
      updatedAt: RECORD_TIME,
    });
  });
  vi.spyOn(proto, "updateChecklistItem").mockImplementation(
    async (id, update) => {
      state.writes.push("updateChecklistItem");
      state.checklist = state.checklist.map((item) =>
        item.id === id ? { ...item, ...update } : item,
      );
    },
  );
  vi.spyOn(proto, "deleteChecklistItem").mockImplementation(async (id) => {
    state.writes.push("deleteChecklistItem");
    state.checklist = state.checklist.filter((item) => item.id !== id);
  });
  installLinkStore(state);
  installGroupStore(state);
}

function installLinkStore(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findLinksByWorkItemId").mockImplementation(
    async (workItemId, visibility) =>
      state.links.flatMap((link): WorkItemLink[] => {
        const isOutgoing = link.workItemId === workItemId;
        if (!isOutgoing && link.linkedWorkItemId !== workItemId) return [];
        const otherId = isOutgoing ? link.linkedWorkItemId : link.workItemId;
        const other = state.tickets.get(otherId);
        if (!other || !isTicketVisible(other, visibility)) return [];
        const status = state.statuses.find(
          (entry) => entry.id === other.statusId,
        );
        return [
          {
            id: link.id,
            linkType: link.linkType,
            direction: isOutgoing ? "outgoing" : "incoming",
            linkedWorkItemId: other.id,
            linkedWorkItemKey: other.key,
            linkedWorkItemTitle: other.title,
            linkedWorkItemStatusKey: status?.key ?? "",
            linkedWorkItemIsDone: status?.isDone ?? false,
            createdAt: RECORD_TIME,
          },
        ];
      }),
  );
  vi.spyOn(proto, "findLinkById").mockImplementation(
    async (id) => state.links.find((link) => link.id === id) ?? null,
  );
  vi.spyOn(proto, "insertLink").mockImplementation(async (link) => {
    state.writes.push("insertLink");
    state.links.push(link);
  });
  vi.spyOn(proto, "deleteLink").mockImplementation(async (id) => {
    state.writes.push("deleteLink");
    state.links = state.links.filter((link) => link.id !== id);
  });
}

function installGroupStore(state: TaskState): void {
  const proto = TaskRepository.prototype;
  vi.spyOn(proto, "findAssigneeGroups").mockImplementation(async () =>
    state.groups.map((group) => ({
      id: group.id,
      name: group.name,
      memberCount: group.memberIds.length,
    })),
  );
  vi.spyOn(proto, "findAssigneeGroupsWithMembers").mockImplementation(
    async () => state.groups,
  );
  vi.spyOn(proto, "findAssigneeGroupById").mockImplementation(async (id) => {
    const group = state.groups.find((entry) => entry.id === id);
    return group
      ? { id: group.id, name: group.name, memberCount: group.memberIds.length }
      : null;
  });
  vi.spyOn(proto, "findGroupIdsByMember").mockImplementation(async (userId) =>
    state.groups
      .filter((group) => group.memberIds.includes(userId))
      .map((group) => group.id),
  );
}
