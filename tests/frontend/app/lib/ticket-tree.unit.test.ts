import { describe, expect, it } from "vitest";

import {
  TICKET_LAYOUT_ROUTE_ID,
  buildTicketTree,
  findTreePath,
  groupKey,
  projectKey,
} from "@/app/lib/ticket-tree";

import type { TicketTreeSource } from "@/app/lib/ticket-tree";
import type { WorkItemType } from "@/definition/Task";

function entry(
  id: string,
  type: WorkItemType,
  parentId: string | null,
  projectId = "p1",
): TicketTreeSource {
  return { id, type, parentId, projectId, projectName: `Project ${projectId}` };
}

describe("ticket tree keys", () => {
  it("builds stable keys for projects and groups", () => {
    expect(projectKey("p1")).toBe("project:p1");
    expect(groupKey("no-epic", "p1")).toBe("no-epic:p1");
    expect(TICKET_LAYOUT_ROUTE_ID).toBe("routes/tasks-layout");
  });
});

describe("building the ticket tree", () => {
  it("nests subtask below task below epic below initiative", () => {
    const tree = buildTicketTree([
      entry("sub", "subtask", "task"),
      entry("task", "task", "epic"),
      entry("epic", "epic", "init"),
      entry("init", "initiative", null),
    ]);

    expect(tree).toHaveLength(1);
    const [project] = tree;
    expect(project).toMatchObject({
      key: "project:p1",
      projectId: "p1",
      projectName: "Project p1",
    });
    const [initiative] = project?.nodes ?? [];
    expect(initiative).toMatchObject({ kind: "ticket", key: "init" });
    const epic = initiative?.kind === "ticket" ? initiative.children[0] : null;
    const task = epic?.children[0];
    expect(epic?.key).toBe("epic");
    expect(task?.key).toBe("task");
    expect(task?.children.map((child) => child.key)).toEqual(["sub"]);
  });

  it("collects tickets without a valid parent in a group per missing level", () => {
    const tree = buildTicketTree([
      entry("epic", "epic", null),
      entry("task", "task", null),
      entry("sub", "subtask", null),
      entry("init", "initiative", null),
    ]);

    const nodes = tree[0]?.nodes ?? [];
    expect(nodes.map((node) => node.key)).toEqual([
      "init",
      "no-initiative:p1",
      "no-epic:p1",
      "no-task:p1",
    ]);
    expect(nodes.map((node) => node.kind)).toEqual([
      "ticket",
      "group",
      "group",
      "group",
    ]);
    const group = nodes[1];
    expect(group?.kind === "group" && group.group).toBe("no-initiative");
    expect(
      group?.kind === "group" && group.children.map((child) => child.key),
    ).toEqual(["epic"]);
  });

  it("treats a parent of the wrong type, of another project or a missing one as no parent", () => {
    const tree = buildTicketTree([
      entry("epic", "epic", null),
      entry("wrongType", "task", "init"),
      entry("init", "initiative", null),
      entry("elsewhere", "task", "epic2", "p1"),
      entry("epic2", "epic", null, "p2"),
      entry("dangling", "subtask", "gone"),
    ]);

    expect(tree.map((project) => project.projectId)).toEqual(["p1", "p2"]);
    const keys = tree[0]?.nodes.map((node) => node.key);
    expect(keys).toEqual([
      "init",
      "no-initiative:p1",
      "no-epic:p1",
      "no-task:p1",
    ]);
  });

  it("builds nothing without tickets and omits empty groups", () => {
    expect(buildTicketTree([])).toEqual([]);
    expect(
      buildTicketTree([entry("init", "initiative", null)])[0]?.nodes,
    ).toHaveLength(1);
  });

  it("keeps a project's tickets together even when other projects interleave", () => {
    const tree = buildTicketTree([
      entry("a", "initiative", null, "p1"),
      entry("b", "initiative", null, "p2"),
      entry("c", "initiative", null, "p1"),
    ]);

    expect(tree.map((project) => project.projectId)).toEqual(["p1", "p2"]);
    expect(tree[0]?.nodes.map((node) => node.key)).toEqual(["a", "c"]);
  });
});

describe("finding the path to a ticket", () => {
  const entries = [
    entry("init", "initiative", null),
    entry("epic", "epic", "init"),
    entry("task", "task", "epic"),
    entry("orphan", "task", null),
    entry("initiativeless", "epic", null),
    entry("sub", "subtask", "gone"),
  ];

  it("lists the project and every ancestor from the root down to the parent", () => {
    expect(findTreePath(entries, "task")).toEqual([
      "project:p1",
      "epic",
      "init",
    ]);
    expect(findTreePath(entries, "epic")).toEqual(["project:p1", "init"]);
  });

  it("ends with the group of a ticket without a valid parent", () => {
    expect(findTreePath(entries, "orphan")).toEqual([
      "project:p1",
      "no-epic:p1",
    ]);
    expect(findTreePath(entries, "initiativeless")).toEqual([
      "project:p1",
      "no-initiative:p1",
    ]);
    expect(findTreePath(entries, "sub")).toEqual(["project:p1", "no-task:p1"]);
  });

  it("ends at the project for an initiative", () => {
    expect(findTreePath(entries, "init")).toEqual(["project:p1"]);
  });

  it("returns no path for no or an unknown ticket", () => {
    expect(findTreePath(entries, null)).toEqual([]);
    expect(findTreePath(entries, "nope")).toEqual([]);
  });
});
