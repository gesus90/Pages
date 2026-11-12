import type { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import type { AgentPlanWorkGate } from "./AgentPlanWorkGate";
import type { AgentPlanAgentTodoService } from "./AgentPlanAgentTodoService";
import type { AgentPlanStepProgressService } from "./AgentPlanStepProgressService";
import type { AgentPlanWorkspaces } from "./AgentPlanWorkspaces";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanRemoteTargets } from "./AgentPlanRemoteTargets";
import type { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentWorkspaceService } from "./AgentWorkspaceService";
import type { AgentProfileService } from "./AgentProfileService";
import type { AgentParameterService } from "./AgentParameterService";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentPlanPhases } from "./AgentPlanPhases";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanPreparation } from "./AgentPlanPreparation";
import type { PlanRunEnginePort } from "./runs/PlanRunEnginePort";
import type { AgentPlanSessionGrants } from "./AgentPlanSessionAccess";
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AgentPlanScripts } from "./AgentPlanScripts";
import type { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import type { PlanAssetService } from "./assets/PlanAssetService";

/** What the plan service and its parts work with. */
export interface PlanDependencies {
  readonly workspaceCleanup?: AgentWorkspaceCleanupRepository;
  readonly workGate?: AgentPlanWorkGate;
  /** The live progress `update_step_progress` reported (PAGE-284). */
  readonly stepProgress?: Pick<AgentPlanStepProgressService, "listForRun">;
  /** The TODO lists CLIs reported as structured plans (PAGE-306). */
  readonly agentTodos?: Pick<AgentPlanAgentTodoService, "listForRun">;
  readonly workspaceCatalog?: AgentPlanWorkspaces;
  readonly remoteExecution?: AgentPlanRemoteExecution;
  readonly remoteTargets?: AgentPlanRemoteTargets;
  readonly plans: AgentPlanRepository;
  readonly runs: AgentPlanRunRepository;
  readonly workspaces: AgentWorkspaceService;
  readonly profiles: AgentProfileService;
  readonly parameters: AgentParameterService;
  readonly tasks: AgentPlanTasks;
  readonly phases: AgentPlanPhases;
  readonly access: AgentPlanAccess;
  readonly preparation: AgentPlanPreparation;
  readonly engine: PlanRunEnginePort;
  /** Ends the MCP access of interrupted sessions; absent without plan sessions. */
  readonly sessions?: AgentPlanSessionGrants;
  /** Serves the prompts nodes were sent. */
  readonly archive?: AgentRunArchive;
  /** The interpreter profiles of script nodes; absent, no profile exists. */
  readonly scripts?: AgentPlanScripts;
  readonly startRejections?: AgentPlanStartRejectionRepository;
  /** The files of asset nodes and asset stack entries (PAGE-268). */
  readonly planAssets?: PlanAssetService;
}
