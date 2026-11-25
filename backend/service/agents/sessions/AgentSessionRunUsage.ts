import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { codexAttemptUsage } from "../usage/CodexRunUsage";

import { isOpenCodeRunner, listSessionAttempts } from "./AgentSessionAttempts";
import { claudeAttemptUsage, sumTurnUsage } from "./AgentSessionUsage";
import { openCodeAttemptUsage, sumOpenCodeUsage } from "./OpenCodeUsage";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionTurnUsage,
  AgentSessionUsageTotal,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";
import type { StoredOpenCodeUsage } from "./OpenCodeUsage";

/** The attempt of an OpenCode session view and what belongs to it. */
export interface OpenCodeViewSelection {
  readonly attemptId: string;
  /** Every attempt of the selected node in its run. */
  readonly nodeAttempts: ReadonlySet<string>;
  /** Whether a turn of the selected attempt still runs. */
  readonly isRunning: boolean;
}

/** The usage of the selected attempt under the field of its provider. */
export type SelectedAttemptUsage = Pick<
  AgentSessionView,
  "codexAttemptUsage" | "claudeAttemptUsage"
>;

/**
 * The usage of a Codex or Claude Code attempt for the block "Verbrauch" of
 * the plan terminal.
 * @param runner - The provider of the attempt.
 * @param turns - Turns of any attempt; only those of `attemptId` count.
 * @param attemptId - The selected attempt.
 * @returns The usage under the field of its provider, or `null` for a
 * provider whose usage is read another way.
 */
export function selectedAttemptUsage(
  runner: string,
  turns: readonly AgentSessionTurnUsage[],
  attemptId: string,
): SelectedAttemptUsage | null {
  if (runner === "codex_cli")
    return { codexAttemptUsage: codexAttemptUsage(turns, attemptId) };
  if (runner === "claude_code")
    return { claudeAttemptUsage: claudeAttemptUsage(turns, attemptId) };
  return null;
}

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

/**
 * Every attempt of a native OpenCode session already started in the run,
 * including loop iterations.
 * @param run - The run whose nodes are searched.
 * @returns The attempts of OpenCode nodes and of the nodes of an OpenRouter
 * connection, which run on OpenCode and report the same model steps.
 */
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
      return session?.attemptId && isOpenCodeRunner(session.runner)
        ? [...nodeAttemptIds(session.attemptId, session)]
        : [];
    }),
  );
}

/**
 * The native usage of an OpenCode session view: the selected attempt for the
 * block "Verbrauch" of the plan terminal, and the sums of its node and run.
 * @param run - The run of the session.
 * @param messages - The native messages of every attempt of the run.
 * @param selection - The selected attempt and its node.
 * @returns The three views; a message counts once in each.
 */
export function openCodeUsageView(
  run: AgentPlanRun,
  messages: readonly StoredOpenCodeUsage[],
  selection: OpenCodeViewSelection,
): Required<Pick<AgentSessionView, "openCode" | "openCodeAttemptUsage">> {
  const { attemptId, nodeAttempts, isRunning } = selection;
  return {
    openCode: {
      step: sumOpenCodeUsage(
        messages.filter((message) => nodeAttempts.has(message.attemptId)),
        nodeAttempts,
      ),
      run: sumOpenCodeUsage(messages, runOpenCodeAttemptIds(run)),
    },
    openCodeAttemptUsage: openCodeAttemptUsage(messages, attemptId, isRunning),
  };
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
