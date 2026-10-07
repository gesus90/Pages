import { describe, expect, it, vi } from "vitest";

import { handleProjectScopeAction } from "@/app/lib/project-actions/project-scope-actions.server";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { ProjectService } from "@/backend/service/ProjectService";
import { createDatabase, createUser } from "../helpers/factories";

import type { ProjectScopeActionContext } from "@/app/lib/project-actions/project-scope-actions.server";
import type { Project } from "@/definition/Project";

const PROJECT: Project = {
  id: "project",
  name: "Project",
  description: "",
  status: "active",
  progress: 0,
  departments: [],
  hasIcon: false,
  managerId: null,
  managerName: null,
  notes: "",
  parentId: null,
  placeholderColor: "#FCE3D3",
  startDate: null,
  targetDate: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

function setup(): ProjectScopeActionContext {
  const projectService = new ProjectService(
    new ProjectRepository(createDatabase()),
    new PermissionService(),
  );
  vi.spyOn(projectService, "archive").mockResolvedValue(undefined);
  vi.spyOn(projectService, "deletePermanently").mockResolvedValue(undefined);
  vi.spyOn(projectService, "setDepartments").mockResolvedValue(undefined);
  vi.spyOn(projectService, "getById").mockResolvedValue(PROJECT);
  return {
    actor: createUser(),
    formData: new FormData(),
    projectId: "project",
    services: { projectService },
  };
}

describe("project scope and retention actions", () => {
  it.each([
    ["archive-project", "/projekte?archiv=1"],
    ["delete-project", "/projekte"],
  ])("redirects after successful %s", async (intent, location) => {
    const context = setup();
    const result = await handleProjectScopeAction(intent, context);
    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) throw new Error("Expected redirect");
    expect(result.headers.get("Location")).toBe(location);
    expect(result.status).toBe(302);
  });

  it("keeps an accessible project open after changing its departments", async () => {
    const context = setup();
    context.formData.append("departmentIds", "frontend");
    context.formData.append("departmentIds", "backend");
    const result = await handleProjectScopeAction("set-departments", context);
    expect(context.services.projectService.setDepartments).toHaveBeenCalledWith(
      context.actor,
      "project",
      ["frontend", "backend"],
    );
    if (!(result instanceof Response)) throw new Error("Expected redirect");
    expect(result.headers.get("Location")).toBe("/projekte/project");
  });

  it("returns to the overview when the successful change removes the actor's own last common department", async () => {
    const context = setup();
    vi.mocked(context.services.projectService.getById).mockRejectedValue(
      new ProjectAccessDeniedError(),
    );
    const result = await handleProjectScopeAction("set-departments", context);
    if (!(result instanceof Response)) throw new Error("Expected redirect");
    expect(result.headers.get("Location")).toBe("/projekte");
  });

  it("rejects non-text assignments and leaves unrelated intents to the existing action handlers", async () => {
    const context = setup();
    context.formData.append(
      "departmentIds",
      new Blob(["department"]),
      "department.txt",
    );
    expect(
      await handleProjectScopeAction("set-departments", context),
    ).toMatchObject({
      data: { ok: false, error: "invalidInput" },
      init: { status: 400 },
    });
    expect(
      context.services.projectService.setDepartments,
    ).not.toHaveBeenCalled();
    expect(await handleProjectScopeAction(null, context)).toBeUndefined();
  });

  it("propagates failed persistence or unexpected post-save reads without reporting success", async () => {
    const context = setup();
    vi.mocked(context.services.projectService.archive).mockRejectedValue(
      new Error("Archive failed"),
    );
    await expect(
      handleProjectScopeAction("archive-project", context),
    ).rejects.toThrow("Archive failed");
    vi.mocked(context.services.projectService.getById).mockRejectedValue(
      new Error("Read failed"),
    );
    await expect(
      handleProjectScopeAction("set-departments", context),
    ).rejects.toThrow("Read failed");
  });
});
