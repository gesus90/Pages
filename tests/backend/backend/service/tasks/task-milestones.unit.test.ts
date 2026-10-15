import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkItemAccessDeniedError,
  WorkItemConflictError,
} from "@/backend/error/WorkItemErrors";

import { TaskWorld } from "./task-world";

let world = new TaskWorld();
beforeEach(() => {
  world = new TaskWorld();
  world.addMilestone("m1", "alpha", {
    name: "Release",
    description: "Ship it",
    startAt: "2026-02-01",
    dueAt: "2026-03-01",
  });
  world.addMilestone("m2", "alpha");
});

describe("reading milestones", () => {
  it("returns active milestones of accessible projects only", async () => {
    world.addMilestone("m-beta", "beta");
    world.addMilestone("m-old", "alpha", { archivedAt: "2026-01-02 00:00:00" });

    const milestones = await world.tasks.findMilestones(world.user("writer"), [
      "alpha",
      "beta",
    ]);

    expect(milestones.map((milestone) => milestone.id).sort()).toEqual([
      "m1",
      "m2",
    ]);
  });
});

describe("creating milestones", () => {
  it("stores the trimmed milestone for a project manager", async () => {
    const created = await world.tasks.createMilestone(world.user("manager"), {
      projectId: "alpha",
      name: "  Beta  ",
      description: "  Plan  ",
      startAt: "2026-04-01",
      dueAt: "2026-05-01",
      colorKey: "release",
      iconKey: "flag",
      colorCustom: "#aabbcc",
    });

    expect(created).toMatchObject({
      projectId: "alpha",
      name: "Beta",
      description: "Plan",
      startAt: "2026-04-01",
      dueAt: "2026-05-01",
      colorKey: "release",
      iconKey: "flag",
      colorCustom: "#aabbcc",
    });
  });

  it("forgets cached ticket data", async () => {
    const invalidate = vi.spyOn(world.projects.cache, "invalidateWorkItems");

    await world.tasks.createMilestone(world.user("manager"), {
      projectId: "alpha",
      name: "Beta",
    });

    expect(invalidate).toHaveBeenCalled();
  });

  it("needs project responsibility, not only the write capability", async () => {
    await expect(
      world.tasks.createMilestone(world.user("writer"), {
        projectId: "alpha",
        name: "Beta",
      }),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
    expect(world.state.writes).toEqual([]);
  });

  it.each([
    ["a blank name", { name: " " }, "milestoneNameLength"],
    ["a long name", { name: "n".repeat(201) }, "milestoneNameLength"],
    ["a malformed start", { startAt: "1.2.2026" }, "milestoneStartDateFormat"],
    ["a malformed due date", { dueAt: "2026-13" }, "milestoneDueDateFormat"],
    [
      "a start after the due date",
      { startAt: "2026-05-02", dueAt: "2026-05-01" },
      "milestoneDateOrder",
    ],
    [
      "an unknown color",
      { colorKey: "pink" as "team" },
      "milestoneColorUnsupported",
    ],
    ["an unknown icon", { iconKey: "x" as "flag" }, "milestoneIconUnsupported"],
    [
      "a bad custom color",
      { colorCustom: "red" },
      "milestoneCustomColorFormat",
    ],
  ])("rejects %s", async (_, overrides, code) => {
    await expect(
      world.tasks.createMilestone(world.user("manager"), {
        projectId: "alpha",
        name: "Beta",
        ...overrides,
      }),
    ).rejects.toMatchObject({ code });
    expect(world.state.writes).toEqual([]);
  });
});

describe("updating milestones", () => {
  const update = {
    name: " Renamed ",
    description: " Text ",
    status: "completed" as const,
    startAt: "2026-02-02",
    dueAt: "2026-03-02",
  };

  it("stores the trimmed values", async () => {
    const updated = await world.tasks.updateMilestone(
      world.user("manager"),
      "m1",
      update,
    );

    expect(updated).toMatchObject({
      name: "Renamed",
      description: "Text",
      status: "completed",
      dueAt: "2026-03-02",
    });
  });

  it("rejects an unknown status", async () => {
    await expect(
      world.tasks.updateMilestone(world.user("manager"), "m1", {
        ...update,
        status: "gone" as "open",
      }),
    ).rejects.toMatchObject({ code: "milestoneStatusUnsupported" });
  });

  it("reports an unknown or archived milestone", async () => {
    world.addMilestone("m-old", "alpha", { archivedAt: "2026-01-02 00:00:00" });

    await expect(
      world.tasks.updateMilestone(world.user("manager"), "nope", update),
    ).rejects.toMatchObject({ code: "milestoneNotFound" });
    await expect(
      world.tasks.updateMilestone(world.user("manager"), "m-old", update),
    ).rejects.toMatchObject({ code: "milestoneNotFound" });
  });

  it("needs project responsibility", async () => {
    await expect(
      world.tasks.updateMilestone(world.user("writer"), "m1", update),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });
});

describe("single field changes", () => {
  it("replaces one field and leaves the others", async () => {
    const result = await world.tasks.updateMilestoneField(
      world.user("manager"),
      "m1",
      { field: "name", base: "Release", value: " Final release " },
    );

    expect(result.isChanged).toBe(true);
    expect(result.milestone).toMatchObject({
      name: "Final release",
      description: "Ship it",
      dueAt: "2026-03-01",
    });
  });

  it("reports no change when the value is already stored", async () => {
    const result = await world.tasks.updateMilestoneField(
      world.user("manager"),
      "m1",
      { field: "dueAt", base: "2026-03-01", value: "2026-03-01" },
    );

    expect(result.isChanged).toBe(false);
    expect(world.state.writes).toEqual([]);
  });

  it("accepts a value someone else already stored", async () => {
    const result = await world.tasks.updateMilestoneField(
      world.user("manager"),
      "m1",
      { field: "name", base: "Older name", value: "Release" },
    );

    expect(result.isChanged).toBe(false);
  });

  it("raises a conflict for a field changed since it was read", async () => {
    const attempt = world.tasks.updateMilestoneField(
      world.user("manager"),
      "m1",
      { field: "name", base: "Older name", value: "Mine" },
    );

    await expect(attempt).rejects.toBeInstanceOf(WorkItemConflictError);
    await expect(attempt).rejects.toMatchObject({ field: "name" });
    expect(world.state.milestones.get("m1")?.name).toBe("Release");
  });

  it("raises a conflict when the field changes between check and write", async () => {
    world.state.beforeWrite = () => {
      const stored = world.state.milestones.get("m1");
      if (stored)
        world.state.milestones.set("m1", { ...stored, name: "Raced" });
    };

    await expect(
      world.tasks.updateMilestoneField(world.user("manager"), "m1", {
        field: "name",
        base: "Release",
        value: "Mine",
      }),
    ).rejects.toMatchObject({ field: "name" });
    expect(world.state.milestones.get("m1")?.name).toBe("Raced");
  });

  it.each([
    [
      "name",
      { field: "name", base: "Release", value: " " },
      "milestoneNameLength",
    ],
    [
      "status",
      { field: "status", base: "open", value: "gone" },
      "milestoneStatusUnsupported",
    ],
    [
      "startAt",
      { field: "startAt", base: "2026-02-01", value: "2026-04-01" },
      "milestoneDateOrder",
    ],
    [
      "dueAt",
      { field: "dueAt", base: "2026-03-01", value: "x" },
      "milestoneDueDateFormat",
    ],
  ] as const)("validates the %s field", async (_, change, code) => {
    await expect(
      world.tasks.updateMilestoneField(world.user("manager"), "m1", change),
    ).rejects.toMatchObject({ code });
  });

  it("stores an emptied description as an empty text", async () => {
    const result = await world.tasks.updateMilestoneField(
      world.user("manager"),
      "m1",
      { field: "description", base: "Ship it", value: null },
    );

    expect(result.milestone.description).toBe("");
  });
});

describe("dependencies", () => {
  it("links two milestones of a project", async () => {
    const dependency = await world.tasks.addDependency(world.user("manager"), {
      projectId: "alpha",
      sourceId: "m1",
      targetId: "m2",
      linkType: "blocks",
    });

    expect(dependency).toMatchObject({ sourceId: "m1", targetId: "m2" });
    await expect(
      world.tasks.findDependencies(world.user("writer"), ["alpha"]),
    ).resolves.toHaveLength(1);
  });

  it.each([
    ["itself", { sourceId: "m1", targetId: "m1" }, "dependencySelf"],
    [
      "a missing milestone",
      { sourceId: "m1", targetId: "m9" },
      "dependencyPairInvalid",
    ],
  ])("rejects a dependency on %s", async (_, pair, code) => {
    await expect(
      world.tasks.addDependency(world.user("manager"), {
        projectId: "alpha",
        linkType: "blocks",
        ...pair,
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects an unsupported link type", async () => {
    await expect(
      world.tasks.addDependency(world.user("manager"), {
        projectId: "alpha",
        sourceId: "m1",
        targetId: "m2",
        linkType: "x" as "blocks",
      }),
    ).rejects.toMatchObject({ code: "dependencyTypeUnsupported" });
  });

  it("rejects a milestone of another project", async () => {
    world.addMilestone("m-spare", "spare");

    await expect(
      world.tasks.addDependency(world.user("manager"), {
        projectId: "alpha",
        sourceId: "m1",
        targetId: "m-spare",
        linkType: "blocks",
      }),
    ).rejects.toMatchObject({ code: "dependencyPairInvalid" });
  });

  it("rejects a pair that is already linked in either direction", async () => {
    await world.tasks.addDependency(world.user("manager"), {
      projectId: "alpha",
      sourceId: "m1",
      targetId: "m2",
      linkType: "blocks",
    });

    await expect(
      world.tasks.addDependency(world.user("manager"), {
        projectId: "alpha",
        sourceId: "m2",
        targetId: "m1",
        linkType: "blocks",
      }),
    ).rejects.toMatchObject({ code: "dependencyExists" });
  });

  it("removes a dependency and refuses an unknown one", async () => {
    const dependency = await world.tasks.addDependency(world.user("manager"), {
      projectId: "alpha",
      sourceId: "m1",
      targetId: "m2",
      linkType: "blocks",
    });

    await expect(
      world.tasks.removeDependency(world.user("manager"), "alpha", "nope"),
    ).rejects.toMatchObject({ code: "dependencyNotFound" });
    await world.tasks.removeDependency(
      world.user("manager"),
      "alpha",
      dependency.id,
    );

    expect(world.state.dependencies).toEqual([]);
  });

  it("needs project responsibility to change dependencies", async () => {
    await expect(
      world.tasks.addDependency(world.user("writer"), {
        projectId: "alpha",
        sourceId: "m1",
        targetId: "m2",
        linkType: "blocks",
      }),
    ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
  });
});

describe("archiving milestones", () => {
  beforeEach(async () => {
    await world.tasks.addDependency(world.user("manager"), {
      projectId: "alpha",
      sourceId: "m1",
      targetId: "m2",
      linkType: "blocks",
    });
    world.addTicket("t1", { milestoneId: "m1" });
  });

  it("archives the milestone with its dependencies and keeps its tickets", async () => {
    await world.tasks.archiveMilestone(world.user("manager"), "m1");

    expect(world.state.milestones.get("m1")?.archivedAt).not.toBeNull();
    expect(world.state.dependencies).toEqual([]);
    expect(world.ticket("t1").milestoneId).toBe("m1");
  });

  it.each(["writer", "milestoner", "reader"])(
    "refuses %s without the archive right",
    async (userId) => {
      await expect(
        world.tasks.archiveMilestone(world.user(userId), "m1"),
      ).rejects.toBeInstanceOf(WorkItemAccessDeniedError);
      expect(world.state.milestones.get("m1")?.archivedAt).toBeNull();
      expect(world.state.dependencies).toHaveLength(1);
    },
  );

  it("reports an unknown or archived milestone", async () => {
    await world.tasks.archiveMilestone(world.user("manager"), "m1");

    await expect(
      world.tasks.archiveMilestone(world.user("manager"), "m1"),
    ).rejects.toMatchObject({ code: "milestoneNotFound" });
  });

  it("finds an archived milestone again only on request", async () => {
    await world.tasks.archiveMilestone(world.user("manager"), "m1");

    await expect(
      world.tasks.requireArchivableMilestone(world.user("manager"), "m1", {
        includeArchived: true,
      }),
    ).resolves.toMatchObject({ id: "m1" });
  });
});
