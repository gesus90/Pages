import type { WikiTreeNode } from "@/definition/Wiki";

/** A page of the navigation together with its children. */
export interface WikiTreeItem {
  readonly node: WikiTreeNode;
  readonly children: readonly WikiTreeItem[];
}

/** The pages of the navigation, grouped by the area they live in. */
export interface WikiTreeAreas {
  readonly privateRoots: readonly WikiTreeItem[];
  readonly instanceRoots: readonly WikiTreeItem[];
  /** Root pages by project identifier. */
  readonly projectRoots: ReadonlyMap<string, readonly WikiTreeItem[]>;
}

/**
 * Builds the page trees from the flat list the server sends.
 *
 * @param nodes - Visible pages in sibling order.
 * @returns The roots of each area with their children.
 *
 * @remarks
 * A page whose parent is not in the list becomes a root, which only happens
 * when the server hides the parent; the server never sends such pages.
 */
export function buildWikiTree(nodes: readonly WikiTreeNode[]): WikiTreeAreas {
  const ids = new Set(nodes.map((node) => node.id));
  const childrenOf = new Map<string | null, WikiTreeNode[]>();

  for (const node of nodes) {
    const parent =
      node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;

    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), node]);
  }

  const toItem = (node: WikiTreeNode): WikiTreeItem => ({
    children: (childrenOf.get(node.id) ?? []).map(toItem),
    node,
  });
  const roots = (childrenOf.get(null) ?? []).map(toItem);
  const projectRoots = new Map<string, WikiTreeItem[]>();

  for (const item of roots) {
    if (item.node.scope === "project" && item.node.projectId !== null) {
      projectRoots.set(item.node.projectId, [
        ...(projectRoots.get(item.node.projectId) ?? []),
        item,
      ]);
    }
  }

  return {
    instanceRoots: roots.filter((item) => item.node.scope === "instance"),
    privateRoots: roots.filter((item) => item.node.scope === "private"),
    projectRoots,
  };
}

/**
 * Lists the pages from a page up to its root.
 *
 * @param nodes - Visible pages.
 * @param id - Page identifier.
 * @returns The identifiers of the ancestors, nearest first.
 */
export function findAncestorIds(
  nodes: readonly WikiTreeNode[],
  id: string,
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestors: string[] = [];
  let current = byId.get(id)?.parentId ?? null;

  while (current !== null && !ancestors.includes(current)) {
    ancestors.push(current);
    current = byId.get(current)?.parentId ?? null;
  }

  return ancestors;
}

/**
 * Lists a page and everything below it.
 *
 * @param nodes - Visible pages.
 * @param id - Page identifier.
 * @returns The identifiers, the page first.
 */
export function findSubtreeIds(
  nodes: readonly WikiTreeNode[],
  id: string,
): string[] {
  const found = [id];

  for (const parentId of found) {
    for (const node of nodes) {
      if (node.parentId === parentId && !found.includes(node.id)) {
        found.push(node.id);
      }
    }
  }

  return found;
}

/**
 * Turns a title into the readable ending of a page address.
 *
 * @param title - Page title.
 * @returns Lower-case words joined by hyphens; empty when nothing is left.
 */
export function slugifyTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Builds the address of a page.
 *
 * @param id - Page identifier.
 * @param title - Page title; its slug is appended when it has one.
 * @returns The path below the wiki.
 */
export function wikiPagePath(id: string, title?: string): string {
  const slug = title === undefined ? "" : slugifyTitle(title);

  return slug === "" ? `/wiki/${id}` : `/wiki/${id}/${slug}`;
}
