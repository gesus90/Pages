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
} from "@/backend/service/agents/AgentAdministrationParameters";
import { CAPABILITY } from "@/definition/Authorization";

const invalidRequest = expect.objectContaining({ code: "INVALID_REQUEST" });
const role = {
  id: "role",
  name: "Role",
  rank: 1,
  departmentBound: false,
  permissions: [],
};

it("accepts empty read parameters but refuses client facts and unrelated fields", () => {
  for (const input of [null, undefined, {}])
    expect(readAdminParameters("admin.users.list", input)).toEqual({});
  expect(() =>
    readAdminParameters("admin.users.list", { isAdmin: true }),
  ).toThrow(invalidRequest);
  expect(() =>
    readAdminParameters("admin.projectMembers.read", {
      projectId: "project",
      extra: true,
    }),
  ).toThrow(invalidRequest);
});

it.each([null, 1, "", " ", "a".repeat(201)])(
  "refuses an administrative name %j",
  (input) => {
    expect(() => readAdminName(input)).toThrow(invalidRequest);
  },
);

it("trims names and permits the deliberately empty surname", () => {
  expect(readAdminName("  Name  ")).toBe("Name");
  expect(readAdminName(" ", true)).toBe("");
  expect(readAdminName("a".repeat(200))).toHaveLength(200);
});

it.each([null, 0, "false", {}])(
  "refuses truthiness coercion for %j",
  (input) => {
    expect(() => readAdminBoolean(input)).toThrow(invalidRequest);
  },
);

it("preserves both boolean authorization states", () => {
  expect(readAdminBoolean(true)).toBe(true);
  expect(readAdminBoolean(false)).toBe(false);
});

it.each([
  null,
  {},
  ["same", "same"],
  Array.from({ length: 101 }, (_, index) => `id-${index}`),
])("refuses malformed or duplicate identifiers %j", (input) => {
  expect(() => readAdminIds(input)).toThrow(invalidRequest);
});

it("sorts bounded unique identifier sets", () => {
  expect(readAdminIds(["b", "a"], 2)).toEqual(["a", "b"]);
  expect(() => readAdminIds(["b", "a"], 1)).toThrow(invalidRequest);
});

it.each([null, {}, Array.from({ length: 8 }, () => CAPABILITY.WRITE)])(
  "refuses oversized or malformed permission sets %j",
  (input) => {
    expect(() => readAdminPermissions(input)).toThrow(invalidRequest);
  },
);

it.each(["1", -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
  "refuses an invalid role rank %j",
  (rank) => {
    expect(() => readAdminRole({ ...role, rank })).toThrow(invalidRequest);
  },
);

it("accepts a complete role including zero rank", () => {
  expect(readAdminRole({ ...role, rank: 0 })).toEqual({ ...role, rank: 0 });
});

it.each([
  null,
  {},
  Array.from({ length: 101 }, (_, index) => ({
    userId: `user-${index}`,
    roleId: null,
  })),
  [
    { userId: "same", roleId: null },
    { userId: "same", roleId: "role" },
  ],
])("refuses malformed or repeated batch assignments %j", (input) => {
  expect(() => readAdminAssignments(input)).toThrow(invalidRequest);
});

it("sorts batch assignments and preserves the absence of a role", () => {
  expect(
    readAdminAssignments([
      { userId: "b", roleId: "role" },
      { userId: "a", roleId: null },
    ]),
  ).toEqual([
    { userId: "a", roleId: null },
    { userId: "b", roleId: "role" },
  ]);
});

it.each(["unknown", null, 1])(
  "refuses an unsupported saved target %j",
  (targetType) => {
    expect(() =>
      readAdminChanged({
        id: "id",
        targetType,
        changed: false,
        affectedUserIds: [],
      }),
    ).toThrow(invalidRequest);
  },
);

it.each(["person", "group", "department", "role"])(
  "accepts a validated saved result for %s",
  (targetType) => {
    const result = {
      id: "id",
      targetType,
      changed: false,
      affectedUserIds: [],
    };
    expect(readAdminChanged(result)).toEqual(result);
  },
);
