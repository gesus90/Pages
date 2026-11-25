import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import { ProjectManagementService } from "./ProjectManagementService";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  ProjectDetailsUpdate,
  ProjectRepository,
  ProjectUpdate,
} from "@/backend/database/repositories/ProjectRepository";
import type { User } from "@/definition/User";

const doubles = vi.hoisted(() => ({
  canAccess: vi.fn<(account: unknown, ids: string[]) => boolean>(() => true),
  canEditGeneral: vi.fn(() => true),
  canManageAssignments: vi.fn(() => true),
  canArchive: vi.fn(() => true),
  canDelete: vi.fn(() => true),
  canChangeDepartments: vi.fn(() => true),
  account: vi.fn(async () => ({ userId: "u1" })),
  getById: vi.fn(async () => ({ departments: [{ id: "d1" }] })),
  canWrite: vi.fn(async () => true),
  describe: vi.fn(async () => ({ scope: { name: "S" } })),
  deleteWithEffects: vi.fn(async () => ({})),
}));

vi.mock("@/backend/auth/ProjectPolicyService", () => ({
  ProjectPolicyService: class {
    public canAccess = doubles.canAccess;
    public canEditGeneral = doubles.canEditGeneral;
    public canManageAssignments = doubles.canManageAssignments;
    public canArchive = doubles.canArchive;
    public canDelete = doubles.canDelete;
    public canChangeDepartments = doubles.canChangeDepartments;
  },
}));
vi.mock("./ProjectAccessService", () => ({
  ProjectAccessService: class {
    public account = doubles.account;
    public getById = doubles.getById;
    public canWrite = doubles.canWrite;
  },
}));
vi.mock("./ProjectDeletionService", () => ({
  ProjectDeletionService: class {
    public describe = doubles.describe;
    public deleteWithEffects = doubles.deleteWithEffects;
  },
}));

const actor = doubleOf<User>({ id: "u1" });
type Mock = ReturnType<typeof vi.fn>;

const general = doubleOf<ProjectUpdate>({
  name: " N ",
  description: " D ",
  status: "active",
  progress: 50,
});
const details = doubleOf<ProjectDetailsUpdate>({
  ...general,
  notes: " n ",
  managerId: null,
});

function setup(
  facts: {
    departments?: readonly object[];
    active?: object | null;
    archived?: object | null;
    archive?: boolean;
  } = {},
): {
  readonly service: ProjectManagementService;
  readonly repository: Record<string, Mock>;
  readonly cache: Record<string, Mock>;
} {
  const repository: Record<string, Mock> = {
    authorization: vi.fn(() => ({
      snapshot: async () => ({
        accounts: [],
        departments: facts.departments ?? [{ id: "d1" }, { id: "d2" }],
      }),
    })),
    findById: vi.fn(async () =>
      facts.active === undefined
        ? { id: "p", departments: [{ id: "d1" }] }
        : facts.active,
    ),
    findArchivedById: vi.fn(async () =>
      facts.archived === undefined ? null : facts.archived,
    ),
    findArchived: vi.fn(async () => [
      { departments: [{ id: "d1" }] },
      { departments: [{ id: "d2" }] },
    ]),
    isProjectManager: vi.fn(async () => true),
    update: vi.fn(async () => {}),
    updateDetails: vi.fn(async () => {}),
    insertActivity: vi.fn(async () => {}),
    findMembers: vi.fn(async () => [{ userId: "m1" }]),
    upsertIcon: vi.fn(async () => {}),
    setDepartments: vi.fn(async () => {}),
    appendEvent: vi.fn(async () => {}),
    archive: vi.fn(async () => facts.archive ?? true),
    findGoals: vi.fn(async () => []),
    findTags: vi.fn(async () => []),
    findEvents: vi.fn(async () => []),
    findIntegration: vi.fn(async () => null),
  };
  repository.transaction = vi.fn(async (work: (r: object) => unknown) =>
    work(repository),
  );
  repository.readTransaction = repository.transaction;
  const cache: Record<string, Mock> = {
    invalidateProject: vi.fn(),
    invalidateProjectMembership: vi.fn(),
    invalidateWorkItems: vi.fn(),
    invalidateLabels: vi.fn(),
    invalidateGitHub: vi.fn(),
  };
  const service = new ProjectManagementService(
    repository as unknown as ProjectRepository,
    cache as unknown as ServerCache,
  );
  return { service, repository, cache };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of [
    "canAccess",
    "canEditGeneral",
    "canManageAssignments",
    "canArchive",
    "canDelete",
    "canChangeDepartments",
  ] as const)
    doubles[name].mockReturnValue(true);
  doubles.canWrite.mockResolvedValue(true);
  doubles.getById.mockResolvedValue({ departments: [{ id: "d1" }] });
});

describe("channels and flags", () => {
  it("copies deletion effects to the service of another channel", async () => {
    const { service } = setup();
    const effects = { stopRuns: vi.fn(), removeFiles: vi.fn() };
    service.setDeletionEffects(effects);
    await service.forChannel("mcp").deletePermanently(actor, "p");
    expect(doubles.deleteWithEffects).toHaveBeenCalledWith(actor, "p", effects);
    expect(await service.canDelete(actor)).toBe(true);
  });

  it("describes the deletion scope", async () => {
    expect(await setup().service.describeDeletion(actor, "p")).toEqual({
      name: "S",
    });
  });
});

describe("permissions", () => {
  it("grants all hints for an accessible active project", async () => {
    expect(await setup().service.permissions(actor, "p")).toEqual({
      canEditGeneral: true,
      canChangeDepartments: true,
      canArchive: true,
      canDelete: true,
    });
  });

  it("limits archived projects to deletion", async () => {
    const { service } = setup({
      active: null,
      archived: { departments: [{ id: "d1" }] },
    });
    expect(await service.permissions(actor, "p")).toEqual({
      canEditGeneral: false,
      canChangeDepartments: false,
      canArchive: false,
      canDelete: true,
    });
  });

  it("grants nothing without access and fails for unknown projects", async () => {
    doubles.canAccess.mockReturnValue(false);
    expect(await setup().service.permissions(actor, "p")).toEqual({
      canEditGeneral: false,
      canChangeDepartments: false,
      canArchive: false,
      canDelete: false,
    });
    await expect(
      setup({ active: null }).service.permissions(actor, "p"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

describe("findArchived and readArchived", () => {
  it("filters archived projects by access", async () => {
    doubles.canAccess.mockImplementation((candidate: unknown, ids: string[]) =>
      ids.includes("d1"),
    );
    expect(await setup().service.findArchived(actor)).toHaveLength(1);
  });

  it("reads archived contents", async () => {
    const { service } = setup({ archived: { departments: [{ id: "d1" }] } });
    expect(await service.readArchived(actor, "p")).toMatchObject({
      members: [{ userId: "m1" }],
      integration: null,
    });
  });

  it("rejects missing and inaccessible archives", async () => {
    await expect(
      setup().service.readArchived(actor, "p"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    doubles.canAccess.mockReturnValue(false);
    await expect(
      setup({ archived: { departments: [{ id: "d1" }] } }).service.readArchived(
        actor,
        "p",
      ),
    ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  });
});

describe("update", () => {
  it("saves trimmed values and invalidates the project", async () => {
    const { service, repository, cache } = setup();
    await service.update(actor, "p", general);
    expect(repository.update).toHaveBeenCalledWith(
      "p",
      expect.objectContaining({ name: "N", description: "D" }),
    );
    expect(cache.invalidateProject).toHaveBeenCalledWith("p");
  });

  it("refuses without write access", async () => {
    doubles.canWrite.mockResolvedValue(false);
    await expect(
      setup().service.update(actor, "p", general),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });

  it("requires a department when departments exist", async () => {
    doubles.getById.mockResolvedValue({ departments: [] });
    await expect(
      setup().service.update(actor, "p", general),
    ).rejects.toMatchObject({ code: "departmentRequired" });
    await expect(
      setup({ departments: [] }).service.update(actor, "p", general),
    ).resolves.toBeUndefined();
  });

  it("validates general values", async () => {
    const { service } = setup();
    for (const bad of [
      { ...general, name: " " },
      { ...general, name: "a".repeat(201) },
      { ...general, description: "a".repeat(10_001) },
      { ...general, status: "bogus" },
      { ...general, progress: 1.5 },
      { ...general, progress: -1 },
      { ...general, progress: 101 },
    ] as ProjectUpdate[])
      await expect(service.update(actor, "p", bad)).rejects.toThrow();
  });
});

describe("updateDetails", () => {
  it("saves details, records activity and returns the project", async () => {
    const { service, repository } = setup();
    const result = await service.updateDetails(actor, "p", {
      ...details,
      managerId: "m1",
    });
    expect(result).toMatchObject({ id: "p" });
    expect(repository.updateDetails).toHaveBeenCalledWith(
      "p",
      expect.objectContaining({ notes: "n" }),
    );
    expect(repository.insertActivity).toHaveBeenCalled();
    await expect(
      setup().service.updateDetails(actor, "p", details),
    ).resolves.toBeDefined();
  });

  it("validates notes and manager", async () => {
    const { service } = setup();
    await expect(
      service.updateDetails(actor, "p", {
        ...details,
        notes: "a".repeat(10_001),
      }),
    ).rejects.toThrow("notes");
    await expect(
      service.updateDetails(actor, "p", { ...details, managerId: "zzz" }),
    ).rejects.toThrow("manager");
  });

  it("fails when the project disappears", async () => {
    const { service, repository } = setup();
    repository.findById.mockResolvedValueOnce(null);
    await expect(
      service.updateDetails(actor, "p", details),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

describe("replaceIcon", () => {
  it("stores the icon", async () => {
    const { service, repository } = setup();
    await service.replaceIcon(actor, "p", doubleOf<never>({}));
    expect(repository.upsertIcon).toHaveBeenCalled();
  });
});

describe("setDepartments", () => {
  it("replaces the departments and appends an event", async () => {
    const { service, repository, cache } = setup();
    await service.setDepartments(actor, "p", ["d2", "d2"]);
    expect(repository.setDepartments).toHaveBeenCalledWith("p", ["d2"]);
    expect(repository.appendEvent).toHaveBeenCalled();
    expect(cache.invalidateGitHub).toHaveBeenCalled();
  });

  it("changes nothing for the same set", async () => {
    const { service, repository } = setup();
    await service.setDepartments(actor, "p", ["d1"]);
    expect(repository.setDepartments).not.toHaveBeenCalled();
  });

  it("detects a different set of the same size or a different size", async () => {
    const { service, repository } = setup();
    await service.setDepartments(actor, "p", ["d1", "d2"]);
    expect(repository.setDepartments).toHaveBeenCalled();
  });

  it("rejects forbidden, empty, unknown and out-of-scope selections", async () => {
    doubles.canManageAssignments.mockReturnValue(false);
    await expect(
      setup().service.setDepartments(actor, "p", ["d1"]),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
    doubles.canManageAssignments.mockReturnValue(true);
    await expect(
      setup().service.setDepartments(actor, "p", []),
    ).rejects.toMatchObject({ code: "departmentRequired" });
    await expect(
      setup().service.setDepartments(actor, "p", ["zzz"]),
    ).rejects.toMatchObject({ code: "invalidDepartment" });
    doubles.canChangeDepartments.mockReturnValue(false);
    await expect(
      setup().service.setDepartments(actor, "p", ["d2"]),
    ).rejects.toMatchObject({ code: "departmentOutOfScope" });
  });
});

describe("archive", () => {
  it("archives and appends an event", async () => {
    const { service, repository } = setup();
    await service.archive(actor, "p");
    expect(repository.appendEvent).toHaveBeenCalled();
  });

  it("skips the event when nothing was archived", async () => {
    const { service, repository } = setup({ archive: false });
    await service.archive(actor, "p");
    expect(repository.appendEvent).not.toHaveBeenCalled();
  });

  it("refuses without the archive right", async () => {
    doubles.canArchive.mockReturnValue(false);
    await expect(setup().service.archive(actor, "p")).rejects.toBeInstanceOf(
      ProjectManagementDeniedError,
    );
  });
});

function doubleOf<Type>(value: unknown): Type {
  return value as Type;
}
