import { describe, expect, it } from "vitest";
import { PermissionService } from "@/backend/auth/PermissionService";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { CAPABILITY } from "@/definition/Authorization";
import { createUser } from "../helpers/factories";
import { createRole } from "../helpers/authorization";
import { useMigratedDatabase } from "../helpers/test-database";
import type { Capability } from "@/definition/Authorization";

describe("live global capabilities before A3 department enforcement", () => {
  const getDatabase = useMigratedDatabase();
  const actor = createUser({ id: "actor" }); // Deliberately stale legacy admin projection.
  const project = {
    id: "project",
    name: "Project",
    description: "",
    ownerId: "admin",
    status: "active" as const,
    placeholderColor: "#FCE3D3",
  };

  async function setup(capabilities: readonly Capability[]): Promise<{
    administration: AdministrationService;
    projects: ProjectService;
    tasks: TaskService;
    permissions: PermissionService;
  }> {
    const database = getDatabase();
    const repository = new AuthorizationRepository(database);
    const cache = new ServerCache();
    const administration = new AdministrationService(
      repository,
      cache,
      new PasswordHasher(),
    );
    await repository.users().insert({
      id: "admin",
      username: "admin",
      displayName: "Admin",
      role: "admin",
      passwordHash: "hash",
    });
    await administration.saveRole(
      "admin",
      createRole({ id: "profile", permissions: capabilities }),
    );
    await repository.users().insert({
      id: "actor",
      username: "actor",
      displayName: "Actor",
      role: "employee",
      passwordHash: "hash",
      authorization: {
        roleId: "profile",
        isAdmin: false,
        mode: "role",
        firstName: "Actor",
        lastName: "",
      },
    });
    const projectRepository = new ProjectRepository(database);
    await projectRepository.insert(project);
    await projectRepository.addMember("project", "actor", "manager");
    const permissions = new PermissionService((id) =>
      administration.getContext(id),
    );
    const projects = new ProjectService(
      projectRepository,
      permissions,
      null,
      cache,
    );
    return {
      administration,
      projects,
      permissions,
      tasks: new TaskService(
        new TaskRepository(database),
        projects,
        permissions,
        cache,
      ),
    };
  }

  it("create-only roles can create but cannot manage existing projects or write tickets", async () => {
    const { projects, tasks } = await setup([CAPABILITY.CREATE_PROJECTS]);
    expect(await projects.canCreateProjects(actor)).toBe(true);
    expect(await projects.canManageProjects(actor)).toBe(false);
    await projects.create(actor, {
      ...project,
      id: "created",
      ownerId: "actor",
    });
    await expect(projects.archive(actor, "project")).rejects.toThrow();
    await expect(
      tasks.create(actor, {
        projectId: "project",
        type: "task",
        title: "Forbidden",
        statusId: "status-todo",
      }),
    ).rejects.toThrow();
  });

  it("project management implies creation and preserves planning without granting ticket writes", async () => {
    const { permissions, projects, tasks } = await setup([
      CAPABILITY.MANAGE_PROJECTS,
    ]);
    expect(
      await permissions.hasCapability(actor, CAPABILITY.CREATE_PROJECTS),
    ).toBe(true);
    expect(await permissions.hasCapability(actor, CAPABILITY.WRITE)).toBe(
      false,
    );
    expect(
      (
        await tasks.createMilestone(actor, {
          projectId: "project",
          name: "Existing planning access",
        })
      ).name,
    ).toBe("Existing planning access");
    await expect(
      tasks.create(actor, {
        projectId: "project",
        type: "task",
        title: "Forbidden",
        statusId: "status-todo",
      }),
    ).rejects.toThrow();
    await projects.archive(actor, "project");
  });

  it("checks the current role again after a role change, not the caller's cached projection", async () => {
    const { administration, tasks, permissions } = await setup([
      CAPABILITY.WRITE,
    ]);
    const item = await tasks.create(actor, {
      projectId: "project",
      type: "task",
      title: "Allowed",
      statusId: "status-todo",
      skipGitHubSync: true,
    });
    await administration.saveRole(
      "admin",
      createRole({ id: "profile", permissions: [] }),
    );
    expect(
      await permissions.hasCapability(actor, CAPABILITY.CREATE_PROJECTS),
    ).toBe(false);
    await expect(
      tasks.updateStatusAndOrder(actor, item.id, "status-done", 1),
    ).rejects.toThrow();
    await expect(tasks.archive(actor, item.id)).rejects.toThrow();
    expect((await tasks.findAll(actor)).map((ticket) => ticket.id)).toContain(
      item.id,
    );
  });

  it("does not reuse a management listing after rights change outside this process's cache", async () => {
    const { projects } = await setup([CAPABILITY.MANAGE_PROJECTS]);
    await new ProjectRepository(getDatabase()).insert({
      ...project,
      id: "foreign",
    });
    expect((await projects.findAll(actor)).map((entry) => entry.id)).toContain(
      "foreign",
    );
    await new AuthorizationRepository(getDatabase()).saveRole(
      createRole({ id: "profile", permissions: [] }),
    );
    expect((await projects.findAll(actor)).map((entry) => entry.id)).toEqual([
      "project",
    ]);
  });

  it("planning continues to use the existing project role until A3 defines milestone actions", async () => {
    const { tasks, administration } = await setup([CAPABILITY.MILESTONES]);
    const first = await tasks.createMilestone(actor, {
      projectId: "project",
      name: "First",
    });
    const second = await tasks.createMilestone(actor, {
      projectId: "project",
      name: "Second",
    });
    const dependency = await tasks.addDependency(actor, {
      projectId: "project",
      sourceId: first.id,
      targetId: second.id,
      linkType: "prerequisite",
    });
    await tasks.removeDependency(actor, "project", dependency.id);
    await tasks.updateMilestone(actor, first.id, {
      name: "Done",
      description: "",
      status: "completed",
      startAt: null,
      dueAt: null,
    });
    await administration.saveRole(
      "admin",
      createRole({ id: "profile", permissions: [] }),
    );
    await tasks.deleteMilestone(actor, first.id);
    await new ProjectRepository(getDatabase()).updateMemberRole(
      "project",
      "actor",
      "member",
    );
    await expect(tasks.deleteMilestone(actor, second.id)).rejects.toThrow();
    await expect(
      tasks.addDependency(actor, {
        projectId: "project",
        sourceId: first.id,
        targetId: second.id,
        linkType: "prerequisite",
      }),
    ).rejects.toThrow();
  });
});
