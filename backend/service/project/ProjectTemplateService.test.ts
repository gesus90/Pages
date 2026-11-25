import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import { ProjectTemplateService } from "./ProjectTemplateService";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  NewProject,
  ProjectRepository,
} from "@/backend/database/repositories/ProjectRepository";
import type { User } from "@/definition/User";

const doubles = vi.hoisted(() => ({
  canAccess: vi.fn(() => true),
  account: vi.fn(async () => ({ userId: "u1" })),
  getById: vi.fn(async () => ({
    name: "N",
    description: "D",
    status: "active",
  })),
  canWrite: vi.fn(async () => true),
  create: vi.fn(async () => true),
}));

vi.mock("@/backend/auth/ProjectPolicyService", () => ({
  ProjectPolicyService: class {
    public canAccess = doubles.canAccess;
  },
}));
vi.mock("./ProjectAccessService", () => ({
  ProjectAccessService: class {
    public account = doubles.account;
    public getById = doubles.getById;
    public canWrite = doubles.canWrite;
  },
}));
vi.mock("./ProjectCreationService", () => ({
  ProjectCreationService: class {
    public create = doubles.create;
  },
}));

const actor = doubleOf<User>({ id: "u1" });
const template = {
  id: "t1",
  projectId: "src",
  description: "TD",
  status: "paused",
  goals: ["g1", "g2"],
  tags: ["x"],
};

type Mock = ReturnType<typeof vi.fn>;

function setup(
  facts: {
    templates?: readonly object[];
    active?: object | null;
    archived?: object | null;
  } = {},
): {
  readonly service: ProjectTemplateService;
  readonly repository: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    findTemplates: vi.fn(async () => facts.templates ?? [template]),
    findById: vi.fn(async () =>
      facts.active === undefined
        ? { departments: [{ id: "d" }] }
        : facts.active,
    ),
    findArchivedById: vi.fn(async () =>
      facts.archived === undefined ? null : facts.archived,
    ),
    findGoals: vi.fn(async () => [{ title: "G" }]),
    findTags: vi.fn(async () => ["tag"]),
    saveTemplate: vi.fn(async () => {}),
    insertGoal: vi.fn(async () => {}),
    setTags: vi.fn(async () => {}),
  };
  repository.transaction = vi.fn(async (work: (r: object) => unknown) =>
    work(repository),
  );
  repository.readTransaction = repository.transaction;
  const cache: Record<string, Mock> = { invalidateProjectsList: vi.fn() };
  const service = new ProjectTemplateService(
    repository as unknown as ProjectRepository,
    cache as unknown as ServerCache,
  );
  return { service, repository, cache };
}

beforeEach(() => {
  vi.clearAllMocks();
  doubles.canAccess.mockReturnValue(true);
  doubles.canWrite.mockResolvedValue(true);
  doubles.create.mockResolvedValue(true);
});

describe("findAll", () => {
  it("lists templates whose source stays accessible", async () => {
    const other = { ...template, id: "t2" };
    const { service } = setup({ templates: [template, other] });
    expect(await service.findAll(actor)).toHaveLength(2);
    doubles.canAccess.mockReturnValue(false);
    expect(await setup().service.findAll(actor)).toEqual([]);
  });

  it("falls back to archived sources and drops missing ones", async () => {
    const archived = setup({ active: null, archived: { departments: [] } });
    expect(await archived.service.findAll(actor)).toHaveLength(1);
    expect(await setup({ active: null }).service.findAll(actor)).toEqual([]);
  });
});

describe("save", () => {
  it("creates a new snapshot", async () => {
    const { service, repository } = setup({ templates: [] });
    await service.save(actor, "p");
    expect(repository.saveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p",
        name: "N",
        goals: ["G"],
        tags: ["tag"],
      }),
    );
  });

  it("refreshes the existing snapshot of the project", async () => {
    const { service, repository } = setup({
      templates: [{ id: "old", projectId: "p" }, template],
    });
    await service.save(actor, "p");
    expect(repository.saveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "old" }),
    );
  });

  it("requires write access", async () => {
    doubles.canWrite.mockResolvedValue(false);
    await expect(setup().service.save(actor, "p")).rejects.toBeInstanceOf(
      ProjectManagementDeniedError,
    );
  });
});

describe("create", () => {
  const input = doubleOf<NewProject>({ id: "new", name: "New" });

  it("instantiates goals and tags and invalidates the list", async () => {
    const { service, repository, cache } = setup();
    expect(await service.create(actor, "t1", input)).toBe(true);
    expect(doubles.create).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ description: "TD", status: "paused" }),
      {},
    );
    expect(repository.insertGoal).toHaveBeenCalledTimes(2);
    expect(repository.setTags).toHaveBeenCalledWith("new", ["x"]);
    expect(cache.invalidateProjectsList).toHaveBeenCalled();
  });

  it("rejects unknown templates and inaccessible sources", async () => {
    await expect(
      setup().service.create(actor, "zzz", input),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    doubles.canAccess.mockReturnValue(false);
    await expect(
      setup().service.create(actor, "t1", input),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}
