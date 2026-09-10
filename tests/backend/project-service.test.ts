import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { PERMISSION, ROLE } from "@/definition/Role";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
  ProjectService,
} from "@/backend/service/ProjectService";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { Project } from "@/definition/Project";
import type { User } from "@/definition/User";

function createUser(overrides: Partial<User> = {}): User {
  return {
    displayName: "Admin",
    id: "user-1",
    isActive: true,
    role: ROLE.ADMIN,
    username: "admin",
    ...overrides,
  };
}

function createProject(): Project {
  return {
    createdAt: "2026-01-01",
    description: "New public website",
    hasIcon: false,
    id: "project-1",
    managerId: null,
    managerName: null,
    name: "Website refresh",
    notes: "",
    parentId: null,
    placeholderColor: "#FCE3D3",
    progress: 0,
    startDate: null,
    status: "planned",
    targetDate: null,
    updatedAt: "2026-01-02",
  };
}

interface MockProjectRepository {
  readonly archive: ReturnType<typeof vi.fn>;
  readonly findAll: ReturnType<typeof vi.fn>;
  readonly findById: ReturnType<typeof vi.fn>;
  readonly findByMemberId: ReturnType<typeof vi.fn>;
  readonly findIconByProjectId: ReturnType<typeof vi.fn>;
  readonly findIntegrationsByProjectIds: ReturnType<typeof vi.fn>;
  readonly insert: ReturnType<typeof vi.fn>;
  readonly isMember: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
  readonly upsertIcon: ReturnType<typeof vi.fn>;
}

function createRepository(): ProjectRepository & MockProjectRepository {
  return {
    archive: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    findByMemberId: vi.fn(),
    findIconByProjectId: vi.fn(),
    findIntegrationsByProjectIds: vi.fn().mockResolvedValue(new Map()),
    insert: vi.fn(),
    isMember: vi.fn(),
    update: vi.fn(),
    upsertIcon: vi.fn(),
  } as unknown as ProjectRepository & MockProjectRepository;
}

function createPermissions(): PermissionService & {
  hasPermission: ReturnType<typeof vi.fn>;
} {
  return {
    hasPermission: vi.fn().mockReturnValue(true),
  } as unknown as PermissionService & {
    hasPermission: ReturnType<typeof vi.fn>;
  };
}

describe("ProjectService", () => {
  let permissions: ReturnType<typeof createPermissions>;
  let repository: ReturnType<typeof createRepository>;
  let service: ProjectService;

  beforeEach(() => {
    permissions = createPermissions();
    repository = createRepository();
    service = new ProjectService(repository, permissions);
  });

  it("returns every project to managers", async () => {
    const projects = [createProject()];
    repository.findAll.mockResolvedValue(projects);

    await expect(service.findAll(createUser())).resolves.toBe(projects);
    expect(repository.findAll).toHaveBeenCalledOnce();
  });

  it("returns only member projects to participating employees", async () => {
    const actor = createUser({ role: ROLE.EMPLOYEE });
    const projects = [createProject()];
    permissions.hasPermission.mockImplementation(
      (_role, permission) => permission === PERMISSION.PARTICIPATE_IN_PROJECTS,
    );
    repository.findByMemberId.mockResolvedValue(projects);

    await expect(service.findAll(actor)).resolves.toBe(projects);
    expect(repository.findByMemberId).toHaveBeenCalledWith(actor.id);
  });

  it("denies the project list without participation rights", async () => {
    permissions.hasPermission.mockReturnValue(false);

    await expect(service.findAll(createUser())).rejects.toThrow(
      ProjectAccessDeniedError,
    );
  });

  it("gets a project for managers", async () => {
    const project = createProject();
    repository.findById.mockResolvedValue(project);

    await expect(service.getById(createUser(), project.id)).resolves.toBe(
      project,
    );
    expect(repository.isMember).not.toHaveBeenCalled();
  });

  it("gets a project for participating members", async () => {
    const actor = createUser({ role: ROLE.EMPLOYEE });
    const project = createProject();
    permissions.hasPermission.mockImplementation(
      (_role, permission) => permission === PERMISSION.PARTICIPATE_IN_PROJECTS,
    );
    repository.findById.mockResolvedValue(project);
    repository.isMember.mockResolvedValue(true);

    await expect(service.getById(actor, project.id)).resolves.toBe(project);
    expect(repository.isMember).toHaveBeenCalledWith(project.id, actor.id);
  });

  it("reports missing and inaccessible projects", async () => {
    repository.findById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createProject());

    await expect(service.getById(createUser(), "missing")).rejects.toThrow(
      ProjectNotFoundError,
    );

    permissions.hasPermission.mockReturnValue(false);
    await expect(
      service.getById(createUser({ role: ROLE.EMPLOYEE }), "project-1"),
    ).rejects.toThrow(ProjectAccessDeniedError);
  });

  it("denies non-members with participation rights", async () => {
    permissions.hasPermission.mockImplementation(
      (_role, permission) => permission === PERMISSION.PARTICIPATE_IN_PROJECTS,
    );
    repository.findById.mockResolvedValue(createProject());
    repository.isMember.mockResolvedValue(false);

    await expect(
      service.getById(createUser({ role: ROLE.EMPLOYEE }), "project-1"),
    ).rejects.toThrow(ProjectAccessDeniedError);
  });

  it("creates projects for managers", async () => {
    const input = {
      description: "New public website",
      id: "project-1",
      name: "Website refresh",
      ownerId: "user-1",
      placeholderColor: "#FCE3D3",
      status: "planned" as const,
    };
    repository.insert.mockResolvedValue(undefined);

    await service.create(createUser(), input);
    expect(repository.insert).toHaveBeenCalledWith(input);
  });

  it("updates and archives existing projects for managers", async () => {
    repository.findById.mockResolvedValue(createProject());
    repository.update.mockResolvedValue(undefined);
    repository.archive.mockResolvedValue(undefined);
    const update = {
      description: "Updated",
      name: "Updated",
      progress: 100,
      status: "completed" as const,
    };

    await service.update(createUser(), "project-1", update);
    await service.archive(createUser(), "project-1");

    expect(repository.update).toHaveBeenCalledWith("project-1", update);
    expect(repository.archive).toHaveBeenCalledWith("project-1");
  });

  it("gets and replaces icons after authorization", async () => {
    const project = createProject();
    const icon = {
      data: Buffer.from([1]),
      filename: "logo.png",
      mimeType: "image/png",
    };
    repository.findById.mockResolvedValue(project);
    repository.findIconByProjectId.mockResolvedValue(icon);
    repository.upsertIcon.mockResolvedValue(undefined);

    await expect(service.getIcon(createUser(), project.id)).resolves.toBe(icon);
    await service.replaceIcon(createUser(), project.id, icon);
    expect(repository.upsertIcon).toHaveBeenCalledWith(project.id, icon);
  });

  it("denies management operations without permission", async () => {
    permissions.hasPermission.mockReturnValue(false);
    const actor = createUser({ role: ROLE.EMPLOYEE });

    await expect(service.create(actor, {} as never)).rejects.toThrow(
      ProjectManagementDeniedError,
    );
    await expect(
      service.update(actor, "project-1", {} as never),
    ).rejects.toThrow(ProjectManagementDeniedError);
    await expect(service.archive(actor, "project-1")).rejects.toThrow(
      ProjectManagementDeniedError,
    );
    await expect(
      service.replaceIcon(actor, "project-1", {} as never),
    ).rejects.toThrow(ProjectManagementDeniedError);
  });

  it("checks project management permissions", () => {
    const actor = createUser();

    expect(service.canManageProjects(actor)).toBe(true);
    expect(permissions.hasPermission).toHaveBeenCalledWith(
      actor.role,
      PERMISSION.MANAGE_PROJECTS,
    );
  });
});

describe("ProjectService cached batch reads", () => {
  it("caches integrations for a project set", async () => {
    const cache = new ServerCache();
    const repository = createRepository();
    repository.findIntegrationsByProjectIds.mockResolvedValue(
      new Map([["project-1", {} as never]]),
    );
    const service = new ProjectService(
      repository,
      createPermissions(),
      null,
      cache,
    );

    await service.findIntegrationsByProjects(["project-1"]);
    await service.findIntegrationsByProjects(["project-1"]);

    expect(repository.findIntegrationsByProjectIds).toHaveBeenCalledTimes(1);
  });
});
