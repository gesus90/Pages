import { AgentError } from "@/backend/error/AgentErrors";
import { planSwarmMemoryViewSchema } from "@/definition/AgentPlanSwarmMemory";

import { swarmMemoryLog, swarmMemoryMarkdown } from "./SwarmMemoryMarkdown";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanSwarmMemoryFile,
  AgentPlanSwarmMemoryView,
} from "@/definition/AgentPlanSwarmMemory";
import type { AgentPlanSwarmMemoryRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmMemoryRepository";

/** What the memory views of the run view need. */
export interface AgentPlanSwarmMemoryServiceDependencies {
  /** Reads a run with the same access check as every other run data. */
  readonly runs: { run(userId: string, runId: string): Promise<AgentPlanRun> };
  readonly memories: Pick<AgentPlanSwarmMemoryRepository, "view">;
}

/** One exported file, built in memory. */
export interface SwarmMemoryExportFile {
  readonly fileName: AgentPlanSwarmMemoryFile;
  readonly content: string;
}

/**
 * Shows and exports the shared memory of a swarm node in a run.
 * @remarks
 * Whoever may read the run reads its memory; anyone else gets the refusal of
 * every other run data. The export builds `SWARM.md` and `SWARM-LOG.md` from
 * the stored events in memory: it takes no path and writes no file, so the
 * working directory of the swarm never changes.
 */
export class AgentPlanSwarmMemoryService {
  private readonly dependencies: AgentPlanSwarmMemoryServiceDependencies;

  public constructor(dependencies: AgentPlanSwarmMemoryServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * The memory of one swarm node of a run.
   * @throws {AgentError} `plan_access_denied` without read access or for a node
   * that is not a swarm step of the run.
   */
  public async view(
    userId: string,
    runId: string,
    stepId: string,
  ): Promise<AgentPlanSwarmMemoryView> {
    const run = await this.dependencies.runs.run(userId, runId);
    const step = run.steps.find((entry) => entry.id === stepId);
    if (!step?.swarm) throw new AgentError("plan_access_denied");
    return planSwarmMemoryViewSchema.parse(
      await this.dependencies.memories.view({ runId: run.id, nodeId: stepId }),
    );
  }

  /**
   * One of the two export files of a swarm node's memory.
   * @throws {AgentError} `plan_access_denied` as {@link view}.
   */
  public async export(
    userId: string,
    request: {
      readonly runId: string;
      readonly stepId: string;
      readonly fileName: AgentPlanSwarmMemoryFile;
    },
  ): Promise<SwarmMemoryExportFile> {
    const view = await this.view(userId, request.runId, request.stepId);
    const context = { runId: request.runId, nodeId: request.stepId };
    return {
      fileName: request.fileName,
      content:
        request.fileName === "SWARM.md"
          ? swarmMemoryMarkdown(view, context)
          : swarmMemoryLog(view, context),
    };
  }
}
