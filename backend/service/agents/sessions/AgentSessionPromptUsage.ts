import { canonicalClaudeModel } from "@/definition/ClaudePriceModels";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { AgentSessionAttemptRecord } from "./AgentSessionStore";
import type { TurnTokenDelta } from "./AgentSessionUsage";

/** What the usage record of a prompt that ended is built from. */
export interface PromptUsageInput {
  readonly attempt: AgentSessionAttemptRecord;
  readonly turn: number;
  readonly delta: TurnTokenDelta | null;
  readonly nativeSessionId: string | undefined;
  readonly reportedAt: string;
}

/**
 * Builds the usage record of the prompt that ended in a turn.
 *
 * @param input - The attempt, its turn, the counted tokens and the native session.
 * @returns The record to persist; without tokens it is marked as partial.
 */
export function buildPromptUsage(
  input: PromptUsageInput,
): AgentSessionTurnUsage {
  const { attempt, turn, delta, nativeSessionId, reportedAt } = input;
  const { provider, key } = attempt;
  const model = promptModel(attempt);
  return {
    ...(delta?.tokens ?? {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalTokens: null,
      inputIncludesCache: provider === "antigravity" ? null : false,
      isPartial: true,
    }),
    ...(provider === "claude_code" && nativeSessionId && delta
      ? {
          claudeObservation: {
            sessionId: nativeSessionId,
            id: `${key.attemptId}:${turn}`,
            kind: "prompt" as const,
            models: [
              {
                model: canonicalClaudeModel(model ?? "unknown"),
                inputTokens: delta.tokens.inputTokens,
                outputTokens: delta.tokens.outputTokens,
                cacheReadTokens: delta.tokens.cacheReadTokens,
                cacheWriteTokens: delta.tokens.cacheWriteTokens,
              },
            ],
          },
        }
      : {}),
    attemptId: key.attemptId,
    turn,
    provider,
    model:
      provider === "codex_cli"
        ? (model ?? attempt.requestedModel ?? null)
        : model,
    ...(provider === "codex_cli"
      ? {
          codex: {
            connectionId: attempt.connectionId ?? "",
            agentId: attempt.agentId ?? "",
            report: null,
          },
        }
      : {}),
    reportedAt,
  };
}

/**
 * Names the model a prompt ran on, preferring the model the provider confirmed.
 *
 * @param attempt - The attempt whose prompt ended.
 * @returns The model name, or `null` when none is known.
 */
function promptModel(attempt: AgentSessionAttemptRecord): string | null {
  return attempt.provider === "claude_code"
    ? (attempt.confirmedModel.value ?? attempt.requestedModel ?? null)
    : attempt.confirmedModel.value;
}
