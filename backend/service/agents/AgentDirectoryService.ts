import {
  accountForChannel,
  agentChannelPolicy,
} from "@/backend/auth/McpActorContext";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { TicketDepartmentPolicy } from "@/backend/auth/TicketDepartmentPolicy";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";

import type {
  AgentDirectoryEntry,
  AgentVisiblePerson,
} from "@/definition/AgentExtensions";
import type { AgentTaskContext } from "./AgentTaskAccess";

/** Visibility-filtered directory shared by reads and assignment validation. */
export interface AgentDirectory {
  readonly people: readonly AgentVisiblePerson[];
  readonly groups: readonly (AgentDirectoryEntry & {
    readonly memberIds: readonly string[];
  })[];
  readonly departments: readonly AgentDirectoryEntry[];
}

/** Builds the public directory from the same management and assignee scopes as the UI. */
export async function readAgentDirectory(
  context: AgentTaskContext,
): Promise<AgentDirectory> {
  const repository = new AuthorizationRepository(context.database);
  const snapshot = await repository.snapshot();
  const account = await context.projects.authorizationFacts(context.actor);
  const policy = new UserPolicyService();
  const departmentPolicy = new TicketDepartmentPolicy();
  const projects = await context.projects.findAll(context.actor);
  const eligible = await context.tasks.findAssigneesByProjects(
    projects.map(({ id }) => id),
  );
  const visibleIds = new Set([
    context.actor.id,
    ...[...eligible.values()].flat().map(({ id }) => id),
  ]);
  const visible = snapshot.accounts.filter(
    (person) =>
      person.isActive &&
      (policy.canSee(account.account, person) || visibleIds.has(person.userId)),
  );
  const ids = new Set(visible.map(({ userId }) => userId));
  const groups = (await repository.groups().findAll())
    .filter(
      (group) =>
        policy.isAdministrator(
          accountForChannel(
            account.account,
            agentChannelPolicy(context.channel).actor,
          ),
        ) || group.memberIds.some((id) => ids.has(id)),
    )
    .map((group) => ({
      ...group,
      memberIds: group.memberIds.filter((id) => ids.has(id)),
    }));
  const departments = snapshot.departments.filter(
    (department) =>
      policy.isAdministrator(account.account) ||
      account.account.departments.includes(department.id) ||
      departmentPolicy.canSelect(account.account, department.id) ||
      visible.some((person) => person.departments.includes(department.id)),
  );
  const users = new UserRepository(context.database);
  const people: AgentVisiblePerson[] = [];
  for (const person of visible) {
    const user = await users.findById(person.userId);
    if (user)
      people.push({
        id: user.id,
        displayName: user.displayName,
        departments: departments.filter(({ id }) =>
          person.departments.includes(id),
        ),
        groups: groups
          .filter(({ memberIds }) => memberIds.includes(user.id))
          .map(({ id, name }) => ({ id, name })),
      });
  }
  return { people, groups, departments };
}
