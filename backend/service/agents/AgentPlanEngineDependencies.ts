import type { AgentPlanWorkGate } from "./AgentPlanWorkGate";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanScriptRunner } from "./AgentPlanScriptRunner";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentPlanStepRunner } from "./AgentPlanStepRunner";
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AcpResourceScheduler } from "./AcpResourceScheduler";
import type { AgentDefinitionFiles } from "./AgentDefinitionFiles";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

/** Runtime boundaries shared with the run command aggregate. */
export interface EngineDependencies {
  readonly workGate?: AgentPlanWorkGate;
  readonly remoteExecution?: AgentPlanRemoteExecution;
  readonly scripts?: Pick<AgentPlanScriptRunner, "run">;
  readonly resources?: Pick<AcpResourceScheduler, "pauseRun" | "resumeRun">;
  readonly runs: Pick<
    AgentPlanRunRepository,
    "insert" | "create" | "update" | "find"
  >;
  readonly start: Pick<AgentPlanStepStart, "control">;
  readonly steps: Pick<AgentPlanStepRunner, "run" | "closeGroups"> &
    Partial<Pick<AgentPlanStepRunner, "revise">>;
  readonly archive?: AgentRunArchive;
  readonly files?: AgentDefinitionFiles;
}
