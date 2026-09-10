import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { PROJECT_STATUS } from "@/definition/Project";

import type { Database } from "@/backend/database/Database";

function createDatabase(): Database & {
  execute: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  return {
    close: vi.fn(),
    execute: vi.fn(),
    migrate: vi.fn(),
    query: vi.fn(),
  } as unknown as Database & {
    execute: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

function createRow(overrides: readonly unknown[] = []): readonly unknown[] {
  return [
    "project-1",
    null,
    "Website refresh",
    "New public website",
    PROJECT_STATUS.ACTIVE,
    40,
    "#FCE3D3",
    1,
    null,
    null,
    null,
    null,
    "",
    "2026-01-01",
    "2026-01-02",
    ...overrides,
  ];
}

describe("ProjectRepository", () => {
  let database: ReturnType<typeof createDatabase>;
  let repository: ProjectRepository;

  beforeEach(() => {
    database = createDatabase();
    repository = new ProjectRepository(database);
  });

  it("returns all non-archived projects", async () => {
    database.query.mockResolvedValue([createRow(), createRow()]);

    await expect(repository.findAll()).resolves.toHaveLength(2);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE projects.archived_at IS NULL"),
    );
  });

  it("returns projects belonging to a member", async () => {
    database.query.mockResolvedValue([createRow()]);

    await expect(repository.findByMemberId("user-1")).resolves.toEqual([
      expect.objectContaining({ id: "project-1" }),
    ]);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("INNER JOIN project_members"),
      { member_id: "user-1" },
    );
  });

  it("returns a project by identifier or null", async () => {
    database.query
      .mockResolvedValueOnce([createRow()])
      .mockResolvedValueOnce([]);

    await expect(repository.findById("project-1")).resolves.toEqual({
      createdAt: "2026-01-01",
      description: "New public website",
      hasIcon: true,
      id: "project-1",
      managerId: null,
      managerName: null,
      name: "Website refresh",
      notes: "",
      parentId: null,
      placeholderColor: "#FCE3D3",
      progress: 40,
      startDate: null,
      status: "active",
      targetDate: null,
      updatedAt: "2026-01-02",
    });
    await expect(repository.findById("missing")).resolves.toBeNull();
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("WHERE projects.id = $id"),
      { id: "missing" },
    );
  });

  it("preserves a parent project identifier", async () => {
    const row = [...createRow()];
    row[1] = "parent-1";
    database.query.mockResolvedValue([row]);

    await expect(repository.findById("project-1")).resolves.toMatchObject({
      parentId: "parent-1",
    });
  });

  it("reports project membership", async () => {
    database.query.mockResolvedValueOnce([[1n]]).mockResolvedValueOnce([[0]]);

    await expect(repository.isMember("project-1", "user-1")).resolves.toBe(
      true,
    );
    await expect(repository.isMember("project-1", "user-2")).resolves.toBe(
      false,
    );
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("COUNT(*)"),
      { project_id: "project-1", user_id: "user-2" },
    );
  });

  it("throws when the membership count is missing", async () => {
    database.query.mockResolvedValue([]);

    await expect(repository.isMember("project-1", "user-1")).rejects.toThrow(
      "Database returned no membership count.",
    );
  });

  it("inserts a project and assigns its owner", async () => {
    database.execute.mockResolvedValue(undefined);
    const project = {
      description: "New public website",
      id: "project-1",
      name: "Website refresh",
      ownerId: "user-1",
      placeholderColor: "#FCE3D3",
      status: PROJECT_STATUS.PLANNED,
    };

    await repository.insert(project);

    expect(database.execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO projects"),
      {
        description: project.description,
        id: project.id,
        name: project.name,
        owner_id: project.ownerId,
        placeholder_color: project.placeholderColor,
        status: project.status,
      },
    );
    expect(database.execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO project_members"),
      { project_id: project.id, user_id: project.ownerId },
    );
  });

  it("updates and archives projects", async () => {
    database.execute.mockResolvedValue(undefined);

    await repository.update("project-1", {
      description: "Updated description",
      name: "Updated project",
      progress: 75,
      status: PROJECT_STATUS.COMPLETED,
    });
    await repository.archive("project-1");

    expect(database.execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("progress = $progress"),
      {
        description: "Updated description",
        id: "project-1",
        name: "Updated project",
        progress: 75,
        status: "completed",
      },
    );
    expect(database.execute).toHaveBeenLastCalledWith(
      expect.stringContaining("archived_at = CURRENT_TIMESTAMP"),
      { id: "project-1" },
    );
  });

  it("returns an icon or null", async () => {
    const icon = Buffer.from([1, 2, 3]);
    database.query
      .mockResolvedValueOnce([["image/png", "logo.png", icon]])
      .mockResolvedValueOnce([]);

    await expect(repository.findIconByProjectId("project-1")).resolves.toEqual({
      data: icon,
      filename: "logo.png",
      mimeType: "image/png",
    });
    await expect(repository.findIconByProjectId("missing")).resolves.toBeNull();
  });

  it("creates or replaces an icon", async () => {
    const icon = {
      data: Buffer.from([1]),
      filename: "logo.png",
      mimeType: "image/png",
    };
    database.execute.mockResolvedValue(undefined);

    await repository.upsertIcon("project-1", icon);

    expect(database.execute).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (project_id)"),
      {
        data: icon.data,
        filename: "logo.png",
        mime_type: "image/png",
        project_id: "project-1",
      },
    );
  });

  it.each([
    [1, 42],
    [4, "unknown"],
    [5, 101],
    [5, 1.5],
    [6, null],
    [7, 2],
  ])("rejects invalid project column %i", async (index, value) => {
    const row = [...createRow()];
    row[index] = value;
    database.query.mockResolvedValue([row]);

    await expect(repository.findById("project-1")).rejects.toThrow();
  });

  it("propagates database failures", async () => {
    database.query.mockRejectedValue(new Error("Query failed"));

    await expect(repository.findAll()).rejects.toThrow("Query failed");

    database.execute.mockRejectedValue(new Error("Write failed"));

    await expect(repository.archive("project-1")).rejects.toThrow(
      "Write failed",
    );
  });

  it("returns an empty integration map for an empty project list", async () => {
    await expect(repository.findIntegrationsByProjectIds([])).resolves.toEqual(
      new Map(),
    );
  });
});
