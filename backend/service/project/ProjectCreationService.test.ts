import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectDepartmentError,
  ProjectManagementDeniedError,
} from "@/backend/error/ProjectErrors";

import { ProjectCreationService } from "./ProjectCreationService";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  NewProject,
  ProjectRepository,
} from "@/backend/database/repositories/ProjectRepository";
import type { User } from "@/definition/User";

const policy = vi.hoisted(() => ({
  canSelectDepartment: vi.fn(() => true),
  canCreate: vi.fn(() => true),
  canAccess: vi.fn(() => true),
  has: vi.fn(() => true),
}));

vi.mock("@/backend/auth/McpActorContext", () => ({
  accountForChannel: (account: object) => account,
}));
vi.mock("@/backend/auth/ProjectPolicyService", () => ({
  ProjectPolicyService: class {
    public canSelectDepartment = policy.canSelectDepartment;
    public canCreate = policy.canCreate;
    public canAccess = policy.canAccess;
  },
}));
vi.mock("@/backend/auth/UserPolicyService", () => ({
  UserPolicyService: class {
    public has = policy.has;
  },
}));

const actor = doubleOf<User>({ id: "u1" });

function project(overrides: Partial<NewProject> = {}): NewProject {
  return doubleOf<NewProject>({
    id: "p1",
    name: " Name ",
    description: " Text ",
    status: "active",
    departmentIds: ["d1", "d1"],
    ...overrides,
  });
}

function setup(
  options: {
    readonly accounts?: readonly object[];
    readonly departments?: readonly object[];
  } = {},
): {
  readonly service: ProjectCreationService;
  readonly repository: Record<string, ReturnType<typeof vi.fn>>;
  readonly cache: { invalidateProjectsList: ReturnType<typeof vi.fn> };
} {
  const repository: Record<string, ReturnType<typeof vi.fn>> = {
    authorization: vi.fn(() => ({
      snapshot: async () => ({
        accounts: options.accounts ?? [{ userId: "u1", isActive: true }],
        departments: options.departments ?? [{ id: "d1" }],
      }),
    })),
    insert: vi.fn(async () => {}),
  };
  repository.transaction = vi.fn(async (work: (r: object) => unknown) =>
    work(repository),
  );
  const cache = { invalidateProjectsList: vi.fn() };
  const service = new ProjectCreationService(
    repository as unknown as ProjectRepository,
    cache as unknown as ServerCache,
  );
  return { service, repository, cache };
}

beforeEach(() => {
  vi.clearAllMocks();
  policy.canSelectDepartment.mockReturnValue(true);
  policy.canCreate.mockReturnValue(true);
  policy.canAccess.mockReturnValue(true);
  policy.has.mockReturnValue(true);
});

describe("choices", () => {
  it("offers selectable departments", async () => {
    const choices = await setup().service.choices(actor);
    expect(choices).toEqual({
      available: [{ id: "d1" }],
      selectionRequired: true,
    });
  });

  it("denies unknown and inactive accounts", async () => {
    await expect(
      setup({ accounts: [] }).service.choices(actor),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
    await expect(
      setup({ accounts: [{ userId: "u1", isActive: false }] }).service.choices(
        actor,
      ),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});

describe("create", () => {
  it("saves the trimmed project with unique departments", async () => {
    const { service, repository, cache } = setup();
    expect(await service.create(actor, project())).toBe(true);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Name",
        description: "Text",
        ownerId: "u1",
        departmentIds: ["d1"],
      }),
    );
    expect(cache.invalidateProjectsList).toHaveBeenCalled();
  });

  it("allows projects without departments when none exist", async () => {
    const { service } = setup({ departments: [] });
    expect(
      await service.create(actor, project({ departmentIds: undefined })),
    ).toBe(true);
  });

  it("denies unknown accounts and missing capability", async () => {
    await expect(
      setup({ accounts: [] }).service.create(actor, project()),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    policy.has.mockReturnValue(false);
    await expect(
      setup().service.create(actor, project()),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });

  it("validates the input", async () => {
    const { service } = setup();
    for (const bad of [
      project({ name: " " }),
      project({ name: "a".repeat(201) }),
      project({ description: "a".repeat(10_001) }),
      project({ status: "bogus" as NewProject["status"] }),
    ])
      await expect(service.create(actor, bad)).rejects.toThrow(
        "Invalid project input.",
      );
  });

  it("requires and validates departments", async () => {
    const { service } = setup();
    await expect(
      service.create(actor, project({ departmentIds: [] })),
    ).rejects.toMatchObject({ code: "departmentRequired" });
    await expect(
      service.create(actor, project({ departmentIds: ["x"] })),
    ).rejects.toMatchObject({ code: "invalidDepartment" });
  });

  it("refuses selections outside the actor's range", async () => {
    policy.canCreate.mockReturnValue(false);
    await expect(
      setup().service.create(actor, project()),
    ).rejects.toBeInstanceOf(ProjectDepartmentError);
  });

  it("handles unreadable projects according to the option", async () => {
    policy.canAccess.mockReturnValue(false);
    await expect(
      setup().service.create(actor, project(), { requireReadable: true }),
    ).rejects.toMatchObject({ code: "departmentOutOfScope" });
    const { service, repository } = setup();
    expect(await service.create(actor, project())).toBe(false);
    expect(repository.insert).toHaveBeenCalled();
  });
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}
