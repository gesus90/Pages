import { describe, expect, it } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { MILESTONE_LINK_TYPE } from "@/definition/Task";

import { useMigratedDatabase } from "../helpers/test-database";

import type { NewMilestone } from "@/backend/database/repositories/TaskRepository";

function createMilestone(overrides: Partial<NewMilestone> = {}): NewMilestone {
  return {
    description: "First release",
    dueAt: "2026-09-30",
    id: "milestone-1",
    name: "MVP",
    projectId: "project-1",
    ...overrides,
  };
}

describe("TaskRepository milestones on DuckDB", () => {
  const getDatabase = useMigratedDatabase();

  async function createRepository(): Promise<TaskRepository> {
    return new TaskRepository(getDatabase());
  }

  it("stores a milestone with its appearance and reads it back", async () => {
    const repository = await createRepository();

    await repository.insertMilestone(
      createMilestone({
        colorCustom: "#a1B2c3",
        colorKey: "release",
        iconKey: "rocket",
        startAt: "2026-09-01",
      }),
    );

    await expect(repository.findMilestoneById("milestone-1")).resolves.toEqual(
      expect.objectContaining({
        archivedAt: null,
        colorCustom: "#a1B2c3",
        colorKey: "release",
        completedAt: null,
        description: "First release",
        dueAt: "2026-09-30",
        iconKey: "rocket",
        name: "MVP",
        startAt: "2026-09-01",
        status: "open",
      }),
    );
  });

  it("reads milestones without optional values", async () => {
    const repository = await createRepository();

    await repository.insertMilestone(createMilestone({ dueAt: null }));

    await expect(
      repository.findMilestoneById("milestone-1"),
    ).resolves.toMatchObject({
      colorCustom: null,
      colorKey: null,
      dueAt: null,
      iconKey: null,
      startAt: null,
    });
  });

  it("ignores stored appearance values the application does not know", async () => {
    const repository = await createRepository();

    await repository.insertMilestone(createMilestone());
    await getDatabase().execute(
      "UPDATE milestones SET color_key = 'neon', icon_key = 'skull', color_custom = 'orange' WHERE id = 'milestone-1';",
    );

    await expect(
      repository.findMilestoneById("milestone-1"),
    ).resolves.toMatchObject({
      colorCustom: null,
      colorKey: null,
      iconKey: null,
    });
  });

  it("stamps completion when a milestone is completed and clears it again", async () => {
    const repository = await createRepository();
    const update = {
      description: "",
      dueAt: "2026-09-30",
      name: "MVP",
      status: "completed",
    } as const;

    await repository.insertMilestone(createMilestone());
    await repository.updateMilestone("milestone-1", update);

    const completed = await repository.findMilestoneById("milestone-1");

    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2} /u);

    await repository.updateMilestone("milestone-1", {
      ...update,
      status: "open",
    });

    await expect(
      repository.findMilestoneById("milestone-1"),
    ).resolves.toMatchObject({ completedAt: null, status: "open" });
  });

  it("archives a milestone and hides it from the project list", async () => {
    const repository = await createRepository();

    await repository.insertMilestone(createMilestone());
    await repository.insertMilestone(
      createMilestone({ id: "milestone-2", name: "Beta" }),
    );
    await repository.archiveMilestone("milestone-1");

    const visible = await repository.findMilestonesByProjectIds(["project-1"]);

    expect(visible.map((milestone) => milestone.id)).toEqual(["milestone-2"]);
    await expect(repository.findMilestoneById("milestone-1")).resolves.toBe(
      null,
    );
  });

  it("orders milestones by due date, then name, with undated ones first", async () => {
    const repository = await createRepository();

    await repository.insertMilestone(
      createMilestone({ dueAt: "2026-10-01", id: "late", name: "Late" }),
    );
    await repository.insertMilestone(
      createMilestone({ dueAt: "2026-09-01", id: "b", name: "B early" }),
    );
    await repository.insertMilestone(
      createMilestone({ dueAt: "2026-09-01", id: "a", name: "A early" }),
    );
    await repository.insertMilestone(
      createMilestone({ dueAt: null, id: "none", name: "Undated" }),
    );

    const milestones = await repository.findMilestonesByProjectIds([
      "project-1",
    ]);

    expect(milestones.map((milestone) => milestone.id)).toEqual([
      "none",
      "a",
      "b",
      "late",
    ]);
  });

  describe("dependencies", () => {
    const dependency = {
      id: "dependency-1",
      linkType: MILESTONE_LINK_TYPE.BLOCKS,
      projectId: "project-1",
      sourceId: "milestone-1",
      targetId: "milestone-2",
    };

    it("stores a dependency and lists it for its project only", async () => {
      const repository = await createRepository();

      await repository.insertDependency(dependency);
      await repository.insertDependency({
        ...dependency,
        id: "dependency-2",
        projectId: "project-2",
        sourceId: "milestone-8",
        targetId: "milestone-9",
      });

      const dependencies = await repository.findDependenciesByProjectIds([
        "project-1",
      ]);

      expect(dependencies).toEqual([
        expect.objectContaining({
          id: "dependency-1",
          linkType: "blocks",
          projectId: "project-1",
          sourceId: "milestone-1",
          targetId: "milestone-2",
        }),
      ]);
    });

    it("lists the dependencies of several projects at once", async () => {
      const repository = await createRepository();

      await repository.insertDependency(dependency);
      await repository.insertDependency({
        ...dependency,
        id: "dependency-2",
        projectId: "project-2",
        sourceId: "milestone-8",
        targetId: "milestone-9",
      });

      const dependencies = await repository.findDependenciesByProjectIds([
        "project-1",
        "project-2",
      ]);

      expect(dependencies.map((entry) => entry.id).sort()).toEqual([
        "dependency-1",
        "dependency-2",
      ]);
    });

    it("lists nothing without projects", async () => {
      const repository = await createRepository();

      await expect(
        repository.findDependenciesByProjectIds([]),
      ).resolves.toEqual([]);
    });

    it("rejects the same link between the same milestones twice", async () => {
      const repository = await createRepository();

      await repository.insertDependency(dependency);

      await expect(
        repository.insertDependency({ ...dependency, id: "dependency-2" }),
      ).rejects.toThrow();
    });

    it("deletes one dependency", async () => {
      const repository = await createRepository();

      await repository.insertDependency(dependency);
      await repository.deleteDependency("dependency-1");

      await expect(
        repository.findDependenciesByProjectIds(["project-1"]),
      ).resolves.toEqual([]);
    });

    it("deletes every dependency that touches a milestone", async () => {
      const repository = await createRepository();

      await repository.insertDependency(dependency);
      await repository.insertDependency({
        ...dependency,
        id: "dependency-2",
        sourceId: "milestone-3",
        targetId: "milestone-1",
      });
      await repository.insertDependency({
        ...dependency,
        id: "dependency-3",
        sourceId: "milestone-3",
        targetId: "milestone-2",
      });

      await repository.deleteDependenciesByMilestone("milestone-1");

      const remaining = await repository.findDependenciesByProjectIds([
        "project-1",
      ]);

      expect(remaining.map((entry) => entry.id)).toEqual(["dependency-3"]);
    });
  });
});
