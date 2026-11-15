import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type {
  CodexRunUsage,
  CodexUsageSummary,
  CodexTokenCounts,
} from "@/definition/CodexPlanUsage";

/** Adds normalized counters; unknown reports remain visible as incomplete sums. */
export function sumCodexUsage(
  turns: readonly AgentSessionTurnUsage[],
  hasMissingAttempt = false,
): CodexUsageSummary {
  function sum(field: keyof CodexTokenCounts): number | null {
    const counts = turns.flatMap((turn) =>
      turn[field] == null ? [] : [turn[field]],
    );
    return counts.length
      ? counts.reduce((total, count) => total + count, 0)
      : null;
  }
  const costs = turns.flatMap((turn) =>
    turn.accounting?.costUsd == null ? [] : [turn.accounting.costUsd],
  );
  return {
    inputTokens: sum("inputTokens"),
    cacheReadTokens: sum("cacheReadTokens"),
    outputTokens: sum("outputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    costUsd: costs.length
      ? costs.reduce((total, cost) => total + cost, 0)
      : null,
    isSubscription: true,
    isPartial:
      hasMissingAttempt ||
      turns.length === 0 ||
      turns.some(
        (turn) =>
          turn.isPartial ||
          turn.inputTokens === null ||
          turn.outputTokens === null,
      ),
    isPriceUnknown: turns.some(
      (turn) => turn.inputTokens !== null && !turn.accounting?.price,
    ),
  };
}

/** Includes all journal attempts and loop iterations, even when a retry replaced the current session record. */
export function codexRunUsage(
  run: AgentPlanRun,
  turns: readonly AgentSessionTurnUsage[],
): CodexRunUsage {
  const codexTurns = turns.filter((turn) => turn.provider === "codex_cli");
  const attempts = allPlanRunResults(run).flatMap((step) =>
    step.session?.runner === "codex_cli"
      ? [
          {
            stepId: step.id,
            attemptId: sessionAttemptId(step.session, step.id),
          },
        ]
      : [],
  );
  const stepIds = [
    ...new Set([
      ...attempts.map((entry) => entry.stepId),
      ...codexTurns.flatMap((turn) => (turn.stepId ? [turn.stepId] : [])),
    ]),
  ];
  const steps = stepIds.map((stepId) => {
    const members = attempts.filter((entry) => entry.stepId === stepId);
    const own = codexTurns.filter(
      (turn) =>
        turn.stepId === stepId ||
        members.some((entry) => entry.attemptId === turn.attemptId),
    );
    const missing = members.some(
      (entry) => !own.some((turn) => turn.attemptId === entry.attemptId),
    );
    return { stepId, usage: sumCodexUsage(own, missing) };
  });
  return {
    total: sumCodexUsage(
      codexTurns,
      steps.some((step) => step.usage.isPartial),
    ),
    steps,
  };
}
