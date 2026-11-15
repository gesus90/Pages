import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { LocalSessions } from "@/backend/agents/local/LocalSessions";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentPlanSessionAccess } from "./AgentPlanSessionAccess";
import type { AgentPlanStepReportService } from "./AgentPlanStepReportService";
import type { AgentPlanStepProgressService } from "./AgentPlanStepProgressService";
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AgentSessionService } from "./sessions/AgentSessionService";

export interface StepRunnerDependencies {
  readonly localSessions?: LocalSessions;
  readonly start: Pick<AgentPlanStepStart, "prepare"> &
    Partial<Pick<AgentPlanStepStart, "prepareGroup">>;
  readonly execution: PlanExecution;
  readonly tasks: Pick<AgentPlanTasks, "checklist"> &
    Partial<Pick<AgentPlanTasks, "snapshot">>;
  readonly access: Pick<AgentPlanSessionAccess, "grant" | "revoke">;
  /** Takes what a session reports through `report_step_result`. */
  readonly stepReports?: Pick<AgentPlanStepReportService, "open" | "close">;
  /** The live progress of a step, which a new session after a failure continues from (PAGE-284). */
  readonly stepProgress?: Pick<AgentPlanStepProgressService, "find"> &
    Partial<Pick<AgentPlanStepProgressService, "initialize" | "current">>;
  readonly archive?: Pick<AgentRunArchive, "input">;
  /** Records the PageAgentCLI history and usage of every ACP node. */
  readonly sessions?: Pick<
    AgentSessionService,
    "listen" | "settle" | "released" | "offer" | "abandon"
  >;
}
