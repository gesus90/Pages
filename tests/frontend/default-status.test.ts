import { describe, expect, it } from "vitest";

import { findDefaultStatusId } from "@/app/components/tasks/form/default-status";
import { WORKFLOW_STATUS_KEY } from "@/definition/Task";

import type { WorkflowStatus } from "@/definition/Task";

function createStatus(
  id: string,
  key: WorkflowStatus["key"],
  isDone = false,
): WorkflowStatus {
  return { id, isDone, key, name: id, position: 1, projectId: null };
}

describe("findDefaultStatusId", () => {
  it("prefers the backlog status", () => {
    expect(
      findDefaultStatusId([
        createStatus("todo", WORKFLOW_STATUS_KEY.TODO),
        createStatus("backlog", WORKFLOW_STATUS_KEY.BACKLOG),
      ]),
    ).toBe("backlog");
  });

  it("falls back to the first status that is not done", () => {
    expect(
      findDefaultStatusId([
        createStatus("done", WORKFLOW_STATUS_KEY.DONE, true),
        createStatus("todo", WORKFLOW_STATUS_KEY.TODO),
      ]),
    ).toBe("todo");
  });

  it("takes the first status when every one is done", () => {
    expect(
      findDefaultStatusId([
        createStatus("done", WORKFLOW_STATUS_KEY.DONE, true),
      ]),
    ).toBe("done");
  });

  it("returns an empty identifier without statuses", () => {
    expect(findDefaultStatusId([])).toBe("");
  });
});
