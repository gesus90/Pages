import { beforeEach, describe, expect, it, vi } from "vitest";

import { managementRevision } from "./ManagementRevision";
import { ManagementUserRead } from "./ManagementUserRead";

import type { ManagementContext } from "./ManagementContext";
import type { AccountAccess } from "@/definition/Authorization";

const state = vi.hoisted(() => ({
  projects: vi.fn<(userId: string) => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/backend/database/repositories/ManagementRepository", () => ({
  ManagementRepository: class {
    public projects = state.projects;
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

const actor = accountOf({ userId: "root", isAdmin: true, mode: "admin" });
const accounts = [
  actor,
  accountOf({ userId: "b-human", departments: ["d1"] }),
  accountOf({ userId: "a-agent", isAgent: true, isActive: false, role: null }),
];
const identities: Record<
  string,
  {
    displayName: string;
    username: string;
    avatarImageUrl: string | null;
    avatarColor: string | null;
  }
> = {
  root: {
    displayName: "Root",
    username: "root",
    avatarImageUrl: null,
    avatarColor: null,
  },
  "b-human": {
    displayName: "Bea",
    username: "bea",
    avatarImageUrl: null,
    avatarColor: null,
  },
  "a-agent": {
    displayName: "Bot",
    username: "bot",
    avatarImageUrl: null,
    avatarColor: null,
  },
};
const agentDetail = {
  agent: {
    revision: "er",
    avatarImageUrl: "/a.png",
    documents: { instructions: "i", soul: "s" },
    settings: { connectionId: "c", model: "m", reasoningEffort: null },
  },
};

function contextOf(
  overrides: { actor?: AccountAccess; accounts?: AccountAccess[] } = {},
): ManagementContext {
  const list = overrides.accounts ?? accounts;
  return {
    actor: overrides.actor ?? actor,
    channel: "ui",
    database: {},
    agents: { detail: vi.fn(async () => agentDetail) },
    authorization: {
      snapshot: async () => ({
        accounts: list,
        departments: [
          { id: "d1", name: "One" },
          { id: "d2", name: "Two" },
        ],
      }),
      users: () => ({
        findById: async (id: string) => identities[id] ?? null,
        findEmailsByUserIds: async () =>
          new Map([["b-human", "b@example.org"]]),
      }),
      groups: () => ({
        findAll: async () => [
          { id: "g1", name: "G", memberIds: ["b-human"] },
          { id: "g2", name: "H", memberIds: [] },
        ],
      }),
    },
  } as unknown as ManagementContext;
}

beforeEach(() => {
  state.projects.mockReset();
  state.projects.mockImplementation(async (userId: string) =>
    userId === "b-human"
      ? [
          { id: "p1", name: "P", role: "manager" },
          { id: "p2", name: "Q", role: "member" },
        ]
      : [],
  );
});

describe("ManagementUserRead.user", () => {
  it("reads a human with memberships and mapped project roles", async () => {
    const user = await new ManagementUserRead(contextOf()).user("b-human");
    expect(user).toMatchObject({
      id: "b-human",
      email: "b@example.org",
      kind: "human",
      role: "role-1",
      status: "active",
      departments: [{ id: "d1", name: "One" }],
      groups: [{ id: "g1", name: "G" }],
      agent: null,
    });
    expect(user.projects.map((project) => project.role)).toEqual([
      "projectmanager",
      "member",
    ]);
    expect(user.revision).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("reads an agent with its settings", async () => {
    const user = await new ManagementUserRead(contextOf()).user("a-agent");
    expect(user).toMatchObject({
      kind: "agent",
      role: null,
      status: "deactivated",
      email: null,
      agent: {
        agentMd: "i",
        soulMd: "s",
        connectionId: "c",
        model: "m",
        avatarUrl: "/a.png",
      },
    });
  });

  it("hides unknown, unidentified and invisible accounts", async () => {
    const reads = new ManagementUserRead(contextOf());
    await expect(reads.user("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const noIdentity = new ManagementUserRead(
      contextOf({ accounts: [...accounts, accountOf({ userId: "ghost" })] }),
    );
    await expect(noIdentity.user("ghost")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const outsider = new ManagementUserRead(
      contextOf({ actor: accountOf({ userId: "x" }) }),
    );
    await expect(outsider.user("b-human")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("ManagementUserRead.list", () => {
  it("lists visible accounts sorted by id", async () => {
    const result = await new ManagementUserRead(contextOf()).list({});
    expect(result.users.map((user) => user.id)).toEqual([
      "a-agent",
      "b-human",
      "root",
    ]);
    expect(result.total).toBe(3);
    expect(result.nextCursor).toBeNull();
  });

  it("filters by kind, status, department, group and text", async () => {
    const reads = new ManagementUserRead(contextOf());
    const ids = async (filter: unknown): Promise<string[]> =>
      (await reads.list(filter)).users.map((user) => user.id);
    expect(await ids({ kind: "agent" })).toEqual(["a-agent"]);
    expect(await ids({ status: "deactivated" })).toEqual(["a-agent"]);
    expect(await ids({ departmentId: "d1" })).toEqual(["b-human"]);
    expect(await ids({ groupId: "g1" })).toEqual(["b-human"]);
    expect(await ids({ query: "BEA" })).toEqual(["b-human"]);
    expect(await ids({ query: "nobody" })).toEqual([]);
  });

  it("pages with an opaque cursor", async () => {
    const reads = new ManagementUserRead(contextOf());
    const first = await reads.list({ limit: 2 });
    expect(first.users.map((user) => user.id)).toEqual(["a-agent", "b-human"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await reads.list({ limit: 2, cursor: first.nextCursor });
    expect(second.users.map((user) => user.id)).toEqual(["root"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects invalid cursors", async () => {
    const reads = new ManagementUserRead(contextOf());
    const fingerprint = managementRevision({});
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const cursor of [
      "%%%",
      encode(null),
      encode("text"),
      encode({ fingerprint: "other", after: "root" }),
      encode({ fingerprint }),
      encode({ fingerprint, after: 5 }),
      encode({ fingerprint, after: "missing" }),
    ])
      await expect(reads.list({ cursor })).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
  });
});
