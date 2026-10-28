import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type {
  AgentPlanRun,
  AgentPlanStepResult,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type {
  AgentPlanCheckpoint,
  AgentPlanRecoveryExecution,
  AgentPlanRecoveryOption,
  AgentPlanRecoveryView,
} from "@/definition/AgentPlanRecovery";

/** Everything the availability of a restart, resume or release depends on. */
export interface RecoveryFacts {
  readonly run: AgentPlanRun;
  readonly isEngineActive?: boolean;
  readonly plan: AgentPlanView;
  /** The newest run of the plan, by start. */
  readonly latest: AgentPlanRun | null;
  readonly isReserved: boolean;
  readonly checkpoints: readonly AgentPlanCheckpoint[];
  readonly executions: readonly AgentPlanRecoveryExecution[];
  /** The agent nodes of the run's frozen plan, without control nodes. */
  readonly agentStepIds: readonly string[];
  /** The groups of the frozen plan; their summaries are derived, never checkpointed. */
  readonly groupIds: readonly string[];
}

/** What a resume would take over, run again and continue natively. */
export interface ResumePlan {
  /** Verified successful results, taken over unchanged. */
  readonly reused: readonly AgentPlanStepResult[];
  /** Started nodes that run again; their possible effects need a reviewed decision. */
  readonly retriedStepIds: readonly string[];
  /** Successful results whose checkpoint is missing or does not match. */
  readonly unverifiedStepIds: readonly string[];
  /** The native session of each retried agent node or group, where the adapter can resume it. */
  readonly resumeSessions: Readonly<Record<string, string>>;
  /** Whether every retried agent node has such a session. */
  readonly canResumeNatively: boolean;
}

const AVAILABLE: AgentPlanRecoveryOption = { available: true, reason: null };

function blocked(
  reason: NonNullable<AgentPlanRecoveryOption["reason"]>,
): AgentPlanRecoveryOption {
  return { available: false, reason };
}

/** A failed or interrupted node that had started, so its effects are unknown. */
function hasStarted(step: AgentPlanStepResult): boolean {
  return (
    (step.status === "failed" || step.status === "cancelled") &&
    (Boolean(step.session) || step.script !== undefined)
  );
}

/** A loop whose unfinished iteration had started work, so its effects are unknown too. */
function hasStartedLoop(
  loops: readonly AgentPlanLoopRun[] | undefined,
  stepId: string,
): boolean {
  const loop = loops?.find((entry) => entry.id === stepId);
  const unfinished = loop?.iterations.at(-1);
  if (!loop || loop.count === null || unfinished?.status === "succeeded")
    return false;
  return (unfinished?.nodes ?? []).some(
    (node) =>
      node.status !== "succeeded" &&
      (Boolean(node.session) || node.script !== undefined),
  );
}

/** The newest run a restart or resume of this run started, if any. */
export function continuedRun(
  executions: readonly AgentPlanRecoveryExecution[],
): string | null {
  return (
    executions.find((execution) => execution.targetRunId !== null)
      ?.targetRunId ?? null
  );
}

/** A restart needs an ended run and no other active run of the plan. */
export function restartOption(facts: RecoveryFacts): AgentPlanRecoveryOption {
  if (!facts.plan.canEdit) return blocked("plan_read_only");
  if (isActivePlanRun(facts.run.status) || facts.isEngineActive !== false)
    return blocked("run_active");
  if (facts.latest && isActivePlanRun(facts.latest.status))
    return blocked("plan_run_active");
  return AVAILABLE;
}

/**
 * A resume continues only the newest ended, unfinished run of the plan, once.
 *
 * @remarks
 * An explicit stop ends the original run; a reviewed resume starts a new linked run.
 * A successful run has nothing to resume.
 * Uncertain cleanup is settled by the resume itself, or named when it cannot be.
 */
export function resumeOption(
  facts: RecoveryFacts,
  plan: ResumePlan,
): AgentPlanRecoveryOption {
  const restart = restartOption(facts);
  if (!restart.available) return restart;
  const { run } = facts;
  if (run.status === "succeeded") return blocked("succeeded");
  if (continuedRun(facts.executions) !== null)
    return blocked("already_continued");
  if (facts.latest && facts.latest.id !== run.id) return blocked("superseded");
  if (plan.unverifiedStepIds.length > 0) return blocked("checkpoint_mismatch");
  return AVAILABLE;
}

/** A release is offered only while the ended run still holds working copies. */
export function releaseOption(facts: RecoveryFacts): AgentPlanRecoveryOption {
  if (!facts.plan.canEdit) return blocked("plan_read_only");
  if (
    facts.isEngineActive !== false ||
    (isActivePlanRun(facts.run.status) && !facts.run.stopRequested)
  )
    return blocked("run_active");
  return facts.isReserved ? AVAILABLE : blocked("nothing_to_release");
}

/**
 * Splits an ended run into verified results, work to run again and work that never started.
 *
 * @remarks
 * A successful result is taken over only when its checkpoint names the same
 * output digest, so a changed or unverifiable result is never treated as done.
 * A native session counts only with its identifier and the adapter's
 * announced `session/resume`; a loop's sessions always start new.
 */
export function planResume(facts: RecoveryFacts): ResumePlan {
  const { run, checkpoints } = facts;
  const reused: AgentPlanStepResult[] = [];
  const unverified: string[] = [];
  for (const step of run.steps) {
    if (step.status !== "succeeded" || facts.groupIds.includes(step.id))
      continue;
    const checkpoint = checkpoints.find((entry) => entry.stepId === step.id);
    if (
      checkpoint?.result.outputDigest === planContentDigest(step.output) &&
      planContentDigest(checkpoint.result.report ?? null) ===
        planContentDigest(step.report ?? null)
    )
      reused.push(step);
    else unverified.push(step.id);
  }
  const retried = run.steps.filter(
    (step) => hasStarted(step) || hasStartedLoop(run.loops, step.id),
  );
  const retriedLoops = (run.loops ?? []).filter((loop) =>
    retried.some((step) => step.id === loop.id),
  );
  const agents = retried.filter(
    (step) =>
      facts.agentStepIds.includes(step.id) &&
      !retriedLoops.some((loop) => loop.id === step.id),
  );
  const resumeSessions: Record<string, string> = {};
  for (const step of agents) {
    const sessionId = nativeSession(step);
    if (sessionId) resumeSessions[step.groupId ?? step.id] = sessionId;
  }
  return {
    reused,
    retriedStepIds: retried.map((step) => step.id),
    unverifiedStepIds: unverified,
    resumeSessions,
    canResumeNatively:
      agents.length > 0 && agents.every((step) => nativeSession(step) !== null),
  };
}

/** The native session of a started agent node that its adapter can resume. */
function nativeSession(step: AgentPlanStepResult): string | null {
  const { session } = step;
  if (
    !session?.sessionId ||
    session.runner === "api" ||
    !isAcpProvider(session.runner) ||
    session.continuationCapabilities?.canResume !== true
  )
    return null;
  return session.sessionId;
}

/** Why the earlier session of one failed node can or cannot be continued. */
export function nodeModes(
  step: AgentPlanStepResult,
  isLoop: boolean,
): AgentPlanRecoveryView["nodes"][number]["modes"] {
  const capabilities = step.session?.continuationCapabilities;
  let reason: AgentPlanRecoveryView["nodes"][number]["modes"][number]["reason"] =
    null;
  if (isLoop) reason = "loop_session";
  else if (!step.session?.sessionId) reason = "session_unknown";
  else if (!capabilities) reason = "capabilities_unknown";
  else if (!capabilities.canResume) reason = "native_capability_unavailable";
  return [
    { mode: "live", available: false, reason: "session_not_available" },
    { mode: "native_resume", available: reason === null, reason },
    { mode: "new_session", available: true, reason: null },
  ];
}

/**
 * The loop states a resumed run continues.
 *
 * @remarks
 * Completed iterations stay as they were, with their outputs and the
 * verdicts of their condition, so the counter and the feedback of the loop
 * continue. In the unfinished iteration, completed members keep their result
 * and every other member waits for a new attempt. A loop that never resolved
 * its count starts empty.
 */
export function resumedLoopRuns(
  loops: readonly AgentPlanLoopRun[],
  reusedStepIds: readonly string[],
): {
  readonly loops: readonly AgentPlanLoopRun[];
  readonly iterations: Readonly<Record<string, number>>;
} {
  const iterations: Record<string, number> = {};
  const resumed = loops.flatMap((loop): AgentPlanLoopRun[] => {
    if (reusedStepIds.includes(loop.id)) return [loop];
    if (loop.count === null) return [];
    const unfinished = loop.iterations.at(-1);
    if (unfinished && unfinished.status !== "succeeded")
      iterations[loop.id] = unfinished.number;
    return [
      {
        ...loop,
        status: "paused",
        completion: null,
        cleanup: "not_needed",
        endedAt: null,
        error: null,
        iterations: loop.iterations.map((iteration) =>
          iteration.status === "succeeded"
            ? iteration
            : {
                ...iteration,
                status: "paused",
                endedAt: null,
                error: null,
                nodes: iteration.nodes.map((node) =>
                  node.status === "succeeded" ? node : waitingAgain(node),
                ),
              },
        ),
      },
    ];
  });
  return { loops: resumed, iterations };
}

function waitingAgain(node: AgentPlanStepResult): AgentPlanStepResult {
  return {
    id: node.id,
    ...(node.groupId === undefined ? {} : { groupId: node.groupId }),
    name: node.name,
    status: "paused",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
  };
}
