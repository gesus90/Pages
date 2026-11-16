import { expect, it } from "vitest";

import {
  readAdminAssignments,
  readAdminBoolean,
  readAdminChanged,
  readAdminIds,
  readAdminName,
  readAdminParameters,
  readAdminPermissions,
  readAdminRole,
  readAdminScope,
  requireAdminCurrent,
} from "@/backend/service/agents/AgentAdministrationParameters";

it("requires exact parameters for reads and writes", () => {
  expect(
    readAdminParameters("admin.departments.rename", {
      operationId: "op",
      departmentId: "d",
      name: "Name",
      expectedName: "Old",
    }),
  ).toMatchObject({ departmentId: "d" });
  expect(() =>
    readAdminParameters("admin.departments.rename", {
      operationId: "op",
      departmentId: "d",
      name: "Name",
    }),
  ).toThrow();
  expect(() =>
    readAdminParameters("admin.departments.rename", {
      operationId: "op",
      departmentId: "d",
      name: "Name",
      expectedName: "Old",
      isAdmin: true,
    }),
  ).toThrow();
  expect(
    readAdminParameters("admin.projectMembers.read", {
      projectId: "project",
      limit: 10,
    }),
  ).toMatchObject({ projectId: "project" });
  expect(() => readAdminParameters("admin.projectMembers.read", {})).toThrow();
  expect(() =>
    readAdminParameters("admin.projectMembers.read", {
      projectId: "project",
      extra: true,
    }),
  ).toThrow();
});

it("validates scalar names, booleans, unique ids and current state", () => {
  expect(readAdminName(" Name ")).toBe("Name");
  expect(readAdminName(" ", true)).toBe("");
  expect(() => readAdminName(" ")).toThrow();
  expect(() => readAdminName("x".repeat(201))).toThrow();
  expect(readAdminBoolean(false)).toBe(false);
  expect(() => readAdminBoolean("false")).toThrow();
  expect(readAdminIds(["b", "a"])).toEqual(["a", "b"]);
  expect(() => readAdminIds(["a", "a"])).toThrow();
  expect(() => readAdminIds(["a"], 0)).toThrow();
  expect(() => requireAdminCurrent({ id: 1 }, { id: 1 })).not.toThrow();
  expect(() => requireAdminCurrent({ id: 1 }, { id: 2 })).toThrow();
});

it("validates complete scopes, roles and permissions", () => {
  expect(
    readAdminScope({
      managedDepartments: ["b", "a"],
      allDepartments: false,
      allProjects: true,
    }),
  ).toEqual({
    managedDepartments: ["a", "b"],
    allDepartments: false,
    allProjects: true,
  });
  expect(() => readAdminScope({ allDepartments: true })).toThrow();
  const role = {
    id: "role",
    name: " Role ",
    rank: 1,
    departmentBound: false,
    permissions: [],
  };
  expect(readAdminRole(role)).toMatchObject({ name: "Role", rank: 1 });
  expect(() => readAdminRole({ ...role, rank: -1 })).toThrow();
  expect(() => readAdminRole({ ...role, rank: 0.5 })).toThrow();
  expect(readAdminPermissions([])).toEqual([]);
  expect(() => readAdminPermissions(["unknown"])).toThrow();
});

it("sorts assignments and narrows persisted changed results", () => {
  expect(
    readAdminAssignments([
      { userId: "b", roleId: null },
      { userId: "a", roleId: "role" },
    ]),
  ).toEqual([
    { userId: "a", roleId: "role" },
    { userId: "b", roleId: null },
  ]);
  expect(() =>
    readAdminAssignments([
      { userId: "a", roleId: null },
      { userId: "a", roleId: "role" },
    ]),
  ).toThrow();
  expect(
    readAdminChanged({
      id: "group",
      targetType: "group",
      changed: true,
      affectedUserIds: ["b", "a"],
    }),
  ).toEqual({
    id: "group",
    targetType: "group",
    changed: true,
    affectedUserIds: ["a", "b"],
  });
  expect(() =>
    readAdminChanged({
      id: "group",
      targetType: "unknown",
      changed: true,
      affectedUserIds: [],
    }),
  ).toThrow();
});
