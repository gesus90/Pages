import { setTimeout as wait } from "node:timers/promises";

import { setScriptRunPaused } from "./AgentPlanScriptPause";

import type { LocalSessions } from "@/backend/agents/local/LocalSessions";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** Limits the native suspension path to local Codex plans; other providers keep their control path. */
export function usesImmediateCodexPause(snapshot: AgentPlanSnapshot): boolean {
  return (
    snapshot.steps.length > 0 &&
    snapshot.steps.every(
      (step) => step.provider === "codex_cli" && !step.remoteTarget,
    ) &&
    (snapshot.remoteSteps?.length ?? 0) === 0 &&
    snapshot.plan.executionTarget?.kind !== "remote"
  );
}

/** Acknowledges native process suspension without touching leases, attempts or TODOs. */
export async function setCodexRunPaused(
  active: ActivePlanRun,
  local: Pick<LocalSessions, "setRunPaused"> | undefined,
  isPaused: boolean,
): Promise<void> {
  await Promise.all([
    local?.setRunPaused(active.view.id, isPaused),
    setScriptRunPaused(active.view.id, isPaused),
  ]);
}

/** Records the exact live frontier while retaining running node and iteration identities. */
export function suspendedCodexRun(active: ActivePlanRun): AgentPlanRun {
  const pending = active.view.steps.filter((step) =>
    ["running", "paused", "waiting"].includes(step.status),
  );
  return {
    ...active.view,
    status: "paused",
    pauseBoundary: {
      pausedAt: new Date().toISOString(),
      completedStepIds: active.view.steps
        .filter((step) => step.status === "succeeded")
        .map((step) => step.id),
      pendingStepIds: pending.map((step) => step.id),
      frontierStepIds: pending.map((step) => step.id),
    },
  };
}

/** Holds a completed native turn at the pause boundary before assessment or a corrective turn. */
export async function waitForCodexResume(
  read: () => AgentPlanRun,
  signal: AbortSignal,
): Promise<void> {
  while (["pausing", "paused"].includes(read().status) && !signal.aborted) {
    try {
      await wait(25, undefined, { signal });
    } catch (error: unknown) {
      if (!signal.aborted) throw error;
    }
  }
}
