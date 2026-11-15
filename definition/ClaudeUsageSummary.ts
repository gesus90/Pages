import { allPlanRunResults } from "./AgentPlanLoopResults";
import { sessionAttemptId } from "./AgentSessionJournal";

import type { AgentSessionTurnUsage } from "./AgentSessionJournal";
import type { AgentPlanRun } from "./AgentPlan";
import type {
  ClaudeRunUsage,
  ClaudeTokens,
  ClaudeUsageSummary,
} from "./ClaudeUsage";

const FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

/** Sums known measurements and preserves missing usage and unknown prices separately. */
export function summarizeClaudeUsage(
  turns: readonly AgentSessionTurnUsage[],
): ClaudeUsageSummary {
  const unique = new Map(
    turns
      .filter((turn) => turn.provider === "claude_code")
      .map((turn) => [`${turn.attemptId}:${turn.turn}`, turn]),
  );
  const entries = [...unique.values()];
  const sum = (field: keyof ClaudeTokens): number | null => {
    const known = entries.flatMap((entry) =>
      entry[field] === null ? [] : [entry[field]],
    );
    return known.length === 0
      ? null
      : known.reduce((total, count) => total + count, 0);
  };
  const costs = entries.flatMap((entry) =>
    entry.claudeAccounting?.costUsd == null
      ? []
      : [entry.claudeAccounting.costUsd],
  );
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    costUsd:
      costs.length === 0
        ? null
        : costs.reduce((total, amount) => total + amount, 0),
    subscription: true,
    isIncomplete:
      entries.length === 0 ||
      entries.some(
        (entry) =>
          entry.isPartial || FIELDS.some((field) => entry[field] === null),
      ),
    hasUnknownPrice: entries.some(
      (entry) =>
        entry.totalTokens !== null &&
        (!entry.claudeAccounting ||
          entry.claudeAccounting.models.some((model) => model.price === null)),
    ),
  };
}

/** Includes every loop iteration and retry once, and marks attempts with no reported usage incomplete. */
export function claudeRunUsage(
  run: AgentPlanRun,
  turns: readonly AgentSessionTurnUsage[],
): ClaudeRunUsage | null {
  const attempts = new Map<string, string>();
  for (const step of allPlanRunResults(run)) {
    const record = step.session;
    if (record?.runner !== "claude_code") continue;
    attempts.set(sessionAttemptId(record, step.id), step.name);
    for (const retry of record.retry?.attempts ?? [])
      if (retry.attemptId) attempts.set(retry.attemptId, step.name);
  }
  for (const turn of turns)
    if (turn.provider === "claude_code" && !attempts.has(turn.attemptId))
      attempts.set(turn.attemptId, turn.model ?? "Claude");
  if (attempts.size === 0) return null;
  const steps = [...attempts].map(([attemptId, name]) => ({
    attemptId,
    name,
    usage: summarizeClaudeUsage(
      turns.filter((turn) => turn.attemptId === attemptId),
    ),
  }));
  const total = summarizeClaudeUsage(turns);
  return {
    steps,
    total: {
      ...total,
      isIncomplete:
        total.isIncomplete || steps.some((step) => step.usage.isIncomplete),
    },
  };
}
