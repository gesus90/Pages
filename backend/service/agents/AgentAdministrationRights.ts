import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { findAccount } from "@/backend/service/AdministrationAccess";

import { requireAgentConfirmation } from "./AgentConfirmation";
import { readIdentifier } from "./AgentParameterReader";
import {
  readAdminAssignments,
  readAdminPermissions,
  readAdminScope,
  requireAdminCurrent,
} from "./AgentAdministrationParameters";

import type { AgentAdminChanged } from "@/definition/AgentAdministration";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentAdministrationContext } from "./AgentAdministrationContext";

/** Changes the capabilities of an existing shared role, preserving its rank, binding and identity. */
export async function setAdminRolePermissions(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentAdminChanged> {
  const id = readIdentifier(parameters.roleId);
  const role = context.snapshot.roles.find((candidate) => candidate.id === id);
  if (!role) throw new AgentOperationError("NOT_FOUND");
  const permissions = readAdminPermissions(parameters.permissions);
  requireAdminCurrent(
    [...role.permissions].sort(),
    readAdminPermissions(parameters.expectedPermissions),
  );
  if (role.permissions.some((permission) => !permissions.includes(permission)))
    await requireAgentConfirmation(
      context.database,
      context.actor.id,
      parameters.confirmation,
    );
  const changed =
    JSON.stringify([...role.permissions].sort()) !==
    JSON.stringify(permissions);
  if (changed)
    await context.administration.saveRole(context.actor.id, {
      ...role,
      permissions,
    });
  return {
    id,
    targetType: "role",
    changed,
    affectedUserIds: context.snapshot.accounts
      .filter((account) => account.role?.id === id)
      .map(({ userId }) => userId),
  };
}

interface AssignmentTargets {
  readonly targetType: "person" | "group" | "department";
  readonly accounts: readonly AccountAccess[];
}

async function assignmentTargets(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AssignmentTargets> {
  const id = readIdentifier(parameters.targetId);
  if (parameters.targetType === "person")
    return {
      targetType: "person",
      accounts: [findAccount(context.snapshot, id)],
    };
  if (parameters.targetType === "department") {
    if (
      !context.snapshot.departments.some((department) => department.id === id)
    )
      throw new AgentOperationError("NOT_FOUND");
    return {
      targetType: "department",
      accounts: context.snapshot.accounts.filter(({ departments }) =>
        departments.includes(id),
      ),
    };
  }
  if (parameters.targetType !== "group")
    throw new AgentOperationError("INVALID_REQUEST");
  const group = (await context.repository.groups().findAll()).find(
    (candidate) => candidate.id === id,
  );
  if (!group) throw new AgentOperationError("NOT_FOUND");
  return {
    targetType: "group",
    accounts: context.snapshot.accounts.filter(({ userId }) =>
      group.memberIds.includes(userId),
    ),
  };
}

/** Assigns an existing normal role to a person or all current members of a group/department, atomically. */
export async function assignAdminRole(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentAdminChanged> {
  const { targetType, accounts: targets } = await assignmentTargets(
    context,
    parameters,
  );
  if (targets.length > 100) throw new AgentOperationError("PAYLOAD_TOO_LARGE");
  const assignments = targets.map((account) => ({
    userId: account.userId,
    roleId: account.role?.id ?? null,
  }));
  requireAdminCurrent(
    readAdminAssignments(assignments),
    readAdminAssignments(parameters.expectedAssignments),
  );
  const roleId = readIdentifier(parameters.roleId);
  const role = context.snapshot.roles.find(
    (candidate) => candidate.id === roleId,
  );
  if (!role) throw new AgentOperationError("NOT_FOUND");
  if (
    targets.some((account) =>
      account.role?.permissions.some(
        (permission) => !role.permissions.includes(permission),
      ),
    )
  )
    await requireAgentConfirmation(
      context.database,
      context.actor.id,
      parameters.confirmation,
    );
  const affected = targets.filter((account) => account.role?.id !== roleId);
  for (const account of affected)
    await context.administration.assignRole(
      context.actor.id,
      account.userId,
      roleId,
    );
  return {
    id: readIdentifier(parameters.targetId),
    targetType,
    changed: affected.length > 0,
    affectedUserIds: affected.map(({ userId }) => userId),
  };
}

/** Changes a user's explicit management scope with confirmation of reductions. */
export async function setAdminScope(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentAdminChanged> {
  const id = readIdentifier(parameters.userId);
  const account = findAccount(context.snapshot, id);
  const current = readAdminScope({
    managedDepartments: account.managedDepartments,
    allDepartments: account.allDepartments,
    allProjects: account.allProjects,
  });
  const scope = readAdminScope(parameters.scope);
  requireAdminCurrent(current, readAdminScope(parameters.expectedScope));
  if (
    (current.allProjects && !scope.allProjects) ||
    (current.allDepartments && !scope.allDepartments) ||
    current.managedDepartments.some(
      (department) => !scope.managedDepartments.includes(department),
    )
  )
    await requireAgentConfirmation(
      context.database,
      context.actor.id,
      parameters.confirmation,
    );
  const changed = JSON.stringify(current) !== JSON.stringify(scope);
  if (changed)
    await context.administration.setScope(context.actor.id, id, scope);
  return {
    id,
    targetType: "person",
    changed,
    affectedUserIds: changed ? [id] : [],
  };
}
