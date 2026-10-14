import { expect, it } from "vitest";

import { GitHubSyncWorld, STATUSES } from "./github-sync-world";

const NO_CHANGES = {
  conflicts: 0,
  created: 0,
  detected: 0,
  pullRequests: 0,
  pulled: 0,
  pushed: 0,
};

it("closes the issue of a task that is done in Pages", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  world.setStatus("a", STATUSES.done);

  await expect(world.syncProject()).resolves.toEqual({
    ...NO_CHANGES,
    pushed: 1,
  });

  expect(world.writes).toEqual([
    { body: { state: "closed" }, method: "PATCH", number: 7 },
  ]);
  expect(world.item("a")).toMatchObject({
    archivedAt: null,
    githubIssueNumber: 7,
    githubIssueState: "closed",
    statusId: STATUSES.done.id,
  });
});

it("closes the issue of an archived task and keeps its status and link", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  await world.archive("a");

  await expect(world.syncProject()).resolves.toEqual({
    ...NO_CHANGES,
    pushed: 1,
  });

  expect(world.writes).toEqual([
    { body: { state: "closed" }, method: "PATCH", number: 7 },
  ]);
  expect(world.issue(7).state).toBe("closed");
  expect(world.item("a")).toMatchObject({
    githubIssueNumber: 7,
    githubIssueState: "closed",
    isDone: false,
    statusId: STATUSES.todo.id,
  });
  expect(world.item("a").archivedAt).not.toBeNull();
});

it("closes the issues of every task archived together with its parent", async () => {
  const world = new GitHubSyncWorld();
  world.addUnlinkedTask("epic", { type: "epic" });
  world.addLinkedTask("first", 11, { parentId: "epic" });
  world.addLinkedTask("second", 12, { parentId: "epic" });
  world.addUnlinkedTask("unlinked", { parentId: "epic" });
  world.addLinkedTask("outside", 13);

  await expect(world.archive("epic")).resolves.toBe(4);
  await expect(world.syncProject()).resolves.toEqual({
    ...NO_CHANGES,
    pushed: 2,
  });

  expect(world.writes).toEqual([
    { body: { state: "closed" }, method: "PATCH", number: 11 },
    { body: { state: "closed" }, method: "PATCH", number: 12 },
  ]);
  expect(world.issue(13).state).toBe("open");
  expect(world.writes.some((write) => write.method === "POST")).toBe(false);
});

it("turns a closed issue into the done status of an active task without archiving it", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  world.closeOnGitHub(7);

  await expect(world.syncProject()).resolves.toEqual({
    ...NO_CHANGES,
    pulled: 1,
  });

  expect(world.item("a")).toMatchObject({
    archivedAt: null,
    githubIssueState: "closed",
    isDone: true,
    statusId: STATUSES.done.id,
  });
  expect(world.writes).toEqual([]);
});

it("keeps the status of an archived task when its closed issue changes", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  await world.archive("a");
  await world.syncProject();
  world.editOnGitHub(7, { title: "Renamed on GitHub" });

  await expect(world.syncProject()).resolves.toEqual({
    ...NO_CHANGES,
    pulled: 1,
  });

  expect(world.item("a")).toMatchObject({
    isDone: false,
    statusId: STATUSES.todo.id,
    title: "Renamed on GitHub",
  });
  expect(world.item("a").archivedAt).not.toBeNull();
});

it("reopens the issue of a restored task that is not done", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  await world.archive("a");
  await world.syncProject();
  await world.restore("a");

  await expect(world.syncProject()).resolves.toEqual({
    ...NO_CHANGES,
    pushed: 1,
  });

  expect(world.writes.at(-1)).toEqual({
    body: { state: "open" },
    method: "PATCH",
    number: 7,
  });
  expect(world.issue(7).state).toBe("open");
  expect(world.item("a")).toMatchObject({
    archivedAt: null,
    githubIssueState: "open",
    statusId: STATUSES.todo.id,
  });
});

it("leaves the issue of a restored done task closed", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  world.setStatus("a", STATUSES.done);
  await world.syncProject();
  await world.archive("a");
  await world.syncProject();
  await world.restore("a");
  const writesBefore = world.writes.length;

  await expect(world.syncProject()).resolves.toEqual(NO_CHANGES);

  expect(world.writes).toHaveLength(writesBefore);
  expect(world.issue(7).state).toBe("closed");
  expect(world.item("a")).toMatchObject({
    archivedAt: null,
    isDone: true,
  });
});

it("leaves the done status of an active task when its issue is reopened", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  world.setStatus("a", STATUSES.done);
  await world.syncProject();
  world.reopenOnGitHub(7);

  await expect(world.syncProject()).resolves.toEqual({
    ...NO_CHANGES,
    pulled: 1,
  });

  expect(world.item("a")).toMatchObject({
    archivedAt: null,
    githubIssueState: "open",
    isDone: false,
    statusId: STATUSES.backlog.id,
  });
  expect(world.issue(7).state).toBe("open");
});

it("does not restore an archived task whose issue is reopened and closes the issue again", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  world.setStatus("a", STATUSES.done);
  await world.syncProject();
  await world.archive("a");
  await world.syncProject();
  world.reopenOnGitHub(7);

  await world.syncProject();

  expect(world.item("a").archivedAt).not.toBeNull();
  expect(world.item("a").statusId).toBe(STATUSES.backlog.id);

  await world.syncProject();

  expect(world.issue(7).state).toBe("closed");
  expect(world.item("a").archivedAt).not.toBeNull();
  expect(world.item("a").githubIssueNumber).toBe(7);
});

it("does not change anything when a synchronized state is synchronized again", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("done", 7);
  world.addLinkedTask("archived", 8);
  world.addLinkedTask("open", 9);
  world.setStatus("done", STATUSES.done);
  await world.archive("archived");
  await world.syncProject();
  const requestsBefore = world.requests.length;
  const writesBefore = world.writes.length;
  const snapshot = world.snapshot();

  await expect(world.syncProject()).resolves.toEqual(NO_CHANGES);
  await expect(world.syncProject()).resolves.toEqual(NO_CHANGES);

  expect(world.snapshot()).toEqual(snapshot);
  expect(world.writes).toHaveLength(writesBefore);
  expect(world.requests.length).toBeGreaterThan(requestsBefore);
  expect(world.remote.size).toBe(3);
});

it("closes the issue of one archived task on a single-task synchronization", async () => {
  const world = new GitHubSyncWorld();
  world.addLinkedTask("a", 7);
  world.addLinkedTask("b", 8);
  await world.archive("a");
  await world.archive("b");

  await expect(world.syncTask("a")).resolves.toEqual({
    ...NO_CHANGES,
    pushed: 1,
  });

  expect(world.issue(7).state).toBe("closed");
  expect(world.issue(8).state).toBe("open");
});
