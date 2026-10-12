import { randomUUID } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { findAccount } from "@/backend/service/AdministrationAccess";

import {
  readAdminBoolean,
  readAdminIds,
  readAdminName,
  readAdminRole,
  requireAdminCurrent,
} from "./AgentAdministrationParameters";
import { requireAgentConfirmation } from "./AgentConfirmation";
import { readIdentifier } from "./AgentParameterReader";

import type {
  AgentAdminChanged,
  ChatAdminWriteOperation,
  ChatTemporaryPassword,
} from "@/definition/AgentAdministration";
import type { AgentAdministrationContext } from "./AgentAdministrationContext";

/** The public mutation result plus an optional one-time receipt for the human administrator only. */
export interface ChatAdminMutation {
  readonly result: AgentAdminChanged;
  readonly temporaryPassword?: ChatTemporaryPassword;
}

/** Uses the surface services for chat-only administration, with server-verified confirmation. */
export async function applyChatAdministration(
  context: AgentAdministrationContext,
  operation: ChatAdminWriteOperation,
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  if (context.channel !== "chat")
    throw new AgentOperationError("INVALID_REQUEST");
  switch (operation) {
    case "admin.users.create":
      return createChatUser(context, parameters);
    case "admin.users.resetPassword":
      return resetChatPassword(context, parameters);
    case "admin.users.setAdministrator":
    case "admin.users.setActive":
      return changeChatUserAccess(context, operation, parameters);
    case "admin.groups.create":
      return createChatGroup(context, parameters);
    case "admin.groups.delete":
      return deleteChatGroup(context, parameters);
    case "admin.departments.create":
      return createChatDepartment(context, parameters);
    case "admin.departments.delete":
      return deleteChatDepartment(context, parameters);
    case "admin.roles.save":
      return saveChatRole(context, parameters);
    case "admin.roles.delete":
      return deleteChatRole(context, parameters);
  }
}

async function createChatUser(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  await requireAgentConfirmation(
    context.database,
    context.actor.id,
    parameters.confirmation,
  );
  if (parameters.email !== null && typeof parameters.email !== "string")
    throw new AgentOperationError("INVALID_REQUEST");
  const username = readAdminName(parameters.username);
  const { temporaryPassword } = await context.administration.createUser(
    context.actor.id,
    {
      username,
      firstName: readAdminName(parameters.firstName),
      lastName: readAdminName(parameters.lastName),
      email: parameters.email,
      roleId:
        parameters.roleId === null ? null : readIdentifier(parameters.roleId),
      isAdmin: readAdminBoolean(parameters.isAdmin),
      departments: readAdminIds(parameters.departmentIds),
    },
  );
  const user = (await context.repository.users().findAll()).find(
    (candidate) => candidate.username === username,
  );
  if (!user) throw new Error("Created administration account is missing.");
  return {
    result: {
      id: user.id,
      targetType: "person",
      changed: true,
      affectedUserIds: [user.id],
    },
    temporaryPassword: { userId: user.id, username, temporaryPassword },
  };
}

async function resetChatPassword(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  await requireAgentConfirmation(
    context.database,
    context.actor.id,
    parameters.confirmation,
  );
  const id = readIdentifier(parameters.userId);
  const user = await context.repository.users().findById(id);
  if (!user) throw new AgentOperationError("NOT_FOUND");
  const { temporaryPassword } = await context.administration.resetPassword(
    context.actor.id,
    id,
  );
  return {
    result: { id, targetType: "person", changed: true, affectedUserIds: [id] },
    temporaryPassword: {
      userId: id,
      username: user.username,
      temporaryPassword,
    },
  };
}

async function changeChatUserAccess(
  context: AgentAdministrationContext,
  operation: "admin.users.setAdministrator" | "admin.users.setActive",
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  await requireAgentConfirmation(
    context.database,
    context.actor.id,
    parameters.confirmation,
  );
  const id = readIdentifier(parameters.userId);
  const target = findAccount(context.snapshot, id);
  const isAdministrator = operation === "admin.users.setAdministrator";
  const next = readAdminBoolean(
    isAdministrator ? parameters.isAdmin : parameters.isActive,
  );
  const current = isAdministrator ? target.isAdmin : target.isActive;
  requireAdminCurrent(
    current,
    readAdminBoolean(
      isAdministrator
        ? parameters.expectedIsAdmin
        : parameters.expectedIsActive,
    ),
  );
  const changed = next !== current;
  if (changed && isAdministrator)
    await context.administration.setAdministrator(context.actor.id, id, next);
  if (changed && !isAdministrator)
    await context.administration.setActive(context.actor.id, id, next);
  return {
    result: {
      id,
      targetType: "person",
      changed,
      affectedUserIds: changed ? [id] : [],
    },
  };
}

async function createChatGroup(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  const id = randomUUID();
  const memberIds = readAdminIds(parameters.memberIds);
  await context.groups.saveGroup(context.actor.id, {
    id,
    name: readAdminName(parameters.name),
    memberIds,
  });
  return {
    result: {
      id,
      targetType: "group",
      changed: true,
      affectedUserIds: memberIds,
    },
  };
}

async function deleteChatGroup(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  await requireAgentConfirmation(
    context.database,
    context.actor.id,
    parameters.confirmation,
  );
  const id = readIdentifier(parameters.groupId);
  const group = (await context.repository.groups().findAll()).find(
    (candidate) => candidate.id === id,
  );
  if (!group) throw new AgentOperationError("NOT_FOUND");
  requireAdminCurrent(group.name, readAdminName(parameters.expectedName));
  requireAdminCurrent(
    [...group.memberIds].sort(),
    readAdminIds(parameters.expectedMemberIds),
  );
  await context.groups.deleteGroup(context.actor.id, id);
  return {
    result: {
      id,
      targetType: "group",
      changed: true,
      affectedUserIds: group.memberIds,
    },
  };
}

async function createChatDepartment(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  const id = randomUUID();
  await context.administration.saveDepartment(context.actor.id, {
    id,
    name: readAdminName(parameters.name),
  });
  return {
    result: {
      id,
      targetType: "department",
      changed: true,
      affectedUserIds: [],
    },
  };
}

async function deleteChatDepartment(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  await requireAgentConfirmation(
    context.database,
    context.actor.id,
    parameters.confirmation,
  );
  const id = readIdentifier(parameters.departmentId);
  const department = context.snapshot.departments.find(
    (candidate) => candidate.id === id,
  );
  if (!department) throw new AgentOperationError("NOT_FOUND");
  const memberIds = context.snapshot.accounts
    .filter(({ departments }) => departments.includes(id))
    .map(({ userId }) => userId);
  requireAdminCurrent(department.name, readAdminName(parameters.expectedName));
  requireAdminCurrent(
    [...memberIds].sort(),
    readAdminIds(parameters.expectedMemberIds),
  );
  await context.administration.deleteDepartment(context.actor.id, id);
  return {
    result: {
      id,
      targetType: "department",
      changed: true,
      affectedUserIds: memberIds,
    },
  };
}

async function saveChatRole(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  const role = readAdminRole(parameters.role);
  const current = context.snapshot.roles.find(
    (candidate) => candidate.id === role.id,
  );
  requireAdminCurrent(
    current ? readAdminRole(current) : null,
    parameters.expectedRole === null
      ? null
      : readAdminRole(parameters.expectedRole),
  );
  if (
    current?.permissions.some(
      (permission) => !role.permissions.includes(permission),
    )
  )
    await requireAgentConfirmation(
      context.database,
      context.actor.id,
      parameters.confirmation,
    );
  const changed =
    JSON.stringify(current ? readAdminRole(current) : null) !==
    JSON.stringify(role);
  if (changed) await context.administration.saveRole(context.actor.id, role);
  return {
    result: {
      id: role.id,
      targetType: "role",
      changed,
      affectedUserIds: context.snapshot.accounts
        .filter((account) => account.role?.id === role.id)
        .map(({ userId }) => userId),
    },
  };
}

async function deleteChatRole(
  context: AgentAdministrationContext,
  parameters: Readonly<Record<string, unknown>>,
): Promise<ChatAdminMutation> {
  await requireAgentConfirmation(
    context.database,
    context.actor.id,
    parameters.confirmation,
  );
  const id = readIdentifier(parameters.roleId);
  const current = context.snapshot.roles.find(
    (candidate) => candidate.id === id,
  );
  if (!current) throw new AgentOperationError("NOT_FOUND");
  requireAdminCurrent(
    readAdminRole(current),
    readAdminRole(parameters.expectedRole),
  );
  await context.administration.deleteRole(context.actor.id, id);
  return {
    result: { id, targetType: "role", changed: true, affectedUserIds: [] },
  };
}
