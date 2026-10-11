import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectAccessService } from "@/backend/service/project/ProjectAccessService";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { User } from "@/definition/User";

/** Creates fresh MCP policy using transaction-bound project access, independent of browser role mode. */
export function createAgentWikiAccess(
  projects: ProjectRepository,
  actor: User,
): WikiAccess {
  const access = new ProjectAccessService(
    projects,
    ServerCache.disabled(),
    "mcp",
  );
  return new WikiAccess(
    {
      workItemVisibility: async (user) => (await access.scope(user)).visibility,
    },
    new PermissionService((id) => access.account({ ...actor, id })),
  );
}
