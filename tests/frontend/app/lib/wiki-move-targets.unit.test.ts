import { describe, expect, it } from "vitest";

import {
  formatMoveTarget,
  listMoveTargets,
  parseMoveTarget,
} from "@/app/lib/wiki-move-targets";

import type { WikiMoveRequest } from "@/app/components/wiki/use-wiki-drag";
import type {
  WikiNavigation,
  WikiScope,
  WikiTreeNode,
} from "@/definition/Wiki";

function node(
  id: string,
  parentId: string | null,
  scope: WikiScope = "instance",
  projectId: string | null = null,
): WikiTreeNode {
  return {
    id,
    parentId,
    title: id.toUpperCase(),
    icon: null,
    scope,
    projectId,
    position: 0,
    currentUntil: null,
  };
}

function navigation(nodes: WikiTreeNode[]): WikiNavigation {
  return {
    nodes,
    projects: [{ id: "p1", name: "Apollo" }],
    favoriteIds: [],
    expandedIds: [],
    recent: [],
    canCreate: true,
  };
}

const LABELS = {
  privateRoot: "Private",
  generalRoot: "General",
  projectRoot: (name: string): string => `Project ${name}`,
};

function request(overrides: Partial<WikiMoveRequest>): WikiMoveRequest {
  return {
    pageId: "page",
    from: { scope: "instance", projectId: null },
    parentId: null,
    scope: "instance",
    projectId: null,
    beforeId: null,
    ...overrides,
  };
}

describe("listing move targets", () => {
  it("offers the three kinds of roots first, then every page with its depth marked", () => {
    const targets = listMoveTargets(
      navigation([
        node("mine", null, "private"),
        node("home", null),
        node("child", "home"),
        node("grandchild", "child"),
        node("plan", null, "project", "p1"),
      ]),
      "unrelated",
      LABELS,
    );

    expect(targets).toEqual([
      { label: "Private", value: "root:private" },
      { label: "General", value: "root:instance" },
      { label: "Project Apollo", value: "root:project:p1" },
      { label: "MINE", value: "page:mine" },
      { label: "HOME", value: "page:home" },
      { label: "– CHILD", value: "page:child" },
      { label: "– – GRANDCHILD", value: "page:grandchild" },
      { label: "PLAN", value: "page:plan" },
    ]);
  });

  it("leaves out the moved page and everything below it", () => {
    const targets = listMoveTargets(
      navigation([
        node("home", null),
        node("child", "home"),
        node("deep", "child"),
        node("other", null),
      ]),
      "child",
      LABELS,
    );

    expect(targets.map((target) => target.value)).toEqual([
      "root:private",
      "root:instance",
      "root:project:p1",
      "page:home",
      "page:other",
    ]);
  });
});

describe("move targets as values", () => {
  it("formats a parent page, an area root and a project root", () => {
    expect(formatMoveTarget(request({ parentId: "abc" }))).toBe("page:abc");
    expect(formatMoveTarget(request({ scope: "private" }))).toBe(
      "root:private",
    );
    expect(formatMoveTarget(request({ scope: "instance" }))).toBe(
      "root:instance",
    );
    expect(
      formatMoveTarget(request({ scope: "project", projectId: "p1" })),
    ).toBe("root:project:p1");
  });

  it("parses the values it formats", () => {
    expect(parseMoveTarget("page:abc")).toEqual({
      parentId: "abc",
      projectId: null,
      scope: "instance",
    });
    expect(parseMoveTarget("root:private")).toEqual({
      parentId: null,
      projectId: null,
      scope: "private",
    });
    expect(parseMoveTarget("root:instance")).toEqual({
      parentId: null,
      projectId: null,
      scope: "instance",
    });
    expect(parseMoveTarget("root:project:p1")).toEqual({
      parentId: null,
      projectId: "p1",
      scope: "project",
    });
  });

  it("falls back to the general area for an unknown root", () => {
    expect(parseMoveTarget("root:elsewhere")).toEqual({
      parentId: null,
      projectId: null,
      scope: "instance",
    });
  });
});
