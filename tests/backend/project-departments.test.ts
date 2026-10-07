import { describe, expect, it, vi } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { ProjectDepartmentRepository } from "@/backend/database/repositories/project/ProjectDepartmentRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { createDatabase } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

const PROJECT = {
  id: "project",
  name: "Shared project",
  description: "",
  ownerId: "owner",
  placeholderColor: "#FCE3D3",
  status: "planned" as const,
  departmentIds: ["frontend", "backend", "frontend"],
};

describe("project department persistence", () => {
  const getDatabase = useMigratedDatabase();

  async function setup(): Promise<ProjectRepository> {
    const authorization = new AuthorizationRepository(getDatabase());
    await authorization.saveDepartment({ id: "frontend", name: "Frontend" });
    await authorization.saveDepartment({ id: "backend", name: "Backend" });
    return new ProjectRepository(getDatabase());
  }

  it("creates no departments or assignments during migration", async () => {
    expect(
      await getDatabase().query("SELECT COUNT(*) FROM departments;"),
    ).toEqual([[0]]);
    expect(
      await getDatabase().query("SELECT COUNT(*) FROM project_departments;"),
    ).toEqual([[0]]);
    expect(await new ProjectRepository(getDatabase()).findAll()).toEqual([]);
    expect(
      await new ProjectDepartmentRepository(getDatabase()).findByProjectIds([]),
    ).toEqual(new Map());
  });

  it("stores initial assignments atomically with the project and owner", async () => {
    const repository = await setup();
    await repository.insert(PROJECT);
    const departments = [
      { id: "backend", name: "Backend" },
      { id: "frontend", name: "Frontend" },
    ];
    expect((await repository.findById("project"))?.departments).toEqual(
      departments,
    );
    expect((await repository.findAll())[0]?.departments).toEqual(departments);
    expect((await repository.findByMemberId("owner"))[0]?.departments).toEqual(
      departments,
    );
    expect(await repository.isProjectManager("project", "owner")).toBe(true);
    expect(await repository.findDepartments("project")).toEqual(departments);
    expect(await repository.findDepartments("missing")).toEqual([]);
    await expect(repository.insert(PROJECT)).rejects.toThrow();
    expect(await repository.findDepartments("project")).toEqual(departments);
  });

  it("replaces assignments without duplicates and exposes live catalog names", async () => {
    const repository = await setup();
    await repository.insert(PROJECT);
    await repository.transaction(async (transaction) => {
      await transaction.setDepartments("project", ["frontend", "frontend"]);
      await transaction
        .authorization()
        .saveDepartment({ id: "frontend", name: "Web" });
    });
    expect((await repository.findAll())[0]?.departments).toEqual([
      { id: "frontend", name: "Web" },
    ]);
    await repository.transaction((transaction) =>
      transaction.setDepartments("project", []),
    );
    expect((await repository.findById("project"))?.departments).toEqual([]);
    expect((await repository.findByMemberId("owner"))[0]?.departments).toEqual(
      [],
    );
  });

  it("rolls back the project and owner when initial assignment persistence fails", async () => {
    const repository = await setup();
    vi.spyOn(
      ProjectDepartmentRepository.prototype,
      "replace",
    ).mockRejectedValueOnce(new Error("Assignment failed"));
    await expect(repository.insert(PROJECT)).rejects.toThrow(
      "Assignment failed",
    );
    expect(await repository.findById("project")).toBeNull();
    expect(await repository.isMember("project", "owner")).toBe(false);
    expect(await repository.findDepartments("project")).toEqual([]);
  });

  it("deletes department assignments without deleting the project", async () => {
    const repository = await setup();
    await repository.insert(PROJECT);
    await repository.transaction((transaction) =>
      transaction.authorization().deleteDepartment("frontend"),
    );
    expect((await repository.findById("project"))?.departments).toEqual([
      { id: "backend", name: "Backend" },
    ]);
    await repository
      .authorization()
      .transaction((authorization) =>
        authorization.deleteDepartment("backend"),
      );
    expect((await repository.findById("project"))?.departments).toEqual([]);
    expect(
      await getDatabase().query("SELECT COUNT(*) FROM project_departments;"),
    ).toEqual([[0]]);
  });
});

describe("project department row contracts", () => {
  it.each([
    [null, "Name"],
    ["department", null],
  ])("rejects invalid single-project department rows", async (id, name) => {
    const database = createDatabase();
    database.query.mockResolvedValue([[id, name]]);
    await expect(
      new ProjectDepartmentRepository(database).findByProjectId("project"),
    ).rejects.toThrow();
  });

  it.each([
    [null, "department", "Name"],
    ["project", null, "Name"],
    ["project", "department", null],
  ])("rejects invalid batch department rows", async (projectId, id, name) => {
    const database = createDatabase();
    database.query.mockResolvedValue([[projectId, id, name]]);
    await expect(
      new ProjectDepartmentRepository(database).findByProjectIds(["project"]),
    ).rejects.toThrow();
  });
});

describe("A2 changes invalidate project visibility", () => {
  const getDatabase = useMigratedDatabase();

  it("clears project lists after membership and scope changes and rows after catalog changes", async () => {
    const repository = new AuthorizationRepository(getDatabase());
    await repository.users().insert({
      id: "admin",
      username: "admin",
      displayName: "Admin",
      role: "admin",
      passwordHash: "hash",
    });
    const cache = new ServerCache();
    const administration = new AdministrationService(
      repository,
      cache,
      new PasswordHasher(),
    );
    cache.set("projects:list:old", [], 60_000);
    await administration.saveDepartment("admin", {
      id: "department",
      name: "Department",
    });
    expect(cache.get("projects:list:old")).toBeUndefined();
    cache.set("projects:list:old", [], 60_000);
    await administration.setMemberships("admin", "admin", ["department"]);
    expect(cache.get("projects:list:old")).toBeUndefined();
    cache.set("projects:list:old", [], 60_000);
    await administration.setScope("admin", "admin", {
      managedDepartments: ["department"],
      allDepartments: false,
      allProjects: false,
    });
    expect(cache.get("projects:list:old")).toBeUndefined();
    cache.set("project:old", {}, 60_000);
    await administration.saveDepartment("admin", {
      id: "department",
      name: "Renamed",
    });
    expect(cache.get("project:old")).toBeUndefined();
    cache.set("project:old", {}, 60_000);
    cache.set("projects:list:old", [], 60_000);
    await administration.deleteDepartment("admin", "department");
    expect(cache.get("project:old")).toBeUndefined();
    expect(cache.get("projects:list:old")).toBeUndefined();
  });
});
