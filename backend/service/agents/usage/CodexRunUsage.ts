import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import { attemptUsageEstimate } from "../sessions/AgentSessionUsage";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { AgentSessionUsageEstimate } from "@/definition/AgentSessionPricing";
import type { TurnValuation } from "../sessions/AgentSessionUsage";
import type {
  CodexRunUsage,
  CodexUsageSummary,
  CodexTokenCounts,
} from "@/definition/CodexPlanUsage";

/**
 * The valuation the Codex accounting stored with a turn.
 * @remarks
 * A turn without a model has no price, whatever its record says.
 */
function codexTurnValuation(turn: AgentSessionTurnUsage): TurnValuation {
  const price = turn.accounting?.price;
  return {
    amountUsd: turn.model === null ? null : (turn.accounting?.costUsd ?? null),
    missing: turn.model === null ? "model" : "price",
    priceAsOf: price ? [price.catalogAt] : [],
    priceModels: price ? [price.modelId] : [],
  };
}

/**
 * The tokens one Codex attempt processed and their estimate, for the block
 * "Verbrauch" of the plan terminal.
 * @param turns - Turns of any attempt; only the Codex turns of `attemptId` count.
 * @param attemptId - The selected attempt; another attempt never adds to it.
 * @returns The sums of the attempt's turns with the amount stored with them.
 * @remarks
 * The counts stay Codex's own, so the input contains the cache reads. The
 * amount is the sum of the valuations stored with the turns, at the price
 * frozen for the attempt. A turn that still runs holds its latest interim
 * reading and marks the amount as partial; the counts of its end replace it.
 * Without a turn, with a turn that lacks input or output, or without a price
 * for its model there is no amount.
 */
export function codexAttemptUsage(
  turns: readonly AgentSessionTurnUsage[],
  attemptId: string,
): AgentSessionUsageEstimate {
  return attemptUsageEstimate(
    turns.filter(
      (turn) => turn.provider === "codex_cli" && turn.attemptId === attemptId,
    ),
    codexTurnValuation,
  );
}

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
