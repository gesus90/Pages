import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { PERMISSION, ROLE } from "@/definition/Role";
import { ProjectService } from "@/backend/service/ProjectService";

import { createDatabase, createUser } from "../helpers/factories";
import { createAccess, createRole } from "../helpers/authorization";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import type { PermissionService } from "@/backend/auth/PermissionService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { Project } from "@/definition/Project";

function createProject(): Project {
  return {
    createdAt: "2026-01-01",
    description: "New public website",
    departments: [],
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
  vi.spyOn(repository, "isProjectManager").mockResolvedValue(false);
  const mocked = Object.assign(repository, {
    archive: vi.spyOn(repository, "archive").mockResolvedValue(undefined),
    findAll: vi.spyOn(repository, "findAll"),
    findById: vi.spyOn(repository, "findById"),
    findByMemberId: vi.spyOn(repository, "findByMemberId"),
    findIconByProjectId: vi.spyOn(repository, "findIconByProjectId"),
    findIntegrationsByProjectIds: vi
      .spyOn(repository, "findIntegrationsByProjectIds")
      .mockResolvedValue(new Map()),
    insert: vi.spyOn(repository, "insert").mockResolvedValue(undefined),
    isMember: vi.spyOn(repository, "isMember"),
    update: vi.spyOn(repository, "update").mockResolvedValue(undefined),
    upsertIcon: vi.spyOn(repository, "upsertIcon").mockResolvedValue(undefined),
  });
  return mocked;
}

function setAccount(
  repository: ProjectRepository,
  account = createAccess({
    userId: "user-1",
    role: createRole({ departmentBound: false, permissions: [] }),
  }),
): void {
  vi.mocked(repository.authorization().snapshot).mockResolvedValue({
    departments: [],
    roles: [],
    accounts: [account],
  });
}

function createPermissions(): PermissionService & {
  hasPermission: ReturnType<typeof vi.fn>;
} {
  const hasPermission = vi.fn().mockReturnValue(true);
  return {
    hasPermission,
    allows: vi.fn(async (actor: { role: string }, permission: string) =>
      hasPermission(actor.role, permission),
    ),
    hasCapability: vi.fn(async (actor: { role: string }) =>
      hasPermission(actor.role, PERMISSION.MANAGE_PROJECTS),
    ),
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

  it("returns current department choices through the project facade", async () => {
    await expect(service.departmentChoices(createUser())).resolves.toEqual({
      available: [],
      selectionRequired: false,
    });
  });

  it("returns every project to managers", async () => {
    const projects = [createProject()];
    repository.findAll.mockResolvedValue(projects);

    await expect(service.findAll(createUser())).resolves.toEqual(projects);
    expect(repository.findAll).toHaveBeenCalledOnce();
  });

  it("returns public projects to active employees independently of membership", async () => {
    const actor = createUser({ role: ROLE.EMPLOYEE });
    const projects = [createProject()];
    permissions.hasPermission.mockImplementation(
      (_role, permission) => permission === PERMISSION.PARTICIPATE_IN_PROJECTS,
    );
    repository.findAll.mockResolvedValue(projects);
    setAccount(repository);

    await expect(service.findAll(actor)).resolves.toEqual(projects);
    expect(repository.findByMemberId).not.toHaveBeenCalled();
  });

  it("denies the project list for an inactive current account", async () => {
    setAccount(repository, createAccess({ userId: "user-1", isActive: false }));

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

  it("gets a public project without using project membership", async () => {
    const actor = createUser({ role: ROLE.EMPLOYEE });
    const project = createProject();
    permissions.hasPermission.mockImplementation(
      (_role, permission) => permission === PERMISSION.PARTICIPATE_IN_PROJECTS,
    );
    repository.findById.mockResolvedValue(project);
    repository.isMember.mockResolvedValue(true);

    await expect(service.getById(actor, project.id)).resolves.toBe(project);
    expect(repository.isMember).not.toHaveBeenCalled();
  });

  it("reports missing and inaccessible projects", async () => {
    repository.findById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createProject());

    await expect(service.getById(createUser(), "missing")).rejects.toThrow(
      ProjectNotFoundError,
    );

    setAccount(repository, createAccess({ userId: "user-1", isActive: false }));
    await expect(
      service.getById(createUser({ role: ROLE.EMPLOYEE }), "project-1"),
    ).rejects.toThrow(ProjectAccessDeniedError);
  });

  it("denies a bound account without a common department even with membership", async () => {
    permissions.hasPermission.mockImplementation(
      (_role, permission) => permission === PERMISSION.PARTICIPATE_IN_PROJECTS,
    );
    setAccount(
      repository,
      createAccess({ userId: "user-1", departments: ["frontend"] }),
    );
    repository.findById.mockResolvedValue({
      ...createProject(),
      departments: [{ id: "backend", name: "Backend" }],
    });
    repository.isMember.mockResolvedValue(true);

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
    expect(repository.insert).toHaveBeenCalledWith({
      ...input,
      departmentIds: [],
    });
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
    setAccount(repository);
    repository.findById.mockResolvedValue(createProject());
    const actor = createUser({ role: ROLE.EMPLOYEE });

    await expect(
      service.create(actor, {
        id: "new",
        name: "New",
        description: "",
        status: "planned",
        ownerId: actor.id,
        placeholderColor: "#FCE3D3",
      }),
    ).rejects.toThrow(ProjectManagementDeniedError);
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

  it("checks project management permissions", async () => {
    const actor = createUser();

    expect(await service.canManageProjects(actor)).toBe(true);
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
