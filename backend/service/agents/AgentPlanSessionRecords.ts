import { sanitizePlanOutput } from "./AgentPlanOutput";

import type {
  PlanSessionClosed,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { CliProviderId } from "@/definition/AgentConnection";
import type { ResolvedAgentAssignment } from "./AgentAssignmentResolution";
import type {
  AgentPlanAcceptance,
  AgentPlanContract,
  AgentPlanSessionRecord,
} from "@/definition/AgentPlanSession";
import type { PreparedPlanStep } from "./AgentPlanStepStart";

const RUNNER_LABELS: Readonly<Record<CliProviderId, string>> = {
  codex_cli: "Codex CLI over ACP",
  claude_code: "Claude Code over ACP",
  opencode: "OpenCode",
};

/** What a new record of a node is built from. */
export interface SessionRecordStart {
  readonly instanceId: string;
  readonly prepared: PreparedPlanStep;
  readonly contract: AgentPlanContract | null;
  readonly usesMcp: boolean;
}

// The ACP sessions of Codex and Claude Code stay open until Pages closes them; OpenCode ends with its turn.
function sessionMode(
  provider: ResolvedAgentAssignment["connection"]["provider"],
): AgentPlanSessionRecord["mode"] {
  if (provider === "claude_code" || provider === "codex_cli")
    return "interactive";
  if (provider === "opencode") return "one_shot";
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
  const isRequest =
    provider !== "codex_cli" &&
    provider !== "claude_code" &&
    provider !== "opencode";
  return {
    runner: isRequest ? "api" : provider,
    mode: sessionMode(provider),
    instanceId: start.instanceId,
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
 * Names why a node did not succeed, or `null` when it did.
 *
 * @param turn - How the turn ended.
 * @param acceptance - The verdict on the closing report, when there was one.
 * @param closed - The actual process exit and confirmation that nothing is left.
 */
export function failureCode(
  turn: PlanSessionTurn,
  acceptance: AgentPlanAcceptance | null,
  closed: PlanSessionClosed,
): AgentErrorCode | "timeout" | null {
  if (turn.failure === "timeout") return "timeout";
  if (turn.errorCode !== null) return turn.errorCode;
  const isDenied = turn.permissionDenials > 0;
  if (turn.failure === "failed")
    return isDenied ? "plan_runner_permission_denied" : "plan_runner_failed";
  if (turn.failure === "incomplete")
    return isDenied
      ? "plan_runner_permission_denied"
      : "plan_runner_incomplete";
  if (acceptance?.verdict !== "accepted")
    return isDenied
      ? "plan_runner_permission_denied"
      : "plan_acceptance_failed";
  if (!closed.isConfirmed) return "plan_closeout_failed";
  return closed.exit !== null &&
    closed.exit.code === 0 &&
    closed.exit.signal === null
    ? null
    : "plan_runner_failed";
}
