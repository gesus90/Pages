import { describe, expect, it, vi } from "vitest";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { PermissionService } from "@/backend/auth/PermissionService";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { WikiService } from "@/backend/service/WikiService";

import type { Database } from "@/backend/database/Database";

function createDatabase(): Database {
  return {
    close: vi.fn(),
    execute: vi.fn(),
    migrate: vi.fn(),
    query: vi.fn(),
  } as unknown as Database;
}

describe("future persistence boundaries", () => {
  it("creates a project repository around the database", () => {
    const database = createDatabase();

    expect(new ProjectRepository(database)).toBeInstanceOf(ProjectRepository);
  });

  it("creates a task repository around the database", () => {
    const database = createDatabase();

    expect(new TaskRepository(database)).toBeInstanceOf(TaskRepository);
  });

  it("creates a wiki repository around the database", () => {
    const database = createDatabase();

    expect(new WikiRepository(database)).toBeInstanceOf(WikiRepository);
  });
});

describe("future business-logic boundaries", () => {
  it("creates a project service around its repository", () => {
    const repository = new ProjectRepository(createDatabase());

    expect(
      new ProjectService(repository, new PermissionService()),
    ).toBeInstanceOf(ProjectService);
  });

  it("creates a task service around its repository", () => {
    const database = createDatabase();
    const repository = new TaskRepository(database);
    const permissionService = new PermissionService();
    const projectRepository = new ProjectRepository(database);
    const projectService = new ProjectService(
      projectRepository,
      permissionService,
    );

    expect(
      new TaskService(repository, projectService, permissionService),
    ).toBeInstanceOf(TaskService);
  });

  it("creates a wiki service around its repository", () => {
    const repository = new WikiRepository(createDatabase());

    expect(new WikiService(repository)).toBeInstanceOf(WikiService);
  });
});
