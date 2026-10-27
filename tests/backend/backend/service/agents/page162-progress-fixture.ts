import { materializeTicketChecklist } from "@/backend/service/task/TicketChecklist";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanTicketChecklist } from "@/backend/service/agents/AgentPlanTasks";
import type { WorkItemChecklistItem } from "@/definition/Task";

/** A ticket with real Markdown checklist identities and hashes, without persistence boundaries. */
export function progressTicket(
  markdown = "",
  id = "ticket",
  criteria: readonly WorkItemChecklistItem[] = [],
): AgentPlanTicketChecklist {
  return {
    id,
    key: `SYN-${id}`,
    title: "Synthetic work",
    checklist: materializeTicketChecklist(markdown, criteria),
  };
}

/** A running result without assuming that the runner already produced a session record. */
export function progressStep(
  overrides: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return {
    id: "agent",
    name: "Synthetic agent",
    status: "running",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    ...overrides,
  };
}

/** A private executor run with no actual runner, file, process or network. */
export function progressRun(
  steps: readonly AgentPlanStepResult[] = [progressStep()],
): AgentPlanRun {
  return {
    id: "run",
    planId: "plan",
    planName: "Synthetic",
    planRevision: 1,
    userId: "executor",
    startedAt: "2026-10-27T18:00:00Z",
    status: "running",
    stopRequested: false,
    steps,
  };
}

/** A session whose current ACP activity explicitly names checklist IDs. */
export function progressSession(
  titles: readonly string[],
): AgentPlanSessionRecord {
  return {
    runner: "codex_cli",
    mode: "interactive",
    instanceId: "session",
    attemptId: "attempt",
    sessionId: null,
    processId: null,
    startedAt: "2026-10-27T18:00:00Z",
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: "pending",
    leftoverProcesses: null,
    resultCode: null,
    requested: {
      runner: "codex_cli",
      connectionId: "connection",
      connectionName: "Synthetic",
      model: "synthetic",
      reasoningEffort: null,
      options: null,
      unattended: "read_only",
      mcp: true,
      directory: null,
    },
    effective: null,
    definition: null,
    contract: null,
    acceptance: null,
    events: [],
    activity: { reportedAt: "2026-10-27T18:01:00Z", titles },
  };
}
