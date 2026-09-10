import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { ROLE } from "@/definition/Role";

import type { Project } from "@/definition/Project";
import type { User } from "@/definition/User";

function createUser(): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
  };
}

function createProject(): Project {
  return {
    createdAt: "2026-01-01",
    description: "Description",
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
    const repository = {
      findAll: vi.fn().mockResolvedValue([createProject()]),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    const permissions = {
      hasPermission: vi.fn().mockReturnValue(true),
    };
    const service = new ProjectService(
      repository as never,
      permissions as never,
      null,
      cache,
    );
    const actor = createUser();

    expect(await service.findAll(actor)).toHaveLength(1);
    expect(await service.findAll(actor)).toHaveLength(1);
    expect(repository.findAll).toHaveBeenCalledTimes(1);

    await service.create(actor, {
      description: "",
      id: "project-2",
      name: "Second",
      ownerId: actor.id,
      placeholderColor: "#FCE3D3",
      status: "planned",
    });

    await service.findAll(actor);
    expect(repository.findAll).toHaveBeenCalledTimes(2);
  });

  it("caches project rows and invalidates them on update", async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(createProject()),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const permissions = {
      hasPermission: vi.fn().mockReturnValue(true),
    };
    const service = new ProjectService(
      repository as never,
      permissions as never,
      null,
      cache,
    );
    const actor = createUser();

    await service.getById(actor, "project-1");
    await service.getById(actor, "project-1");
    expect(repository.findById).toHaveBeenCalledTimes(1);

    await service.update(actor, "project-1", {
      description: "Description",
      name: "Project",
      progress: 10,
      status: "active",
    });

    await service.getById(actor, "project-1");
    expect(repository.findById).toHaveBeenCalledTimes(2);
  });

  it("serves work item queries from the cache and invalidates on archive", async () => {
    const projectService = {
      findAll: vi.fn().mockResolvedValue([createProject()]),
      getById: vi.fn().mockResolvedValue(createProject()),
    };
    const repository = {
      archive: vi.fn().mockResolvedValue(undefined),
      findAll: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      insertHistory: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TaskService(
      repository as never,
      projectService as never,
      { hasPermission: vi.fn() } as never,
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
      findAll: vi.fn().mockResolvedValue([createProject()]),
    };
    const repository = {
      findAll: vi.fn().mockResolvedValue([]),
    };
    const service = new TaskService(
      repository as never,
      projectService as never,
      { hasPermission: vi.fn() } as never,
      cache,
    );
    const actor = createUser();

    await service.findAll(actor, { archived: "active" });
    await service.findAll(actor, { archived: "archived" });
    await service.findAll(actor, { archived: "active" });

    expect(repository.findAll).toHaveBeenCalledTimes(2);
  });
});
