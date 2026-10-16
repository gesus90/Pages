import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { classifyOpenCodeFailure } from "@/backend/agents/acp/OpenCodeAcpErrors";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { ProviderCheckOutcome } from "@/backend/agents/providers/ProviderContracts";

/** Looks for known CLI failure markers without exposing the original text. */
export function classifyCliFailure(payload: unknown): AgentErrorCode {
  const encoded = JSON.stringify(payload);
  if (
    /\b401\b|not logged in|unauthori[sz]ed|authentication[_ ]error/i.test(
      encoded,
    )
  )
    return "cli_auth_failed";
  if (/usage limit|quota|insufficient_quota/i.test(encoded))
    return "provider_quota_exhausted";
  if (/\b429\b|rate[_ ]limit/i.test(encoded)) return "provider_rate_limited";
  return "cli_check_failed";
}

/** JSONL completion is proof of a Codex turn; the process exit code alone is not. */
export function readCodexTest(output: string): ProviderCheckOutcome {
  let completed: Record<string, unknown> | null = null;
  let failure: AgentErrorCode | null = null;
  try {
    for (const line of output
      .split("\n")
      .filter((candidate) => candidate.trim() !== "")) {
      const parsed: unknown = JSON.parse(line);
      const event = readAgentObject(parsed);
      if (event.type === "turn.completed")
        completed = readAgentObject(event.usage);
      if (event.type === "turn.failed" || event.type === "error")
        failure = classifyCliFailure(event);
    }
  } catch {
    return { ok: false, errorCode: "cli_unexpected_output", detail: {} };
  }
  if (failure !== null || completed === null)
    return { ok: false, errorCode: failure ?? "cli_check_failed", detail: {} };
  return {
    ok: true,
    detail: sanitizeCheckDetail({
      inputTokens: completed.input_tokens,
      outputTokens: completed.output_tokens,
    }),
  };
}

/** Claude may exit zero with is_error:true, so only its success result is accepted. */
export function readClaudeTest(output: string): ProviderCheckOutcome {
  let result: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(output);
    result = readAgentObject(parsed);
  } catch {
    return { ok: false, errorCode: "cli_unexpected_output", detail: {} };
  }
  if (result.is_error !== false || result.subtype !== "success")
    return { ok: false, errorCode: classifyCliFailure(result), detail: {} };
  const usage = readAgentObject(result.usage);
  const models = Object.keys(readAgentObject(result.modelUsage));
  return {
    ok: true,
    detail: sanitizeCheckDetail({
      model: models[0],
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costUsd: result.total_cost_usd,
    }),
  };
}

/** A finished OpenCode step with text is proof of a turn; the exit code alone is not. */
export function readOpenCodeTest(output: string): ProviderCheckOutcome {
  let finished: Record<string, unknown> | null = null;
  let failure: AgentErrorCode | null = null;
  let hasText = false;
  try {
    for (const line of output
      .split("\n")
      .filter((candidate) => candidate.trim() !== "")) {
      const parsed: unknown = JSON.parse(line);
      const event = readAgentObject(parsed);
      const part = readAgentObject(event.part);
      if (event.type === "error") {
        const classified = classifyOpenCodeFailure(JSON.stringify(event));
        failure =
          classified === "opencode_acp_session_failed"
            ? classifyCliFailure(event)
            : classified;
      }
      if (event.type === "text" && typeof part.text === "string")
        hasText = hasText || part.text.trim() !== "";
      if (event.type === "step_finish" && part.reason === "stop")
        finished = part;
    }
  } catch {
    return { ok: false, errorCode: "cli_unexpected_output", detail: {} };
  }
  if (failure !== null || finished === null || !hasText)
    return { ok: false, errorCode: failure ?? "cli_check_failed", detail: {} };
  const tokens = readAgentObject(finished.tokens);
  return {
    ok: true,
    detail: sanitizeCheckDetail({
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      costUsd: finished.cost,
    }),
  };
}
