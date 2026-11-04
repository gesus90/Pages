import {
  AGENT_ERROR_MESSAGES,
  isAgentErrorCode,
} from "@/backend/error/AgentErrors";
import { PLAN_BLOCKER_RETRIES } from "@/definition/AgentPlanRetry";

import {
  failedPlanAttempts,
  planBlockerClassOf,
} from "./AgentPlanBlockerRules";

import type { AgentPlanRetry } from "@/definition/AgentPlanRetry";

const EFFECTS =
  "Files and other external effects of the earlier attempt may already exist. Inspect the current state first, keep correct results, and do not repeat a completed external action.";

/** What each finding of the acceptance means, so the agent can act on it without knowing Pages. */
const ISSUE_MEANINGS: readonly (readonly [RegExp, string])[] = [
  [
    /^report_missing$/u,
    "you neither called report_step_result nor wrote a pages-report block",
  ],
  [
    /^report_invalid$/u,
    "the pages-report block is no valid JSON or lacks its todos or criteria list",
  ],
  [/^todo_open:/u, "this todo is still open"],
  [/^todo_missing:/u, "the report does not name this todo"],
  [
    /^criterion_missing:/u,
    "the report does not say whether this criterion is met",
  ],
  [/^criterion_unmet:/u, "this criterion is not met"],
  [/^evidence_missing:/u, "this criterion has no real evidence"],
  [
    /^ticket_unchecked:/u,
    "the report says done, but the ticket entry is not checked",
  ],
  [
    /^ticket_changed:/u,
    "the requirements of this ticket changed; read them again",
  ],
  [/^ticket_unreadable:/u, "this ticket could not be read"],
  [/^business_/u, "your answer declares the work as not finished"],
];

/**
 * One finding of the acceptance, in words an agent can act on.
 *
 * @param issue - The stable code of the finding.
 * @returns The code with its meaning; a code without a known meaning stays as it is.
 */
export function describePlanIssue(issue: string): string {
  const meaning = ISSUE_MEANINGS.find(([pattern]) => pattern.test(issue))?.[1];
  return meaning ? `${issue}: ${meaning}` : issue;
}

function issueLine(issue: string): string {
  return `- ${describePlanIssue(issue)}`;
}

/** The concrete error an agent gets back: what failed and every finding of the acceptance. */
function concreteError(code: string, issues: readonly string[]): string {
  const message = isAgentErrorCode(code) ? AGENT_ERROR_MESSAGES[code] : code;
  return [`Error: ${message}`, ...issues.map(issueLine)].join("\n");
}

/**
 * What the next attempt of a step is told about the failed one.
 *
 * @param retry - The retry record of the step, with the failed attempts.
 * @param isResumed - Whether this attempt continues the earlier native session.
 * @returns The text that precedes the assignment.
 *
 * @remarks
 * A technical failure only asks the agent to reconcile the state. A form or
 * functional failure goes back to it with the concrete error, because repeating
 * the same answer would fail the same way.
 */
export function planRetryNotice(
  retry: AgentPlanRetry,
  isResumed: boolean,
): string {
  const last = retry.attempts.at(-1);
  if (!last) return "";
  const failureClass =
    last.failureClass ?? retry.failureClass ?? planBlockerClassOf(last.code);
  const failed = failedPlanAttempts(retry.attempts, failureClass);
  const total = PLAN_BLOCKER_RETRIES[failureClass] + 1;
  const mode = isResumed
    ? "continues the earlier native session"
    : "starts a new native session and does not remember the earlier conversation";
  const lead =
    failureClass === "infrastructure"
      ? `A technical session error ended attempt ${failed} of ${total}. This attempt ${mode}. ${EFFECTS}`
      : `Pages returned this step to you after attempt ${failed} of ${total}. This attempt ${mode}. ${EFFECTS} Repair exactly what follows, then finish with the complete closing report.`;
  return [
    "## Pages automatic session retry",
    "",
    lead,
    ...(failureClass === "infrastructure"
      ? []
      : ["", concreteError(last.code, last.issues ?? [])]),
    "",
    "",
  ].join("\n");
}
