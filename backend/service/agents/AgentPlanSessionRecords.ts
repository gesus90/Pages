import { randomUUID } from "node:crypto";

import { isAcpProvider } from "@/definition/AgentConfiguration";

import { sanitizePlanOutput } from "./AgentPlanOutput";

import type {
  PlanSessionClosed,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { ResolvedAgentAssignment } from "./AgentAssignmentResolution";
import type {
  AgentPlanContract,
  AgentPlanSessionRecord,
} from "@/definition/AgentPlanSession";
import type { NodeRun } from "./AgentPlanStepContext";
import type { PreparedPlanStep } from "./AgentPlanStepStart";

const RUNNER_LABELS: Readonly<Record<CliProviderId, string>> = {
  codex_cli: "Codex CLI over ACP",
  claude_code: "Claude Code over ACP",
  opencode: "OpenCode over native ACP",
  antigravity: "Google Antigravity over official ACP",
};

/** What a new record of a node is built from. */
export interface SessionRecordStart {
  readonly instanceId: string;
  readonly attemptId?: string;
  readonly prepared: PreparedPlanStep;
  readonly contract: AgentPlanContract | null;
  readonly usesMcp: boolean;
}

// Every CLI plan session stays open until Pages confirms its closeout.
function sessionMode(
  provider: ResolvedAgentAssignment["connection"]["provider"],
): AgentPlanSessionRecord["mode"] {
  if (isAcpProvider(provider)) return "interactive";
  return "request";
}

function connectionOf(agent: ResolvedAgentAssignment): {
  readonly connectionId: string;
  readonly connectionName: string;
} {
  return {
    connectionId: agent.connection.id,
    connectionName: agent.connection.name,
  };
}

/**
 * Creates the record of a node before anything starts.
 *
 * @param start - Instance, prepared input, contract and MCP use of the node.
 * @returns A record whose requested configuration and contract are fixed.
 */
export function createSessionRecord(
  start: SessionRecordStart,
): AgentPlanSessionRecord {
  const { agent, directory } = start.prepared.input;
  const provider = agent.connection.provider;
  const isRequest = !isAcpProvider(provider);
  return {
    runner: isRequest ? "api" : provider,
    mode: sessionMode(provider),
    instanceId: start.instanceId,
    attemptId: start.attemptId ?? randomUUID(),
    sessionId: null,
    processId: null,
    startedAt: null,
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: isRequest ? "not_needed" : "pending",
    leftoverProcesses: null,
    resultCode: null,
    requested: {
      runner: isRequest ? "api" : provider,
      ...connectionOf(agent),
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      options: start.prepared.options,
      unattended: isRequest ? "request without tools" : "pending",
      mcp: start.usesMcp,
      directory: isRequest ? null : directory,
    },
    effective: null,
    definition: start.prepared.definition,
    contract: start.contract,
    acceptance: null,
    events: [],
  };
}

/** The runner as people read it, such as "Claude Code". */
export function runnerLabel(record: AgentPlanSessionRecord): string {
  return record.runner === "api" ? "API request" : RUNNER_LABELS[record.runner];
}

/** Adds what the turn reported, redacted, to the record. */
export function withTurn(
  record: AgentPlanSessionRecord,
  turn: PlanSessionTurn,
): AgentPlanSessionRecord {
  return {
    ...record,
    ...(turn.providerFailure ? { providerFailure: turn.providerFailure } : {}),
    sessionId: turn.sessionId ?? record.sessionId,
    turnEndedAt: turn.endedAt,
    effective: Object.fromEntries(
      Object.entries({ ...record.effective, ...turn.effective }).map(
        ([key, value]) => [key, sanitizePlanOutput(value).slice(0, 2_000)],
      ),
    ),
    events: turn.events.map((line) => sanitizePlanOutput(line)),
  };
}

/**
 * Names a technical turn failure, independently of reported work progress.
 *
 * @param turn - How the turn ended.
 */
export function turnFailureCode(
  turn: PlanSessionTurn,
): AgentErrorCode | "timeout" | null {
  if (turn.failure === "timeout") return "timeout";
  if (turn.errorCode !== null) return turn.errorCode;
  if (turn.permissionDenials > 0) return "plan_runner_permission_denied";
  if (turn.failure === "incomplete") return "plan_runner_incomplete";
  return turn.failure === null ? null : "plan_runner_failed";
}

/** Names a process or cleanup failure; a confirmed cleanup alone does not prove a clean exit. */
export function closeoutFailureCode(
  closed: PlanSessionClosed,
): AgentErrorCode | null {
  if (!closed.isConfirmed) return "plan_closeout_failed";
  return closed.exit !== null &&
    closed.exit.code === 0 &&
    closed.exit.signal === null
    ? null
    : "plan_runner_failed";
}

/** The fields of a record that a closed session settles: its exit, cleanup and result code. */
export function closedSessionChanges(
  closed: PlanSessionClosed,
): Partial<AgentPlanSessionRecord> {
  return {
    exit: closed.exit,
    endedAt: closed.endedAt,
    closeout: closed.isConfirmed ? "confirmed" : "failed",
    containment: closed.isConfirmed ? closed.containment : undefined,
    leftoverProcesses: closed.leftovers,
    resultCode: closeoutFailureCode(closed) === null ? 0 : -1,
  };
}

/** Combines the runner turn and its actual closeout without consulting business diagnostics. */
export function failureCode(
  turn: PlanSessionTurn,
  closed: PlanSessionClosed,
): AgentErrorCode | "timeout" | null {
  return turnFailureCode(turn) ?? closeoutFailureCode(closed);
}

/** Identifies a deadline separately from an explicit user stop. */
export function hasPlanStepTimedOut(signal: AbortSignal): boolean {
  return (
    signal.aborted &&
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError"
  );
}

/** A runner cancellation is confirmed only after cleanup and never for a timeout. */
export function isConfirmedPlanCancellation(
  turn: PlanSessionTurn,
  closed: PlanSessionClosed,
  signal: AbortSignal,
): boolean {
  return (
    turn.failure === "cancelled" &&
    !hasPlanStepTimedOut(signal) &&
    closed.isConfirmed
  );
}

/** Combines deadline, turn and cleanup without inferring business acceptance. */
export function planCompletedFailure(
  turn: PlanSessionTurn,
  closed: PlanSessionClosed,
  signal: AbortSignal,
): string | null {
  if (!closed.isConfirmed) return "plan_closeout_failed";
  return hasPlanStepTimedOut(signal) ? "timeout" : failureCode(turn, closed);
}

/** Reuses the snapshot's initial attempt once; retries and loop turns retain their own fresh identities. */
export function initialStepAttemptId(node: NodeRun): string | undefined {
  if (node.retry || node.loop) return undefined;
  return node.run.steps.find((entry) => entry.id === node.step.step.id)
    ?.execution?.attemptId;
}
