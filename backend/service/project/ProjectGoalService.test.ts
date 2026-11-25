import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectManagementDeniedError } from "@/backend/error/ProjectErrors";

import { ProjectGoalService } from "./ProjectGoalService";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { User } from "@/definition/User";

const access = vi.hoisted(() => ({
  getById: vi.fn(async () => ({})),
  canWrite: vi.fn(async () => true),
  constructed: vi.fn(),
}));

vi.mock("./ProjectAccessService", () => ({
  ProjectAccessService: class {
    public getById = access.getById;
    public canWrite = access.canWrite;
    public constructor(...parameters: unknown[]) {
      access.constructed(...parameters);
    }
  },
}));

const actor = doubleOf<User>({ id: "u1" });

function setup(): {
  readonly service: ProjectGoalService;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
} {
  const repository = {
    findGoals: vi.fn(async () => [{ id: "g1" }, { id: "g2" }]),
    insertGoal: vi.fn(async () => {}),
    insertActivity: vi.fn(async () => {}),
    updateGoal: vi.fn(async () => {}),
    deleteGoal: vi.fn(async () => {}),
  };
  const service = new ProjectGoalService(
    repository as unknown as ProjectRepository,
    doubleOf<ServerCache>({}),
  );
  return { service, repository };
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canWrite.mockResolvedValue(true);
});

describe("ProjectGoalService", () => {
  it("lists goals after the access check", async () => {
    const { service, repository } = setup();
    expect(await service.findAll(actor, "p")).toHaveLength(2);
    expect(access.getById).toHaveBeenCalledWith(actor, "p");
    expect(repository.findGoals).toHaveBeenCalledWith("p");
  });

  it("creates a trimmed goal at the end and records activity", async () => {
    const { service, repository } = setup();
    await service.create(actor, "p", " Ship ");
    expect(repository.insertGoal).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p", title: "Ship", position: 2 }),
    );
    expect(repository.insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "goal_created", userId: "u1" }),
    );
  });

  it("rejects empty and overlong titles", async () => {
    const { service } = setup();
    await expect(service.create(actor, "p", " ")).rejects.toThrow("Goal title");
    await expect(service.create(actor, "p", "a".repeat(201))).rejects.toThrow(
      "Goal title",
    );
  });

  it("refuses writes without the write rule", async () => {
    access.canWrite.mockResolvedValue(false);
    const { service } = setup();
    await expect(service.create(actor, "p", "A")).rejects.toBeInstanceOf(
      ProjectManagementDeniedError,
    );
  });

  it("updates and deletes known goals", async () => {
    const { service, repository } = setup();
    await service.update(actor, "p", "g1", { title: " T ", isDone: true });
    expect(repository.updateGoal).toHaveBeenCalledWith("g1", "T", true);
    await service.delete(actor, "p", "g2");
    expect(repository.deleteGoal).toHaveBeenCalledWith("g2");
  });

  it("refuses unknown goals", async () => {
    const { service } = setup();
    await expect(
      service.update(actor, "p", "x", { title: "T", isDone: false }),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    await expect(service.delete(actor, "p", "x")).rejects.toBeInstanceOf(
      ProjectManagementDeniedError,
    );
  });
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}
