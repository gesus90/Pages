import {
  completedGatedRemote,
  settleRemoteAcceptance,
} from "./AgentPlanRemoteAcceptance";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanAccess } from "./AgentPlanAccess";
import type { AgentPlanTasks } from "./AgentPlanTasks";
import type { AgentPlanStepReportService } from "./AgentPlanStepReportService";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";

interface RemoteSettlementDependencies {
  readonly runs: Pick<AgentPlanRunRepository, "find">;
  readonly access: Pick<AgentPlanAccess, "require">;
  readonly tasks?: Pick<AgentPlanTasks, "checklist">;
  readonly stepReports?: Pick<AgentPlanStepReportService, "close">;
}

/** The original and a restored remote attempt close their reports under the same acceptance rules. */
export class AgentPlanRemoteSettlement {
  private readonly dependencies: RemoteSettlementDependencies;

  public constructor(dependencies: RemoteSettlementDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads the exact durable closeout and assesses the pinned report without dispatching new work. */
  public async settle(
    run: AgentPlanRun,
    remote: RemotePlanStep,
    result: Partial<AgentPlanStepResult>,
    attemptId: string,
  ): Promise<Partial<AgentPlanStepResult>> {
    const current = await this.dependencies.runs.find(run.id);
    const completed = completedGatedRemote(
      remote,
      current?.steps.find((step) => step.id === remote.step.id) ?? result,
    );
    const report = await this.dependencies.stepReports?.close({
      runId: run.id,
      sessionScopeId: remote.step.id,
      attemptId,
    });
    return settleRemoteAcceptance({
      remote,
      run,
      result: completed,
      tasks: this.dependencies.tasks,
      projectId: async () =>
        (await this.dependencies.access.require(run.userId, run.planId))
          .projectId,
      stepReport: report ?? null,
    });
  }
}
