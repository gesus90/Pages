import { findSubtreeIds } from "@/app/lib/wiki-tree";
import { buildWikiTree } from "@/app/lib/wiki-tree";

import type { WikiTreeItem } from "@/app/lib/wiki-tree";
import type { WikiMoveRequest } from "@/app/components/wiki/use-wiki-drag";
import type { WikiNavigation } from "@/definition/Wiki";

/** One place a page can be moved to, for a select. */
export interface MoveTargetOption {
  readonly value: string;
  readonly label: string;
}

const ROOT_PREFIX = "root:";
const PAGE_PREFIX = "page:";

function listPageOptions(
  items: readonly WikiTreeItem[],
  excluded: ReadonlySet<string>,
  depth: number,
): MoveTargetOption[] {
  return items.flatMap((item) =>
    excluded.has(item.node.id)
      ? []
      : [
          {
            label: `${"– ".repeat(depth)}${item.node.title}`,
            value: `${PAGE_PREFIX}${item.node.id}`,
          },
          ...listPageOptions(item.children, excluded, depth + 1),
        ],
  );
}

/**
 * Lists the places a page can go: the top of each area and every page that
 * is not the page itself or below it.
 *
 * @param navigation - The visible pages and projects.
 * @param pageId - The page to move.
 * @param labels - Texts for the top of each area.
 * @returns The options in tree order.
 */
export function listMoveTargets(
  navigation: WikiNavigation,
  pageId: string,
  labels: {
    readonly privateRoot: string;
    readonly generalRoot: string;
    readonly projectRoot: (name: string) => string;
  },
): MoveTargetOption[] {
  const tree = buildWikiTree(navigation.nodes);
  const excluded = new Set(findSubtreeIds(navigation.nodes, pageId));

  return [
    { label: labels.privateRoot, value: `${ROOT_PREFIX}private` },
    { label: labels.generalRoot, value: `${ROOT_PREFIX}instance` },
    ...navigation.projects.map((project) => ({
      label: labels.projectRoot(project.name),
      value: `${ROOT_PREFIX}project:${project.id}`,
    })),
    ...listPageOptions(
      [
        ...tree.privateRoots,
        ...tree.instanceRoots,
        ...[...tree.projectRoots.values()].flat(),
      ],
      excluded,
      0,
    ),
  ];
}

/**
 * Writes the target of a move request as an option value.
 *
 * @param request - The move.
 * @returns The value of the option that stands for the target.
 */
export function formatMoveTarget(request: WikiMoveRequest): string {
  if (request.parentId !== null) {
    return `${PAGE_PREFIX}${request.parentId}`;
  }

  return request.scope === "project"
    ? `${ROOT_PREFIX}project:${request.projectId}`
    : `${ROOT_PREFIX}${request.scope}`;
}

/**
 * Reads an option value back into the fields of a move request.
 *
 * @param value - Option value written by this module.
 * @returns Parent, scope and project. Below a page the scope and project
 * stay empty, because the parent decides them.
 */
export function parseMoveTarget(
  value: string,
): Pick<WikiMoveRequest, "parentId" | "projectId" | "scope"> {
  if (value.startsWith(PAGE_PREFIX)) {
    return {
      parentId: value.slice(PAGE_PREFIX.length),
      projectId: null,
      scope: "instance",
    };
  }

  const area = value.slice(ROOT_PREFIX.length);

  if (area.startsWith("project:")) {
    return {
      parentId: null,
      projectId: area.slice("project:".length),
      scope: "project",
    };
  }

  return {
    parentId: null,
    projectId: null,
    scope: area === "private" ? "private" : "instance",
  };
}
