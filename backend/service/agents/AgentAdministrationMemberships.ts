import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { findAccount } from "@/backend/service/AdministrationAccess";

import {
  readAdminIds,
  readAdminName,
  requireAdminCurrent,
} from "./AgentAdministrationParameters";
import { requireAgentConfirmation } from "./AgentConfirmation";
import { readIdentifier } from "./AgentParameterReader";

import type { AgentAdminChanged } from "@/definition/AgentAdministration";
import type { AgentAdministrationContext } from "./AgentAdministrationContext";

/** Changes a person's display name without changing their login, email or authorization. */
export async function setAdminUserName(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentAdminChanged> {
  const id = readIdentifier(parameters.userId);
  const account = findAccount(context.snapshot, id);
  const firstName = readAdminName(parameters.firstName, true);
  const lastName = readAdminName(parameters.lastName, true);
  requireAdminCurrent(
    [account.firstName, account.lastName],
    [
      readAdminName(parameters.expectedFirstName, true),
      readAdminName(parameters.expectedLastName, true),
    ],
  );
  const changed =
    firstName !== account.firstName || lastName !== account.lastName;
  if (changed) {
    const user = (
      await context.administration.listUsers(context.actor.id)
    ).find((candidate) => candidate.id === id);
    if (!user) throw new AgentOperationError("NOT_FOUND");
    await context.administration.updateProfile(context.actor.id, id, {
      username: user.username,
      email: user.email,
      firstName,
      lastName,
    });
  }
  return {
    id,
    targetType: "person",
    changed,
    affectedUserIds: changed ? [id] : [],
  };
}

/** Replaces a person's department memberships, retaining the UI's last-membership constraint. */
export async function setAdminDepartments(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentAdminChanged> {
  const id = readIdentifier(parameters.userId);
  const account = findAccount(context.snapshot, id);
  const departments = readAdminIds(parameters.departmentIds);
  requireAdminCurrent(
    [...account.departments].sort(),
    readAdminIds(parameters.expectedDepartmentIds),
  );
  if (
    account.departments.some((department) => !departments.includes(department))
  )
    await requireAgentConfirmation(
      context.database,
      context.actor.id,
      parameters.confirmation,
    );
  const changed =
    JSON.stringify([...account.departments].sort()) !==
    JSON.stringify(departments);
  if (changed)
    await context.administration.setMemberships(
      context.actor.id,
      id,
      departments,
    );
  return {
    id,
    targetType: "person",
    changed,
    affectedUserIds: changed ? [id] : [],
  };
}

/** Edits an existing group's name and members; an absent group can never be created through this operation. */
export async function updateAdminGroup(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentAdminChanged> {
  const id = readIdentifier(parameters.groupId);
  const group = (await context.repository.groups().findAll()).find(
    (candidate) => candidate.id === id,
  );
  if (!group) throw new AgentOperationError("NOT_FOUND");
  const name = readAdminName(parameters.name);
  const memberIds = readAdminIds(parameters.memberIds);
  requireAdminCurrent(group.name, readAdminName(parameters.expectedName));
  requireAdminCurrent(
    [...group.memberIds].sort(),
    readAdminIds(parameters.expectedMemberIds),
  );
  if (group.memberIds.some((member) => !memberIds.includes(member)))
    await requireAgentConfirmation(
      context.database,
      context.actor.id,
      parameters.confirmation,
    );
  const changed =
    name !== group.name ||
    JSON.stringify([...group.memberIds].sort()) !== JSON.stringify(memberIds);
  if (changed)
    await context.groups.saveGroup(context.actor.id, { id, name, memberIds });
  return {
    id,
    targetType: "group",
    changed,
    affectedUserIds: [...new Set([...group.memberIds, ...memberIds])].sort(),
  };
}

/** Renames an existing department without introducing a creation path over MCP. */
export async function renameAdminDepartment(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentAdminChanged> {
  const id = readIdentifier(parameters.departmentId);
  const department = context.snapshot.departments.find(
    (candidate) => candidate.id === id,
  );
  if (!department) throw new AgentOperationError("NOT_FOUND");
  const name = readAdminName(parameters.name);
  requireAdminCurrent(department.name, readAdminName(parameters.expectedName));
  const changed = name !== department.name;
  if (changed)
    await context.administration.saveDepartment(context.actor.id, { id, name });
  return { id, targetType: "department", changed, affectedUserIds: [] };
}
