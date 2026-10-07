import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { ProjectGoalRepository } from "@/backend/database/repositories/project/ProjectGoalRepository";
import { ProjectTemplateRepository } from "@/backend/database/repositories/project/ProjectTemplateRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { createAccess, createRole } from "../helpers/authorization";
import { createDatabase, createUser } from "../helpers/factories";
import { useMigratedDatabase } from "../helpers/test-database";

import type { ProjectTemplate } from "@/definition/Project";

const ACTOR = createUser({ id: "actor" });
const NEW_PROJECT = {
  id: "new",
  name: "Explicit new name",
  description: "Ignored template override",
  status: "planned" as const,
  ownerId: "forged",
  departmentIds: ["frontend"],
  placeholderColor: "#FCE3D3",
};

describe("source-bound project template snapshots", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const authorization = new AuthorizationRepository(getDatabase());
    await authorization.users().insert({
      id: "actor",
      username: "actor",
      displayName: "Actor",
      passwordHash: "hash",
      role: "employee",
    });
    await authorization.saveRole(createRole());
    await authorization.saveAccount(createAccess());
    for (const id of ["frontend", "backend"])
      await authorization.saveDepartment({ id, name: id });
    const repository = new ProjectRepository(getDatabase());
    await repository.insert({
      ...NEW_PROJECT,
      id: "source",
      name: "Source name",
      description: "Saved description",
      status: "active",
      ownerId: "actor",
    });
    await repository.insertGoal({
      id: "first",
      projectId: "source",
      title: "First goal",
      position: 0,
    });
    await repository.insertGoal({
      id: "second",
      projectId: "source",
      title: "Second goal",
      position: 1,
    });
    await repository.updateGoal("first", "First goal", true);
    await repository.setTags("source", ["Web", "Internal"]);
    await repository.upsertIntegration("source", {
      repoUrl: "https://github.com/example/repo",
      tokenHash: "secret-hash",
      tokenEncrypted: "secret-encrypted",
      repoName: "example/repo",
      isConnected: true,
      lastSyncAt: null,
      syncComments: true,
      syncCommits: false,
      syncDirection: "push",
      syncIntervalMinutes: 5,
      syncIssues: true,
      syncPullRequests: false,
      syncStatus: true,
    });
    const cache = new ServerCache();
    const service = new ProjectService(
      repository,
      new PermissionService(),
      null,
      cache,
    );
    return { authorization, repository, service, cache };
  }

  async function requireTemplate(
    service: ProjectService,
  ): Promise<ProjectTemplate> {
    const template = (await service.findTemplates(ACTOR))[0];
    if (!template) throw new Error("Missing saved template");
    return template;
  }

  it("stores the confirmed fields, ordered goal titles and tags, with an explicit refresh retaining the identity", async () => {
    const { service, repository } = await setup();
    expect(await service.findTemplates(ACTOR)).toEqual([]);
    await service.saveTemplate(ACTOR, "source");
    const initial = await requireTemplate(service);
    expect(initial).toMatchObject({
      projectId: "source",
      name: "Source name",
      description: "Saved description",
      status: "active",
      goals: ["First goal", "Second goal"],
      tags: ["Internal", "Web"],
    });
    await repository.update("source", {
      name: "Refreshed",
      description: "Changed",
      status: "completed",
      progress: 100,
    });
    expect((await requireTemplate(service)).name).toBe("Source name");
    await service.saveTemplate(ACTOR, "source");
    expect(await service.findTemplates(ACTOR)).toHaveLength(1);
    expect(await requireTemplate(service)).toMatchObject({
      id: initial.id,
      name: "Refreshed",
      description: "Changed",
      status: "completed",
    });
  });

  it("creates only a fresh owned project, scoped assignments, open goals and tags; no source team or credentials", async () => {
    const { service, repository, cache } = await setup();
    await service.saveTemplate(ACTOR, "source");
    const template = await requireTemplate(service);
    cache.set("projects:list:old", [], 60_000);
    await service.createFromTemplate(ACTOR, template.id, NEW_PROJECT);
    expect(await repository.findById("new")).toMatchObject({
      name: "Explicit new name",
      description: "Saved description",
      status: "active",
      progress: 0,
      managerId: null,
      notes: "",
      departments: [{ id: "frontend", name: "frontend" }],
    });
    expect(await repository.findGoals("new")).toEqual([
      expect.objectContaining({
        title: "First goal",
        isDone: false,
        position: 0,
      }),
      expect.objectContaining({
        title: "Second goal",
        isDone: false,
        position: 1,
      }),
    ]);
    expect(await repository.findTags("new")).toEqual(["Internal", "Web"]);
    expect(
      (await repository.findMembers("new")).map((member) => member.userId),
    ).toEqual(["actor"]);
    expect(await repository.findIntegration("new")).toBeNull();
    expect(
      await new TaskRepository(getDatabase()).findAll({ projectIds: ["new"] }),
    ).toEqual([]);
    expect(cache.get("projects:list:old")).toBeUndefined();
  });

  it("checks source access again after a previously visible template is revoked", async () => {
    const { service, repository } = await setup();
    await service.saveTemplate(ACTOR, "source");
    const template = await requireTemplate(service);
    await repository.setDepartments("source", ["backend"]);
    expect(await service.findTemplates(ACTOR)).toEqual([]);
    await expect(
      service.createFromTemplate(ACTOR, template.id, NEW_PROJECT),
    ).rejects.toThrow("not allowed");
    await expect(service.saveTemplate(ACTOR, "source")).rejects.toThrow(
      "not allowed",
    );
    expect(await repository.findById("new")).toBeNull();
  });

  it("validates the new name, assignments and current creation capability atomically", async () => {
    const { service, authorization, repository } = await setup();
    await service.saveTemplate(ACTOR, "source");
    const template = await requireTemplate(service);
    await expect(
      service.createFromTemplate(ACTOR, template.id, {
        ...NEW_PROJECT,
        name: " ",
      }),
    ).rejects.toThrow("Invalid project input");
    await expect(
      service.createFromTemplate(ACTOR, template.id, {
        ...NEW_PROJECT,
        departmentIds: [],
      }),
    ).rejects.toMatchObject({ code: "departmentRequired" });
    await authorization.saveRole(createRole({ permissions: [] }));
    await expect(
      service.createFromTemplate(ACTOR, template.id, NEW_PROJECT),
    ).rejects.toThrow("not allowed");
    await repository.updateMemberRole("source", "actor", "viewer");
    await expect(service.saveTemplate(ACTOR, "source")).rejects.toThrow(
      "not allowed",
    );
    expect(await repository.findById("new")).toBeNull();
  });

  it("keeps accessible archived templates reusable but removes the whole snapshot on permanent deletion", async () => {
    const { service, repository, authorization } = await setup();
    await service.saveTemplate(ACTOR, "source");
    const template = await requireTemplate(service);
    await repository.archive("source");
    expect((await service.findTemplates(ACTOR))[0]?.id).toBe(template.id);
    await service.createFromTemplate(ACTOR, template.id, NEW_PROJECT);
    await authorization.saveAccount(
      createAccess({ isAdmin: true, mode: "admin", role: null }),
    );
    await service.deletePermanently(ACTOR, "source");
    expect(await service.findTemplates(ACTOR)).toEqual([]);
    for (const table of [
      "project_templates",
      "project_template_goals",
      "project_template_tags",
    ])
      expect(
        await getDatabase().query(`SELECT COUNT(*) FROM ${table};`),
      ).toEqual([[0]]);
    expect(await repository.findById("new")).not.toBeNull();
    await expect(
      service.createFromTemplate(ACTOR, template.id, {
        ...NEW_PROJECT,
        id: "another",
      }),
    ).rejects.toThrow("does not exist");
  });

  it("ignores dangling source snapshots and rejects inactive or missing accounts", async () => {
    const { service } = await setup();
    await service.saveTemplate(ACTOR, "source");
    const template = await requireTemplate(service);
    await getDatabase().execute("DELETE FROM projects WHERE id = 'source';");
    expect(await service.findTemplates(ACTOR)).toEqual([]);
    await expect(
      service.createFromTemplate(ACTOR, template.id, NEW_PROJECT),
    ).rejects.toThrow("not allowed");
    await getDatabase().execute(
      "UPDATE users SET is_active = 0 WHERE id = 'actor';",
    );
    await expect(service.findTemplates(ACTOR)).rejects.toThrow("not allowed");
    await expect(
      service.findTemplates(createUser({ id: "missing" })),
    ).rejects.toThrow("not allowed");
  });

  it("rolls back the new project, membership, assignments and goals after a clone write fails", async () => {
    const { repository, service, cache } = await setup();
    await service.saveTemplate(ACTOR, "source");
    const template = await requireTemplate(service);
    cache.set("projects:list:old", ["old"], 60_000);
    vi.spyOn(ProjectGoalRepository.prototype, "insert").mockRejectedValueOnce(
      new Error("Goal write failed"),
    );
    await expect(
      service.createFromTemplate(ACTOR, template.id, NEW_PROJECT),
    ).rejects.toThrow("Goal write failed");
    expect(await repository.findById("new")).toBeNull();
    expect(await repository.findDepartments("new")).toEqual([]);
    expect(await repository.findMembers("new")).toEqual([]);
    expect(cache.get("projects:list:old")).toEqual(["old"]);
  });

  it("rolls back a full snapshot refresh after replacement persistence fails", async () => {
    const { service, repository } = await setup();
    await service.saveTemplate(ACTOR, "source");
    const originalTemplate = await requireTemplate(service);
    await repository.deleteGoal("first");
    await repository.setTags("source", ["Changed"]);
    const originalSave = ProjectTemplateRepository.prototype.save;
    vi.spyOn(
      ProjectTemplateRepository.prototype,
      "save",
    ).mockImplementationOnce(async function (
      this: ProjectTemplateRepository,
      template,
    ) {
      await originalSave.call(this, template);
      throw new Error("Refresh failed");
    });
    await expect(service.saveTemplate(ACTOR, "source")).rejects.toThrow(
      "Refresh failed",
    );
    expect(await requireTemplate(service)).toEqual(originalTemplate);
  });
});

describe("template row validation", () => {
  it("rejects unsupported stored statuses", async () => {
    const database = createDatabase();
    database.query.mockResolvedValue([
      ["id", "project", "Name", "Description", "unknown"],
    ]);
    await expect(
      new ProjectTemplateRepository(database).findAll(),
    ).rejects.toThrow("unsupported template status");
  });
});
