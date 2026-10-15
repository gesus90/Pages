import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import { ProjectWorld } from "./project-service-world";

let world = new ProjectWorld();
beforeEach(() => {
  world = new ProjectWorld();
});

describe("project listing", () => {
  beforeEach(() => {
    world.addProject("beta", ["design"]);
    world.addProject("shared", []);
  });

  it("lists the projects of the own departments and unassigned projects", async () => {
    const projects = await world.service.findAll(world.user("writer"));

    expect(projects.map((project) => project.id).sort()).toEqual([
      "alpha",
      "shared",
    ]);
  });

  it("lists every active project in administrator mode", async () => {
    const projects = await world.service.findAll(world.user("admin"));

    expect(projects.map((project) => project.id).sort()).toEqual([
      "alpha",
      "beta",
      "shared",
    ]);
  });

  it("does not list archived projects", async () => {
    world.archive("alpha");

    const projects = await world.service.findAll(world.user("admin"));

    expect(projects.map((project) => project.id)).not.toContain("alpha");
  });

  it("refuses an inactive account", async () => {
    world.addPerson("gone", { isActive: false });

    await expect(
      world.service.findAll(world.user("gone")),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("refuses an account without persisted authorization", async () => {
    world.state.accounts.delete("writer");

    await expect(
      world.service.findAll(world.user("writer")),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("applies the current scope to rows another user cached", async () => {
    const cache = new ServerCache();
    world = new ProjectWorld({ cache });
    world.addProject("beta", ["design"]);
    const findAll = vi.spyOn(ProjectRepository.prototype, "findAll");

    const forAdmin = await world.service.findAll(world.user("admin"));
    const forOutsider = await world.service.findAll(world.user("outsider"));

    expect(forAdmin.map((project) => project.id).sort()).toEqual([
      "alpha",
      "beta",
    ]);
    expect(forOutsider.map((project) => project.id)).toEqual(["beta"]);
    expect(findAll).toHaveBeenCalledTimes(1);
  });
});

describe("single project access", () => {
  it("returns a project of an own department", async () => {
    await expect(
      world.service.getById(world.user("writer"), "alpha"),
    ).resolves.toMatchObject({ id: "alpha" });
  });

  it("reports a missing project", async () => {
    await expect(
      world.service.getById(world.user("admin"), "missing"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("treats an archived project as missing", async () => {
    world.archive("alpha");

    await expect(
      world.service.getById(world.user("admin"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("refuses a project of a foreign department", async () => {
    await expect(
      world.service.getById(world.user("outsider"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("lets an unbound role read projects of every department", async () => {
    world.addPerson("roaming", {
      capabilities: ["write"],
      departmentBound: false,
      departments: [],
    });

    await expect(
      world.service.getById(world.user("roaming"), "alpha"),
    ).resolves.toMatchObject({ id: "alpha" });
  });

  it("does not widen reads through project management", async () => {
    world.manage("alpha", "outsider");

    await expect(
      world.service.getById(world.user("outsider"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });

  it("refuses an actor whose account was deactivated meanwhile", async () => {
    world.addPerson("writer", { isActive: false });

    await expect(
      world.service.getById(world.user("writer"), "alpha"),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});

describe("ticket visibility", () => {
  beforeEach(() => {
    world.addProject("beta", ["design"]);
  });

  it("limits a member to the own departments and accessible projects", async () => {
    await expect(
      world.service.workItemVisibility(world.user("writer")),
    ).resolves.toEqual({
      departmentIds: ["engineering"],
      projectIds: ["alpha"],
    });
  });

  it("does not limit departments in administrator mode", async () => {
    const visibility = await world.service.workItemVisibility(
      world.user("admin"),
    );

    expect(visibility.departmentIds).toBeNull();
    expect([...(visibility.projectIds ?? [])].sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("drops archived projects from the visible projects", async () => {
    world.archive("alpha");

    const visibility = await world.service.workItemVisibility(
      world.user("writer"),
    );

    expect(visibility.projectIds).toEqual([]);
  });
});

describe("authorization facts", () => {
  it("returns the active account with the live department catalog", async () => {
    const facts = await world.service.authorizationFacts(world.user("writer"));

    expect(facts.account.userId).toBe("writer");
    expect(facts.departments.map((department) => department.id)).toEqual([
      "engineering",
      "design",
    ]);
  });

  it("refuses an inactive account", async () => {
    world.addPerson("gone", { isActive: false });

    await expect(
      world.service.authorizationFacts(world.user("gone")),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});

describe("assignee filtering", () => {
  it("keeps only candidates with current access to each project", async () => {
    world.addProject("beta", ["design"]);
    const candidates = new Map([
      ["alpha", [world.user("writer"), world.user("outsider")]],
      ["beta", [world.user("writer"), world.user("outsider")]],
    ]);

    const eligible = await world.service.filterAssignees(candidates);

    expect(eligible.get("alpha")?.map((user) => user.id)).toEqual(["writer"]);
    expect(eligible.get("beta")?.map((user) => user.id)).toEqual(["outsider"]);
  });

  it("drops inactive and unknown candidates and archived projects", async () => {
    world.addPerson("gone", { isActive: false });
    world.addProject("old", ["engineering"]);
    world.archive("old");
    const unknown = { ...world.user("writer"), id: "unknown" };
    const candidates = new Map([
      ["alpha", [world.user("gone"), unknown, world.user("admin")]],
      ["old", [world.user("writer")]],
    ]);

    const eligible = await world.service.filterAssignees(candidates);

    expect(eligible.get("alpha")?.map((user) => user.id)).toEqual(["admin"]);
    expect(eligible.has("old")).toBe(false);
  });
});

describe("write access", () => {
  it("allows an administrator", async () => {
    await expect(
      world.service.canWriteProject(world.user("admin"), "alpha"),
    ).resolves.toBe(true);
  });

  it("allows a scoped co-owner of the project departments", async () => {
    await expect(
      world.service.canWriteProject(world.user("lead"), "alpha"),
    ).resolves.toBe(true);
  });

  it("refuses a co-owner of other departments", async () => {
    world.addProject("beta", ["design"]);
    world.addPerson("elsewhere", {
      capabilities: ["write", "manage_projects"],
      managedDepartments: ["design"],
    });

    await expect(
      world.service.canWriteProject(world.user("elsewhere"), "alpha"),
    ).resolves.toBe(false);
  });

  it("refuses a plain writer and allows the same person as project manager", async () => {
    await expect(
      world.service.canWriteProject(world.user("writer"), "alpha"),
    ).resolves.toBe(false);

    world.manage("alpha", "writer");

    await expect(
      world.service.canWriteProject(world.user("writer"), "alpha"),
    ).resolves.toBe(true);
  });

  it("refuses a project manager without read access", async () => {
    world.manage("alpha", "outsider");

    await expect(
      world.service.canWriteProject(world.user("outsider"), "alpha"),
    ).resolves.toBe(false);
  });

  it("refuses a missing project", async () => {
    await expect(
      world.service.canWriteProject(world.user("admin"), "missing"),
    ).resolves.toBe(false);
  });
});

describe("management capability hints", () => {
  it.each([
    ["admin", true],
    ["lead", true],
    ["writer", false],
  ])("reports %s as %s", async (userId, expected) => {
    const actor = world.user(userId);

    await expect(world.service.canManageProjects(actor)).resolves.toBe(
      expected,
    );
    await expect(world.service.canCreateProjects(actor)).resolves.toBe(
      expected,
    );
  });
});
