import { expect, it } from "vitest";

import { McpUserRequest } from "@/backend/service/mcp/users/McpUserRequest";

it("parses bounded directory queries and rejects duplicate or unknown parameters", () => {
  expect(McpUserRequest.list(new URLSearchParams())).toEqual({ limit: 50 });
  expect(
    McpUserRequest.userList(new URLSearchParams("limit=12&isActive=false")),
  ).toEqual({ limit: 12, isActive: "false" });
  for (const query of [
    "limit=1&limit=2",
    "limit=0",
    "limit=101",
    "extra=x",
    "isActive=yes",
  ])
    expect(() => McpUserRequest.userList(new URLSearchParams(query))).toThrow();
});

it("defaults creation fields and refuses extra privileged input", () => {
  const body = {
    operationId: " op ",
    username: "user",
    firstName: "First",
    lastName: "Last",
    roleId: null,
  };
  expect(McpUserRequest.createUser(body)).toMatchObject({
    operationId: "op",
    email: null,
    isAdmin: false,
    departmentIds: [],
  });
  expect(() =>
    McpUserRequest.createUser({ ...body, password: "secret" }),
  ).toThrow();
  expect(() =>
    McpUserRequest.createUser({ ...body, departmentIds: ["same", "same"] }),
  ).toThrow();
});

it("requires an expected value for every profile field being changed", () => {
  expect(
    McpUserRequest.updateUser({
      operationId: "op",
      firstName: "New",
      expected: { firstName: "Old" },
    }),
  ).toMatchObject({ firstName: "New" });
  expect(() =>
    McpUserRequest.updateUser({ operationId: "op", expected: {} }),
  ).toThrow();
  expect(() =>
    McpUserRequest.updateUser({
      operationId: "op",
      firstName: "New",
      expected: {},
    }),
  ).toThrow();
});

it("parses user control and scope changes with their expected state", () => {
  const scope = {
    managedDepartments: ["department"],
    allDepartments: false,
    allProjects: true,
  };
  expect(
    McpUserRequest.active({
      operationId: "op",
      isActive: false,
      expected: { isActive: true },
    }).isActive,
  ).toBe(false);
  expect(McpUserRequest.reset({ operationId: "op" })).toEqual({
    operationId: "op",
  });
  expect(
    McpUserRequest.departments({
      operationId: "op",
      departmentIds: [],
      expected: { departmentIds: ["old"] },
    }).departmentIds,
  ).toEqual([]);
  expect(
    McpUserRequest.scope({ operationId: "op", scope, expected: { scope } })
      .scope,
  ).toEqual(scope);
  expect(
    McpUserRequest.administrator({
      operationId: "op",
      isAdmin: true,
      expected: { isAdmin: false },
    }).isAdmin,
  ).toBe(true);
  expect(() =>
    McpUserRequest.scope({
      operationId: "op",
      scope: { ...scope, allProjects: "yes" },
      expected: { scope },
    }),
  ).toThrow();
});

it("validates role assignments and role changes", () => {
  const role = {
    name: "Role",
    rank: 1,
    departmentBound: false,
    permissions: [],
  };
  expect(
    McpUserRequest.assign({
      operationId: "op",
      targetType: "group",
      targetId: "group",
      expectedAssignments: [],
    }),
  ).toMatchObject({ targetId: "group" });
  expect(
    McpUserRequest.roleCreate({ operationId: "op", ...role }),
  ).toMatchObject(role);
  expect(
    McpUserRequest.roleUpdate({ operationId: "op", rank: 2, expected: role })
      .rank,
  ).toBe(2);
  expect(
    McpUserRequest.roleDelete({ operationId: "op", expected: role }).expected,
  ).toEqual(role);
  expect(() =>
    McpUserRequest.roleCreate({ operationId: "op", ...role, rank: -1 }),
  ).toThrow();
  expect(() =>
    McpUserRequest.assign({
      operationId: "op",
      targetType: "unknown",
      targetId: "x",
      expectedAssignments: [],
    }),
  ).toThrow();
});

it("checks department and group expected membership", () => {
  const expected = { name: "Old", memberIds: ["user"] };
  expect(
    McpUserRequest.departmentCreate({ operationId: "op", name: "New" }).name,
  ).toBe("New");
  expect(
    McpUserRequest.departmentUpdate({
      operationId: "op",
      name: "New",
      expected: { name: "Old" },
    }).expected.name,
  ).toBe("Old");
  expect(
    McpUserRequest.membersDelete({ operationId: "op", expected }).expected,
  ).toEqual(expected);
  expect(
    McpUserRequest.groupCreate({
      operationId: "op",
      name: "Group",
      memberIds: ["user"],
    }).memberIds,
  ).toEqual(["user"]);
  expect(
    McpUserRequest.groupUpdate({ operationId: "op", name: "New", expected })
      .expected,
  ).toEqual(expected);
  expect(() =>
    McpUserRequest.groupCreate({
      operationId: "op",
      name: "Group",
      memberIds: ["x", "x"],
    }),
  ).toThrow();
});
