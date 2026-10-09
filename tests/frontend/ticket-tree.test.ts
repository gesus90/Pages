import { describe, expect, it } from "vitest";

import {
  buildTicketTree,
  findTreePath,
  groupKey,
  projectKey,
} from "@/app/lib/ticket-tree";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { TicketTreeSource } from "@/app/lib/ticket-tree";
import type { WorkItemType } from "@/definition/Task";

function entry(
  id: string,
  type: WorkItemType,
  parentId: string | null = null,
  projectId = "p1",
): TicketTreeSource {
  return {
    id,
    parentId,
    projectId,
    projectName: projectId.toUpperCase(),
    type,
  };
}

const LEVELS = [
  entry("i1", WORK_ITEM_TYPE.INITIATIVE),
  entry("e1", WORK_ITEM_TYPE.EPIC, "i1"),
  entry("t1", WORK_ITEM_TYPE.TASK, "e1"),
  entry("s1", WORK_ITEM_TYPE.SUBTASK, "t1"),
];

describe("ticket tree", () => {
  it("nests the four levels below their parents", () => {
    const [project] = buildTicketTree(LEVELS);
    const [initiative] = project?.nodes ?? [];

    expect(project).toMatchObject({
      key: "project:p1",
      projectId: "p1",
      projectName: "P1",
    });
    expect(initiative).toMatchObject({ key: "i1", kind: "ticket" });

    const epic =
      initiative?.kind === "ticket" ? initiative.children[0] : undefined;
    const task = epic?.children[0];

    expect(epic?.key).toBe("e1");
    expect(task?.key).toBe("t1");
    expect(task?.children.map((child) => child.key)).toEqual(["s1"]);
  });

  it("keeps tickets without a fitting parent reachable in groups", () => {
    const [project] = buildTicketTree([
      entry("e2", WORK_ITEM_TYPE.EPIC),
      entry("t2", WORK_ITEM_TYPE.TASK, "missing"),
      entry("t3", WORK_ITEM_TYPE.TASK, "i9"),
      entry("i9", WORK_ITEM_TYPE.INITIATIVE),
      entry("s2", WORK_ITEM_TYPE.SUBTASK, "e2"),
      entry("e3", WORK_ITEM_TYPE.EPIC, "i-elsewhere"),
      entry("i-elsewhere", WORK_ITEM_TYPE.INITIATIVE, null, "p2"),
    ]);

    expect(
      project?.nodes.map((node) => [
        node.key,
        node.kind === "group" ? node.children.map((child) => child.key) : [],
      ]),
    ).toEqual([
      ["i9", []],
      ["no-initiative:p1", ["e2", "e3"]],
      ["no-epic:p1", ["t2", "t3"]],
      ["no-task:p1", ["s2"]],
    ]);
  });

  it("builds one tree per project", () => {
    expect(
      buildTicketTree([
        entry("a", WORK_ITEM_TYPE.TASK, null, "p1"),
        entry("b", WORK_ITEM_TYPE.TASK, null, "p2"),
      ]).map((project) => project.key),
    ).toEqual(["project:p1", "project:p2"]);
    expect(buildTicketTree([])).toEqual([]);
  });

  it("finds the path to a ticket through ancestors and groups", () => {
    expect(findTreePath(LEVELS, "s1")).toEqual([
      "project:p1",
      "t1",
      "e1",
      "i1",
    ]);
    expect(
      findTreePath(
        [
          entry("t2", WORK_ITEM_TYPE.TASK),
          entry("s2", WORK_ITEM_TYPE.SUBTASK, "t2"),
        ],
        "s2",
      ),
    ).toEqual(["project:p1", "t2", "no-epic:p1"]);
    expect(findTreePath(LEVELS, "i1")).toEqual(["project:p1"]);
    expect(findTreePath(LEVELS, "unknown")).toEqual([]);
    expect(findTreePath(LEVELS, null)).toEqual([]);
  });

  it("names the keys of groups and projects", () => {
    expect(groupKey("no-epic", "p1")).toBe("no-epic:p1");
    expect(projectKey("p1")).toBe("project:p1");
  });
});
