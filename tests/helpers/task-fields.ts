import { vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import { TaskFieldService } from "@/backend/service/task/TaskFieldService";
import { TaskGitHubPublisher } from "@/backend/service/task/TaskGitHubPublisher";
import { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import { WorkItemReferenceValidator } from "@/backend/service/task/WorkItemReferenceValidator";

import { createDatabase, createWorkItem } from "./factories";

import type { Milestone, WorkflowStatus } from "@/definition/Task";

/** Complete milestone fixture for field comparisons. */
export function fieldMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: "milestone",
    projectId: "project-1",
    name: "Release",
    description: "Body",
    status: "open",
    startAt: null,
    dueAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

/** Complete workflow status fixture for conditional moves. */
export function fieldStatus(
  overrides: Partial<WorkflowStatus> = {},
): WorkflowStatus {
  return {
    id: "status-done",
    name: "Done",
    key: "done",
    projectId: null,
    position: 3,
    isDone: true,
    ...overrides,
  };
}

/** Real service wiring with typed spies at the persistence and access boundaries. */
function createTaskFieldDoubles() {
  const repository = new TaskRepository(createDatabase());
  const cache = new ServerCache();
  const permissions = new PermissionService();
  const projects = new ProjectService(
    new ProjectRepository(createDatabase()),
    permissions,
  );
  const access = new TaskAccessGuard(repository, projects, permissions);
  const history = new TaskHistoryRecorder(repository);
  const publisher = new TaskGitHubPublisher(repository, history, cache);
  const validator = new WorkItemReferenceValidator(repository, access);
  const methods = {
    writable: vi
      .spyOn(access, "requireWritableWorkItem")
      .mockResolvedValue(createWorkItem()),
    visibility: vi
      .spyOn(access, "visibility")
      .mockResolvedValue({ projectIds: ["project-1"], departmentIds: null }),
    hierarchy: vi
      .spyOn(validator, "validateHierarchy")
      .mockResolvedValue(undefined),
    find: vi.spyOn(repository, "findById").mockResolvedValue(createWorkItem()),
    hiddenParent: vi
      .spyOn(repository, "findParentReference")
      .mockResolvedValue(null),
    title: vi.spyOn(repository, "updateTitle").mockResolvedValue(true),
    status: vi.spyOn(repository, "updateStatus").mockResolvedValue(true),
    parent: vi.spyOn(repository, "replaceParent").mockResolvedValue(true),
    findStatus: vi
      .spyOn(repository, "findStatusById")
      .mockResolvedValue(fieldStatus()),
    titleHistory: vi
      .spyOn(history, "recordTitleChanged")
      .mockResolvedValue(undefined),
    statusHistory: vi
      .spyOn(history, "recordStatusMove")
      .mockResolvedValue(undefined),
    parentHistory: vi
      .spyOn(history, "recordParentChanged")
      .mockResolvedValue(undefined),
    publish: vi.spyOn(publisher, "publish").mockResolvedValue(undefined),
    invalidate: vi.spyOn(cache, "invalidateWorkItems"),
  };
  const fields = new TaskFieldService({
    taskRepository: repository,
    access,
    validator,
    history,
    gitHubPublisher: publisher,
    cache,
  });
  const service = new TaskService(repository, projects, permissions, cache);
  return { repository, cache, access, history, methods, fields, service };
}

/** Builds the typed collaborators of a single-field service test. */
export function taskFieldDoubles(): ReturnType<typeof createTaskFieldDoubles> {
  return createTaskFieldDoubles();
}
