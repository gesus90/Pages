import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADMINISTRATION_ROLE_ID } from "@/definition/Authorization";

import { ManagementCatalog } from "./ManagementCatalog";

import type { ManagementContext } from "./ManagementContext";
import type { AccountAccess } from "@/definition/Authorization";

const state = vi.hoisted(() => ({
  project: null as { id: string; departments: { id: string }[] } | null,
  members: [] as { userId: string; projectRole: string }[],
  isManager: false,
  repository: {
    removeMember: vi.fn(async () => undefined),
    updateMemberRole: vi.fn(async () => undefined),
    addMember: vi.fn(async () => undefined),
    setDepartments: vi.fn(async () => undefined),
  },
  description: vi.fn(async () => "text"),
  setDescription: vi.fn(async () => undefined),
  saveGroup: vi.fn(async () => undefined),
}));

vi.mock("@/backend/database/repositories/ProjectRepository", () => ({
  ProjectRepository: class {
    public removeMember = state.repository.removeMember;
    public updateMemberRole = state.repository.updateMemberRole;
    public addMember = state.repository.addMember;
    public setDepartments = state.repository.setDepartments;
    public findById = async (): Promise<unknown> => state.project;
    public findMembers = async (): Promise<unknown[]> => state.members;
    public isProjectManager = async (): Promise<boolean> => state.isManager;
  },
}));
vi.mock("@/backend/database/repositories/ManagementRepository", () => ({
  ManagementRepository: class {
    public description = state.description;
    public setDescription = state.setDescription;
  },
}));
vi.mock("@/backend/service/GroupAdministrationService", () => ({
  GroupAdministrationService: class {
    public saveGroup = state.saveGroup;
  },
}));

function accountOf(overrides: Partial<AccountAccess>): AccountAccess {
  return {
    userId: "u",
    role: {
      id: "role-1",
      name: "R",
      rank: 1,
      departmentBound: true,
      permissions: [],
    },
    isAdmin: false,
    mode: "role",
    firstName: "A",
    lastName: "B",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: true,
    ...overrides,
  };
}

const administrator = accountOf({
  userId: "root",
  isAdmin: true,
  mode: "admin",
});
const management = accountOf({
  userId: "manager",
  role: {
    id: ADMINISTRATION_ROLE_ID,
    name: "M",
    rank: 9,
    departmentBound: false,
    permissions: [],
  },
});
let groups: {
  id: string;
  name: string;
  memberIds: string[];
  leaderIds: string[];
}[];
let accounts: AccountAccess[];
let departments: { id: string }[];

function catalogOf(actor: AccountAccess = administrator): ManagementCatalog {
  return new ManagementCatalog({
    actor,
    channel: "ui",
    cache: {},
    database: {},
    authorization: {
      groups: () => ({ findAll: async () => groups }),
      snapshot: async () => ({ accounts, departments }),
    },
  } as unknown as ManagementContext);
}

async function revisionOf(): Promise<string> {
  return catalogOf().projectRevision("p1");
}

beforeEach(() => {
  groups = [{ id: "g1", name: "G", memberIds: ["a"], leaderIds: [] }];
  accounts = [
    accountOf({ userId: "a" }),
    accountOf({ userId: "b" }),
    accountOf({ userId: "off", isActive: false }),
    administrator,
  ];
  departments = [{ id: "d1" }];
  state.project = { id: "p1", departments: [{ id: "d1" }] };
  state.members = [];
  state.isManager = false;
  for (const mock of [
    ...Object.values(state.repository),
    state.setDescription,
    state.saveGroup,
  ])
    mock.mockClear();
});

describe("ManagementCatalog groups", () => {
  it("reads a group with description and revision", async () => {
    const group = await catalogOf().group("g1");
    expect(group).toMatchObject({ id: "g1", description: "text" });
    expect(group.revision).toMatch(/^[0-9a-f]{64}$/u);
    await expect(catalogOf().group("none")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("creates a group", async () => {
    const result = await catalogOf()
      .createGroup({
        name: "N",
        description: "d",
        memberIds: [],
        leaderIds: [],
      })
      .catch((error: unknown) => error);
    expect(state.saveGroup).toHaveBeenCalledWith(
      "root",
      expect.objectContaining({ name: "N" }),
      { allowEmpty: true },
    );
    expect(state.setDescription).toHaveBeenCalledWith(expect.any(String), "d");
    expect(result).toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates supplied and keeps omitted group fields", async () => {
    const { revision } = await catalogOf().group("g1");
    const result = await catalogOf().updateGroup("g1", {
      expectedRevision: revision,
    });
    expect(result).toMatchObject({ id: "g1" });
    expect(state.saveGroup).toHaveBeenLastCalledWith(
      "root",
      { id: "g1", name: "G", memberIds: ["a"], leaderIds: [] },
      { allowEmpty: true },
    );
    await catalogOf().updateGroup("g1", {
      expectedRevision: revision,
      name: "X",
      memberIds: ["b"],
      leaderIds: ["b"],
      description: "new",
    });
    expect(state.saveGroup).toHaveBeenLastCalledWith(
      "root",
      { id: "g1", name: "X", memberIds: ["b"], leaderIds: ["b"] },
      { allowEmpty: true },
    );
    expect(state.setDescription).toHaveBeenLastCalledWith("g1", "new");
    await expect(
      catalogOf().updateGroup("g1", { expectedRevision: "stale" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("ManagementCatalog.projectRevision", () => {
  it("hashes the project and its members, or reports a missing project", async () => {
    const first = await revisionOf();
    state.members = [{ userId: "a", projectRole: "member" }];
    expect(await revisionOf()).not.toBe(first);
    state.project = null;
    await expect(revisionOf()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ManagementCatalog.members", () => {
  it("rejects missing projects and callers who cannot edit them", async () => {
    state.project = null;
    await expect(
      catalogOf().members("p1", { expectedRevision: "r", members: [] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    state.project = { id: "p1", departments: [{ id: "d9" }] };
    await expect(
      catalogOf(accountOf({ userId: "x" })).members("p1", {
        expectedRevision: "r",
        members: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.isManager = true;
    await expect(
      catalogOf(accountOf({ userId: "x" })).members("p1", {
        expectedRevision: "r",
        members: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects stale revisions and unknown or inactive members", async () => {
    await expect(
      catalogOf().members("p1", { expectedRevision: "stale", members: [] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const expectedRevision = await revisionOf();
    await expect(
      catalogOf().members("p1", {
        expectedRevision,
        members: [{ userId: "zz", role: "member" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      catalogOf().members("p1", {
        expectedRevision,
        members: [{ userId: "off", role: "member" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("removes, updates and adds members with mapped roles", async () => {
    state.members = [
      { userId: "a", projectRole: "member" },
      { userId: "b", projectRole: "viewer" },
    ];
    const expectedRevision = await revisionOf();
    const result = await catalogOf().members("p1", {
      expectedRevision,
      members: [
        { userId: "b", role: "projectmanager" },
        { userId: "root", role: "viewer" },
      ],
    });
    expect(result).toMatchObject({ projectId: "p1" });
    expect(state.repository.removeMember).toHaveBeenCalledWith("p1", "a");
    expect(state.repository.updateMemberRole).toHaveBeenCalledWith(
      "p1",
      "b",
      "manager",
    );
    expect(state.repository.addMember).toHaveBeenCalledWith(
      "p1",
      "root",
      "viewer",
      expect.any(String),
    );
  });

  it("keeps unchanged memberships out of the membership policy", async () => {
    state.members = [{ userId: "a", projectRole: "member" }];
    const expectedRevision = await revisionOf();
    await catalogOf(management).members("p1", {
      expectedRevision,
      members: [{ userId: "a", role: "member" }],
    });
    expect(state.repository.updateMemberRole).toHaveBeenCalledWith(
      "p1",
      "a",
      "member",
    );
  });

  it("applies the membership policy to changed administrator memberships", async () => {
    const expectedRevision = await revisionOf();
    await expect(
      catalogOf(management).members("p1", {
        expectedRevision,
        members: [{ userId: "root", role: "member" }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("ManagementCatalog.departments", () => {
  it("replaces the departments of a project", async () => {
    const expectedRevision = await revisionOf();
    const result = await catalogOf().departments("p1", {
      expectedRevision,
      departmentIds: ["d1"],
    });
    expect(result).toMatchObject({ projectId: "p1" });
    expect(state.repository.setDepartments).toHaveBeenCalledWith("p1", ["d1"]);
  });

  it("rejects stale revisions, empty selections and unknown departments", async () => {
    await expect(
      catalogOf().departments("p1", {
        expectedRevision: "stale",
        departmentIds: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const expectedRevision = await revisionOf();
    await expect(
      catalogOf().departments("p1", { expectedRevision, departmentIds: [] }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      catalogOf().departments("p1", {
        expectedRevision,
        departmentIds: ["zz"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("allows an empty selection without a catalog", async () => {
    departments = [];
    const expectedRevision = await revisionOf();
    await catalogOf().departments("p1", {
      expectedRevision,
      departmentIds: [],
    });
    expect(state.repository.setDepartments).toHaveBeenCalledWith("p1", []);
  });
});
