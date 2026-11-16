import { beforeEach, expect, it, vi } from "vitest";

import { AgentProfileReadService } from "@/backend/service/employee/profile/AgentProfileReadService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentProfileReadDependencies } from "@/backend/service/employee/profile/AgentProfileReadService";
import type { DatabaseTransaction } from "@/backend/database/Database";

const world = vi.hoisted(() => {
  const reader = {
    userId: "reader",
    isActive: true,
    isAdmin: true,
    mode: "admin",
    isAgent: false,
  };
  const agent = {
    userId: "agent",
    isActive: true,
    departments: ["department"],
    role: { name: "Developer" },
  };
  const users = [
    { id: "reader", displayName: "Reader", isAgent: false },
    { id: "agent", displayName: "Agent", isAgent: true },
  ];
  const employee = {
    userId: "agent",
    instructions: "Build things",
    soul: "Be clear",
    connectionId: "connection",
    model: "model",
    reasoningEffort: null,
    access: "read_only",
  };
  const group = {
    id: "group",
    name: "Group",
    memberIds: ["reader", "agent"],
    leaderIds: ["reader"],
  };
  const loads = {
    projectsByUser: vi.fn(
      async () =>
        new Map([
          ["agent", [{ id: "project", name: "Project", role: "member" }]],
        ]),
    ),
    activeChats: vi.fn(async () => new Map([["agent", 2]])),
    runningSteps: vi.fn(async () => new Map()),
    openTicketCounts: vi.fn(async () => new Map([["agent", 3]])),
    lastActivity: vi.fn(async () => new Map()),
    openTickets: vi.fn(async () => []),
  };
  return { reader, agent, users, employee, group, loads };
});

vi.mock("@/backend/service/agents/AgentTransactionScope", () => ({
  agentTransactionScope: (transaction: unknown) => transaction,
}));
vi.mock("@/backend/database/repositories/AuthorizationRepository", () => ({
  AuthorizationRepository: class {
    public readonly snapshot = async (): Promise<{
      accounts: (typeof world.reader | typeof world.agent)[];
      departments: { id: string; name: string }[];
    }> => ({
      accounts: [world.reader, world.agent],
      departments: [{ id: "department", name: "Department" }],
    });
    public readonly users = (): {
      findAll: () => Promise<typeof world.users>;
    } => ({ findAll: async () => world.users });
    public readonly groups = (): {
      findAll: () => Promise<(typeof world.group)[]>;
    } => ({ findAll: async () => [world.group] });
    public readonly employees = (): {
      employees: () => { list: () => Promise<(typeof world.employee)[]> };
      identities: () => {
        jobTitles: () => Promise<Map<string, string | null>>;
      };
      profileLoads: () => typeof world.loads;
    } => ({
      employees: () => ({ list: async () => [world.employee] }),
      identities: () => ({ jobTitles: async () => new Map() }),
      profileLoads: () => world.loads,
    });
  },
}));

function subject(): AgentProfileReadService {
  const transaction = partial<DatabaseTransaction>({});
  const dependencies = partial<AgentProfileReadDependencies>({
    database: {
      readTransaction: async (
        work: (value: DatabaseTransaction) => Promise<unknown>,
      ) => work(transaction),
    },
    models: { describe: async () => ({ provider: "synthetic" }) },
  });
  return new AgentProfileReadService(dependencies);
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("lists visible agents with memberships, summary and workload", async () => {
  const result = await subject().list("reader", {
    groupId: "group",
    departmentId: "department",
    projectId: "project",
    limit: 1,
  });
  expect(result).toMatchObject({
    total: 1,
    nextCursor: null,
    agents: [
      {
        id: "agent",
        displayName: "Agent",
        role: "Developer",
        summary: "Build things",
        activeChats: 2,
        openTickets: 3,
        departments: [{ id: "department" }],
        groups: [{ id: "group" }],
      },
    ],
  });
  expect(
    (await subject().list("reader", { projectId: "missing" })).agents,
  ).toEqual([]);
  await expect(
    subject().list("reader", { cursor: "invalid" }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  await expect(subject().list("reader", { limit: 0 })).rejects.toMatchObject({
    code: "invalid_request",
  });
});

it("reads profile and group details and rejects missing entities", async () => {
  const service = subject();
  await expect(service.read("reader", "agent")).resolves.toMatchObject({
    id: "agent",
    agentMd: "Build things",
    soulMd: "Be clear",
    load: { activeChats: 2, openTickets: [] },
  });
  await expect(service.group("reader", "group")).resolves.toMatchObject({
    id: "group",
    leaders: [{ id: "reader" }],
    members: [
      { id: "reader", isAgent: false },
      { id: "agent", isAgent: true },
    ],
  });
  await expect(service.groupAgents("reader", "group")).resolves.toMatchObject({
    total: 1,
  });
  await expect(service.read("reader", "missing")).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(service.group("reader", "missing")).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(service.list("missing", {})).rejects.toMatchObject({
    code: "forbidden",
  });
});
