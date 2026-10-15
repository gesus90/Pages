import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** Sanitized synthetic session for UI units, without a runner or external service. */
export function syntheticSession(): AgentPlanSessionRecord {
  return {
    runner: "api",
    mode: "request",
    instanceId: "synthetic-instance",
    sessionId: null,
    processId: null,
    startedAt: "2026-10-15T10:00:00.000Z",
    turnEndedAt: "2026-10-15T10:00:12.000Z",
    endedAt: "2026-10-15T10:00:12.000Z",
    exit: null,
    closeout: "not_needed",
    leftoverProcesses: null,
    resultCode: 0,
    requested: {
      runner: "api",
      connectionId: "synthetic-connection",
      connectionName: "Synthetic connection",
      model: "synthetic-model",
      reasoningEffort: null,
      options: null,
      unattended: "request",
      mcp: false,
      directory: "/synthetic/workspace",
    },
    effective: null,
    definition: null,
    contract: {
      todos: [
        { id: "T1", text: "Read requirements", ticket: null },
        { id: "T2", text: "Implement changes", ticket: null },
        { id: "T3", text: "Review result", ticket: null },
      ],
      criteria: [],
      tickets: [],
    },
    acceptance: {
      verdict: "open",
      todos: [
        { id: "T1", status: "done" },
        { id: "T2", status: "open" },
        { id: "T3", status: "open" },
      ],
      criteria: [],
      decisions: [],
      issues: [],
      summary: "Synthetic progress summary",
    },
    events: ["Session prepared", "Reading requirements"],
  };
}

/** One checkpoint or agent result, with explicit overrides for each tested state. */
export function runStep(
  id: string,
  overrides: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return {
    id,
    name: id,
    status: "waiting",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    ...overrides,
  };
}

/** Three agents between succeeded Start and waiting End, as the run API returns them. */
export function syntheticRun(): AgentPlanRun {
  return {
    id: "synthetic-run",
    planId: "synthetic-plan",
    planName: "Synthetic plan",
    planRevision: 1,
    userId: "synthetic-user",
    startedAt: "2026-10-15T10:00:00.000Z",
    status: "running",
    stopRequested: false,
    steps: [
      runStep("start", { status: "succeeded" }),
      runStep("Research", { status: "succeeded", session: syntheticSession() }),
      runStep("Implementation", {
        status: "running",
        session: syntheticSession(),
      }),
      runStep("Review"),
      runStep("end"),
    ],
  };
}
