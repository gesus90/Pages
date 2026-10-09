import { WORK_ITEM_PARENT_TYPE, WORK_ITEM_TYPE } from "@/definition/Task";

import type { TicketTreeEntry, WorkItemType } from "@/definition/Task";

/** The id under which ticket pages find the tree data of their layout route. */
export const TICKET_LAYOUT_ROUTE_ID = "routes/tasks-layout";

/**
 * A group for tickets whose parent level is missing or not visible: epics
 * without initiative, tasks without epic, and subtasks whose task is hidden.
 */
export type TicketTreeGroup = "no-initiative" | "no-epic" | "no-task";

/** What the tree needs of a ticket; board items and tree entries both fit. */
export type TicketTreeSource = Pick<
  TicketTreeEntry,
  "id" | "parentId" | "type" | "projectId" | "projectName"
>;

/** A ticket of the tree with the tickets below it. */
export interface TicketTreeTicket<T extends TicketTreeSource> {
  readonly kind: "ticket";
  /** The ticket id, which also keys its open state. */
  readonly key: string;
  readonly entry: T;
  readonly children: readonly TicketTreeTicket<T>[];
}

/** A group of tickets without a parent of the level above. */
export interface TicketTreeGroupNode<T extends TicketTreeSource> {
  readonly kind: "group";
  /** `<group>:<project id>`, which keys its open state. */
  readonly key: string;
  readonly group: TicketTreeGroup;
  readonly children: readonly TicketTreeTicket<T>[];
}

/** A top-level entry of a project: an initiative or a group. */
export type TicketTreeNode<T extends TicketTreeSource> =
  TicketTreeTicket<T> | TicketTreeGroupNode<T>;

/** The tree of one project. */
export interface TicketTreeProject<T extends TicketTreeSource> {
  /** `project:<id>`, which keys its open state. */
  readonly key: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly nodes: readonly TicketTreeNode<T>[];
}

const GROUP_OF_TYPE: Readonly<Record<WorkItemType, TicketTreeGroup | null>> = {
  [WORK_ITEM_TYPE.INITIATIVE]: null,
  [WORK_ITEM_TYPE.EPIC]: "no-initiative",
  [WORK_ITEM_TYPE.TASK]: "no-epic",
  [WORK_ITEM_TYPE.SUBTASK]: "no-task",
};

const GROUP_ORDER: readonly TicketTreeGroup[] = [
  "no-initiative",
  "no-epic",
  "no-task",
];

/**
 * The key of a group of a project.
 *
 * @param group - The group.
 * @param projectId - The project.
 * @returns The key under which the open state of the group is kept.
 */
export function groupKey(group: TicketTreeGroup, projectId: string): string {
  return `${group}:${projectId}`;
}

/**
 * The key of a project of the tree.
 *
 * @param projectId - The project.
 * @returns The key under which the open state of the project is kept.
 */
export function projectKey(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * Finds the parent a ticket hangs below in the tree: only a ticket of the
 * level right above in the same project, so a broken relation can neither
 * hide a ticket nor form a loop.
 */
function findTreeParent<T extends TicketTreeSource>(
  entry: T,
  byId: ReadonlyMap<string, T>,
): T | null {
  const parent = entry.parentId === null ? undefined : byId.get(entry.parentId);

  return parent &&
    parent.projectId === entry.projectId &&
    parent.type === WORK_ITEM_PARENT_TYPE[entry.type]
    ? parent
    : null;
}

/**
 * Builds the four-level tree Initiative → Epic → Task → Subtask.
 *
 * @param entries - Tickets in the order they are shown, from any projects.
 * @returns One tree per project in order of appearance: its initiatives, then
 * the groups of tickets without a visible parent. Every ticket appears
 * exactly once.
 */
export function buildTicketTree<T extends TicketTreeSource>(
  entries: readonly T[],
): TicketTreeProject<T>[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const childrenOf = new Map<string, T[]>();
  const orphansByProject = new Map<
    string,
    { readonly projectName: string; readonly orphans: T[] }
  >();

  for (const entry of entries) {
    const parent = findTreeParent(entry, byId);
    const project = orphansByProject.get(entry.projectId);

    if (parent) {
      childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), entry]);
    } else if (project) {
      project.orphans.push(entry);
    } else {
      orphansByProject.set(entry.projectId, {
        orphans: [entry],
        projectName: entry.projectName,
      });
    }
  }

  function toTicket(entry: T): TicketTreeTicket<T> {
    return {
      children: (childrenOf.get(entry.id) ?? []).map(toTicket),
      entry,
      key: entry.id,
      kind: "ticket",
    };
  }

  return [...orphansByProject].map(([projectId, { orphans, projectName }]) => {
    const groups: TicketTreeGroupNode<T>[] = GROUP_ORDER.map((group) => ({
      children: orphans
        .filter((entry) => GROUP_OF_TYPE[entry.type] === group)
        .map(toTicket),
      group,
      key: groupKey(group, projectId),
      kind: "group" as const,
    })).filter((node) => node.children.length > 0);

    return {
      key: projectKey(projectId),
      nodes: [
        ...orphans
          .filter((entry) => GROUP_OF_TYPE[entry.type] === null)
          .map(toTicket),
        ...groups,
      ],
      projectId,
      projectName,
    };
  });
}

/**
 * Finds the keys of everything above a ticket: its project, its group and
 * its ancestors, so the open ticket can be shown.
 *
 * @param entries - The tickets of the tree.
 * @param ticketId - The ticket to show, or `null`.
 * @returns The keys to open; empty when the ticket is not in the tree.
 */
export function findTreePath<T extends TicketTreeSource>(
  entries: readonly T[],
  ticketId: string | null,
): string[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const keys: string[] = [];
  let current = ticketId === null ? undefined : byId.get(ticketId);

  if (!current) {
    return keys;
  }

  keys.push(projectKey(current.projectId));

  for (;;) {
    const parent: T | null = findTreeParent(current, byId);

    if (!parent) {
      const group = GROUP_OF_TYPE[current.type];

      return group ? [...keys, groupKey(group, current.projectId)] : keys;
    }

    keys.push(parent.id);
    current = parent;
  }
}
