import { AgentSessionEventRepository } from "@/backend/database/repositories/agent/AgentSessionEventRepository";
import { LocalSessionRepository } from "@/backend/database/repositories/agent/LocalSessionRepository";
import { PlanRunCommandRepository } from "@/backend/database/repositories/agent/PlanRunCommandRepository";
import { PlanRunOwnerRepository } from "@/backend/database/repositories/agent/PlanRunOwnerRepository";
import { RunApiCleanupRepository } from "@/backend/database/repositories/agent/RunApiCleanupRepository";
import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import { AgentCatalogRepository } from "@/backend/database/repositories/agent/AgentCatalogRepository";
import { AgentCheckRepository } from "@/backend/database/repositories/agent/AgentCheckRepository";
import { AgentConnectionScopeRepository } from "@/backend/database/repositories/agent/AgentConnectionScopeRepository";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanCleanupFailureRepository } from "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository";
import { AgentPlanContinuationRepository } from "@/backend/database/repositories/agent/AgentPlanContinuationRepository";
import { AgentPlanLoopIterationRepository } from "@/backend/database/repositories/agent/AgentPlanLoopIterationRepository";
import { AgentPlanProgressRepository } from "@/backend/database/repositories/agent/AgentPlanProgressRepository";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRemoteAccessRepository } from "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository";
import { AgentPlanOneShotRepository } from "@/backend/database/repositories/agent/AgentPlanOneShotRepository";
import { AgentPlanAccessRepository } from "@/backend/database/repositories/agent/AgentPlanAccessRepository";
import { AgentPlanAuditRepository } from "@/backend/database/repositories/agent/AgentPlanAuditRepository";
import { AgentPlanScriptApprovalRepository } from "@/backend/database/repositories/agent/AgentPlanScriptApprovalRepository";
import { AgentPlanTeamRepository } from "@/backend/database/repositories/agent/AgentPlanTeamRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanRunVisibilityRepository } from "@/backend/database/repositories/agent/AgentPlanRunVisibilityRepository";
import { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import { AgentPlanAgentTodoRepository } from "@/backend/database/repositories/agent/AgentPlanAgentTodoRepository";
import { AgentPlanStepProgressRepository } from "@/backend/database/repositories/agent/AgentPlanStepProgressRepository";
import { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import { AgentPlanTemplateRepository } from "@/backend/database/repositories/agent/AgentPlanTemplateRepository";
import { AgentPlanWorkRepository } from "@/backend/database/repositories/agent/AgentPlanWorkRepository";
import { AgentPlanWorkspaceRepository } from "@/backend/database/repositories/agent/AgentPlanWorkspaceRepository";
import { AgentProfileRemoval } from "@/backend/database/repositories/agent/AgentProfileRemoval";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentProfileStore } from "@/backend/database/repositories/agent/AgentProfileStore";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import { AgentWorkspaceReferencesRepository } from "@/backend/database/repositories/agent/AgentWorkspaceReferencesRepository";
import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentAssetRevisionRepository } from "@/backend/database/repositories/agents/AgentAssetRevisionRepository";
import { AgentPlanAssetRepository } from "@/backend/database/repositories/agents/AgentPlanAssetRepository";
import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { RemoteConnectionRepository } from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import { RemoteInstallFindingRepository } from "@/backend/database/repositories/remote/RemoteInstallFindingRepository";
import { RemoteConsoleSessionRepository } from "@/backend/database/repositories/remote/RemoteConsoleSessionRepository";
import { RemoteWorkspaceRepository } from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";
import { RunnerDeployKeyRepository } from "@/backend/database/repositories/runner/RunnerDeployKeyRepository";
import { RunnerHistoryRecoveryRepository } from "@/backend/database/repositories/runner/RunnerHistoryRecoveryRepository";
import { RunnerPlanEventRepository } from "@/backend/database/repositories/runner/RunnerPlanEventRepository";
import { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";

import {
  AGENT_ASSET_FLOW,
  AGENT_IMPORT_FLOW,
  AGENT_OPERATION_FLOW,
  PLAN_ASSET_FLOW,
} from "./agent-asset-flows";
import {
  ACP_RESOURCE_FLOW,
  ASSIGNMENT_FLOW,
  CATALOG_FLOW,
  CHECK_FLOW,
  CONNECTION_SCOPE_FLOW,
} from "./agent-connection-flows";
import {
  JSON_FUNCTION_FLOW,
  PLAN_DOCUMENT_FLOW,
  PLAN_FLOW,
  PLAN_TEMPLATE_FLOW,
  PLAN_WORKSPACE_FLOW,
  PLAN_WORLD_FLOW,
} from "./agent-plan-flows";
import {
  PROFILE_FLOW,
  WORKSPACE_CLEANUP_FLOW,
  WORKSPACE_FLOW,
} from "./agent-profile-flows";
import { AGENT_NUL_FLOW } from "./agent-nul-flow";
import { AGENT_ORDER_FLOW } from "./agent-order-flows";
import {
  CHECKPOINT_FLOW,
  CLEANUP_FAILURE_FLOW,
  LOOP_ITERATION_FLOW,
  RECOVERY_EXECUTION_FLOW,
  RECOVERY_FLOW,
} from "./agent-recovery-flows";
import {
  PLAN_CONTINUATION_FLOW,
  PLAN_PROGRESS_FLOW,
} from "./agent-progress-flows";
import { PLAN_ONE_SHOT_FLOW } from "./agent-plan-one-shot-flow";
import { PLAN_TEAM_FLOW } from "./agent-plan-team-flow";
import { PLAN_RUN_FLOW } from "./agent-run-flows";
import { PLAN_RUN_PURGE_FLOW } from "./agent-run-purge-flow";
import {
  PLAN_WORK_FLOW,
  REMOTE_ACCESS_FLOW,
  START_REJECTION_FLOW,
  RUN_OWNERSHIP_FLOW,
  STEP_REPORT_FLOW,
} from "./agent-run-record-flows";
import { PAGE_AGENT_RUN_FLOW, AGENT_SESSION_FLOW } from "./agent-session-flows";
import {
  REMOTE_CONNECTION_FLOW,
  REMOTE_CONSOLE_SESSION_FLOW,
  REMOTE_FINDING_FLOW,
  REMOTE_WORKSPACE_FLOW,
} from "./remote-flows";
import {
  RUNNER_DEPLOY_KEY_FLOW,
  RUNNER_EVENT_FLOW,
  RUNNER_FLOW,
  RUNNER_HISTORY_FLOW,
  RUNNER_SESSION_FLOW,
} from "./runner-flows";

import type { RepositoryFlow } from "./world";

/** The flows of agents, plans, runners and remote machines, in dependency order. */
export const AGENT_AREA_FLOWS: readonly RepositoryFlow[] = [
  PLAN_WORLD_FLOW,
  ACP_RESOURCE_FLOW,
  ASSIGNMENT_FLOW,
  CATALOG_FLOW,
  CHECK_FLOW,
  CONNECTION_SCOPE_FLOW,
  PLAN_FLOW,
  JSON_FUNCTION_FLOW,
  PLAN_DOCUMENT_FLOW,
  PLAN_TEMPLATE_FLOW,
  PLAN_WORKSPACE_FLOW,
  PLAN_RUN_FLOW,
  PLAN_PROGRESS_FLOW,
  PLAN_RUN_PURGE_FLOW,
  PLAN_ONE_SHOT_FLOW,
  PLAN_TEAM_FLOW,
  PLAN_CONTINUATION_FLOW,
  CHECKPOINT_FLOW,
  CLEANUP_FAILURE_FLOW,
  LOOP_ITERATION_FLOW,
  RECOVERY_EXECUTION_FLOW,
  RECOVERY_FLOW,
  REMOTE_ACCESS_FLOW,
  START_REJECTION_FLOW,
  STEP_REPORT_FLOW,
  PLAN_WORK_FLOW,
  PROFILE_FLOW,
  WORKSPACE_FLOW,
  WORKSPACE_CLEANUP_FLOW,
  AGENT_SESSION_FLOW,
  PAGE_AGENT_RUN_FLOW,
  AGENT_ASSET_FLOW,
  PLAN_ASSET_FLOW,
  AGENT_IMPORT_FLOW,
  AGENT_OPERATION_FLOW,
  RUNNER_DEPLOY_KEY_FLOW,
  RUNNER_FLOW,
  RUNNER_EVENT_FLOW,
  RUNNER_SESSION_FLOW,
  RUNNER_HISTORY_FLOW,
  REMOTE_CONNECTION_FLOW,
  REMOTE_CONSOLE_SESSION_FLOW,
  REMOTE_FINDING_FLOW,
  REMOTE_WORKSPACE_FLOW,
  AGENT_ORDER_FLOW,
  AGENT_NUL_FLOW,
  RUN_OWNERSHIP_FLOW,
];

/** The classes of these directories, whose methods are watched while the flows run. */
export const AGENT_AREA_CLASSES: Readonly<
  Record<string, { readonly prototype: object }>
> = {
  AgentSessionEventRepository,
  LocalSessionRepository,
  PlanRunCommandRepository,
  PlanRunOwnerRepository,
  RunApiCleanupRepository,
  AcpResourceRepository,
  AgentAssignmentRepository,
  AgentCatalogRepository,
  AgentCheckRepository,
  AgentConnectionScopeRepository,
  AgentPlanCheckpointRepository,
  AgentPlanCleanupFailureRepository,
  AgentPlanContinuationRepository,
  AgentPlanLoopIterationRepository,
  AgentPlanProgressRepository,
  AgentPlanRecoveryExecutionRepository,
  AgentPlanRecoveryRepository,
  AgentPlanRemoteAccessRepository,
  AgentPlanOneShotRepository,
  AgentPlanAccessRepository,
  AgentPlanAuditRepository,
  AgentPlanScriptApprovalRepository,
  AgentPlanTeamRepository,
  AgentPlanRepository,
  AgentPlanRunRepository,
  AgentPlanRunVisibilityRepository,
  AgentPlanStartRejectionRepository,
  AgentPlanAgentTodoRepository,
  AgentPlanStepProgressRepository,
  AgentPlanStepReportRepository,
  AgentPlanTemplateRepository,
  AgentPlanWorkRepository,
  AgentPlanWorkspaceRepository,
  AgentProfileRemoval,
  AgentProfileRepository,
  AgentProfileStore,
  AgentSessionRepository,
  AgentWorkspaceCleanupRepository,
  AgentWorkspaceReferencesRepository,
  AgentWorkspaceRepository,
  PageAgentRunRepository,
  AgentAssetRepository,
  AgentAssetRevisionRepository,
  AgentPlanAssetRepository,
  AgentImportRepository,
  AgentOperationKeyRepository,
  RemoteConnectionRepository,
  RemoteConsoleSessionRepository,
  RemoteInstallFindingRepository,
  RemoteWorkspaceRepository,
  RunnerDeployKeyRepository,
  RunnerHistoryRecoveryRepository,
  RunnerPlanEventRepository,
  RunnerRepository,
};
