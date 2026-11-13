import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AcpResourceSnapshot } from "@/definition/AcpResource";
import type { ActivePlanRun } from "../AgentPlanRunState";
import type { EngineDependencies } from "../AgentPlanEngineDependencies";

/** Persists admission reasons under the engine's serial writes for readers in every process. */
export async function persistPlanResourceWaits(
  activeRuns: Iterable<ActivePlanRun>,
  waiting: AcpResourceSnapshot["waiting"],
  runs: Pick<EngineDependencies["runs"], "update">,
): Promise<void> {
  for (const active of activeRuns) {
    const waitReason = isActivePlanRun(active.view.status)
      ? waiting.find((entry) => entry.runId === active.view.id)?.reason
      : undefined;
    if (active.view.waitReason === waitReason) continue;
    const view = { ...active.view, waitReason };
    await runs.update(view);
    active.view = view;
  }
}
