import { describe, expect, it, vi } from "vitest";

import { ProjectManagementDeniedError } from "@/backend/error/ProjectErrors";

import { GitHubSyncAccessGuard } from "./GitHubSyncAccessGuard";

import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type { WorkItemDetail, WorkItemVisibility } from "@/definition/Task";
import type { User } from "@/definition/User";

const ACTOR = { id: "user-1" } as unknown as User;
const ITEM = {
  id: "task-1",
  projectId: "project-1",
} as unknown as WorkItemDetail;
const VISIBILITY: WorkItemVisibility = { departmentIds: null };

function createGuard(canWrite: boolean): {
  readonly guard: GitHubSyncAccessGuard;
  readonly projectService: {
    readonly getById: ReturnType<typeof vi.fn>;
    readonly canWriteProject: ReturnType<typeof vi.fn>;
    readonly workItemVisibility: ReturnType<typeof vi.fn>;
  };
  readonly taskService: { readonly getById: ReturnType<typeof vi.fn> };
} {
  const projectService = {
    getById: vi.fn().mockResolvedValue({}),
    canWriteProject: vi.fn().mockResolvedValue(canWrite),
    workItemVisibility: vi.fn().mockResolvedValue(VISIBILITY),
  };
  const taskService = { getById: vi.fn().mockResolvedValue(ITEM) };
  const guard = new GitHubSyncAccessGuard(
    projectService as unknown as ProjectService,
    taskService as unknown as TaskService,
  );

  return { guard, projectService, taskService };
}

describe("requireWritableProject", () => {
  it("passes when the actor may see and write the project", async () => {
    const { guard, projectService } = createGuard(true);

    await expect(
      guard.requireWritableProject(ACTOR, "project-1"),
    ).resolves.toBeUndefined();
    expect(projectService.getById).toHaveBeenCalledWith(ACTOR, "project-1");
    expect(projectService.canWriteProject).toHaveBeenCalledWith(
      ACTOR,
      "project-1",
    );
  });

  it("rejects an actor without write permission", async () => {
    const { guard } = createGuard(false);

    await expect(
      guard.requireWritableProject(ACTOR, "project-1"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });
});

describe("requireWritableTask", () => {
  it("returns the task when the actor may write its project", async () => {
    const { guard, taskService, projectService } = createGuard(true);

    await expect(guard.requireWritableTask(ACTOR, "task-1")).resolves.toBe(
      ITEM,
    );
    expect(taskService.getById).toHaveBeenCalledWith(ACTOR, "task-1");
    expect(projectService.canWriteProject).toHaveBeenCalledWith(
      ACTOR,
      "project-1",
    );
  });

  it("rejects an actor without write permission", async () => {
    const { guard } = createGuard(false);

    await expect(
      guard.requireWritableTask(ACTOR, "task-1"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });
});

describe("visibility", () => {
  it("resolves the ticket scope of the actor", async () => {
    const { guard, projectService } = createGuard(true);

    await expect(guard.visibility(ACTOR)).resolves.toBe(VISIBILITY);
    expect(projectService.workItemVisibility).toHaveBeenCalledWith(ACTOR);
  });
});
