import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { stepAttemptId, stepTimes } from "./RunFailures";

import type { RunActivity } from "@/backend/database/repositories/diagnosis/AgentRunActivityRepository";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentRunStalledStep,
  AgentRunTimelineEntry,
} from "@/definition/AgentRunDiagnosis";

interface StepPlace {
  readonly loopId: string | null;
  readonly iteration: number | null;
}

interface TimelineContext {
  readonly run: AgentPlanRun;
  readonly activity: RunActivity;
  readonly now: number;
  readonly stallMs: number;
}

type EntryDraft = Pick<
  AgentRunTimelineEntry,
  "attemptId" | "event" | "at" | "durationMs" | "reason"
>;

function milliseconds(from: string | null, to: string | null): number | null {
  if (from === null || to === null) return null;
  const difference = Date.parse(to) - Date.parse(from);
  return Number.isFinite(difference) && difference >= 0 ? difference : null;
}

/** The earlier failed attempts of a step and the waits between them. */
function retryEntries(
  step: AgentPlanStepResult,
  currentAttemptId: string,
): readonly EntryDraft[] {
  const attempts = step.session?.retry?.attempts ?? [];
  return attempts.flatMap((attempt, index) => {
    const attemptId = attempt.attemptId ?? `${step.id}:${String(index + 1)}`;
    const next = attempts[index + 1];
    const nextId =
      index + 1 < attempts.length
        ? (next?.attemptId ?? `${step.id}:${String(index + 2)}`)
        : currentAttemptId;
    return [
      {
        attemptId,
        event: "failed" as const,
        at: attempt.endedAt,
        durationMs: null,
        reason: attempt.code,
      },
      {
        attemptId: nextId,
        event: "retrying" as const,
        at: attempt.endedAt,
        durationMs: null,
        reason: attempt.code,
      },
    ];
  });
}

function waitReason(
  step: AgentPlanStepResult,
  run: AgentPlanRun,
  isFirstWaiting: boolean,
): string | null {
  const retry = step.session?.retry;
  if (retry?.state === "waiting")
    return retry.nextAttemptAt
      ? `${retry.reason}; next attempt ${retry.nextAttemptAt}`
      : retry.reason;
  if (
    isFirstWaiting &&
    run.isWaitingForWorkspace &&
    step.status === "waiting" &&
    !step.isBlocked
  )
    return `workspace_busy: ${run.workspaceWait?.reason ?? "reserved"}`;
  return null;
}

function currentEntries(
  step: AgentPlanStepResult,
  attemptId: string,
  context: TimelineContext & { readonly isFirstWaiting: boolean },
): readonly EntryDraft[] {
  const { run } = context;
  const { startedAt, endedAt } = stepTimes(step);
  const prior = step.session?.retry?.attempts.at(-1)?.endedAt ?? null;
  const entries: EntryDraft[] = [];
  const reason = waitReason(step, run, context.isFirstWaiting);
  if (reason !== null)
    entries.push({
      attemptId,
      event: "waiting",
      at: prior ?? startedAt ?? run.startedAt,
      durationMs: null,
      reason,
    });
  entries.push(...startEntries(step, attemptId, { startedAt, run }));
  entries.push(...finalEntry(step, attemptId, { startedAt, endedAt, run }));
  return entries;
}

/** The start of the attempt, preceded by the resume that let it begin after a pause. */
function startEntries(
  step: AgentPlanStepResult,
  attemptId: string,
  times: { readonly startedAt: string | null; readonly run: AgentPlanRun },
): readonly EntryDraft[] {
  const { startedAt, run } = times;
  const pausedAt = run.pauseBoundary?.pausedAt;
  const entries: EntryDraft[] = [];
  if (pausedAt !== undefined && startedAt !== null && pausedAt < startedAt)
    entries.push({
      attemptId,
      event: "resumed",
      at: startedAt,
      durationMs: milliseconds(pausedAt, startedAt),
      reason: "run_paused",
    });
  if (startedAt !== null)
    entries.push({
      attemptId,
      event: "started",
      at: startedAt,
      durationMs: null,
      reason: null,
    });
  if (step.status === "paused")
    entries.push({
      attemptId,
      event: "paused",
      at: pausedAt ?? startedAt ?? run.startedAt,
      durationMs: null,
      reason: "run_paused",
    });
  return entries;
}

function finalEntry(
  step: AgentPlanStepResult,
  attemptId: string,
  times: {
    readonly startedAt: string | null;
    readonly endedAt: string | null;
    readonly run: AgentPlanRun;
  },
): readonly EntryDraft[] {
  const event =
    step.status === "succeeded" ||
    step.status === "failed" ||
    step.status === "cancelled"
      ? step.status
      : null;
  if (event === null) return [];
  // An old record without times still shows how the step ended, at the latest known time.
  const at =
    times.endedAt ??
    times.run.endedAt ??
    times.startedAt ??
    times.run.startedAt;
  return [
    {
      attemptId,
      event,
      at,
      durationMs: milliseconds(times.startedAt, at),
      reason: event === "failed" ? step.error : null,
    },
  ];
}

function lastSignOfLife(
  step: AgentPlanStepResult,
  attemptId: string,
  activity: RunActivity,
): string | null {
  const candidates = [
    stepTimes(step).startedAt,
    activity.attemptEvents.get(attemptId),
    activity.attemptLogs.get(attemptId),
    activity.stepProgress.get(step.id),
    step.session?.activity?.reportedAt,
  ].filter((time): time is string => typeof time === "string");
  return candidates.sort().at(-1) ?? null;
}

function stalledStep(
  step: AgentPlanStepResult,
  attemptId: string,
  context: TimelineContext,
): AgentRunStalledStep | null {
  if (step.status !== "running" || !isActivePlanRun(context.run.status))
    return null;
  if (context.run.status === "paused") return null;
  const lastEventAt = lastSignOfLife(step, attemptId, context.activity);
  if (lastEventAt === null) return null;
  const stalledForMs = context.now - Date.parse(lastEventAt);
  return stalledForMs >= context.stallMs
    ? { stepId: step.id, attemptId, lastEventAt, stalledForMs }
    : null;
}

/** Every step result of a run with the place it has in the plan. */
function placedSteps(run: AgentPlanRun): readonly {
  readonly step: AgentPlanStepResult;
  readonly place: StepPlace;
}[] {
  const loops = run.loops ?? [];
  const loopIds = new Set(loops.map((loop) => loop.id));
  return [
    ...run.steps
      .filter((step) => !loopIds.has(step.id))
      .map((step) => ({ step, place: { loopId: null, iteration: null } })),
    ...loops.flatMap((loop) =>
      loop.iterations.flatMap((iteration) =>
        iteration.nodes.map((step) => ({
          step,
          place: { loopId: loop.id, iteration: iteration.number },
        })),
      ),
    ),
  ];
}

/**
 * Builds the timeline of a run: each step and attempt with what happened and when.
 *
 * @param run - The run as the reader may see it.
 * @param activity - The signs of life stored for the run.
 * @param options - The current time and how long a step may stay silent.
 * @returns The entries in time order and the steps without progress.
 */
export function buildRunTimeline(
  run: AgentPlanRun,
  activity: RunActivity,
  options: { readonly now: number; readonly stallMs: number },
): {
  readonly entries: readonly AgentRunTimelineEntry[];
  readonly stalled: readonly AgentRunStalledStep[];
} {
  const context: TimelineContext = { run, activity, ...options };
  const entries: AgentRunTimelineEntry[] = [];
  const stalled: AgentRunStalledStep[] = [];
  let hasWaiting = false;
  for (const { step, place } of placedSteps(run)) {
    const attemptId = stepAttemptId(step) ?? `${step.id}:current`;
    const isFirstWaiting: boolean = !hasWaiting && step.status === "waiting";
    hasWaiting ||= isFirstWaiting;
    const drafts = [
      ...retryEntries(step, attemptId),
      ...currentEntries(step, attemptId, { ...context, isFirstWaiting }),
    ];
    for (const draft of drafts)
      entries.push({
        stepId: step.id,
        stepLabel: step.name,
        ...place,
        ...draft,
      });
    const silent = stalledStep(step, attemptId, context);
    if (silent) stalled.push(silent);
  }
  return {
    entries: entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (left, right) =>
          left.entry.at.localeCompare(right.entry.at) ||
          left.index - right.index,
      )
      .map(({ entry }) => entry),
    stalled,
  };
}
