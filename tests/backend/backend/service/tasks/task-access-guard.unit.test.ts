import { beforeEach, describe, expect, it } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
} from "@/backend/error/WorkItemErrors";
import { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";

import { TaskWorld } from "./task-world";

let world = new TaskWorld();
let guard = guardOf(world);

function guardOf(source: TaskWorld): TaskAccessGuard {
  return new TaskAccessGuard(
    source.repository,
    source.projects.service,
    source.projects.permissions,
  );
}

beforeEach(() => {
  world = new TaskWorld();
  guard = guardOf(world);
  world.addTicket("t1");
  world.addTicket("hidden", { departmentId: "design" });
  world.addTicket("beta-ticket", { projectId: "beta", departmentId: "design" });
});

describe("reading a ticket", () => {
  it("returns a ticket of an accessible project and department", async () => {
    await expect(
      guard.requireWorkItem(world.user("writer"), "t1"),
    ).resolves.toMatchObject({ id: "t1" });
  });

  it("reports a missing ticket", async () => {
    await expect(
      guard.requireWorkItem(world.user("writer"), "nope"),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });

  it("hides a ticket of a foreign department as not found", async () => {
    await expect(
      guard.requireWorkItem(world.user("writer"), "hidden"),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });

  it("hides a ticket of a project the actor cannot open", async () => {
    await expect(
      guard.requireWorkItem(world.user("writer"), "beta-ticket"),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });

  it("shows every ticket to an administrator in administrator mode", async () => {
    await expect(
      guard.requireWorkItem(world.user("admin"), "hidden"),
    ).resolves.toMatchObject({ id: "hidden" });
  });

  it("refuses an inactive account", async () => {
    world.addPerson("gone", { isActive: false });

    await expect(
      guard.requireWorkItem(world.user("gone"), "t1"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});

describe("changing a ticket", () => {
  it("allows the write capability within the visible scope", async () => {
    await expect(
      guard.requireWritableWorkItem(world.user("writer"), "t1"),
    ).resolves.toMatchObject({ id: "t1" });
  });

  it("refuses an actor without the write capability", async () => {
    await expect(
      guard.requireWritableWorkItem(world.user("reader"), "t1"),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });

  it("reports hidden tickets as missing before checking the capability", async () => {
    await expect(
      guard.requireWritableWorkItem(world.user("reader"), "hidden"),
    ).rejects.toBeInstanceOf(WorkItemNotFoundError);
  });

  it("requires project access for a writable project", async () => {
    await expect(
      guard.requireWritableProject(world.user("writer"), "alpha"),
    ).resolves.toMatchObject({ id: "alpha" });
    await expect(
      guard.requireWritableProject(world.user("outsider"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    await expect(
      guard.requireWritableProject(world.user("reader"), "alpha"),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    await expect(
      guard.requireWritableProject(world.user("writer"), "nope"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("requires project responsibility for planning", async () => {
    await expect(
      guard.requirePlanningProject(world.user("manager"), "alpha"),
    ).resolves.toBeUndefined();
    await expect(
      guard.requirePlanningProject(world.user("writer"), "alpha"),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });
});

describe("archive right", () => {
  it.each([
    ["admin", true],
    ["manager", true],
    ["milestoner", false],
    ["writer", false],
    ["reader", false],
  ])("decides %s as %s", async (userId, expected) => {
    await expect(guard.canArchive(world.user(userId), "alpha")).resolves.toBe(
      expected,
    );
  });

  it("needs the milestone capability even for the project manager", async () => {
    world.projects.manage("alpha", "writer");

    await expect(guard.canArchive(world.user("writer"), "alpha")).resolves.toBe(
      false,
    );
  });

  it("grants the right to a milestone holder who is also project manager", async () => {
    world.projects.manage("alpha", "milestoner");

    await expect(
      guard.canArchive(world.user("milestoner"), "alpha"),
    ).resolves.toBe(true);
  });

  it("refuses archiving with an access error", async () => {
    await expect(
      guard.requireArchiveRight(world.user("writer"), "alpha"),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    await expect(
      guard.requireArchivableWorkItem(world.user("manager"), "t1"),
    ).resolves.toMatchObject({ id: "t1" });
  });

  it("narrows projects to those with the archive right", async () => {
    world.projects.addProject("other", ["design"]);

    await expect(
      guard.archivableProjectIds(world.user("manager"), [
        "alpha",
        "spare",
        "other",
      ]),
    ).resolves.toEqual(["alpha", "spare"]);
    await expect(
      guard.archivableProjectIds(world.user("writer"), ["alpha"]),
    ).resolves.toEqual([]);
  });

  it("finds out whether any project qualifies", async () => {
    await expect(
      guard.canArchiveAny(world.user("manager"), ["beta", "alpha"]),
    ).resolves.toBe(true);
    await expect(
      guard.canArchiveAny(world.user("manager"), ["beta"]),
    ).resolves.toBe(false);
    await expect(
      guard.canArchiveAny(world.user("writer"), ["alpha"]),
    ).resolves.toBe(false);
  });
});

describe("hints and project resolution", () => {
  it("reports the write and delete hints from current facts", async () => {
    await expect(
      world.tasks.actionPermissions(world.user("writer")),
    ).resolves.toEqual({ canWrite: true, canDelete: false });
    await expect(
      world.tasks.actionPermissions(world.user("admin")),
    ).resolves.toEqual({ canWrite: true, canDelete: true });
    await expect(
      world.tasks.actionPermissions(world.user("reader")),
    ).resolves.toEqual({ canWrite: false, canDelete: false });
  });

  it("limits requested projects to the accessible ones", async () => {
    await expect(
      guard.resolveAccessibleProjectIds(world.user("writer"), [
        "beta",
        "alpha",
        "nope",
      ]),
    ).resolves.toEqual(["alpha"]);
  });

  it("returns every accessible project without a request", async () => {
    const ids = await guard.resolveAccessibleProjectIds(world.user("writer"));

    expect([...ids].sort()).toEqual(["alpha", "spare"]);
  });
});
