import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { AgentRunDiagnosisSettingsService } from "@/backend/service/agents/diagnosis/AgentRunDiagnosisSettingsService";
import { createAgentRunDiagnosisStores } from "@/backend/service/agents/diagnosis/AgentRunDiagnosisStores";
import { AgentRunLogRecorder } from "@/backend/service/agents/diagnosis/AgentRunLogRecorder";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanDependencies";
import type { UserService } from "@/backend/service/UserService";
import type { AgentPlanRun } from "@/definition/AgentPlan";

/**
 * The run diagnosis of this process (PAGE-307): its tables, the names of
 * starters, the settings service and the recorder of log lines.
 */
export function createRunDiagnosis(input: {
  readonly database: Database;
  readonly users: UserService;
}): {
  readonly dependencies: Pick<PlanDependencies, "diagnosisStores" | "starters">;
  readonly settings: AgentRunDiagnosisSettingsService;
} {
  const stores = createAgentRunDiagnosisStores(input.database);
  const recorder = new AgentRunLogRecorder(stores);
  recorder.start();
  registerShutdownTask(() => recorder.stop(), { step: "run_log_recorder" });
  return {
    dependencies: {
      diagnosisStores: stores,
      starters: {
        displayName: async (userId) =>
          (await input.users.getById(userId))?.displayName ?? null,
      },
    },
    settings: new AgentRunDiagnosisSettingsService(stores.settings),
  };
}

/** What the session history needs of a run: the run, and whether its content is hidden from the reader. */
export async function readableSessionRun(
  service: AgentPlanService,
  userId: string,
  runId: string,
): Promise<{ readonly run: AgentPlanRun; readonly isContentHidden: boolean }> {
  const readable = await service.readableRun(userId, runId);
  return {
    run: readable.run,
    isContentHidden: readable.hiddenFields.length > 0,
  };
}
