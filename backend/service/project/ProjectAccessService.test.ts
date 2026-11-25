import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import { ProjectAccessService } from "./ProjectAccessService";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { User } from "@/definition/User";

const policy = vi.hoisted(() => ({
  canAccess: vi.fn<(account: { userId: string }, ids: string[]) => boolean>(
    () => true,
  ),
  canEditGeneral: vi.fn(() => true),
  hasGlobalAccess: vi.fn(() => false),
}));

vi.mock("@/backend/auth/McpActorContext", () => ({
  accountForChannel: (account: object) => account,
}));
vi.mock("@/backend/auth/ProjectPolicyService", () => ({
  ProjectPolicyService: class {
    public canAccess = policy.canAccess;
    public canEditGeneral = policy.canEditGeneral;
  },
}));
vi.mock("@/backend/auth/UserPolicyService", () => ({
  UserPolicyService: class {
    public hasGlobalAccess = policy.hasGlobalAccess;
  },
}));

const actor = doubleOf<User>({ id: "u1" });
const dep = { id: "d1", name: "D" };

type Mock = ReturnType<typeof vi.fn>;

interface Facts {
  readonly accounts?: readonly object[];
  readonly project?: object | null;
}

function setup(facts: Facts = {}): {
  readonly service: ProjectAccessService;
  readonly repository: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    authorization: vi.fn(() => ({
      snapshot: async () => ({
        accounts: facts.accounts ?? [
          { userId: "u1", isActive: true, departments: ["d1"] },
          { userId: "u2", isActive: true, departments: [] },
        ],
        departments: [dep],
      }),
    })),
    findActiveIds: vi.fn(async () => ["p1", "p2"]),
    findDepartmentsByProjects: vi.fn(async () => new Map([["p1", [dep]]])),
    findAll: vi.fn(async () => [{ id: "p1" }, { id: "p2" }]),
    findByMemberId: vi.fn(async () => [{ id: "p1" }, { id: "p2" }]),
    findGoals: vi.fn(async () => [{ isDone: true }, { isDone: false }]),
    findById: vi.fn(async () =>
      facts.project === undefined
        ? { id: "p1", departments: [dep] }
        : facts.project,
    ),
    isProjectManager: vi.fn(async () => true),
  };
  repository.readTransaction = vi.fn(async (work: (r: object) => unknown) =>
    work(repository),
  );
  const cache: Record<string, Mock> = {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  };
  const service = new ProjectAccessService(
    repository as unknown as ProjectRepository,
    cache as unknown as ServerCache,
  );
  return { service, repository, cache };
}

beforeEach(() => {
  vi.clearAllMocks();
  policy.canAccess.mockReturnValue(true);
  policy.canEditGeneral.mockReturnValue(true);
  policy.hasGlobalAccess.mockReturnValue(false);
});

describe("account and authorizationFacts", () => {
  it("returns active accounts", async () => {
    const { service } = setup();
    expect((await service.account(actor)).userId).toBe("u1");
    const facts = await service.authorizationFacts(actor);
    expect(facts.departments).toEqual([dep]);
  });

  it("denies unknown and inactive accounts", async () => {
    const unknown = setup({ accounts: [] }).service;
    await expect(unknown.account(actor)).rejects.toBeInstanceOf(
      ProjectAccessDeniedError,
    );
    await expect(unknown.authorizationFacts(actor)).rejects.toBeInstanceOf(
      ProjectAccessDeniedError,
    );
    const inactive = setup({
      accounts: [{ userId: "u1", isActive: false }],
    }).service;
    await expect(inactive.account(actor)).rejects.toBeInstanceOf(
      ProjectAccessDeniedError,
    );
  });
});

describe("scope", () => {
  it("limits projects by policy and restricts departments", async () => {
    policy.canAccess.mockImplementation((account: unknown, ids: string[]) =>
      ids.includes("d1"),
    );
    const { service } = setup();
    const scope = await service.scope(actor);
    expect(scope.projectIds).toEqual(["p1"]);
    expect(scope.visibility.departmentIds).toEqual(["d1"]);
  });

  it("lifts the department limit for global access", async () => {
    policy.hasGlobalAccess.mockReturnValue(true);
    const { service } = setup();
    expect((await service.scope(actor)).visibility.departmentIds).toBeNull();
  });
});

describe("findAll", () => {
  it("loads, caches and filters rows with live departments", async () => {
    policy.canAccess.mockImplementation((account: unknown, ids: string[]) =>
      ids.includes("d1"),
    );
    const { service, repository, cache } = setup();
    const projects = await service.findAll(actor);
    expect(projects).toEqual([{ id: "p1", departments: [dep] }]);
    expect(repository.findAll).toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
  });

  it("uses cached rows and empty departments when missing", async () => {
    const { service, repository, cache } = setup();
    cache.get.mockReturnValue([{ id: "p2" }]);
    const projects = await service.findAll(actor);
    expect(repository.findAll).not.toHaveBeenCalled();
    expect(projects).toEqual([{ id: "p2", departments: [] }]);
  });
});

describe("findAssigned", () => {
  it("reports goal counts for projects in scope only", async () => {
    policy.canAccess.mockImplementation((account: unknown, ids: string[]) =>
      ids.includes("d1"),
    );
    const { service } = setup();
    const assigned = await service.findAssigned(actor);
    expect(assigned).toEqual([
      {
        project: { id: "p1", departments: [dep] },
        goalCount: 2,
        completedGoalCount: 1,
      },
    ]);
  });

  it("falls back to no departments", async () => {
    const { service, repository } = setup();
    repository.findByMemberId.mockResolvedValue([{ id: "p2" }]);
    const assigned = await service.findAssigned(actor);
    expect(assigned[0]?.project.departments).toEqual([]);
  });
});

describe("getById and canWrite", () => {
  it("returns an accessible project", async () => {
    const { service } = setup();
    expect((await service.getById(actor, "p1")).id).toBe("p1");
  });

  it("rejects a missing or inaccessible project", async () => {
    await expect(
      setup({ project: null }).service.getById(actor, "p1"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    policy.canAccess.mockReturnValue(false);
    await expect(setup().service.getById(actor, "p1")).rejects.toBeInstanceOf(
      ProjectAccessDeniedError,
    );
  });

  it("writes when the policy allows it", async () => {
    const { service } = setup();
    expect(await service.canWrite(actor, "p1")).toBe(true);
    policy.canEditGeneral.mockReturnValue(false);
    expect(await service.canWrite(actor, "p1")).toBe(false);
  });

  it("does not write to missing or unreadable projects", async () => {
    expect(await setup({ project: null }).service.canWrite(actor, "p1")).toBe(
      false,
    );
    policy.canAccess.mockReturnValue(false);
    expect(await setup().service.canWrite(actor, "p1")).toBe(false);
  });
});

describe("filterAssignees", () => {
  it("keeps users whose accounts may still access active projects", async () => {
    policy.canAccess.mockImplementation(
      (account: { userId: string }) => account.userId === "u1",
    );
    const { service } = setup();
    const users = [{ id: "u1" }, { id: "u2" }, { id: "u3" }].map((user) =>
      doubleOf<User>(user),
    );
    const result = await service.filterAssignees(
      new Map([
        ["p1", users],
        ["p2", users],
        ["gone", users],
      ]),
    );
    expect([...result.keys()]).toEqual(["p1", "p2"]);
    expect(result.get("p1")).toEqual([users[0]]);
  });
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}
