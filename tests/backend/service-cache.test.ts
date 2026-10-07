import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";

import { createDatabase, createUser } from "../helpers/factories";
import { createAccess, createRole } from "../helpers/authorization";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

import type { Project } from "@/definition/Project";

function createProject(): Project {
  return {
    createdAt: "2026-01-01",
    description: "Description",
    departments: [],
    hasIcon: false,
    id: "project-1",
    managerId: null,
    managerName: null,
    name: "Project",
    notes: "",
    parentId: null,
    placeholderColor: "#FCE3D3",
    progress: 0,
    startDate: null,
    status: "active",
    targetDate: null,
    updatedAt: "2026-01-02",
  };
}

describe("service cache behavior", () => {
  let cache: ServerCache;

  beforeEach(() => {
    cache = new ServerCache();
  });

  it("serves project listings from the cache and invalidates on create", async () => {
    const repository = new ProjectRepository(createDatabase());
    vi.spyOn(repository, "transaction").mockImplementation(async (operation) =>
      operation(repository),
    );
    const authorization = repository.authorization();
    vi.spyOn(authorization, "snapshot").mockResolvedValue({
      departments: [],
      roles: [],
      accounts: [
        createAccess({
          userId: "user-1",
          isAdmin: true,
          mode: "admin",
          role: null,
        }),
      ],
    });
    vi.spyOn(repository, "authorization").mockReturnValue(authorization);
    vi.spyOn(repository, "findActiveIds").mockResolvedValue(["project-1"]);
    vi.spyOn(repository, "findDepartmentsByProjects").mockResolvedValue(
      new Map(),
    );
    const findAll = vi
      .spyOn(repository, "findAll")
      .mockResolvedValue([createProject()]);
    vi.spyOn(repository, "insert").mockResolvedValue(undefined);
    const permissions = {
      hasPermission: vi.fn().mockReturnValue(true),
      hasCapability: vi.fn().mockResolvedValue(true),
    };
    const service = new ProjectService(
      repository,
      permissions as never,
      null,
      cache,
    );
    const actor = createUser();

    expect(await service.findAll(actor)).toHaveLength(1);
    expect(await service.findAll(actor)).toHaveLength(1);
    expect(findAll).toHaveBeenCalledTimes(1);

    await service.create(actor, {
      description: "",
      id: "project-2",
      name: "Second",
      ownerId: actor.id,
      placeholderColor: "#FCE3D3",
      status: "planned",
    });

    await service.findAll(actor);
    expect(findAll).toHaveBeenCalledTimes(2);
  });

  it("reads current project assignments on every single-project request", async () => {
    const repository = new ProjectRepository(createDatabase());
    const authorization = repository.authorization();
    vi.spyOn(authorization, "snapshot").mockResolvedValue({
      departments: [],
      roles: [],
      accounts: [
        createAccess({
          userId: "user-1",
          role: createRole({ departmentBound: false }),
        }),
      ],
    });
    vi.spyOn(repository, "authorization").mockReturnValue(authorization);
    const findById = vi
      .spyOn(repository, "findById")
      .mockResolvedValue(createProject());
    const service = new ProjectService(
      repository,
      new PermissionService(),
      null,
      cache,
    );
    await service.getById(createUser(), "project-1");
    await service.getById(createUser(), "project-1");
    expect(findById).toHaveBeenCalledTimes(2);
    findById.mockResolvedValue({
      ...createProject(),
      departments: [{ id: "backend", name: "Backend" }],
    });
    vi.mocked(authorization.snapshot).mockResolvedValue({
      departments: [],
      roles: [],
      accounts: [createAccess({ userId: "user-1", departments: ["frontend"] })],
    });
    await expect(service.getById(createUser(), "project-1")).rejects.toThrow(
      "not allowed",
    );
  });

  it("serves work item queries from the cache and invalidates on archive", async () => {
    const projectService = {
      workItemVisibility: vi
        .fn()
        .mockResolvedValue({ departmentIds: null, projectIds: ["project-1"] }),
      findAll: vi.fn().mockResolvedValue([createProject()]),
      getById: vi.fn().mockResolvedValue(createProject()),
    };
    const repository = {
      archiveMany: vi.fn().mockResolvedValue(undefined),
      findSubtreeIds: vi.fn().mockResolvedValue(["item-1"]),
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      insertHistory: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TaskService(
      repository as never,
      projectService as never,
      {
        hasPermission: vi.fn(),
        hasCapability: vi.fn().mockResolvedValue(true),
      } as never,
      cache,
    );
    const actor = createUser();

    await service.findAll(actor);
    await service.findAll(actor);
    expect(repository.findAll).toHaveBeenCalledTimes(1);

    repository.findById.mockResolvedValue({
      id: "item-1",
      projectId: "project-1",
    });
    await service.archive(actor, "item-1");

    await service.findAll(actor);
    expect(repository.findAll).toHaveBeenCalledTimes(2);
  });

  it("keeps separate cache entries per query shape", async () => {
    const projectService = {
      workItemVisibility: vi
        .fn()
        .mockResolvedValue({ departmentIds: null, projectIds: ["project-1"] }),
      findAll: vi.fn().mockResolvedValue([createProject()]),
    };
    const repository = {
      findAll: vi.fn().mockResolvedValue([]),
    };
    const service = new TaskService(
      repository as never,
      projectService as never,
      {
        hasPermission: vi.fn(),
        hasCapability: vi.fn().mockResolvedValue(true),
      } as never,
      cache,
    );
    const actor = createUser();

    await service.findAll(actor, { archived: "active" });
    await service.findAll(actor, { archived: "archived" });
    await service.findAll(actor, { archived: "active" });

    expect(repository.findAll).toHaveBeenCalledTimes(2);
  });
});
