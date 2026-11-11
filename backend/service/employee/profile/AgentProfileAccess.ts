import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { PROJECT_ROLE } from "@/definition/Project";
import {
  AGENT_PROFILE_ALWAYS_HIDDEN_FIELDS,
  AGENT_PROFILE_LEADER_HIDDEN_FIELDS,
} from "@/definition/AgentProfileRead";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentProfileProject } from "@/definition/AgentProfileRead";
import type { UserGroup } from "@/definition/UserGroup";

/** What the rights of a reader are decided from, read in one consistent state. */
export interface AgentProfileRightsInput {
  readonly reader: AccountAccess;
  readonly agentIds: readonly string[];
  readonly groups: readonly UserGroup[];
  readonly projectsByUser: ReadonlyMap<string, readonly AgentProfileProject[]>;
}

/**
 * Who may read which agent profile (PAGE-308).
 *
 * @remarks
 * Administrators read every agent. A group leader reads the agents that are
 * members of the group, and a project manager reads the agents that are
 * members of the project. Nobody else reads a profile. The reading is
 * decided on the stored memberships of the moment, never on what a client
 * sends.
 */
export class AgentProfileAccess {
  public readonly isAdministrator: boolean;
  private readonly readableIds: ReadonlySet<string>;

  /**
   * Decides the rights of one reader.
   *
   * @param input - The reader, all agent accounts and the memberships.
   * @param channel - Whether the administrator role counts as the interface or the MCP channel sees it.
   */
  public constructor(input: AgentProfileRightsInput, channel: ActorChannel) {
    const { reader, agentIds } = input;
    this.isAdministrator = new UserPolicyService(channel).isAdministrator(
      reader,
    );
    if (this.isAdministrator) this.readableIds = new Set(agentIds);
    else if (reader.isActive) this.readableIds = readableByLeadership(input);
    else this.readableIds = new Set();
  }

  /** Whether the reader may read the profile of an agent. */
  public canRead(agentId: string): boolean {
    return this.readableIds.has(agentId);
  }

  /** The agents the reader may read. */
  public get agentIds(): ReadonlySet<string> {
    return this.readableIds;
  }

  /** The names of the fields this reader never sees. */
  public get hiddenFields(): readonly string[] {
    return this.isAdministrator
      ? AGENT_PROFILE_ALWAYS_HIDDEN_FIELDS
      : AGENT_PROFILE_LEADER_HIDDEN_FIELDS;
  }
}

/** The agents of the groups a reader leads and of the projects a reader manages. */
function readableByLeadership(input: AgentProfileRightsInput): Set<string> {
  const { reader, agentIds, groups, projectsByUser } = input;
  const agents = new Set(agentIds);
  const readable = new Set<string>();
  for (const group of groups) {
    if (!(group.leaderIds ?? []).includes(reader.userId)) continue;
    for (const memberId of group.memberIds)
      if (agents.has(memberId)) readable.add(memberId);
  }
  const managedProjectIds = new Set(
    (projectsByUser.get(reader.userId) ?? [])
      .filter((project) => project.role === PROJECT_ROLE.MANAGER)
      .map((project) => project.id),
  );
  for (const agentId of agents)
    if (
      (projectsByUser.get(agentId) ?? []).some((project) =>
        managedProjectIds.has(project.id),
      )
    )
      readable.add(agentId);
  return readable;
}
