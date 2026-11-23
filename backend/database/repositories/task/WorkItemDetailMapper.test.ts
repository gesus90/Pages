import { describe, expect, it } from "vitest";

import { toWorkItemDetail } from "./WorkItemDetailMapper";

import type { DatabaseValue } from "@/backend/database/Database";

function rowOf(
  overrides: Readonly<Record<number, DatabaseValue>> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = Array.from({ length: 44 }, () => null);
  const base: Record<number, DatabaseValue> = {
    0: "id",
    1: "project",
    2: "KEY-1",
    3: 1,
    4: "task",
    5: null,
    6: "Title",
    7: "Description",
    8: "status",
    9: "normal",
    11: "creator",
    14: 3,
    15: "created",
    16: "updated",
    19: "Project name",
    20: "todo",
    21: "To do",
    22: 0,
    27: 0,
    28: 0,
    34: 0,
    39: '["d1"]',
    ...overrides,
  };
  for (const [index, value] of Object.entries(base)) row[Number(index)] = value;
  return row;
}

describe("toWorkItemDetail", () => {
  it("maps a plain row", () => {
    const detail = toWorkItemDetail(rowOf());

    expect(detail).toMatchObject({
      id: "id",
      key: "KEY-1",
      type: "task",
      priority: "normal",
      departmentIds: ["d1"],
      githubIssueState: null,
      githubIssueNumber: null,
      githubConflict: false,
      isDone: false,
      progressPercentage: 0,
      subtaskTotal: 0,
    });
  });

  it("maps a linked GitHub issue and joined names", () => {
    const detail = toWorkItemDetail(
      rowOf({ 29: 7, 30: "url", 31: "closed", 34: 1, 23: "Ann", 42: "red" }),
    );

    expect(detail).toMatchObject({
      githubIssueNumber: 7,
      githubIssueState: "closed",
      githubConflict: true,
      assigneeName: "Ann",
      assigneeColor: "red",
    });
  });

  it("counts a done item without subtasks as complete", () => {
    expect(toWorkItemDetail(rowOf({ 22: 1 })).progressPercentage).toBe(100);
  });

  it("derives the progress from the subtasks", () => {
    const detail = toWorkItemDetail(rowOf({ 22: 1, 27: 3, 28: 1 }));

    expect(detail.progressPercentage).toBe(33);
    expect(detail.subtaskCompleted).toBe(1);
  });

  it("rejects an unsupported type", () => {
    expect(() => toWorkItemDetail(rowOf({ 4: "bug" }))).toThrow(
      'unsupported work item type "bug"',
    );
  });

  it("rejects an unsupported priority", () => {
    expect(() => toWorkItemDetail(rowOf({ 9: "meh" }))).toThrow(
      'unsupported priority "meh"',
    );
  });

  it("rejects an unsupported GitHub issue state", () => {
    expect(() => toWorkItemDetail(rowOf({ 31: "weird" }))).toThrow(
      'unsupported GitHub issue state "weird"',
    );
  });
});
