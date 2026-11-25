import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADMINISTRATION_ROLE_ID } from "@/definition/Authorization";

import { ManagementUserWrite } from "./ManagementUserWrite";

import type { ManagementContext } from "./ManagementContext";
import type { AccountAccess } from "@/definition/Authorization";

const state = vi.hoisted(() => ({
  user: {},
  administration: {
    createUser: vi.fn(async () => undefined),
    setActive: vi.fn(async () => undefined),
    updateProfile: vi.fn(async () => undefined),
    assignRole: vi.fn(async () => undefined),
    setMemberships: vi.fn(async () => undefined),
  },
  saveGroup: vi.fn(async () => undefined),
}));

vi.mock("@/backend/service/AdministrationService", () => ({
  AdministrationService: class {
    public createUser = state.administration.createUser;
    public setActive = state.administration.setActive;
    public updateProfile = state.administration.updateProfile;
    public assignRole = state.administration.assignRole;
    public setMemberships = state.administration.setMemberships;
  },
}));
vi.mock("@/backend/service/GroupAdministrationService", () => ({
  GroupAdministrationService: class {
    public saveGroup = state.saveGroup;
  },
}));
vi.mock("@/backend/service/employee/AgentEmployeeInput", () => ({
  readAgentEmployeeInput: (input: Record<string, unknown>) => input,
}));
vi.mock("./ManagementUserRead", () => ({
  ManagementUserRead: class {
    public user = async (): Promise<unknown> => state.user;
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
const detail = {
  agent: {
    revision: "er",
    position: "pos",
    avatarColor: "blue",
    settings: { access: "read_only", disabledToolGroups: [] },
    memoryLimits: { memoryCharacters: 1, dreamCharacters: 2 },
    learning: { isEnabled: true },
    voice: { voiceId: "v", speedTenths: 10 },
  },
};
const human = {
  id: "h1",
  kind: "human",
  username: "hh",
  displayName: "Hans",
  email: "h@example.org",
  role: "role-1",
  departments: [{ id: "d1" }],
  agent: null,
  revision: "rev",
};
const agentUser = {
  ...human,
  id: "a1",
  kind: "agent",
  role: null,
  agent: {
    agentMd: "i",
    soulMd: "s",
    connectionId: "c",
    model: "m",
    reasoningEffort: null,
  },
};
const agentBody = {
  agentMd: "i2",
  soulMd: "s2",
  connectionId: "c2",
  model: "m2",
  reasoningEffort: "high",
};

let accounts: AccountAccess[];
let groups: { id: string; memberIds: string[]; leaderIds?: string[] }[];
let users: { id: string; username: string }[];
const agents = {
  create: vi.fn(async () => "new-agent"),
  detail: vi.fn(async () => detail),
  update: vi.fn(async () => undefined),
  setActive: vi.fn(async () => undefined),
};
const updateProfile = vi.fn(async () => undefined);

function writeOf(actor: AccountAccess = administrator): ManagementUserWrite {
  return new ManagementUserWrite({
    actor,
    channel: "ui",
    cache: {},
    hasher: {},
    invitations: {},
    agents,
    authorization: {
      snapshot: async () => ({ accounts }),
      groups: () => ({ findAll: async () => groups }),
      users: () => ({ findAll: async () => users, updateProfile }),
    },
  } as unknown as ManagementContext);
}

beforeEach(() => {
  state.user = human;
  accounts = [
    accountOf({ userId: "h1" }),
    accountOf({ userId: "a1", isAgent: true }),
    administrator,
    accountOf({ userId: "adm2", isAdmin: true }),
  ];
  groups = [
    { id: "g1", memberIds: ["h1"], leaderIds: ["h1", "z"] },
    { id: "g2", memberIds: [] },
    { id: "g3", memberIds: ["h1"] },
  ];
  users = [{ id: "created", username: "nu" }];
  for (const mock of [
    ...Object.values(state.administration),
    ...Object.values(agents),
    state.saveGroup,
    updateProfile,
  ])
    mock.mockClear();
});

function inputMatching(fields: Record<string, unknown>): unknown {
  return expect.objectContaining(fields);
}

const humanCreate = {
  kind: "human",
  username: "nu",
  displayName: "New",
  email: "n@example.org",
  role: "role-1",
  departmentIds: ["d1"],
  groupIds: ["g1", "g2"],
};

describe("ManagementUserWrite.create", () => {
  it("invites a human and joins groups", async () => {
    const result = await writeOf().create(humanCreate);
    expect(result).toEqual({ id: "created", revision: "rev" });
    expect(state.administration.createUser).toHaveBeenCalledWith(
      "root",
      expect.objectContaining({ email: "n@example.org", roleId: "role-1" }),
      expect.anything(),
    );
    expect(state.saveGroup).toHaveBeenCalledWith(
      "root",
      expect.objectContaining({ id: "g2", memberIds: ["created"] }),
    );
  });

  it("fails when the created account cannot be found", async () => {
    users = [];
    await expect(writeOf().create(humanCreate)).rejects.toThrow(
      "Created account is missing",
    );
  });

  it("creates an agent, with or without a profile email", async () => {
    const agentCreate = {
      ...humanCreate,
      kind: "agent",
      email: undefined,
      agent: agentBody,
      groupIds: [],
    };
    expect(await writeOf().create(agentCreate)).toMatchObject({
      id: "new-agent",
    });
    expect(updateProfile).not.toHaveBeenCalled();
    await writeOf().create({ ...agentCreate, email: "x@example.org" });
    expect(updateProfile).toHaveBeenCalledWith("new-agent", {
      username: "nu",
      displayName: "New",
      email: "x@example.org",
    });
  });

  it("refuses protected roles", async () => {
    await expect(
      writeOf(management).create({
        ...humanCreate,
        role: ADMINISTRATION_ROLE_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails agent input without an agent", () => {
    const write = writeOf();
    const agentInput = Reflect.get(write, "agentInput") as (
      request: unknown,
    ) => unknown;
    expect(() => agentInput.call(write, { ...humanCreate })).toThrow(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });
});

describe("ManagementUserWrite.update", () => {
  it("rejects stale revisions and unknown accounts", async () => {
    await expect(
      writeOf().update("h1", { expectedRevision: "old" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      writeOf().update("none", { expectedRevision: "rev" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps omitted human fields and skips unchanged roles", async () => {
    await writeOf().update("h1", { expectedRevision: "rev", role: "role-1" });
    expect(state.administration.updateProfile).toHaveBeenCalledWith(
      "root",
      "h1",
      {
        username: "hh",
        firstName: "Hans",
        lastName: "",
        email: "h@example.org",
      },
    );
    expect(state.administration.assignRole).not.toHaveBeenCalled();
    expect(state.administration.setMemberships).not.toHaveBeenCalled();
    expect(state.saveGroup).not.toHaveBeenCalled();
  });

  it("applies supplied human fields and group changes", async () => {
    await writeOf().update("h1", {
      expectedRevision: "rev",
      displayName: "H",
      email: null,
      role: "role-2",
      departmentIds: ["d2"],
      groupIds: ["g2", "g3"],
    });
    expect(state.administration.updateProfile).toHaveBeenCalledWith(
      "root",
      "h1",
      expect.objectContaining({ firstName: "H", email: null }),
    );
    expect(state.administration.assignRole).toHaveBeenCalledWith(
      "root",
      "h1",
      "role-2",
    );
    expect(state.administration.setMemberships).toHaveBeenCalledWith(
      "root",
      "h1",
      ["d2"],
    );
    expect(state.saveGroup).toHaveBeenCalledWith("root", {
      id: "g1",
      memberIds: [],
      leaderIds: ["z"],
    });
    expect(state.saveGroup).toHaveBeenCalledWith("root", {
      id: "g2",
      memberIds: ["h1"],
      leaderIds: undefined,
    });
  });

  it("rejects agent settings for humans and unknown groups", async () => {
    await expect(
      writeOf().update("h1", { expectedRevision: "rev", agent: agentBody }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      writeOf().update("h1", { expectedRevision: "rev", groupIds: ["nope"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ManagementUserWrite.update of agents", () => {
  it("updates an agent from its current state", async () => {
    state.user = agentUser;
    await writeOf().update("a1", { expectedRevision: "rev" });
    expect(agents.update).toHaveBeenCalledWith(
      "root",
      "a1",
      {
        input: inputMatching({
          displayName: "Hans",
          roleId: "",
          departments: ["d1"],
          model: "m",
        }),
        revision: "er",
      },
      null,
    );
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("updates an agent with supplied fields and profile email", async () => {
    state.user = agentUser;
    await writeOf().update("a1", {
      expectedRevision: "rev",
      displayName: "B",
      role: "role-2",
      departmentIds: ["d2"],
      agent: agentBody,
      email: "b@example.org",
    });
    expect(agents.update).toHaveBeenCalledWith(
      "root",
      "a1",
      {
        input: inputMatching({
          displayName: "B",
          roleId: "role-2",
          departments: ["d2"],
          model: "m2",
        }),
        revision: "er",
      },
      null,
    );
    expect(updateProfile).toHaveBeenCalledWith("a1", {
      username: "hh",
      displayName: "B",
      email: "b@example.org",
    });
  });

  it("rejects an agent patch without any agent state", async () => {
    state.user = { ...agentUser, agent: null };
    await expect(
      writeOf().update("a1", { expectedRevision: "rev" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("ManagementUserWrite.status", () => {
  it("activates and deactivates a human", async () => {
    expect(
      await writeOf().status("h1", {
        expectedRevision: "rev",
        status: "active",
      }),
    ).toEqual({ id: "h1", revision: "rev", status: "active" });
    await writeOf().status("h1", {
      expectedRevision: "rev",
      status: "deactivated",
    });
    expect(state.administration.setActive).toHaveBeenLastCalledWith(
      "root",
      "h1",
      false,
    );
  });

  it("changes the status of an agent at its employee revision", async () => {
    state.user = agentUser;
    await writeOf().status("a1", {
      expectedRevision: "rev",
      status: "deactivated",
    });
    expect(agents.setActive).toHaveBeenCalledWith("root", "a1", {
      isActive: false,
      revision: "er",
    });
  });

  it("rejects stale revisions", async () => {
    await expect(
      writeOf().status("h1", { expectedRevision: "old", status: "active" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("ManagementUserWrite.changeable", () => {
  it("protects administrators and protected roles", async () => {
    await expect(writeOf(management).changeable("adm2")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      writeOf(management).changeable("h1", ADMINISTRATION_ROLE_ID),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await writeOf(management).changeable("h1", "role-2")).toBe(human);
  });
});
