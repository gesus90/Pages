import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectDepartmentError,
  ProjectManagementDeniedError,
} from "@/backend/error/ProjectErrors";
import { PROJECT_STATUS } from "@/definition/Project";

import { ProjectWorld } from "./project-service-world";

import type { NewProject } from "@/backend/database/repositories/ProjectRepository";

let world = new ProjectWorld();
beforeEach(() => {
  world = new ProjectWorld();
});

function request(overrides: Partial<NewProject> = {}): NewProject {
  return {
    id: "created",
    name: "  Launch  ",
    description: "  Plan the launch.  ",
    ownerId: "someone-else",
    placeholderColor: "#336699",
    status: PROJECT_STATUS.ACTIVE,
    departmentIds: ["engineering"],
    ...overrides,
  };
}

describe("project creation", () => {
  it("stores the trimmed project owned by the actor", async () => {
    const canOpen = await world.service.create(world.user("lead"), request());

    expect(canOpen).toBe(true);
    expect(world.state.inserted).toEqual([
      {
        id: "created",
        name: "Launch",
        description: "Plan the launch.",
        ownerId: "lead",
        placeholderColor: "#336699",
        status: "active",
        departmentIds: ["engineering"],
      },
    ]);
  });

  it("drops duplicate department selections", async () => {
    await world.service.create(
      world.user("lead"),
      request({ departmentIds: ["engineering", "engineering"] }),
    );

    expect(world.state.inserted[0]?.departmentIds).toEqual(["engineering"]);
  });

  it("forgets the cached project list", async () => {
    const invalidate = vi.spyOn(world.cache, "invalidateProjectsList");

    await world.service.create(world.user("lead"), request());

    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("lets an administrator select any department", async () => {
    await expect(
      world.service.create(
        world.user("admin"),
        request({ departmentIds: ["design"] }),
      ),
    ).resolves.toBe(true);
  });

  it("reports that the creator cannot open a project of another department", async () => {
    world.addPerson("remote", {
      capabilities: ["manage_projects"],
      managedDepartments: ["engineering"],
      departments: ["design"],
    });

    const canOpen = await world.service.create(world.user("remote"), request());

    expect(canOpen).toBe(false);
    expect(world.state.inserted).toHaveLength(1);
  });

  it("allows a project without department while no departments exist", async () => {
    world.state.departments = [];

    await expect(
      world.service.create(world.user("admin"), request({ departmentIds: [] })),
    ).resolves.toBe(true);
  });
});

describe("refused project creation", () => {
  it("refuses an actor without the management capability", async () => {
    await expect(
      world.service.create(world.user("writer"), request()),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    expect(world.writes).toEqual([]);
  });

  it("refuses an actor without persisted account", async () => {
    world.state.accounts.delete("lead");

    await expect(
      world.service.create(world.user("lead"), request()),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });

  it.each([
    ["a blank name", { name: "   " }],
    ["a name above 200 characters", { name: "n".repeat(201) }],
    [
      "a description above 10000 characters",
      { description: "d".repeat(10_001) },
    ],
  ])("rejects %s", async (_, overrides) => {
    await expect(
      world.service.create(world.user("lead"), request(overrides)),
    ).rejects.toThrow("Invalid project input.");
    expect(world.writes).toEqual([]);
  });

  it("rejects an unsupported status", async () => {
    await expect(
      world.service.create(
        world.user("lead"),
        request({ status: "unknown" as NewProject["status"] }),
      ),
    ).rejects.toThrow("Invalid project input.");
  });

  it("accepts the maximum name length", async () => {
    await expect(
      world.service.create(
        world.user("lead"),
        request({ name: "n".repeat(200) }),
      ),
    ).resolves.toBe(true);
  });

  it("requires a department while the catalog has some", async () => {
    await expect(
      world.service.create(world.user("lead"), request({ departmentIds: [] })),
    ).rejects.toMatchObject({ code: "departmentRequired" });
  });

  it("rejects a department that does not exist", async () => {
    await expect(
      world.service.create(
        world.user("lead"),
        request({ departmentIds: ["ghost"] }),
      ),
    ).rejects.toMatchObject({ code: "invalidDepartment" });
  });

  it("rejects a department outside the responsibility of the actor", async () => {
    const attempt = world.service.create(
      world.user("lead"),
      request({ departmentIds: ["engineering", "design"] }),
    );

    await expect(attempt).rejects.toBeInstanceOf(ProjectDepartmentError);
    await expect(attempt).rejects.toMatchObject({
      code: "departmentOutOfScope",
    });
    expect(world.writes).toEqual([]);
  });
});

describe("department choices", () => {
  it("offers only departments the actor manages", async () => {
    const choices = await world.service.departmentChoices(world.user("lead"));

    expect(choices.available.map((entry) => entry.id)).toEqual(["engineering"]);
    expect(choices.selectionRequired).toBe(true);
  });

  it("offers every department to an administrator", async () => {
    const choices = await world.service.departmentChoices(world.user("admin"));

    expect(choices.available.map((entry) => entry.id)).toEqual([
      "engineering",
      "design",
    ]);
  });

  it("offers nothing without the management capability", async () => {
    const choices = await world.service.departmentChoices(world.user("writer"));

    expect(choices.available).toEqual([]);
  });

  it("does not require a selection without departments", async () => {
    world.state.departments = [];

    const choices = await world.service.departmentChoices(world.user("admin"));

    expect(choices).toEqual({ available: [], selectionRequired: false });
  });

  it("refuses an inactive account", async () => {
    world.addPerson("gone", {
      isActive: false,
      capabilities: ["manage_projects"],
    });

    await expect(
      world.service.departmentChoices(world.user("gone")),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});
