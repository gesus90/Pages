import { expect, it } from "vitest";

import {
  planningIdentity,
  planningTicket,
  useAgentPlanningHarness,
} from "../helpers/agent-planning";

import type { MilestoneFieldChange } from "@/backend/database/repositories/task/MilestoneRepository";

const setup = useAgentPlanningHarness();

it("conditionally updates title, status and nullable parent while preserving every other stored column", async () => {
  const run = await setup();
  await run.planning.tickets.apply(
    planningIdentity,
    "ticket.create",
    planningTicket(),
  );
  const before = (await run.repository.findAll())[0];
  if (!before) throw new Error("Expected created ticket.");
  expect(await run.repository.updateTitle(before.id, "New", "obsolete")).toBe(
    false,
  );
  expect(await run.repository.findById(before.id)).toEqual(before);
  expect(await run.repository.updateTitle(before.id, "New", before.title)).toBe(
    true,
  );
  const titled = await run.repository.findById(before.id);
  expect(titled).toEqual({
    ...before,
    title: "New",
    updatedAt: titled?.updatedAt,
  });
  expect(
    await run.repository.updateStatus(
      before.id,
      { id: "status-done", isDone: true },
      "obsolete",
    ),
  ).toBe(false);
  expect(
    await run.repository.updateStatus(
      before.id,
      { id: "status-done", isDone: true },
      before.statusId,
    ),
  ).toBe(true);
  const done = await run.repository.findById(before.id);
  expect(done).toMatchObject({
    title: "New",
    sortOrder: before.sortOrder,
    statusId: "status-done",
    isDone: true,
  });
  expect(done?.completedAt).not.toBeNull();
  expect(
    await run.repository.updateStatus(
      before.id,
      { id: "status-todo", isDone: false },
      "status-done",
    ),
  ).toBe(true);
  expect(await run.repository.findById(before.id)).toMatchObject({
    completedAt: null,
    sortOrder: before.sortOrder,
  });
  expect(
    await run.repository.replaceParent(before.id, "parent-id", "obsolete"),
  ).toBe(false);
  expect(await run.repository.replaceParent(before.id, "parent-id", null)).toBe(
    true,
  );
  expect(
    await run.database.query(
      "SELECT parent_id FROM work_items WHERE id = $id;",
      { id: before.id },
    ),
  ).toEqual([["parent-id"]]);
  expect(await run.repository.replaceParent(before.id, null, null)).toBe(false);
  expect(await run.repository.replaceParent(before.id, null, "parent-id")).toBe(
    true,
  );
  await run.repository.archiveMany([before.id]);
  for (const id of [before.id, "missing"]) {
    expect(await run.repository.updateTitle(id, "Later", "New")).toBe(false);
    expect(
      await run.repository.updateStatus(
        id,
        { id: "status-done", isDone: true },
        "status-todo",
      ),
    ).toBe(false);
    expect(await run.repository.replaceParent(id, "parent-id", null)).toBe(
      false,
    );
  }
});

const changes: readonly MilestoneFieldChange[] = [
  { field: "name", base: "Release", value: "New" },
  { field: "description", base: "Body", value: "New body" },
  { field: "status", base: "open", value: "completed" },
  { field: "startAt", base: null, value: "2026-01-01" },
  { field: "dueAt", base: null, value: "2026-02-01" },
];

it.each(changes)(
  "protects the milestone $field statement itself from stale values, missing and archived rows",
  async (change) => {
    const run = await setup();
    await run.repository.insertMilestone({
      id: "milestone",
      projectId: "p1",
      name: "Release",
      description: "Body",
      dueAt: null,
    });
    const before = await run.repository.findMilestoneById("milestone");
    expect(
      await run.repository.updateMilestoneField("milestone", {
        ...change,
        base: "obsolete",
      }),
    ).toBe(false);
    expect(await run.repository.findMilestoneById("milestone")).toEqual(before);
    expect(await run.repository.updateMilestoneField("milestone", change)).toBe(
      true,
    );
    const after = await run.repository.findMilestoneById("milestone");
    expect(after).toEqual({
      ...before,
      [change.field]: change.value,
      updatedAt: after?.updatedAt,
      completedAt:
        change.field === "status" ? after?.completedAt : before?.completedAt,
    });
    if (change.field === "status") expect(after?.completedAt).not.toBeNull();
    expect(
      await run.repository.updateMilestoneField("milestone", {
        ...change,
        base: change.value,
        value: change.base,
      }),
    ).toBe(true);
    if (change.field === "status")
      expect(await run.repository.findMilestoneById("milestone")).toMatchObject(
        { completedAt: null },
      );
    await run.repository.archiveMilestone("milestone");
    for (const id of ["milestone", "missing"])
      expect(await run.repository.updateMilestoneField(id, change)).toBe(false);
  },
);

it("classifies known GitHub issue numbers across hidden and archived tickets in just the requested project", async () => {
  const run = await setup();
  for (const [operationId, projectId] of [
    ["first", "p1"],
    ["second", "p1"],
    ["third", "p2"],
  ])
    await run.planning.tickets.apply(
      planningIdentity,
      "ticket.create",
      planningTicket({ operationId, projectId }),
    );
  await run.database.execute(
    "UPDATE work_items SET github_issue_number = 42, archived_at = utc_now(), department_id = 'beta' WHERE project_id = 'p1' AND number = 1;",
  );
  await run.database.execute(
    "UPDATE work_items SET github_issue_number = 43 WHERE project_id = 'p2';",
  );
  expect(await run.repository.findKnownGitHubIssueNumbers("p1")).toEqual(
    new Set([42]),
  );
  expect(await run.repository.findKnownGitHubIssueNumbers("p2")).toEqual(
    new Set([43]),
  );
  expect(await run.repository.findKnownGitHubIssueNumbers("missing")).toEqual(
    new Set(),
  );
});
