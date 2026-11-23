import { describe, expect, it } from "vitest";

import { snapshotParameters } from "./WorkItemSnapshotSql";

describe("snapshotParameters", () => {
  it("marks the comparison as absent when nothing is expected", () => {
    expect(snapshotParameters(undefined)).toEqual({
      has_expected: false,
      base_title: null,
      base_status_id: null,
      base_priority: null,
      base_assignee_id: null,
      base_assignee_group_id: null,
      base_reporter_id: null,
      base_parent_id: null,
      base_milestone_id: null,
      base_due_at: null,
      base_start_at: null,
    });
  });

  it("binds every displayed field of the expected snapshot", () => {
    expect(
      snapshotParameters({
        title: "Title",
        statusId: "status",
        priority: "high",
        assigneeId: "assignee",
        assigneeGroupId: "group",
        reporterId: "reporter",
        parentId: "parent",
        milestoneId: "milestone",
        dueAt: "2026-01-02",
        startAt: "2026-01-01",
      }),
    ).toEqual({
      has_expected: true,
      base_title: "Title",
      base_status_id: "status",
      base_priority: "high",
      base_assignee_id: "assignee",
      base_assignee_group_id: "group",
      base_reporter_id: "reporter",
      base_parent_id: "parent",
      base_milestone_id: "milestone",
      base_due_at: "2026-01-02",
      base_start_at: "2026-01-01",
    });
  });
});
