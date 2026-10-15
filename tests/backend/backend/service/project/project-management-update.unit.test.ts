import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import { ProjectWorld } from "./project-service-world";

import type {
  ProjectDetailsUpdate,
  ProjectUpdate,
} from "@/backend/database/repositories/ProjectRepository";

let world = new ProjectWorld();
beforeEach(() => {
  world = new ProjectWorld();
});

function general(overrides: Partial<ProjectUpdate> = {}): ProjectUpdate {
  return {
    name: "  Renamed  ",
    description: "  New text  ",
    status: "paused",
    progress: 40,
    ...overrides,
  };
}

function details(
  overrides: Partial<ProjectDetailsUpdate> = {},
): ProjectDetailsUpdate {
  return {
    ...general(),
    managerId: null,
    startDate: "2026-02-01",
    targetDate: "2026-03-01",
    notes: "  Notes  ",
    ...overrides,
  };
}

describe("general project update", () => {
  it("stores trimmed values for a responsible co-owner", async () => {
    await world.service.update(world.user("lead"), "alpha", general());

    expect(world.project("alpha")).toMatchObject({
      name: "Renamed",
      description: "New text",
      status: "paused",
      progress: 40,
    });
  });

  it("forgets the cached project", async () => {
    const invalidate = vi.spyOn(world.cache, "invalidateProject");

    await world.service.update(world.user("lead"), "alpha", general());

    expect(invalidate).toHaveBeenCalledWith("alpha");
  });

  it("lets the project manager update without the global capability", async () => {
    world.manage("alpha", "writer");

    await expect(
      world.service.update(world.user("writer"), "alpha", general()),
    ).resolves.toBeUndefined();
  });

  it("refuses a reader and changes nothing", async () => {
    await expect(
      world.service.update(world.user("writer"), "alpha", general()),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.writes).toEqual([]);
    expect(world.project("alpha").name).toBe("alpha");
  });

  it("refuses a project of a foreign department as no access", async () => {
    await expect(
      world.service.update(world.user("outsider"), "alpha", general()),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("reports a missing project", async () => {
    await expect(
      world.service.update(world.user("admin"), "missing", general()),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("requires a department of a project while departments exist", async () => {
    world.addProject("loose", []);

    await expect(
      world.service.update(world.user("admin"), "loose", general()),
    ).rejects.toMatchObject({ code: "departmentRequired" });
    expect(world.writes).toEqual([]);
  });

  it.each([
    ["a blank name", { name: " " }, "Project name must be between 1 and 200"],
    ["a long name", { name: "n".repeat(201) }, "Project name must be between"],
    ["a long description", { description: "d".repeat(10_001) }, "Invalid"],
    ["an unknown status", { status: "gone" as "paused" }, "Invalid"],
    ["a progress above 100", { progress: 101 }, "Invalid"],
    ["a negative progress", { progress: -1 }, "Invalid"],
    ["a fractional progress", { progress: 50.5 }, "Invalid"],
  ])("rejects %s", async (_, overrides, message) => {
    await expect(
      world.service.update(world.user("lead"), "alpha", general(overrides)),
    ).rejects.toThrow(message);
    expect(world.writes).toEqual([]);
  });

  it.each([0, 100])("accepts the progress boundary %i", async (progress) => {
    await world.service.update(
      world.user("lead"),
      "alpha",
      general({ progress }),
    );

    expect(world.project("alpha").progress).toBe(progress);
  });
});

describe("project detail update", () => {
  it("saves the details and records one activity entry", async () => {
    const updated = await world.service.updateDetails(
      world.user("lead"),
      "alpha",
      details({ managerId: "writer" }),
    );

    expect(updated).toMatchObject({
      name: "Renamed",
      notes: "Notes",
      managerId: "writer",
      startDate: "2026-02-01",
    });
    expect(world.writes).toEqual(["updateDetails", "insertActivity"]);
    expect(world.state.activity).toMatchObject([
      {
        projectId: "alpha",
        userId: "lead",
        action: "project_updated",
        category: "project",
      },
    ]);
  });

  it("requires the manager to be a member of the project", async () => {
    await expect(
      world.service.updateDetails(
        world.user("lead"),
        "alpha",
        details({ managerId: "outsider" }),
      ),
    ).rejects.toThrow("The project manager must be a member of the project.");
    expect(world.writes).toEqual([]);
  });

  it("limits the notes to 10000 characters", async () => {
    await expect(
      world.service.updateDetails(
        world.user("lead"),
        "alpha",
        details({ notes: "n".repeat(10_001) }),
      ),
    ).rejects.toThrow("Project notes must not exceed 10,000 characters.");
    expect(world.writes).toEqual([]);
  });

  it("accepts notes of exactly 10000 characters", async () => {
    await expect(
      world.service.updateDetails(
        world.user("lead"),
        "alpha",
        details({ notes: "n".repeat(10_000) }),
      ),
    ).resolves.toMatchObject({ id: "alpha" });
  });

  it("applies the general validation", async () => {
    await expect(
      world.service.updateDetails(
        world.user("lead"),
        "alpha",
        details({ progress: 200 }),
      ),
    ).rejects.toThrow("Invalid project input.");
  });

  it("refuses a reader without activity or change", async () => {
    await expect(
      world.service.updateDetails(world.user("writer"), "alpha", details()),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.state.activity).toEqual([]);
  });

  it("forgets the cached project after the change", async () => {
    const invalidate = vi.spyOn(world.cache, "invalidateProject");

    await world.service.updateDetails(world.user("lead"), "alpha", details());

    expect(invalidate).toHaveBeenCalledWith("alpha");
  });
});

describe("project icon", () => {
  const icon = {
    mimeType: "image/png",
    filename: "icon.png",
    data: Buffer.from([1, 2, 3]),
  };

  it("stores the icon for a responsible manager", async () => {
    world.manage("alpha", "writer");

    await world.service.replaceIcon(world.user("writer"), "alpha", icon);

    await expect(
      world.service.getIcon(world.user("writer"), "alpha"),
    ).resolves.toEqual(icon);
  });

  it("refuses to replace the icon without responsibility", async () => {
    await expect(
      world.service.replaceIcon(world.user("writer"), "alpha", icon),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.state.icons.size).toBe(0);
  });

  it("refuses to read the icon of a project without access", async () => {
    await expect(
      world.service.getIcon(world.user("outsider"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("returns no icon while none is stored", async () => {
    await expect(
      world.service.getIcon(world.user("writer"), "alpha"),
    ).resolves.toBeNull();
  });
});
