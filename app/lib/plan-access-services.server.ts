import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanSharing } from "@/backend/service/agents/AgentPlanSharing";
import { AgentPlanWorkspaces } from "@/backend/service/agents/AgentPlanWorkspaces";
import { AgentPlanWorkspaceRepository } from "@/backend/database/repositories/agent/AgentPlanWorkspaceRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { ProjectMemberRepository } from "@/backend/database/repositories/project/ProjectMemberRepository";
import { AgentPlanAccessRepository } from "@/backend/database/repositories/agent/AgentPlanAccessRepository";
import { AgentPlanAuditRepository } from "@/backend/database/repositories/agent/AgentPlanAuditRepository";
import { AgentPlanScriptApprovalRepository } from "@/backend/database/repositories/agent/AgentPlanScriptApprovalRepository";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { RemoteWorkspaceService } from "@/backend/service/remote/RemoteWorkspaceService";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanDependencies";

/**
 * Teams, owner, script approvals and history of plans (PAGE-329).
 *
 * @param database - The Pages database.
 */
export function planAccessRecords(
  database: Database,
): Pick<PlanDependencies, "accessChanges" | "planAudit" | "scriptApprovals"> {
  return {
    accessChanges: new AgentPlanAccessRepository(database),
    planAudit: new AgentPlanAuditRepository(database),
    scriptApprovals: new AgentPlanScriptApprovalRepository(database),
  };
}

/** Gives editor, execution and runner dispatch the same current workspace and project authorization. */
export function createPlanWorkspaceAccess(
  input: {
    readonly database: Database;
    readonly agents: {
      readonly agentWorkspaceService: AgentWorkspaceService;
      readonly remoteWorkspaceService: RemoteWorkspaceService;
    };
  },
  plans: AgentPlanRepository,
): {
  readonly access: AgentPlanAccess;
  readonly workspaceCatalog: AgentPlanWorkspaces;
} {
  const sharing = new AgentPlanSharing(
    new AuthorizationRepository(input.database),
    new UserGroupRepository(input.database),
  );
  const workspaceCatalog = new AgentPlanWorkspaces({
    local: input.agents.agentWorkspaceService,
    remote: input.agents.remoteWorkspaceService,
    registrations: new AgentPlanWorkspaceRepository(input.database),
    projects: new ProjectRepository(input.database),
  });
  const members = new ProjectMemberRepository(input.database);
  const access = new AgentPlanAccess(
    plans,
    input.agents.agentWorkspaceService,
    sharing,
    {
      catalog: workspaceCatalog,
      // Project managers manage the teams of the project's plans (PAGE-329).
      isProjectManager: (projectId, userId) =>
        members.isProjectManager(projectId, userId),
    },
  );
  return { access, workspaceCatalog };
}
