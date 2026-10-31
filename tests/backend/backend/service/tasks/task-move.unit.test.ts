import { beforeEach, describe, expect, it } from "vitest";

import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { taskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";

import { TaskWorld } from "./task-world";

let world = new TaskWorld();
beforeEach(() => {
  world = new TaskWorld();
  world.addHierarchy();
  world.addMilestone("m1", "alpha");
});

it("moves a matching subtree together when the displayed ticket is current", async () => {
  const expected = {
    fields: taskUpdateSnapshot(world.ticket("task")),
    githubIssueNumber: null,
    projectId: "alpha",
  };
  const moved = await world.tasks.moveToProject(
    world.user("writer"),
    "task",
    "spare",
    expected,
  );
  expect(moved).toMatchObject({ projectId: "spare", key: "SPAR-1" });
  expect(world.ticket("sub")).toMatchObject({
    projectId: "spare",
    key: "SPAR-2",
    parentId: "task",
  });
});

describe("moving a ticket to another project", () => {
  it("renumbers the subtree below the key of the target project", async () => {
    const moved = await world.tasks.moveToProject(
      world.user("writer"),
      "task",
      "spare",
    );

    expect(moved).toMatchObject({
      id: "task",
      projectId: "spare",
      key: "SPAR-1",
      number: 1,
    });
    expect(world.ticket("sub")).toMatchObject({
      projectId: "spare",
      key: "SPAR-2",
      parentId: "task",
    });
  });

  it("continues the numbering of tickets that already live in the target", async () => {
    await world.tasks.create(world.user("writer"), {
      projectId: "spare",
      type: "task",
      title: "Existing",
      statusId: "todo",
    });

    await world.tasks.moveToProject(world.user("writer"), "task", "spare");

    expect(world.ticket("task").key).toBe("SPAR-2");
    expect(world.ticket("sub").key).toBe("SPAR-3");
  });

  it("clears the parent outside the subtree and the milestone of the old project", async () => {
    world.addTicket("task", { ...world.ticket("task"), milestoneId: "m1" });

    await world.tasks.moveToProject(world.user("writer"), "task", "spare");

    expect(world.ticket("task")).toMatchObject({
      parentId: null,
      milestoneId: null,
    });
  });

  it("keeps a milestone that belongs to the target project", async () => {
    world.addMilestone("m-spare", "spare");
    world.addTicket("task", {
      ...world.ticket("task"),
      milestoneId: "m-spare",
    });

    await world.tasks.moveToProject(world.user("writer"), "task", "spare");

    expect(world.ticket("task").milestoneId).toBe("m-spare");
  });

  it("clears an assignee who has no access to the target project", async () => {
    world.projects.addProject("design-work", ["design"]);
    world.addPerson("designer", {
      capabilities: ["write"],
      departments: ["design"],
    });
    world.addTicket("task", { ...world.ticket("task"), assigneeId: "writer" });

    await world.tasks.moveToProject(world.user("admin"), "task", "design-work");

    expect(world.ticket("task").assigneeId).toBeNull();
  });

  it("keeps an assignee who may work in the target project", async () => {
    world.addTicket("task", { ...world.ticket("task"), assigneeId: "manager" });

    await world.tasks.moveToProject(world.user("writer"), "task", "spare");

    expect(world.ticket("task").assigneeId).toBe("manager");
  });

  it("records the move of every ticket with the project names", async () => {
    await world.tasks.moveToProject(world.user("writer"), "task", "spare");

    for (const id of ["task", "sub"])
      expect(
        world.state.history.filter((entry) => entry.workItemId === id),
      ).toMatchObject([
        {
          action: "project_changed",
          field: "project",
          oldValue: "alpha",
          newValue: "spare",
          userId: "writer",
        },
      ]);
  });

  it("records the unlinking of a GitHub issue", async () => {
    world.addTicket("task", {
      ...world.ticket("task"),
      githubIssueNumber: 12,
    });

    await world.tasks.moveToProject(world.user("writer"), "task", "spare");

    expect(world.actions("task")).toEqual([
      "project_changed",
      "github_unlinked",
    ]);
    expect(world.state.history[1]).toMatchObject({ oldValue: "#12" });
  });
});

it("refuses a move when a GitHub issue was linked after confirmation opened", async () => {
  const expected = {
    fields: taskUpdateSnapshot(world.ticket("task")),
    githubIssueNumber: null,
    projectId: "alpha",
  };
  world.state.beforeWrite = () => {
    world.state.tickets.set("task", {
      ...world.ticket("task"),
      githubIssueNumber: 123,
    });
  };
  await expect(
    world.tasks.moveToProject(world.user("writer"), "task", "spare", expected),
  ).rejects.toMatchObject({ code: "ticketConflict" });
  expect(world.ticket("task")).toMatchObject({
    projectId: "alpha",
    githubIssueNumber: 123,
  });
  expect(world.ticket("sub").projectId).toBe("alpha");
});

describe("refused moves", () => {
  it("leaves the whole subtree in place when a descendant changes during the move", async () => {
    const expected = {
      fields: taskUpdateSnapshot(world.ticket("task")),
      githubIssueNumber: null,
      projectId: "alpha",
    };
    world.state.beforeWrite = () => {
      world.state.tickets.set("sub", {
        ...world.ticket("sub"),
        title: "Changed child",
      });
    };
    await expect(
      world.tasks.moveToProject(
        world.user("writer"),
        "task",
        "spare",
        expected,
      ),
    ).rejects.toMatchObject({ code: "ticketConflict" });
    expect(world.ticket("task").projectId).toBe("alpha");
    expect(world.ticket("sub")).toMatchObject({
      projectId: "alpha",
      title: "Changed child",
    });
    expect(world.state.history).toEqual([]);
  });

  it("does not move a subtree after the displayed ticket changes", async () => {
    const expected = {
      fields: taskUpdateSnapshot(world.ticket("task")),
      githubIssueNumber: null,
      projectId: "alpha",
    };
    world.state.beforeWrite = () => {
      world.state.tickets.set("task", {
        ...world.ticket("task"),
        title: "Changed elsewhere",
      });
    };

    await expect(
      world.tasks.moveToProject(
        world.user("writer"),
        "task",
        "spare",
        expected,
      ),
    ).rejects.toMatchObject({ code: "ticketConflict" });
    expect(world.ticket("task")).toMatchObject({
      projectId: "alpha",
      title: "Changed elsewhere",
    });
    expect(world.ticket("sub").projectId).toBe("alpha");
    expect(world.state.history).toEqual([]);
  });

  it("refuses the project the ticket is already in", async () => {
    await expect(
      world.tasks.moveToProject(world.user("writer"), "task", "alpha"),
    ).rejects.toMatchObject({ code: "moveSameProject" });
  });

  it("needs the write capability", async () => {
    await expect(
      world.tasks.moveToProject(world.user("reader"), "task", "spare"),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    expect(world.state.writes).toEqual([]);
  });

  it("needs access to the target project", async () => {
    await expect(
      world.tasks.moveToProject(world.user("writer"), "task", "beta"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    expect(world.ticket("task").projectId).toBe("alpha");
  });

  it("reports a ticket outside the visible scope as missing", async () => {
    world.addTicket("secret", { departmentId: "design" });

    await expect(
      world.tasks.moveToProject(world.user("writer"), "secret", "spare"),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });

  it("moves nothing when a descendant is hidden from the actor", async () => {
    world.addTicket("secret-sub", {
      type: "subtask",
      parentId: "task",
      key: "ALP-11",
      departmentId: "design",
    });

    await expect(
      world.tasks.moveToProject(world.user("writer"), "task", "spare"),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
    expect(world.state.writes).toEqual([]);
    expect(world.ticket("task").projectId).toBe("alpha");
  });
});
