import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanStep,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentSessionKey } from "@/definition/AgentSessionJournal";

/** The node a console was opened for: an agent node, or a group that asks for a member. */
export type ConsoleNode =
  | { readonly kind: "agent"; readonly step: AgentPlanStep }
  | { readonly kind: "group"; readonly group: AgentPlanGroup };

/** What the console shows for one agent node in the selected run. */
export type ConsoleSession =
  | { readonly kind: "no_run" }
  | { readonly kind: "not_started" }
  | { readonly kind: "no_cli_session" }
  | {
      readonly kind: "session";
      readonly key: AgentSessionKey;
      readonly step: AgentPlanStepResult;
    };

/**
 * Finds an agent node or a group by ID, members of groups included.
 *
 * @param draft - The plan as the editor holds it.
 * @param id - The node the console was opened for.
 */
export function findConsoleNode(
  draft: AgentPlanInput,
  id: string,
): ConsoleNode | null {
  for (const node of draft.nodes) {
    if (node.id === id && node.type === "agent")
      return { kind: "agent", step: node };
    if (node.type !== "group") continue;
    if (node.id === id) return { kind: "group", group: node };
    const member = node.steps.find((step) => step.id === id);
    if (member) return { kind: "agent", step: member };
  }
  return null;
}

/** Whether a run can still change: only then live events, instructions and stops apply. */
export function isRunActive(run: AgentPlanRun): boolean {
  return ["running", "pausing", "paused", "stopping"].includes(run.status);
}

/**
 * The session of one agent node in a run, keyed by plan, run, node and attempt.
 *
 * @param run - The selected run; `null` before the plan ran.
 * @param stepId - The agent node.
 * @remarks
 * The key is taken from the node's own record only, so no session of another
 * node, run or attempt is ever guessed.
 */
export function consoleSession(
  run: AgentPlanRun | null,
  stepId: string,
): ConsoleSession {
  if (!run) return { kind: "no_run" };
  const step = run.steps.find((entry) => entry.id === stepId);
  const record = step?.session;
  if (!step || !record) return { kind: "not_started" };
  if (record.runner === "api") return { kind: "no_cli_session" };
  return {
    kind: "session",
    step,
    key: {
      planId: run.planId,
      runId: run.id,
      stepId,
      attemptId: sessionAttemptId(record, stepId),
    },
  };
}

/** The address of a session's read and command route, with plan and attempt in the query. */
export function sessionAddress(key: AgentSessionKey, suffix = ""): string {
  const query = new URLSearchParams({
    planId: key.planId,
    attemptId: key.attemptId,
  });
  return `/agent-api/plan-runs/${encodeURIComponent(key.runId)}/steps/${encodeURIComponent(key.stepId)}/session${suffix}?${query.toString()}`;
}

/** A stable text for a key, used to keep the data of one session apart from the next. */
export function sessionKeyText(key: AgentSessionKey): string {
  return [key.planId, key.runId, key.stepId, key.attemptId].join("/");
}
