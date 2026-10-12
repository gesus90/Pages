import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectAccessService } from "@/backend/service/project/ProjectAccessService";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { User } from "@/definition/User";

/**
 * Creates fresh agent policy using transaction-bound project access.
 *
 * @remarks
 * On the `mcp` channel the policy is independent of the browser role mode; the
 * chat agent keeps the persisted role mode of the interface.
 */
export function createAgentWikiAccess(
  projects: ProjectRepository,
  actor: User,
  channel: AgentChannel = "mcp",
): WikiAccess {
  const access = new ProjectAccessService(
    projects,
    ServerCache.disabled(),
    agentChannelPolicy(channel).actor,
  );
  return new WikiAccess(
    {
      workItemVisibility: async (user) => (await access.scope(user)).visibility,
    },
    new PermissionService((id) => access.account({ ...actor, id })),
  );
}
