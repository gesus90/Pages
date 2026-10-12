import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { CAPABILITY } from "@/definition/Authorization";

import { pageAgentEntries } from "./AgentCursor";
import { readAgentExtension } from "./AgentExtensionReads";
import { createAgentTaskContext } from "./AgentTaskAccess";
import { agentTransactionScope } from "./AgentTransactionScope";

import type {
  AgentAdminReadOperation,
  AgentAdminReadResult,
  AgentAdminUser,
} from "@/definition/AgentAdministration";
import type { AgentAdministrationContext } from "./AgentAdministrationContext";

/** Reads the complete safe directory only after the current actor has passed the administrator boundary. */
export async function readAgentAdministration(
  context: AgentAdministrationContext,
  operation: AgentAdminReadOperation,
  parameters: Readonly<Record<string, unknown>>,
): Promise<AgentAdminReadResult> {
  const window = {
    cursor: parameters.cursor,
    limit: parameters.limit,
    context: JSON.stringify([
      context.actor.id,
      operation,
      parameters.projectId,
    ]),
  };
  if (operation === "admin.permissions.list") {
    pageAgentEntries([], window);
    return {
      permissions: Object.values(CAPABILITY),
      read: true,
      canDisableRead: false,
    };
  }
  if (operation === "admin.projectMembers.read") {
    const result = await readAgentExtension(
      createAgentTaskContext(
        agentTransactionScope(context.database),
        context.actor,
        context.channel,
      ),
      "projects.members.read",
      parameters,
    );
    if (!("members" in result))
      throw new Error("Invalid project-member result.");
    return result;
  }
  if (operation === "admin.activity.read")
    return pageAgentEntries(
      await new AdministrationActivityRepository(context.database).findAll(),
      { ...window, preserveOrder: true },
    );
  if (operation === "admin.roles.list")
    return pageAgentEntries(context.snapshot.roles, window);
  const groups = await context.repository.groups().findAll();
  if (operation === "admin.groups.list")
    return pageAgentEntries(groups, window);
  if (operation === "admin.departments.list")
    return pageAgentEntries(
      context.snapshot.departments.map((department) => ({
        ...department,
        memberIds: context.snapshot.accounts
          .filter(({ departments }) => departments.includes(department.id))
          .map(({ userId }) => userId),
      })),
      window,
    );
  const users = await context.repository.users().findAll();
  const entries: AgentAdminUser[] = users.flatMap((user) => {
    const account = context.snapshot.accounts.find(
      ({ userId }) => userId === user.id,
    );
    return account
      ? [
          {
            ...account,
            id: user.id,
            displayName: user.displayName,
            username: user.username,
            groups: groups
              .filter(({ memberIds }) => memberIds.includes(user.id))
              .map(({ id, name }) => ({ id, name })),
          },
        ]
      : [];
  });
  return pageAgentEntries(entries, window);
}
