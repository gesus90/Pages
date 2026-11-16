import { canonicalClaudeModel } from "@/definition/ClaudePriceModels";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { AgentSessionAttemptRecord } from "./AgentSessionStore";
import type { TurnTokenDelta } from "./AgentSessionUsage";

function promptModel(attempt: AgentSessionAttemptRecord): string | null {
  return attempt.provider === "claude_code"
    ? (attempt.confirmedModel.value ?? attempt.requestedModel ?? null)
    : attempt.confirmedModel.value;
}

interface BuildPromptUsageOptions {
  readonly attempt: AgentSessionAttemptRecord;
  readonly turn: number;
  readonly delta: TurnTokenDelta | null;
  readonly nativeSessionId: string | undefined;
  readonly reportedAt: string;
}

/** Builds the recorded turn usage entry for one finished or interrupted prompt. */
export function buildPromptUsage({
  attempt,
  turn,
  delta,
  nativeSessionId,
  reportedAt,
}: BuildPromptUsageOptions): AgentSessionTurnUsage {
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
