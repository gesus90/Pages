import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { listSessionAttempts } from "./AgentSessionAttempts";
import { sumTurnUsage } from "./AgentSessionUsage";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionTurnUsage,
  AgentSessionUsageTotal,
} from "@/definition/AgentSessionJournal";

/** Every attempt of the node in its run, including recorded retries. */
export function nodeAttemptIds(
  attemptId: string,
  record: AgentPlanSessionRecord,
): ReadonlySet<string> {
  return new Set([
    attemptId,
    ...(record.retry?.attempts ?? []).flatMap((entry) =>
      entry.attemptId ? [entry.attemptId] : [],
    ),
  ]);
}

/** Every OpenCode attempt already started in the run, including loop iterations. */
/** Finds OpenCode attempts throughout the run. */
export function runOpenCodeAttemptIds(run: AgentPlanRun): ReadonlySet<string> {
  const nodes = [
    ...run.steps,
    ...(run.loops ?? []).flatMap((loop) =>
      loop.iterations.flatMap((iteration) => iteration.nodes),
    ),
  ];
  return new Set(
    nodes.flatMap((node) => {
      const session = node.session;
      return session?.runner === "opencode" && session.attemptId
        ? [...nodeAttemptIds(session.attemptId, session)]
        : [];
    }),
  );
}

/** Collects Antigravity attempts and confirmed models. */
export function antigravityAttempts(
  run: AgentPlanRun,
  stepId: string,
): {
  readonly stepAttempts: ReadonlySet<string>;
  readonly runAttempts: ReadonlySet<string>;
  readonly confirmedModels: ReadonlyMap<string, string>;
} {
  const attempts = listSessionAttempts(run).filter(
    (attempt) => attempt.record.runner === "antigravity",
  );
  return {
    confirmedModels: new Map(
      attempts.flatMap((attempt) => {
        const model = attempt.record.effective?.model;
        return model ? [[attempt.key.attemptId, model] as const] : [];
      }),
    ),
    stepAttempts: new Set(
      attempts
        .filter((attempt) => attempt.key.stepId === stepId)
        .flatMap((attempt) => [
          ...nodeAttemptIds(attempt.key.attemptId, attempt.record),
        ]),
    ),
    runAttempts: new Set(
      attempts.flatMap((attempt) => [
        ...nodeAttemptIds(attempt.key.attemptId, attempt.record),
      ]),
    ),
  };
}

/** Summarizes reported OpenRouter usage for the run. */
export function openRouterRunSummary(
  run: AgentPlanRun,
  runTurns: readonly AgentSessionTurnUsage[],
): {
  readonly openRouterRunTotal: AgentSessionUsageTotal | null;
  readonly isOpenRouterRunIncomplete: boolean;
} {
  const openRouterTurns = runTurns.filter((turn) =>
    turn.model?.startsWith("openrouter/"),
  );
  const reportedAttempts = new Set(
    openRouterTurns.map((turn) => turn.attemptId),
  );
  const openRouterAttempts = allPlanRunResults(run).flatMap((step) =>
    step.session?.runner === "opencode" &&
    step.session.requested.model.startsWith("openrouter/")
      ? [step.session.attemptId ?? `${step.session.instanceId}:${step.id}`]
      : [],
  );
  return {
    openRouterRunTotal: sumTurnUsage(openRouterTurns)[0] ?? null,
    isOpenRouterRunIncomplete: openRouterAttempts.some(
      (attemptId) => !reportedAttempts.has(attemptId),
    ),
  };
}
