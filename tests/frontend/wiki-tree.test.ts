import { describe, expect, it } from "vitest";

import {
  buildWikiTree,
  findAncestorIds,
  findSubtreeIds,
  slugifyTitle,
  wikiPagePath,
} from "@/app/lib/wiki-tree";

import type { WikiTreeNode } from "@/definition/Wiki";

function node(
  id: string,
  parentId: string | null,
  overrides: Partial<WikiTreeNode> = {},
): WikiTreeNode {
  return {
    currentUntil: null,
    icon: null,
    id,
    parentId,
    position: 1,
    projectId: null,
    scope: "instance",
    title: id,
    ...overrides,
  };
}

describe("buildWikiTree", () => {
  it("groups roots by area and nests children in order", () => {
    const tree = buildWikiTree([
      node("a", null),
      node("a1", "a"),
      node("a2", "a"),
      node("a11", "a1"),
      node("p", null, { projectId: "p1", scope: "project" }),
      node("p2", null, { projectId: "p1", scope: "project" }),
      node("q", null, { projectId: "p2", scope: "project" }),
      node("secret", null, { scope: "private" }),
    ]);

    expect(tree.instanceRoots.map((item) => item.node.id)).toEqual(["a"]);
    expect(tree.instanceRoots[0]?.children.map((c) => c.node.id)).toEqual([
      "a1",
      "a2",
    ]);
    expect(tree.instanceRoots[0]?.children[0]?.children[0]?.node.id).toBe(
      "a11",
    );
    expect(tree.privateRoots.map((item) => item.node.id)).toEqual(["secret"]);
    expect(tree.projectRoots.get("p1")?.map((item) => item.node.id)).toEqual([
      "p",
      "p2",
    ]);
    expect(tree.projectRoots.get("p2")).toHaveLength(1);
  });

  it("builds empty areas from no pages", () => {
    const tree = buildWikiTree([]);

    expect(tree.instanceRoots).toEqual([]);
    expect(tree.privateRoots).toEqual([]);
  });

  it("treats a page without a listed parent as a root", () => {
    const tree = buildWikiTree([node("orphan", "gone")]);

    expect(tree.instanceRoots.map((item) => item.node.id)).toEqual(["orphan"]);
  });

  it("ignores project pages that name no project", () => {
    const tree = buildWikiTree([node("x", null, { scope: "project" })]);

    expect(tree.projectRoots.size).toBe(0);
  });
});

describe("tree lookups", () => {
  const nodes = [
    node("a", null),
    node("b", "a"),
    node("c", "b"),
    node("d", "a"),
  ];

  it("lists ancestors nearest first", () => {
    expect(findAncestorIds(nodes, "c")).toEqual(["b", "a"]);
    expect(findAncestorIds(nodes, "a")).toEqual([]);
    expect(findAncestorIds(nodes, "unknown")).toEqual([]);
  });

  it("stops at a cycle", () => {
    expect(findAncestorIds([node("x", "y"), node("y", "x")], "x")).toEqual([
      "y",
      "x",
    ]);
  });

  it("lists a subtree with its root first", () => {
    expect(findSubtreeIds(nodes, "a")).toEqual(["a", "b", "d", "c"]);
    expect(findSubtreeIds(nodes, "c")).toEqual(["c"]);
  });
});

describe("addresses", () => {
  it("builds readable slugs", () => {
    expect(slugifyTitle("Größe & Übung: Plan 2026!")).toBe(
      "grosse-ubung-plan-2026",
    );
    expect(slugifyTitle("!!!")).toBe("");
    expect(slugifyTitle("x".repeat(100))).toHaveLength(60);
  });

  it("appends the slug only when there is one", () => {
    expect(wikiPagePath("abc")).toBe("/wiki/abc");
    expect(wikiPagePath("abc", "***")).toBe("/wiki/abc");
    expect(wikiPagePath("abc", "Hello World")).toBe("/wiki/abc/hello-world");
  });
});
