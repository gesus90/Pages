import { readAgentObject } from "@/backend/agents/AgentPayload";
import { providerResetTimestamp } from "@/backend/agents/providers/ProviderReset";
import { AgentError } from "@/backend/error/AgentErrors";
import { CLAUDE_QUOTA_WINDOWS, readClaudePlan } from "@/definition/ClaudeQuota";

import type {
  ClaudePlan,
  ClaudeQuotaWindow,
  ClaudeQuotaWindowKind,
} from "@/definition/ClaudeQuota";

/** The request id under which Pages asks the CLI for its `/usage` data. */
export const CLAUDE_USAGE_REQUEST_ID = "pages-usage";

/**
 * What one `/usage` query of a Claude connection answered.
 * @remarks
 * `windows` is `null` when the CLI had no plan limits to report, such as for
 * a sign-in without a claude.ai subscription; otherwise it holds exactly the
 * windows the usage endpoint reported, and a missing window is absent.
 */
export interface ClaudeUsageReading {
  readonly plan: ClaudePlan | null;
  readonly windows: readonly ClaudeQuotaWindow[] | null;
}

function unexpected(): AgentError {
  return new AgentError("cli_unexpected_output");
}

function readLine(line: string): Record<string, unknown> {
  try {
    return readAgentObject(JSON.parse(line));
  } catch {
    // The CLI may print other lines; only control responses count.
    return {};
  }
}

function isUsageResponse(entry: Record<string, unknown>): boolean {
  return (
    entry.type === "control_response" &&
    readAgentObject(entry.response).request_id === CLAUDE_USAGE_REQUEST_ID
  );
}

/**
 * Whether a line of the CLI output is its answer to the usage request.
 * @param line - One stream-json line.
 */
export function isClaudeUsageAnswer(line: string): boolean {
  return isUsageResponse(readLine(line));
}

/**
 * Reads one window of the usage endpoint.
 * @remarks
 * The endpoint reports `utilization` in percent (0 to 100) and `resets_at`
 * as an ISO time; a window without both figures is not reported.
 */
function readWindow(
  kind: ClaudeQuotaWindowKind,
  reported: unknown,
): ClaudeQuotaWindow | null {
  const window = readAgentObject(reported);
  const { utilization } = window;
  const resetsAt = providerResetTimestamp(window.resets_at);
  if (typeof utilization !== "number" || !Number.isFinite(utilization))
    return null;
  if (resetsAt === null) return null;
  const clamped = Math.min(100, Math.max(0, utilization));
  // Two decimals keep the share exact enough without float residue.
  return { kind, usedPercentage: Math.round(clamped * 100) / 100, resetsAt };
}

/**
 * Reads the answer of the CLI to the `get_usage` control request.
 * @param stdout - The stream-json output of the CLI.
 * @returns The subscription and the plan windows the endpoint reported.
 * @throws {AgentError} `cli_unexpected_output` when the CLI did not answer
 * the request successfully, `claude_usage_stale` when it answered with its
 * stored copy because the usage endpoint failed.
 */
export function readClaudeUsage(stdout: string): ClaudeUsageReading {
  const message = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(readLine)
    .find(isUsageResponse);
  const response = readAgentObject(message?.response);
  if (response.subtype !== "success") throw unexpected();
  const usage = readAgentObject(response.response);
  const plan = readClaudePlan(usage.subscription_type);
  if (
    usage.rate_limits === null ||
    typeof usage.rate_limits !== "object" ||
    Array.isArray(usage.rate_limits)
  )
    return { plan, windows: null };
  const rateLimits = readAgentObject(usage.rate_limits);
  // Claude Code answers a failed endpoint call from its stored copy and then
  // leaves out the `limits` rows; such figures are not current.
  if (!Array.isArray(rateLimits.limits))
    throw new AgentError("claude_usage_stale");
  const windows = CLAUDE_QUOTA_WINDOWS.map((kind) =>
    readWindow(kind, rateLimits[kind]),
  ).filter((window): window is ClaudeQuotaWindow => window !== null);
  return { plan, windows };
}
