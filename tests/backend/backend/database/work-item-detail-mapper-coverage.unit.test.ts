import { expect, it } from "vitest";

import { toWorkItemDetail } from "@/backend/database/repositories/task/WorkItemDetailMapper";

import type { DatabaseValue } from "@/backend/database/Database";

function row(): DatabaseValue[] {
  const result: DatabaseValue[] = Array.from({ length: 44 }, () => null);
  Object.entries({
    0: "id",
    1: "project",
    2: "P-1",
    3: 1,
    4: "task",
    6: "Title",
    7: "Description",
    8: "status",
    9: "normal",
    11: "creator",
    14: 0,
    15: "created",
    16: "updated",
    19: "Project",
    20: "todo",
    21: "Todo",
    22: 0,
    27: 0,
    28: 0,
    34: 0,
    39: '["department"]',
  }).forEach(([index, value]) => {
    result[Number(index)] = value;
  });
  return result;
}

it("maps a detail row and computes progress from subtasks", () => {
  const input = row();
  input[27] = 3;
  input[28] = 2;
  expect(toWorkItemDetail(input)).toMatchObject({
    id: "id",
    key: "P-1",
    departmentIds: ["department"],
    progressPercentage: 67,
    githubConflict: false,
  });
  input[27] = 0;
  input[28] = 0;
  input[22] = 1;
  expect(toWorkItemDetail(input).progressPercentage).toBe(100);
});

it.each([
  [4, "invalid", "work item type"],
  [9, "invalid", "priority"],
  [31, "invalid", "GitHub issue state"],
] as const)("refuses unsupported stored values", (index, value, message) => {
  const input = row();
  input[index] = value;
  expect(() => toWorkItemDetail(input)).toThrow(message);
});
