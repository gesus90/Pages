import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentAdministrationContext } from "@/backend/service/agents/AgentAdministrationContext";

const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/backend/service/agents/AgentConfirmation", () => ({
  requireAgentConfirmation: confirm,
}));

import {
  renameAdminDepartment,
  setAdminDepartments,
  setAdminUserName,
  updateAdminGroup,
} from "@/backend/service/agents/AgentAdministrationMemberships";

const listUsers = vi.fn();
const updateProfile = vi.fn();
const setMemberships = vi.fn();
const saveDepartment = vi.fn();
const findGroups = vi.fn();
const saveGroup = vi.fn();
const context = partial<AgentAdministrationContext>({
  actor: { id: "admin" },
  database: {},
  snapshot: {
    accounts: [
      {
        userId: "user",
        firstName: "Old",
        lastName: "Name",
        departments: ["d1"],
      },
    ],
    departments: [{ id: "d1", name: "Department" }],
  },
  administration: { listUsers, updateProfile, setMemberships, saveDepartment },
  repository: { groups: () => ({ findAll: findGroups }) },
  groups: { saveGroup },
});

beforeEach(() => {
  vi.resetAllMocks();
  listUsers.mockResolvedValue([
    { id: "user", username: "login", email: "mail@example.com" },
  ]);
  findGroups.mockResolvedValue([
    { id: "group", name: "Group", memberIds: ["user"] },
  ]);
});

it("changes a display name while retaining login and email", async () => {
  expect(
    await setAdminUserName(context, {
      userId: "user",
      firstName: "New",
      lastName: "Name",
      expectedFirstName: "Old",
      expectedLastName: "Name",
    }),
  ).toMatchObject({ changed: true, affectedUserIds: ["user"] });
  expect(updateProfile).toHaveBeenCalledWith("admin", "user", {
    username: "login",
    email: "mail@example.com",
    firstName: "New",
    lastName: "Name",
  });
  await expect(
    setAdminUserName(context, {
      userId: "user",
      firstName: "New",
      lastName: "Name",
      expectedFirstName: "stale",
      expectedLastName: "Name",
    }),
  ).rejects.toThrow();
});

it("requires confirmation before removing a department membership", async () => {
  await setAdminDepartments(context, {
    userId: "user",
    departmentIds: [],
    expectedDepartmentIds: ["d1"],
    confirmation: "yes",
  });
  expect(confirm).toHaveBeenCalledWith(context.database, "admin", "yes");
  expect(setMemberships).toHaveBeenCalledWith("admin", "user", []);
});

it("updates only an existing group with matching prior state", async () => {
  expect(
    await updateAdminGroup(context, {
      groupId: "group",
      name: "New",
      memberIds: ["user", "other"],
      expectedName: "Group",
      expectedMemberIds: ["user"],
    }),
  ).toMatchObject({ changed: true, affectedUserIds: ["other", "user"] });
  expect(saveGroup).toHaveBeenCalledOnce();
  await expect(
    updateAdminGroup(context, {
      groupId: "missing",
      name: "New",
      memberIds: [],
      expectedName: "Group",
      expectedMemberIds: [],
    }),
  ).rejects.toThrow();
});

it("renames a department with revision-like name checking", async () => {
  expect(
    await renameAdminDepartment(context, {
      departmentId: "d1",
      name: "New",
      expectedName: "Department",
    }),
  ).toMatchObject({ changed: true });
  expect(saveDepartment).toHaveBeenCalledWith("admin", {
    id: "d1",
    name: "New",
  });
  await expect(
    renameAdminDepartment(context, {
      departmentId: "d1",
      name: "New",
      expectedName: "stale",
    }),
  ).rejects.toThrow();
});
