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

/** Writable execution requires the repository's atomic resource coordination capability. */
export function requireWriterRepository(
  runs: EngineDependencies["runs"],
): Pick<AgentPlanRunRepository, "reserve" | "resourceBlocker"> {
  if (!hasWriterRepository(runs))
    throw new Error(
      "Writable plan execution requires atomic resource coordination",
    );
  return runs;
}

function hasWriterRepository(
  runs: EngineDependencies["runs"],
): runs is EngineDependencies["runs"] &
  Pick<AgentPlanRunRepository, "reserve" | "resourceBlocker"> {
  return (
    "reserve" in runs &&
    typeof runs.reserve === "function" &&
    "resourceBlocker" in runs &&
    typeof runs.resourceBlocker === "function"
  );
}
