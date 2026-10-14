import { expect, it, vi } from "vitest";

import { ProjectManagementDeniedError } from "@/backend/error/ProjectErrors";
import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";

import { GitHubSyncWorld, STATUSES } from "./github-sync-world";

it("still pushes a changed title and description of an active task", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  world.editInPages("a", { description: "New text", title: "New title" });

  await expect(world.syncProject()).resolves.toMatchObject({ pushed: 1 });

  expect(world.writes).toEqual([
    {
      body: { body: "New text", title: "New title" },
      method: "PATCH",
      number: 7,
    },
  ]);
  expect(world.issue(7)).toMatchObject({
    body: "New text",
    state: "open",
    title: "New title",
  });
});

it("still pulls a changed title and body of an active task", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  world.editOnGitHub(7, { body: "From GitHub", title: "Remote title" });

  await expect(world.syncProject()).resolves.toMatchObject({ pulled: 1 });

  expect(world.item("a")).toMatchObject({
    description: "From GitHub",
    statusId: STATUSES.todo.id,
    title: "Remote title",
  });
  expect(world.writes).toEqual([]);
});

it("still flags a task that changed on both sides instead of overwriting it", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  world.editInPages("a", { title: "Pages title" });
  world.editOnGitHub(7, { title: "GitHub title" });

  await expect(world.syncProject()).resolves.toMatchObject({ conflicts: 1 });

  expect(world.item("a")).toMatchObject({
    githubConflict: true,
    title: "Pages title",
  });
  expect(world.issue(7).title).toBe("GitHub title");
  expect(world.writes).toEqual([]);
  expect(world.activity.map((entry) => entry.action)).toEqual([
    "github_conflict",
  ]);
});

it("flags an archived task that changed on both sides and leaves its state alone", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  await world.archive("a");
  world.editOnGitHub(7, { title: "GitHub title" });

  await expect(world.syncProject()).resolves.toMatchObject({ conflicts: 1 });

  expect(world.item("a").githubConflict).toBe(true);
  expect(world.item("a").archivedAt).not.toBeNull();
  expect(world.writes).toEqual([]);
  expect(world.issue(7).state).toBe("open");
});

it("does not write to GitHub in a direction that only pulls", async () => {
  const world = new GitHubSyncWorld();
  world.configure({ syncDirection: "pull" });
  world.addLinkedTask("archived", 7);
  world.addLinkedTask("done", 8);
  await world.archive("archived");
  world.setStatus("done", STATUSES.done);

  await expect(world.syncProject()).resolves.toMatchObject({
    pulled: 0,
    pushed: 0,
  });

  expect(world.writes).toEqual([]);
  expect(world.issue(7).state).toBe("open");
  expect(world.issue(8).state).toBe("open");
});

it("does not create an issue for an archived task that is not linked", async () => {
  const world = new GitHubSyncWorld();
  world.addUnlinkedTask("a");
  await world.archive("a");

  await expect(world.syncProject()).resolves.toMatchObject({ created: 0 });

  expect(world.writes).toEqual([]);
  expect(world.item("a").githubIssueNumber).toBeNull();
});

it("still creates the issue of an active task that is not linked", async () => {
  const world = new GitHubSyncWorld();
  world.addUnlinkedTask("a");

  await expect(world.syncProject()).resolves.toMatchObject({ created: 1 });

  expect(world.writes).toEqual([
    {
      body: { body: "Synthetic ticket", title: "Task a" },
      method: "POST",
      number: null,
    },
  ]);
  expect(world.item("a").githubIssueNumber).toBe(101);
});

it("refuses an actor without write permission before touching GitHub", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  await world.archive("a");
  world.canWrite = false;

  await expect(world.syncProject()).rejects.toBeInstanceOf(
    ProjectManagementDeniedError,
  );
  await expect(world.syncTask("a")).rejects.toBeInstanceOf(
    ProjectManagementDeniedError,
  );

  expect(world.requests).toEqual([]);
  expect(world.issue(7).state).toBe("open");
});

it("does not change any issue while the synchronization is switched off", async () => {
  const world = new GitHubSyncWorld();
  world.configure({ syncEnabled: false });
  world.addLinkedTask("done", 7);
  world.addLinkedTask("archived", 8);
  world.setStatus("done", STATUSES.done);
  await world.archive("archived");
  const snapshot = world.snapshot();
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  await expect(world.syncProject()).rejects.toThrow(WorkItemValidationError);
  await expect(world.syncTask("archived")).rejects.toThrow(
    WorkItemValidationError,
  );
  await expect(world.syncDue()).resolves.toEqual({ completed: 0, failed: 1 });
  await expect(world.publish("done")).resolves.toBeUndefined();

  expect(world.requests).toEqual([]);
  expect(world.writes).toEqual([]);
  expect(world.snapshot()).toEqual(snapshot);
});

it("synchronizes archived tasks in a scheduled run", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  await world.archive("a");

  await expect(world.syncDue()).resolves.toEqual({ completed: 1, failed: 0 });

  expect(world.issue(7).state).toBe("closed");
});
