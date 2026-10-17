import { logCaughtError } from "@/backend/logging/Logger";

import { pageAgentEntries } from "./AgentCursor";
import { readAgentDirectory } from "./AgentDirectoryService";
import { createAgentReadContext, respondAgentRead } from "./AgentReadContext";
import { translateAgentTicketError } from "./AgentTicketErrors";
import { readAgentAssignmentTargetSearch } from "./AgentTicketNavigationValidation";

import type {
  AgentAssignmentTarget,
  AgentAssignmentTargetType,
} from "@/definition/AgentTicketNavigation";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { AgentDirectory } from "./AgentDirectoryService";
import type { AgentReadDependencies } from "./AgentReadContext";
import type { AgentTaskContext } from "./AgentTaskAccess";

interface TargetQuery {
  readonly text: string | null;
  readonly targetType: AgentAssignmentTargetType | null;
  readonly projectId: string | null;
}

function includesType(
  query: TargetQuery,
  targetType: AgentAssignmentTargetType,
): boolean {
  return query.targetType === null || query.targetType === targetType;
}

function matches(name: string, text: string | null): boolean {
  return text === null || name.toLowerCase().includes(text.toLowerCase());
}

function isExactMatch(name: string, text: string | null): boolean {
  return text !== null && name.trim().toLowerCase() === text.toLowerCase();
}

/** The people the account sees; for a project only those who may be assigned in it. */
async function personTargets(
  context: AgentTaskContext,
  directory: AgentDirectory,
  query: TargetQuery,
): Promise<AgentAssignmentTarget[]> {
  const eligible =
    query.projectId === null
      ? null
      : await context.tasks.findEligibleAssignees(
          context.actor,
          query.projectId,
        );
  return directory.people
    .filter(
      ({ id, displayName }) =>
        matches(displayName, query.text) &&
        (eligible === null || eligible.some((user) => user.id === id)),
    )
    .map((person) => ({
      targetType: "person",
      id: person.id,
      name: person.displayName,
      isExactMatch: isExactMatch(person.displayName, query.text),
      departments: person.departments,
      groups: person.groups,
    }));
}

function groupTargets(
  directory: AgentDirectory,
  query: TargetQuery,
): AgentAssignmentTarget[] {
  return directory.groups
    .filter(({ name }) => matches(name, query.text))
    .map(({ id, name }) => ({
      targetType: "group",
      id,
      name,
      isExactMatch: isExactMatch(name, query.text),
    }));
}

/** The departments the account sees and may put a ticket into. */
async function departmentTargets(
  context: AgentTaskContext,
  directory: AgentDirectory,
  query: TargetQuery,
): Promise<AgentAssignmentTarget[]> {
  const { available } = await context.tasks.departmentChoices(context.actor);
  return directory.departments
    .filter(
      ({ id, name }) =>
        matches(name, query.text) && available.some((entry) => entry.id === id),
    )
    .map(({ id, name }) => ({
      targetType: "department",
      id,
      name,
      isExactMatch: isExactMatch(name, query.text),
    }));
}

/** Names the persons, groups and departments a ticket can be assigned to, from what the account sees. */
export class AgentAssignmentTargetService {
  private readonly dependencies: AgentReadDependencies;

  public constructor(dependencies: AgentReadDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Searches the visible assignment targets by name.
   *
   * @param identity - The verified owner of the call.
   * @param parameters - The raw operation parameters: optional `text`, `targetType`, `projectId`, `cursor` and `limit`.
   * @returns One page of targets with the number of all matches.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND` or `PAYLOAD_TOO_LARGE`.
   *
   * @remarks
   * A name is never resolved to one target: every match is listed with its
   * type and identifier, people with the departments and groups that tell
   * equal names apart, and `isExactMatch` marks the ones whose name equals the
   * text. Persons outside the visible directory, groups the account does not
   * see and departments it may not select are not listed at all.
   */
  public async search(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const { window, ...query } = readAgentAssignmentTargetSearch(parameters);
    const context = await createAgentReadContext(this.dependencies, identity);
    try {
      const directory = await readAgentDirectory(context);
      const targets = [
        ...(includesType(query, "person")
          ? await personTargets(context, directory, query)
          : []),
        ...(includesType(query, "group") ? groupTargets(directory, query) : []),
        ...(includesType(query, "department")
          ? await departmentTargets(context, directory, query)
          : []),
      ];
      const page = pageAgentEntries(
        targets.map((target) => ({
          id: `${target.targetType}:${target.id}`,
          target,
        })),
        {
          ...window,
          context: JSON.stringify([
            identity.userId,
            "assignment.targets.search",
            query,
          ]),
        },
      );
      return respondAgentRead({
        targets: page.entries.map(({ target }) => target),
        total: page.total,
        nextCursor: page.nextCursor,
      });
    } catch (error: unknown) {
      logCaughtError("AgentAssignmentTargetService", error);

      throw translateAgentTicketError(error);
    }
  }
}
