import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";
import { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import { TaskMilestoneLinkService } from "@/backend/service/task/TaskMilestoneLinkService";
import { CAPABILITY } from "@/definition/Authorization";

import { useMigratedDatabase } from "../helpers/test-database";
import { createWikiHarness } from "../helpers/wiki-harness";

import type { WorkItemType } from "@/definition/Task";

const getDatabase = useMigratedDatabase();
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
  directories.length = 0;
});

/** Real policy, repository and history on an in-memory database; only the link service is built directly. */
async function setup() {
  const database = getDatabase();
  const wiki = createWikiHarness(database);
  directories.push(wiki.filesDirectory);
  const owner = await wiki.addUser("owner", { isAdmin: true, mode: "admin" });
  await wiki.addDepartment("alpha");
  await wiki.addDepartment("beta");
  const writer = await wiki.addUser("writer", {
    departments: ["alpha"],
    capabilities: [CAPABILITY.WRITE],
  });
  await wiki.addProject("p1", ["alpha"]);
  await wiki.addProject("p2", ["beta"]);
  const context = createAgentTaskContext(database, owner);
  const repository = new TaskRepository(database);
  const links = new TaskMilestoneLinkService(
    repository,
    new TaskAccessGuard(repository, context.projects, context.permissions),
    new TaskHistoryRecorder(repository),
    ServerCache.disabled(),
  );

  async function createItem(
    type: WorkItemType,
    title: string,
    options: { parentId?: string; milestoneId?: string } = {},
  ) {
    return context.tasks.create(owner, {
      projectId: "p1",
      type,
      title,
      statusId: "status-todo",
      ...options,
    });
  }

  async function createMilestone(name: string) {
    return context.tasks.createMilestone(owner, { projectId: "p1", name });
  }

  return {
    owner,
    writer,
    links,
    tasks: context.tasks,
    createItem,
    createMilestone,
  };
}

describe("milestone links of initiatives", () => {
  it("shows an account only the links of projects and initiatives it can see", async () => {
    const run = await setup();
    const initiative = await run.createItem("initiative", "Initiative");
    const milestone = await run.createMilestone("Milestone");

    expect(
      await run.links.addInitiative(run.owner, milestone.id, initiative.id),
    ).toEqual({
      initiativeId: initiative.id,
      milestoneId: milestone.id,
      projectId: "p1",
      isChanged: true,
    });

    expect(await run.links.findLinks(run.writer, ["p1"])).toEqual([
      { initiativeId: initiative.id, milestoneId: milestone.id },
    ]);
    expect(await run.links.findLinks(run.writer, ["p2"])).toEqual([]);
    expect(await run.links.findLinks(run.writer, [])).toEqual([]);
  });

  it("counts the own milestone of an initiative as a link and does not link it again", async () => {
    const run = await setup();
    const milestone = await run.createMilestone("Milestone");
    const initiative = await run.createItem("initiative", "Own", {
      milestoneId: milestone.id,
    });

    expect(
      await run.links.addInitiative(run.owner, milestone.id, initiative.id),
    ).toMatchObject({ isChanged: false });
    expect(await run.links.findLinks(run.owner, ["p1"])).toEqual([
      { initiativeId: initiative.id, milestoneId: milestone.id },
    ]);
  });

  it("refuses an archived initiative and anything that is no initiative", async () => {
    const run = await setup();
    const milestone = await run.createMilestone("Milestone");
    const archived = await run.createItem("initiative", "Archived");
    const epic = await run.createItem("epic", "Epic");
    await run.tasks.archive(run.owner, archived.id);

    await expect(
      run.links.addInitiative(run.owner, milestone.id, archived.id),
    ).rejects.toMatchObject({ code: "ticketArchived" });
    await expect(
      run.links.addInitiative(run.owner, milestone.id, epic.id),
    ).rejects.toMatchObject({ code: "initiativeRequired" });
    expect(await run.links.findLinks(run.owner, ["p1"])).toEqual([]);
  });
});

describe("threading an assigned task upwards", () => {
  async function hierarchy() {
    const run = await setup();
    const initiative = await run.createItem("initiative", "Initiative");
    const epic = await run.createItem("epic", "Epic", {
      parentId: initiative.id,
    });
    const task = await run.createItem("task", "Task", { parentId: epic.id });
    const milestone = await run.createMilestone("Milestone");

    return { ...run, initiative, epic, task, milestone };
  }

  it("gives the epic the milestone and links the initiative", async () => {
    const run = await hierarchy();

    await run.links.threadAssignedTask(run.owner, {
      ...run.task,
      milestoneId: run.milestone.id,
    });

    expect((await run.tasks.getById(run.owner, run.epic.id)).milestoneId).toBe(
      run.milestone.id,
    );
    expect(await run.links.findLinks(run.owner, ["p1"])).toEqual([
      { initiativeId: run.initiative.id, milestoneId: run.milestone.id },
    ]);
  });

  it("gives an epic without initiative the milestone and links nothing", async () => {
    const run = await setup();
    const epic = await run.createItem("epic", "Loose epic");
    const task = await run.createItem("task", "Task", { parentId: epic.id });
    const milestone = await run.createMilestone("Milestone");

    await run.links.threadAssignedTask(run.owner, {
      ...task,
      milestoneId: milestone.id,
    });

    expect((await run.tasks.getById(run.owner, epic.id)).milestoneId).toBe(
      milestone.id,
    );
    expect(await run.links.findLinks(run.owner, ["p1"])).toEqual([]);
  });

  it("stops quietly when the milestone of the task does not exist", async () => {
    const run = await hierarchy();

    await run.links.threadAssignedTask(run.owner, {
      ...run.task,
      milestoneId: "missing-milestone",
    });

    expect(
      (await run.tasks.getById(run.owner, run.epic.id)).milestoneId,
    ).toBeNull();
    expect(await run.links.findLinks(run.owner, ["p1"])).toEqual([]);
  });

  it("stops quietly when the parent of the task is not an epic", async () => {
    const run = await hierarchy();

    await run.links.threadAssignedTask(run.owner, {
      ...run.task,
      milestoneId: run.milestone.id,
      parentId: run.initiative.id,
    });

    expect(
      (await run.tasks.getById(run.owner, run.initiative.id)).milestoneId,
    ).toBeNull();
    expect(
      (await run.tasks.getById(run.owner, run.epic.id)).milestoneId,
    ).toBeNull();
    expect(await run.links.findLinks(run.owner, ["p1"])).toEqual([]);
  });
});
