import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentAdministrationContext } from "@/backend/service/agents/AgentAdministrationContext";

const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/backend/service/agents/AgentConfirmation", () => ({
  requireAgentConfirmation: confirm,
}));

import {
  assignAdminRole,
  setAdminRolePermissions,
  setAdminScope,
} from "@/backend/service/agents/AgentAdministrationRights";

const saveRole = vi.fn();
const assignRole = vi.fn();
const setScope = vi.fn();
const findAll = vi.fn();
const oldRole = { id: "old", permissions: ["milestones", "write"] };
const newRole = { id: "new", permissions: ["milestones"] };
const context = partial<AgentAdministrationContext>({
  actor: { id: "admin" },
  database: {},
  snapshot: {
    roles: [oldRole, newRole],
    departments: [{ id: "department" }],
    accounts: [
      {
        userId: "user",
        role: oldRole,
        departments: ["department"],
        managedDepartments: ["department"],
        allDepartments: true,
        allProjects: true,
      },
    ],
  },
  repository: { groups: () => ({ findAll }) },
  administration: { saveRole, assignRole, setScope },
});

beforeEach(() => {
  vi.resetAllMocks();
  findAll.mockResolvedValue([{ id: "group", memberIds: ["user"] }]);
});

it("requires confirmation before removing permissions from a shared role", async () => {
  expect(
    await setAdminRolePermissions(context, {
      roleId: "old",
      permissions: ["milestones"],
      expectedPermissions: ["write", "milestones"],
      confirmation: "yes",
    }),
  ).toMatchObject({ changed: true, affectedUserIds: ["user"] });
  expect(confirm).toHaveBeenCalledWith(context.database, "admin", "yes");
  expect(saveRole).toHaveBeenCalledWith("admin", {
    ...oldRole,
    permissions: ["milestones"],
  });
  await expect(
    setAdminRolePermissions(context, {
      roleId: "old",
      permissions: ["milestones"],
      expectedPermissions: [],
    }),
  ).rejects.toThrow();
});

it.each(["person", "group", "department"])(
  "assigns a role to an explicitly checked %s",
  async (targetType) => {
    const targetId = targetType === "person" ? "user" : targetType;
    expect(
      await assignAdminRole(context, {
        targetType,
        targetId,
        roleId: "new",
        expectedAssignments: [{ userId: "user", roleId: "old" }],
        confirmation: "yes",
      }),
    ).toMatchObject({ changed: true, affectedUserIds: ["user"] });
    expect(confirm).toHaveBeenCalledOnce();
    expect(assignRole).toHaveBeenCalledWith("admin", "user", "new");
  },
);

it("checks the current management scope before a confirmed reduction", async () => {
  const expectedScope = {
    managedDepartments: ["department"],
    allDepartments: true,
    allProjects: true,
  };
  const scope = {
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
  };
  expect(
    await setAdminScope(context, {
      userId: "user",
      scope,
      expectedScope,
      confirmation: "yes",
    }),
  ).toMatchObject({ changed: true });
  expect(confirm).toHaveBeenCalledOnce();
  expect(setScope).toHaveBeenCalledWith("admin", "user", scope);
  await expect(
    setAdminScope(context, { userId: "user", scope, expectedScope: scope }),
  ).rejects.toThrow();
});
