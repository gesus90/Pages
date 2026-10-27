import { describe, expect, it } from "vitest";

import {
  buildWikiTree,
  findAncestorIds,
  findSubtreeIds,
  slugifyTitle,
  wikiPagePath,
} from "@/app/lib/wiki-tree";

import type { WikiScope, WikiTreeNode } from "@/definition/Wiki";

function node(
  id: string,
  parentId: string | null,
  scope: WikiScope = "instance",
  projectId: string | null = null,
): WikiTreeNode {
  return {
    id,
    parentId,
    title: id,
    icon: null,
    scope,
    projectId,
    position: 0,
    currentUntil: null,
  };
}

describe("building the wiki tree", () => {
  it("builds empty areas without any page", () => {
    const areas = buildWikiTree([]);

    expect(areas.privateRoots).toEqual([]);
    expect(areas.instanceRoots).toEqual([]);
    expect(areas.projectRoots.size).toBe(0);
  });

  it("separates private, instance and project roots", () => {
    const areas = buildWikiTree([
      node("mine", null, "private"),
      node("shared", null, "instance"),
      node("p1-root", null, "project", "p1"),
      node("p1-second", null, "project", "p1"),
      node("p2-root", null, "project", "p2"),
    ]);

    expect(areas.privateRoots.map((item) => item.node.id)).toEqual(["mine"]);
    expect(areas.instanceRoots.map((item) => item.node.id)).toEqual(["shared"]);
    expect([...areas.projectRoots.keys()]).toEqual(["p1", "p2"]);
    expect(areas.projectRoots.get("p1")?.map((item) => item.node.id)).toEqual([
      "p1-root",
      "p1-second",
    ]);
  });

  it("nests children below their parent in the given order", () => {
    const areas = buildWikiTree([
      node("root", null),
      node("b", "root"),
      node("a", "root"),
      node("deep", "a"),
    ]);

    const [root] = areas.instanceRoots;
    expect(root?.children.map((item) => item.node.id)).toEqual(["b", "a"]);
    expect(root?.children[1]?.children.map((item) => item.node.id)).toEqual([
      "deep",
    ]);
  });

  it("promotes a page whose parent is not visible to a root and skips project roots without a project", () => {
    const areas = buildWikiTree([
      node("hidden-child", "hidden-parent"),
      node("lost", null, "project", null),
    ]);

    expect(areas.instanceRoots.map((item) => item.node.id)).toEqual([
      "hidden-child",
    ]);
    expect(areas.projectRoots.size).toBe(0);
    expect(areas.privateRoots).toEqual([]);
  });
});

describe("walking the wiki tree", () => {
  const nodes = [
    node("root", null),
    node("child", "root"),
    node("grandchild", "child"),
    node("sibling", "root"),
    node("loop-a", "loop-b"),
    node("loop-b", "loop-a"),
  ];

  it("lists the ancestors from the parent upward", () => {
    expect(findAncestorIds(nodes, "grandchild")).toEqual(["child", "root"]);
    expect(findAncestorIds(nodes, "root")).toEqual([]);
    expect(findAncestorIds(nodes, "unknown")).toEqual([]);
  });

  it("stops at a cycle in the parent chain", () => {
    expect(findAncestorIds(nodes, "loop-a")).toEqual(["loop-b", "loop-a"]);
  });

  it("lists a page and all of its descendants, each once", () => {
    expect(findSubtreeIds(nodes, "root")).toEqual([
      "root",
      "child",
      "sibling",
      "grandchild",
    ]);
    expect(findSubtreeIds(nodes, "grandchild")).toEqual(["grandchild"]);
    expect(findSubtreeIds(nodes, "loop-a")).toEqual(["loop-a", "loop-b"]);
  });
});

describe("page addresses", () => {
  it.each([
    { title: "Hello World", slug: "hello-world" },
    { title: "Größe & Maß", slug: "grosse-mass" },
    { title: "Café Ünïcode", slug: "cafe-unicode" },
    { title: "  --Trim me--  ", slug: "trim-me" },
    { title: "日本語 タイトル", slug: "日本語-タイトル" },
    { title: "***", slug: "" },
    { title: "x".repeat(80), slug: "x".repeat(60) },
  ])("turns “$title” into “$slug”", ({ title, slug }) => {
    expect(slugifyTitle(title)).toBe(slug);
  });

  it("appends the slug when the title gives one", () => {
    expect(wikiPagePath("p1", "Hello World")).toBe("/wiki/p1/hello-world");
    expect(wikiPagePath("p1", "***")).toBe("/wiki/p1");
    expect(wikiPagePath("p1")).toBe("/wiki/p1");
  });
});
