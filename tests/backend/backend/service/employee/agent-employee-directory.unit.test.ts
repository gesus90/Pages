import { expect, it, vi } from "vitest";

import { AgentEmployeeDirectory } from "@/backend/service/employee/AgentEmployeeDirectory";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AccountAccess } from "@/definition/Authorization";
import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";

const user = {
  id: "agent",
  isAgent: true,
  username: "agent",
  displayName: "Agent",
  isActive: true,
  avatarType: "image",
  avatarImageUrl: "/avatar",
};
const account = partial<AccountAccess>({
  userId: "agent",
  role: { id: "role", name: "Role" },
  departments: ["visible", "hidden"],
});
const snapshot = partial<AuthorizationSnapshot>({
  accounts: [account],
  departments: [{ id: "visible" }],
});
const employee = {
  userId: "agent",
  connectionId: "connection",
  model: "model",
  reasoningEffort: null,
  access: "read_only",
  disabledToolGroups: [],
  soul: "Soul",
  instructions: "Instructions",
  voiceId: null,
  voiceSpeedTenths: 10,
  memory: "two words",
  dream: "Dream",
  memoryCharacters: 100,
  dreamCharacters: 100,
  isLearningEnabled: false,
  dreamSchedule: { isEnabled: false },
  lastLearningAt: null,
  lastLearningResult: null,
  revision: 1,
  createdAt: "2026-01-01 12:00:00",
  updatedAt: "2026-01-02 12:00:00",
};
const findUser = vi.fn(async () => user);
const findEmployee = vi.fn<() => Promise<typeof employee | null>>(
  async () => employee,
);
const auth = {
  users: () => ({
    findAll: async () => [user, { ...user, id: "person", isAgent: false }],
    findById: findUser,
  }),
  employees: () => ({
    employees: () => ({ list: async () => [employee], find: findEmployee }),
    identities: () => ({
      jobTitles: async () => new Map([["agent", "Engineer"]]),
    }),
    memory: () => ({ archiveWords: async () => 7 }),
    sessionSettings: () => ({ read: async () => ({ dreamTime: "03:00" }) }),
  }),
};
const models = {
  describe: vi.fn(async () => ({ modelName: "Model", provider: "codex_cli" })),
};
const activity = { cost: vi.fn(async () => ({ total: 1 })) };
const directory = new AgentEmployeeDirectory(
  partial<ConstructorParameters<typeof AgentEmployeeDirectory>[0]>({
    authorization: auth,
    models,
    activity,
  }),
);

it("lists only visible agent accounts and projects their display facts", async () => {
  expect(await directory.list(snapshot, () => true)).toMatchObject([
    {
      id: "agent",
      position: "Engineer",
      roleId: "role",
      modelName: "Model",
      avatarImageUrl: "/avatar",
    },
  ]);
  expect(await directory.list(snapshot, () => false)).toEqual([]);
});

it("reads the agent panel while filtering unavailable departments", async () => {
  const detail = await directory.detail(snapshot, account);
  expect(detail).toMatchObject({
    departmentIds: ["visible"],
    documents: { soul: "Soul", instructions: "Instructions" },
    memoryUsage: { coreWords: 2, archiveWords: 7 },
    learning: { isEnabled: false, nextRunAt: null },
    createdAt: "2026-01-01T12:00:00Z",
  });
});

it("rejects a panel when its employee record is gone", async () => {
  findEmployee.mockResolvedValueOnce(null);
  await expect(directory.detail(snapshot, account)).rejects.toThrow();
});
