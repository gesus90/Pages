import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { isCapability } from "@/definition/Authorization";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type {
  AgentAdminReadOperation,
  AgentAdminWriteOperation,
  AgentAdminChanged,
} from "@/definition/AgentAdministration";
import type {
  Capability,
  ManagementScopeInput,
  UserRole,
} from "@/definition/Authorization";

const WRITE_KEYS: Readonly<
  Record<AgentAdminWriteOperation, readonly string[]>
> = {
  "admin.roles.setPermissions": [
    "roleId",
    "permissions",
    "expectedPermissions",
  ],
  "admin.roles.assign": [
    "targetType",
    "targetId",
    "roleId",
    "expectedAssignments",
  ],
  "admin.users.setName": [
    "userId",
    "firstName",
    "lastName",
    "expectedFirstName",
    "expectedLastName",
  ],
  "admin.users.setDepartments": [
    "userId",
    "departmentIds",
    "expectedDepartmentIds",
  ],
  "admin.users.setScope": ["userId", "scope", "expectedScope"],
  "admin.groups.update": [
    "groupId",
    "name",
    "memberIds",
    "expectedName",
    "expectedMemberIds",
  ],
  "admin.departments.rename": ["departmentId", "name", "expectedName"],
  "admin.users.create": [
    "username",
    "firstName",
    "lastName",
    "email",
    "roleId",
    "isAdmin",
    "departmentIds",
  ],
  "admin.users.setAdministrator": ["userId", "isAdmin", "expectedIsAdmin"],
  "admin.users.setActive": ["userId", "isActive", "expectedIsActive"],
  "admin.users.resetPassword": ["userId"],
  "admin.groups.create": ["name", "memberIds"],
  "admin.groups.delete": ["groupId", "expectedName", "expectedMemberIds"],
  "admin.departments.create": ["name"],
  "admin.departments.delete": [
    "departmentId",
    "expectedName",
    "expectedMemberIds",
  ],
  "admin.roles.save": ["role", "expectedRole"],
  "admin.roles.delete": ["roleId", "expectedRole"],
};

/** Rejects unknown fields, including client-supplied admin facts or a channel override. */
export function readAdminParameters(
  operation: AgentAdminReadOperation | AgentAdminWriteOperation,
  input: unknown,
): Readonly<Record<string, unknown>> {
  const parameters = readParameterRecord(input ?? {});
  if (Object.hasOwn(WRITE_KEYS, operation)) {
    const write = operation as AgentAdminWriteOperation;
    const required = ["operationId", ...WRITE_KEYS[write]];
    if (
      required.some((key) => !(key in parameters)) ||
      Object.keys(parameters).some(
        (key) => ![...required, "confirmation"].includes(key),
      )
    )
      throw new AgentOperationError("INVALID_REQUEST");
    readIdentifier(parameters.operationId);
  } else {
    const allowed = [
      "cursor",
      "limit",
      ...(operation === "admin.projectMembers.read" ? ["projectId"] : []),
    ];
    if (Object.keys(parameters).some((key) => !allowed.includes(key)))
      throw new AgentOperationError("INVALID_REQUEST");
    if (operation === "admin.projectMembers.read")
      readIdentifier(parameters.projectId);
  }
  return parameters;
}

/** Reads a bounded administrative name, permitting an empty surname where the UI does. */
export function readAdminName(input: unknown, allowEmpty = false): string {
  if (
    typeof input !== "string" ||
    input.length > 200 ||
    (!allowEmpty && !input.trim())
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return input.trim();
}

/** Reads boolean authorization fields without truthiness coercion. */
export function readAdminBoolean(input: unknown): boolean {
  if (typeof input !== "boolean")
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

/** Reads a unique, bounded set of administrative identifiers. */
export function readAdminIds(input: unknown, maximum = 100): readonly string[] {
  if (!Array.isArray(input) || input.length > maximum)
    throw new AgentOperationError("INVALID_REQUEST");
  const ids = input.map(readIdentifier);
  if (new Set(ids).size !== ids.length)
    throw new AgentOperationError("INVALID_REQUEST");
  return ids.sort();
}

/** Accepts only the existing configurable capabilities; reading and admin eligibility are excluded. */
export function readAdminPermissions(input: unknown): readonly Capability[] {
  if (!Array.isArray(input) || input.length > 7)
    throw new AgentOperationError("INVALID_REQUEST");
  const permissions = input.map((permission: unknown) => {
    if (!isCapability(permission))
      throw new AgentOperationError("INVALID_REQUEST");
    return permission;
  });
  if (new Set(permissions).size !== permissions.length)
    throw new AgentOperationError("INVALID_REQUEST");
  return permissions.sort();
}

/** Requires the last read state before an administration object changes. */
export function requireAdminCurrent(current: unknown, expected: unknown): void {
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new AgentOperationError("CONFLICT");
}

/** Reads an exact, complete scope using the UI management contract. */
export function readAdminScope(input: unknown): ManagementScopeInput {
  const scope = readParameterRecord(input);
  requireParameterKeys(scope, [
    "managedDepartments",
    "allDepartments",
    "allProjects",
  ]);
  return {
    managedDepartments: readAdminIds(scope.managedDepartments),
    allDepartments: readAdminBoolean(scope.allDepartments),
    allProjects: readAdminBoolean(scope.allProjects),
  };
}

/** Reads a complete normal role; no role field can confer personal administrator eligibility. */
export function readAdminRole(input: unknown): UserRole {
  const role = readParameterRecord(input);
  requireParameterKeys(role, [
    "id",
    "name",
    "rank",
    "departmentBound",
    "permissions",
  ]);
  if (
    typeof role.rank !== "number" ||
    !Number.isSafeInteger(role.rank) ||
    role.rank < 0
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    id: readIdentifier(role.id),
    name: readAdminName(role.name),
    rank: role.rank,
    departmentBound: readAdminBoolean(role.departmentBound),
    permissions: readAdminPermissions(role.permissions),
  };
}

/** Reads the exact people and roles of a batch; membership changes cause a conflict as well. */
export function readAdminAssignments(
  input: unknown,
): readonly { readonly userId: string; readonly roleId: string | null }[] {
  if (!Array.isArray(input) || input.length > 100)
    throw new AgentOperationError("INVALID_REQUEST");
  const assignments = input.map((entry: unknown) => {
    const assignment = readParameterRecord(entry);
    requireParameterKeys(assignment, ["userId", "roleId"]);
    return {
      userId: readIdentifier(assignment.userId),
      roleId:
        assignment.roleId === null ? null : readIdentifier(assignment.roleId),
    };
  });
  if (
    new Set(assignments.map(({ userId }) => userId)).size !== assignments.length
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return assignments.sort((left, right) =>
    left.userId.localeCompare(right.userId),
  );
}

/** Narrows a saved public result instead of trusting arbitrary replay JSON as a type. */
export function readAdminChanged(input: unknown): AgentAdminChanged {
  const result = readParameterRecord(input);
  if (
    result.targetType !== "person" &&
    result.targetType !== "group" &&
    result.targetType !== "department" &&
    result.targetType !== "role"
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    id: readIdentifier(result.id),
    targetType: result.targetType,
    changed: readAdminBoolean(result.changed),
    affectedUserIds: readAdminIds(result.affectedUserIds, 100_000),
  };
}
