import { createSessionRecord } from "@/backend/service/agents/AgentPlanSessionRecords";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { parameterRunFixture } from "./page55-run-fixture";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

export interface RecoveryFixture {
  readonly snapshot: AgentPlanSnapshot;
  readonly initial: AgentPlanRun;
  readonly completed: AgentPlanRun;
  readonly failed: AgentPlanRun;
}

/** A frozen A → B → C plan; every external boundary comes from the existing synthetic fixture. */
export async function recoveryFixture(): Promise<RecoveryFixture> {
  const base = await parameterRunFixture(
    emptyAgentConfiguration(),
    "codex_cli",
  );
  const steps = ["a", "b", "c"].map((id) => ({
    ...base.step,
    step: {
      ...base.step.step,
      id,
      instruction: `Original private assignment ${id}`,
    },
  }));
  const snapshot: AgentPlanSnapshot = {
    ...base.snapshot,
    steps,
    plan: {
      ...base.snapshot.plan,
      nodes: steps.map((step) => step.step),
      edges: [
        { from: "a", to: "b", fromPort: "flow-out", toPort: "flow-in" },
        { from: "b", to: "c", fromPort: "flow-out", toPort: "flow-in" },
      ],
    },
  };
  const initial: AgentPlanRun = {
    ...base.run,
    steps: steps.map((step) => ({
      id: step.step.id,
      name: step.step.id,
      status: "waiting",
      isBlocked: false,
      cancellation: "none",
      output: null,
      error: null,
    })),
  };
  const prepared = await base.start.prepare(base.run, base.snapshot, base.step);
  const session = {
    ...createSessionRecord({
      instanceId: "owned-instance",
      prepared,
      contract: null,
      usesMcp: false,
    }),
    sessionId: "original-native-session",
    startedAt: "2026-10-17T00:00:00.000Z",
    endedAt: "2026-10-17T00:01:00.000Z",
    closeout: "confirmed" as const,
    resultCode: 0 as const,
    dispatchedPromptDigest: planContentDigest("original dispatched prompt"),
    continuationCapabilities: {
      canResume: true,
      canLoad: false,
      adapter: "synthetic-adapter 1",
    },
    acceptance: {
      verdict: "accepted" as const,
      todos: [],
      criteria: [],
      decisions: [],
      issues: [],
      summary: "A accepted",
    },
  };
  const completed = patchRecoveryStep(initial, "a", {
    status: "succeeded",
    output: "immutable A result",
    session,
  });
  const failed: AgentPlanRun = {
    ...patchRecoveryStep(completed, "b", {
      status: "failed",
      error: "plan_group_acceptance_failed",
    }),
    status: "failed",
    recovery: { state: "recoverable", requiresReconciliation: true },
  };
  return { snapshot, initial, completed, failed };
}

/** Changes one synthetic result without modifying the frozen plan or another node. */
export function patchRecoveryStep(
  run: AgentPlanRun,
  stepId: string,
  changes: Partial<AgentPlanStepResult>,
): AgentPlanRun {
  return {
    ...run,
    steps: run.steps.map((step) =>
      step.id === stepId ? { ...step, ...changes } : step,
    ),
  };
}
