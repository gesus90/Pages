import { randomUUID } from "node:crypto";

import { CAPABILITY } from "@/definition/Authorization";

import { McpUserError } from "./McpUserError";
import { mcpRoleFields } from "./McpUserProjection";
import {
  requireMcpUserConfirmation,
  requireMcpUserCurrent,
  requireMcpUserRight,
  sortedIds,
} from "./McpUserSession";
import { withoutConfirmation } from "./McpUserWriteService";

import type { AccountAccess, UserRole } from "@/definition/Authorization";
import type { McpUserCommand } from "./McpUserCommand";
import type { McpUserChangeResult } from "./McpUserContract";
import type {
  McpDepartmentCreateRequest,
  McpDepartmentUpdateRequest,
  McpGroupCreateRequest,
  McpGroupUpdateRequest,
  McpMembersDeleteRequest,
  McpRoleAssignRequest,
  McpRoleCreateRequest,
  McpRoleDeleteRequest,
  McpRoleUpdateRequest,
} from "./McpUserRequest";
import type { McpUserSession } from "./McpUserSession";

/** Most accounts one assignment may change, like the administration contract. */
const MAXIMUM_ASSIGNMENT_TARGETS = 100;

/** The accounts one role assignment would change. */
async function assignmentTargets(
  session: McpUserSession,
  request: McpRoleAssignRequest,
): Promise<readonly AccountAccess[]> {
  if (request.targetType === "person")
    return [session.visibleAccount(request.targetId)];
  if (request.targetType === "department")
    return session.departmentMembers(
      session.visibleDepartment(request.targetId).id,
    );
  return session.groupMembers(await session.visibleGroup(request.targetId));
}

/** Whether a role takes away a permission one of the accounts holds now. */
function removesPermissions(
  role: UserRole,
  accounts: readonly AccountAccess[],
): boolean {
  return accounts.some((account) =>
    account.role?.permissions.some(
      (permission) => !role.permissions.includes(permission),
    ),
  );
}

/** The result of a change of a catalog object. */
function catalogResult(
  targetType: McpUserChangeResult["targetType"],
  id: string,
  changed: boolean,
  affectedUserIds: readonly string[] = [],
): McpUserChangeResult {
  return {
    id,
    targetType,
    changed,
    affectedUserIds: sortedIds(affectedUserIds),
  };
}

/**
 * Changes roles, departments and groups and assigns roles through the
 * administration of the interface (PAGE-280).
 *
 * @remarks
 * Each method returns the command for `McpUserApi.change`. A role change
 * applies to all its holders; an assignment changes only the current
 * members of a group or department, atomically, and nothing is inherited by
 * future members.
 */
export class McpUserCatalogService {
  /**
   * Assigns an existing role to a person or all current members of a group
   * or department, at most 100, all or none.
   *
   * @param roleId - The role from the role catalog.
   * @param request - Target and every current target with its read role.
   */
  public assignRole(
    roleId: string,
    request: McpRoleAssignRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.roles.assign",
        operationId: request.operationId,
        request: { roleId, ...withoutConfirmation(request) },
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_ROLES),
      },
      apply: async (session) => {
        const role = session.visibleRole(roleId);
        const targets = await assignmentTargets(session, request);
        if (targets.length > MAXIMUM_ASSIGNMENT_TARGETS)
          throw new McpUserError("too_many_targets");
        requireMcpUserRight(
          session.policy.canAssignRole(session.actor, role) &&
            targets.every((target) =>
              session.policy.canChange(
                session.actor,
                target,
                CAPABILITY.MANAGE_ROLES,
              ),
            ),
        );
        const byUser = (
          entries: readonly { userId: string; roleId: string | null }[],
        ): string =>
          JSON.stringify(
            [...entries].sort((left, right) =>
              left.userId.localeCompare(right.userId),
            ),
          );
        requireMcpUserCurrent(
          byUser(
            targets.map((target) => ({
              userId: target.userId,
              roleId: target.role?.id ?? null,
            })),
          ),
          byUser(request.expectedAssignments),
        );
        const affected = targets.filter((target) => target.role?.id !== roleId);
        if (removesPermissions(role, affected))
          requireMcpUserConfirmation(request.confirmation, {
            target: { type: request.targetType, id: request.targetId },
            effects: ["role_replaced", "permissions_removed"],
            affectedUserIds: sortedIds(affected.map(({ userId }) => userId)),
          });
        for (const target of affected)
          await session.administration.assignRole(
            session.actor.userId,
            target.userId,
            roleId,
          );
        return {
          result: catalogResult(
            request.targetType,
            request.targetId,
            affected.length > 0,
            affected.map(({ userId }) => userId),
          ),
        };
      },
    };
  }

  /** Creates a role within the delegation limits of the actor. */
  public createRole(request: McpRoleCreateRequest): McpUserCommand {
    return {
      operation: {
        name: "admin.roles.create",
        operationId: request.operationId,
        request,
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_ROLES),
      },
      apply: async (session) => {
        const id = randomUUID();
        await session.administration.saveRole(session.actor.userId, {
          id,
          name: request.name,
          rank: request.rank,
          departmentBound: request.departmentBound,
          permissions: request.permissions,
        });
        return { result: catalogResult("role", id, true) };
      },
    };
  }

  /**
   * Changes name, rank, department binding or permissions of a role for all
   * its holders; omitted fields stay, removed permissions need a confirmation.
   *
   * @param roleId - The role.
   * @param request - The changed fields and the complete read role in `expected`.
   */
  public updateRole(
    roleId: string,
    request: McpRoleUpdateRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.roles.update",
        operationId: request.operationId,
        request: { roleId, ...withoutConfirmation(request) },
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_ROLES),
      },
      apply: async (session) => {
        const role = session.visibleRole(roleId);
        const holders = session.holders(roleId);
        const next: UserRole = {
          id: roleId,
          name: request.name ?? role.name,
          rank: request.rank ?? role.rank,
          departmentBound: request.departmentBound ?? role.departmentBound,
          permissions: request.permissions ?? role.permissions,
        };
        requireMcpUserRight(
          session.policy.canEditRole(session.actor, role, next, holders),
        );
        requireMcpUserCurrent(
          mcpRoleFields(role),
          mcpRoleFields({ id: roleId, ...request.expected }),
        );
        const holderIds = holders.map(({ userId }) => userId);
        if (role.permissions.some((item) => !next.permissions.includes(item)))
          requireMcpUserConfirmation(request.confirmation, {
            target: { type: "role", id: roleId },
            effects: ["permissions_removed"],
            affectedUserIds: sortedIds(holderIds),
          });
        const changed =
          JSON.stringify(mcpRoleFields(role)) !==
          JSON.stringify(mcpRoleFields(next));
        if (changed)
          await session.administration.saveRole(session.actor.userId, next);
        return { result: catalogResult("role", roleId, changed, holderIds) };
      },
    };
  }

  /** Deletes an unused role after a confirmation; a used role answers `in_use`. */
  public deleteRole(
    roleId: string,
    request: McpRoleDeleteRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.roles.delete",
        operationId: request.operationId,
        request: { roleId, ...withoutConfirmation(request) },
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_ROLES),
      },
      apply: async (session) => {
        const role = session.visibleRole(roleId);
        requireMcpUserRight(
          session.policy.canEditRole(session.actor, role, role, []),
        );
        requireMcpUserCurrent(
          mcpRoleFields(role),
          mcpRoleFields({ id: roleId, ...request.expected }),
        );
        if (session.holders(roleId).length > 0)
          throw new McpUserError("in_use");
        requireMcpUserConfirmation(request.confirmation, {
          target: { type: "role", id: roleId },
          effects: ["role_deleted"],
          affectedUserIds: [],
        });
        await session.administration.deleteRole(session.actor.userId, roleId);
        return { result: catalogResult("role", roleId, true) };
      },
    };
  }

  /** Creates a department; it joins the creator's managed departments, like in the interface. */
  public createDepartment(request: McpDepartmentCreateRequest): McpUserCommand {
    return {
      operation: {
        name: "admin.departments.create",
        operationId: request.operationId,
        request,
        guard: (session) =>
          session.requireCapability(CAPABILITY.MANAGE_DEPARTMENTS),
      },
      apply: async (session) => {
        const id = randomUUID();
        await session.administration.saveDepartment(session.actor.userId, {
          id,
          name: request.name,
        });
        return { result: catalogResult("department", id, true) };
      },
    };
  }

  /** Renames a department within the actor's range; the identifier stays. */
  public updateDepartment(
    departmentId: string,
    request: McpDepartmentUpdateRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.departments.update",
        operationId: request.operationId,
        request: { departmentId, ...request },
        guard: (session) =>
          session.requireCapability(CAPABILITY.MANAGE_DEPARTMENTS),
      },
      apply: async (session) => {
        const department = session.visibleDepartment(departmentId);
        requireMcpUserRight(
          session.policy.canManageDepartment(session.actor, departmentId),
        );
        requireMcpUserCurrent(department.name, request.expected.name);
        const changed = request.name.trim() !== department.name;
        if (changed)
          await session.administration.saveDepartment(session.actor.userId, {
            id: departmentId,
            name: request.name,
          });
        return { result: catalogResult("department", departmentId, changed) };
      },
    };
  }

  /** Deletes a department after a confirmation; its members lose the membership. */
  public deleteDepartment(
    departmentId: string,
    request: McpMembersDeleteRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.departments.delete",
        operationId: request.operationId,
        request: { departmentId, ...withoutConfirmation(request) },
        guard: (session) =>
          session.requireCapability(CAPABILITY.MANAGE_DEPARTMENTS),
      },
      apply: async (session) => {
        const department = session.visibleDepartment(departmentId);
        requireMcpUserRight(
          session.policy.canManageDepartment(session.actor, departmentId),
        );
        const memberIds = session.visibleIds(
          session.departmentMembers(departmentId),
        );
        requireMcpUserCurrent(
          { name: department.name, memberIds },
          {
            ...request.expected,
            memberIds: sortedIds(request.expected.memberIds),
          },
        );
        requireMcpUserConfirmation(request.confirmation, {
          target: { type: "department", id: departmentId },
          effects: ["department_deleted", "department_memberships_removed"],
          affectedUserIds: memberIds,
        });
        await session.administration.deleteDepartment(
          session.actor.userId,
          departmentId,
        );
        return {
          result: catalogResult("department", departmentId, true, memberIds),
        };
      },
    };
  }

  /** Creates a group with active members within the actor's range. */
  public createGroup(request: McpGroupCreateRequest): McpUserCommand {
    return {
      operation: {
        name: "admin.groups.create",
        operationId: request.operationId,
        request,
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_USERS),
      },
      apply: async (session) => {
        if (request.memberIds.length === 0)
          throw new McpUserError("last_membership");
        const id = randomUUID();
        await session.groups.saveGroup(session.actor.userId, {
          id,
          name: request.name,
          memberIds: sortedIds(request.memberIds),
        });
        return {
          result: catalogResult("group", id, true, request.memberIds),
        };
      },
    };
  }

  /**
   * Renames a group or replaces its members; omitted fields stay, removed
   * members need a confirmation, at least one member remains.
   *
   * @param groupId - The group.
   * @param request - The changed fields and the read name and members.
   */
  public updateGroup(
    groupId: string,
    request: McpGroupUpdateRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.groups.update",
        operationId: request.operationId,
        request: { groupId, ...withoutConfirmation(request) },
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_USERS),
      },
      apply: async (session) => {
        const group = await session.visibleGroup(groupId);
        const current = {
          name: group.name,
          memberIds: session.visibleIds(session.groupMembers(group)),
        };
        requireMcpUserRight(session.canChangeGroup(group));
        requireMcpUserCurrent(current, {
          name: request.expected.name,
          memberIds: sortedIds(request.expected.memberIds),
        });
        const next = {
          name: request.name?.trim() ?? group.name,
          memberIds: sortedIds(request.memberIds ?? group.memberIds),
        };
        if (next.memberIds.length === 0)
          throw new McpUserError("last_membership");
        const removed = group.memberIds.filter(
          (id) => !next.memberIds.includes(id),
        );
        if (removed.length > 0)
          requireMcpUserConfirmation(request.confirmation, {
            target: { type: "group", id: groupId },
            effects: ["group_members_removed"],
            affectedUserIds: sortedIds(removed),
          });
        const changed =
          next.name !== group.name ||
          JSON.stringify(next.memberIds) !==
            JSON.stringify(sortedIds(group.memberIds));
        if (changed)
          await session.groups.saveGroup(session.actor.userId, {
            id: groupId,
            ...next,
          });
        return {
          result: catalogResult("group", groupId, changed, [
            ...new Set([...group.memberIds, ...next.memberIds]),
          ]),
        };
      },
    };
  }

  /** Deletes a group after a confirmation; its ticket assignments go with it. */
  public deleteGroup(
    groupId: string,
    request: McpMembersDeleteRequest,
  ): McpUserCommand {
    return {
      operation: {
        name: "admin.groups.delete",
        operationId: request.operationId,
        request: { groupId, ...withoutConfirmation(request) },
        guard: (session) => session.requireCapability(CAPABILITY.MANAGE_USERS),
      },
      apply: async (session) => {
        const group = await session.visibleGroup(groupId);
        requireMcpUserRight(session.canChangeGroup(group));
        const memberIds = session.visibleIds(session.groupMembers(group));
        requireMcpUserCurrent(
          { name: group.name, memberIds },
          {
            ...request.expected,
            memberIds: sortedIds(request.expected.memberIds),
          },
        );
        requireMcpUserConfirmation(request.confirmation, {
          target: { type: "group", id: groupId },
          effects: ["group_deleted", "group_ticket_assignments_removed"],
          affectedUserIds: memberIds,
        });
        await session.groups.deleteGroup(session.actor.userId, groupId);
        return { result: catalogResult("group", groupId, true, memberIds) };
      },
    };
  }
}
