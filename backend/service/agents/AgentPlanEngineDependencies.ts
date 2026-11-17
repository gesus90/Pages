import type { AgentPlanWorkGate } from "./AgentPlanWorkGate";
import type { AgentPlanStartResources } from "./AgentPlanStartResources";
import type { LocalSessions } from "@/backend/agents/local/LocalSessions";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanScriptRunner } from "./AgentPlanScriptRunner";
import type { AgentPlanDecisionModel } from "./branching/AgentPlanDecisionModel";
import type { AgentPlanSwarmRunner } from "./swarm/AgentPlanSwarmRunner";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentPlanStepRunner } from "./AgentPlanStepRunner";
import type { AgentPlanInvocations } from "./invocation/AgentPlanInvocations";
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AcpResourceScheduler } from "./AcpResourceScheduler";
import type { AgentDefinitionFiles } from "./AgentDefinitionFiles";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

/** Runtime boundaries shared with the run command aggregate. */
export interface EngineDependencies {
  readonly runnerExecution?: {
    setRunPaused(runId: string, isPaused: boolean): Promise<void>;
  };
  readonly startResources?: Pick<
    AgentPlanStartResources,
    "release" | "releaseResources" | "reconcile" | "blockers"
  >;
  /** Startup restores state and consumes pending controls before releasing dispatch. */
  readonly deferScheduling?: boolean;
  readonly localSessions?: LocalSessions;
  readonly workGate?: AgentPlanWorkGate;
  readonly remoteExecution?: AgentPlanRemoteExecution;
  readonly scripts?: Pick<AgentPlanScriptRunner, "run"> &
    Partial<Pick<AgentPlanScriptRunner, "suspend" | "resume">>;
  /** Asks the model of a model decision; without it such a decision fails instead of guessing. */
  readonly decisions?: Pick<AgentPlanDecisionModel, "run">;
  /** Runs swarm nodes; without it a swarm fails instead of running. */
  readonly swarms?: Pick<AgentPlanSwarmRunner, "run">;
  /** Runs outgoing Jumps, signals and the returns of ends; without it they fail instead of running. */
  readonly invocations?: Pick<AgentPlanInvocations, "call" | "signal" | "end">;
  readonly resources?: Pick<AcpResourceScheduler, "pauseRun" | "resumeRun"> &
    Partial<Pick<AcpResourceScheduler, "setWaitObserver" | "controlRun">>;
  readonly runs: Pick<
    AgentPlanRunRepository,
    "insert" | "create" | "update" | "find"
  > &
    Partial<
      Pick<
        AgentPlanRunRepository,
        "resetRemoteRetry" | "prepareSnapshot" | "snapshot" | "engineState"
      >
    >;
  readonly start: Pick<AgentPlanStepStart, "control">;
  readonly steps: Pick<AgentPlanStepRunner, "run" | "closeGroups"> &
    Partial<Pick<AgentPlanStepRunner, "revise" | "finishPlanRun" | "restore">>;
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
