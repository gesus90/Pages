import { providerResetTimestamp } from "@/backend/agents/providers/ProviderReset";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentProviderFailure } from "@/definition/AgentPlanRetry";

/** A turn the adapter ended with `end_turn` although it carries no model answer. */
export interface AntigravityTurnFailure {
  readonly code: AgentErrorCode;
  /** Set for a quota failure so the plan retry policy can wait for the reset. */
  readonly providerFailure: AgentProviderFailure | null;
}

// The official adapter 1.4.4 reports its failures as ordinary agent text and
// still ends the turn with `end_turn`: its server wraps SDK errors with the
// quota_errors, mcp_errors and api_errors renderings. Pages pins that exact
// adapter version, so these fixed wordings are the reliable failure signal.
// They match at the start of a line, where the adapter appends its report.
const QUOTA =
  /(?:^|\n)Usage Limit Reached\n\nYou have reached your current quota for this period\.(?: Your limit will reset (?:in [^.]+|on (?<moment>[^.]+ UTC))\.)?/u;
const MCP_LOAD = /(?:^|\n)The MCP server '[\w-]+' failed to initialize[:.]/u;
const EXECUTION = /(?:^|\n)Agent execution error: /u;
const CONNECTION =
  /(?:^|\n)Agent connection was lost and could not be re-established: /u;

function quotaFailure(moment: string | undefined): AntigravityTurnFailure {
  const resetAt =
    moment === undefined
      ? null
      : providerResetTimestamp(moment.replace(/ UTC$/u, " GMT"));
  return {
    code: "provider_quota_exhausted",
    providerFailure: { code: "provider_quota_exhausted", resetAt },
  };
}

/**
 * Recognizes a turn whose final message is a failure the adapter reported.
 *
 * @param text - The newest agent message of the turn.
 * @param hasMcp - Whether Pages supplied an MCP server to the session.
 * @returns The failure, or `null` when the text is not an adapter report.
 *
 * @remarks
 * Only fixed adapter wordings are recognized. A clean Google API message
 * without such wording cannot be told from model text, so authentication is
 * additionally proven by the model-free auth check and by the selectors
 * confirmed before every prompt.
 */
export function readAntigravityTurnFailure(
  text: string,
  hasMcp: boolean,
): AntigravityTurnFailure | null {
  const quota = QUOTA.exec(text);
  if (quota) return quotaFailure(quota.groups?.moment);
  if (hasMcp && MCP_LOAD.test(text))
    return { code: "plan_mcp_unavailable", providerFailure: null };
  if (EXECUTION.test(text) || CONNECTION.test(text))
    return { code: "antigravity_acp_session_failed", providerFailure: null };
  return null;
}
