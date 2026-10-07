import { describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { ProjectDepartmentRepository } from "@/backend/database/repositories/project/ProjectDepartmentRepository";
import { ProjectCreationService } from "@/backend/service/project/ProjectCreationService";
import { createAccess, createRole } from "../helpers/authorization";
import { createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

import type { AccountAccess } from "@/definition/Authorization";

const INPUT = {
  id: "project",
  name: "  Shared project  ",
  description: "  Description  ",
  ownerId: "forged-owner",
  placeholderColor: "#FCE3D3",
  status: "planned" as const,
};

describe("transactional project creation policy", () => {
  const getDatabase = useMigratedDatabase();
  const actor = createUser({ id: "actor", role: "admin" });

  async function setup(account: AccountAccess = createAccess()): Promise<{
    authorization: AuthorizationRepository;
    repository: ProjectRepository;
    service: ProjectCreationService;
    cache: ServerCache;
  }> {
    const authorization = new AuthorizationRepository(getDatabase());
    await authorization.users().insert({
      id: "actor",
      username: "actor",
      displayName: "Actor",
      role: "employee",
      passwordHash: "hash",
    });
    if (account.role) await authorization.saveRole(account.role);
    await authorization.saveAccount(account);
    const repository = new ProjectRepository(getDatabase());
    const cache = new ServerCache();
    return {
      authorization,
      repository,
      cache,
      service: new ProjectCreationService(repository, cache),
    };
  }

  it("allows an empty catalog, normalizes input and fixes the creator membership", async () => {
    const { service, repository, cache } = await setup();
    expect(await service.choices(actor)).toEqual({
      available: [],
      selectionRequired: false,
    });
    cache.set("projects:list:old", [], 60_000);
    await service.create(actor, INPUT);
    expect(await repository.findById("project")).toMatchObject({
      name: "Shared project",
      description: "Description",
      departments: [],
    });
    expect(await repository.isProjectManager("project", "actor")).toBe(true);
    expect(await repository.isMember("project", "forged-owner")).toBe(false);
    expect(cache.get("projects:list:old")).toBeUndefined();
  });

  it("shows only selectable departments and rejects absent, unknown and out-of-scope selections", async () => {
    const { service, authorization, repository } = await setup(
      createAccess({ managedDepartments: ["frontend"] }),
    );
    await authorization.saveDepartment({ id: "frontend", name: "Frontend" });
    await authorization.saveDepartment({ id: "backend", name: "Backend" });
    expect(await service.choices(actor)).toEqual({
      available: [{ id: "frontend", name: "Frontend" }],
      selectionRequired: true,
    });
    await expect(service.create(actor, INPUT)).rejects.toMatchObject({
      code: "departmentRequired",
    });
    await expect(
      service.create(actor, { ...INPUT, departmentIds: ["missing"] }),
    ).rejects.toMatchObject({ code: "invalidDepartment" });
    await expect(
      service.create(actor, { ...INPUT, departmentIds: ["backend"] }),
    ).rejects.toMatchObject({ code: "departmentOutOfScope" });
    expect(await repository.findAll()).toEqual([]);
    await service.create(actor, {
      ...INPUT,
      departmentIds: ["frontend", "frontend"],
    });
    expect(await repository.findDepartments("project")).toEqual([
      { id: "frontend", name: "Frontend" },
    ]);
  });

  it("reports no read access when assigning a managed department outside own membership", async () => {
    const { service, authorization, repository } = await setup(
      createAccess({
        role: createRole({ departmentBound: true }),
        departments: [],
        managedDepartments: ["frontend"],
        allProjects: false,
      }),
    );
    await authorization.saveDepartment({ id: "frontend", name: "Frontend" });
    await expect(
      service.create(actor, { ...INPUT, departmentIds: ["frontend"] }),
    ).resolves.toBe(false);
    expect(await repository.isProjectManager(INPUT.id, actor.id)).toBe(true);
  });

  it("uses current capability and active state instead of the submitted legacy role", async () => {
    const account = createAccess();
    const { service, authorization, repository } = await setup(account);
    await authorization.saveRole(createRole({ permissions: [] }));
    expect(await service.choices(actor)).toEqual({
      available: [],
      selectionRequired: false,
    });
    await expect(service.create(actor, INPUT)).rejects.toThrow("not allowed");
    await authorization.saveRole(createRole());
    await getDatabase().execute(
      "UPDATE users SET is_active = 0 WHERE id = 'actor';",
    );
    await expect(service.create(actor, INPUT)).rejects.toThrow("not allowed");
    await expect(service.choices(actor)).rejects.toThrow("not allowed");
    await expect(
      service.create(createUser({ id: "missing" }), INPUT),
    ).rejects.toThrow("not allowed");
    await expect(
      service.choices(createUser({ id: "missing" })),
    ).rejects.toThrow("not allowed");
    expect(await repository.findAll()).toEqual([]);
  });

  it("permits a current administrator to choose the complete catalog", async () => {
    const { authorization, service } = await setup(
      createAccess({
        isAdmin: true,
        mode: "admin",
        role: null,
        managedDepartments: [],
      }),
    );
    await authorization.saveDepartment({ id: "backend", name: "Backend" });
    expect((await service.choices(actor)).available).toEqual([
      { id: "backend", name: "Backend" },
    ]);
    await service.create(actor, { ...INPUT, departmentIds: ["backend"] });
  });

  it.each([
    { name: " " },
    { name: "x".repeat(201) },
    { description: "x".repeat(10_001) },
  ])("rejects invalid persisted text before writing: %j", async (invalid) => {
    const { service, repository } = await setup();
    await expect(
      service.create(actor, { ...INPUT, ...invalid }),
    ).rejects.toThrow("Invalid project input");
    expect(await repository.findAll()).toEqual([]);
  });

  it("rolls back all creation writes and retains cached listings after persistence fails", async () => {
    const { service, repository, cache } = await setup();
    cache.set("projects:list:old", ["old"], 60_000);
    vi.spyOn(
      ProjectDepartmentRepository.prototype,
      "replace",
    ).mockRejectedValueOnce(new Error("Assignment failed"));
    await expect(service.create(actor, INPUT)).rejects.toThrow(
      "Assignment failed",
    );
    expect(await repository.findById("project")).toBeNull();
    expect(await repository.isMember("project", "actor")).toBe(false);
    expect(cache.get("projects:list:old")).toEqual(["old"]);
  });
});
