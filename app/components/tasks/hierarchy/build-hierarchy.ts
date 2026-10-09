import { buildTicketTree } from "@/app/lib/ticket-tree";

import type { TicketTreeGroup, TicketTreeTicket } from "@/app/lib/ticket-tree";
import type { WorkItemDetail } from "@/definition/Task";

/** A work item together with its nested children and rolled-up progress. */
export interface HierarchyNode {
  readonly item: WorkItemDetail;
  readonly children: readonly HierarchyNode[];
  readonly progress: number;
}

/**
 * A part of the hierarchy view: the initiatives of a project, or one group
 * of tickets without a parent of the level above.
 */
export interface HierarchySection {
  readonly key: string;
  /** Name of the project, given when tickets of several projects are shown. */
  readonly projectName: string | null;
  readonly group: TicketTreeGroup | null;
  readonly nodes: readonly HierarchyNode[];
}

function toNode(ticket: TicketTreeTicket<WorkItemDetail>): HierarchyNode {
  const children = ticket.children.map(toNode);
  const progress =
    children.length === 0
      ? ticket.entry.progressPercentage
      : Math.round(
          children.reduce((total, child) => total + child.progress, 0) /
            children.length,
        );

  return { children, item: ticket.entry, progress };
}

/**
 * Groups work items into the four-level tree the sidebar shows as well
 * (A8.2-E09), with rolled-up progress.
 *
 * @param workItems - Flat work items, already filtered by the task filters.
 * @returns Per project its initiatives, then the groups of tickets without
 * a visible parent; every work item appears exactly once.
 */
export function buildHierarchy(
  workItems: readonly WorkItemDetail[],
): HierarchySection[] {
  const projects = buildTicketTree(workItems);
  const isSeveral = projects.length > 1;

  return projects.flatMap((project) => {
    const projectName = isSeveral ? project.projectName : null;
    const initiatives = project.nodes.flatMap((node) =>
      node.kind === "ticket" ? [toNode(node)] : [],
    );
    const groups = project.nodes.flatMap((node) =>
      node.kind === "group"
        ? [
            {
              group: node.group,
              key: node.key,
              nodes: node.children.map(toNode),
              projectName,
            },
          ]
        : [],
    );

    return [
      ...(initiatives.length > 0
        ? [{ group: null, key: project.key, nodes: initiatives, projectName }]
        : []),
      ...groups,
    ];
  });
}
