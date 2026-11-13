import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { resumableSessionId } from "../AgentPlanStepDecision";

import type {
  AgentPlanRun,
  AgentPlanStepResult,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type {
  AgentPlanCheckpoint,
  AgentPlanRecoveryExecution,
  AgentPlanRecoveryMode,
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
  /** The frozen plan has a decision or an event connection; absent counts as none. */
  readonly hasBranching?: boolean;
  /** Private event queues, consumed edges and active event prompts. */
  readonly branching?: unknown;
}

/** What a resume would take over, run again and continue natively. */
export interface ResumePlan {
  /** Verified successful results, taken over unchanged. */
  readonly reused: readonly AgentPlanStepResult[];
  /** Started nodes that run again; their possible effects need a reviewed decision. */
  readonly retriedStepIds: readonly string[];
  /** Compatibility diagnostic; durable successful results need no separate checkpoint. */
  readonly unverifiedStepIds: readonly string[];
  /** The native session of each retried agent node or group, where the adapter can resume it. */
  readonly resumeSessions: Readonly<Record<string, string>>;
  /** Whether at least one retried agent can continue natively; others start with saved context. */
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
    step.status !== "succeeded" &&
    step.status !== "skipped" &&
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

/** Scripts with possible prior effects need a concrete review before a from-beginning replay. */
export function restartScriptReview(run: AgentPlanRun): readonly string[] {
  return run.steps
    .filter(
      (step) =>
        Boolean(step.script) ||
        (step.execution?.modelAccess.provider === "script" &&
          Boolean(step.remote?.launchId)),
    )
    .map((step) => step.id);
}

/** A restart needs an ended run and no other active run of the plan. */
export function restartOption(facts: RecoveryFacts): AgentPlanRecoveryOption {
  if (!facts.plan.canEdit) return blocked("plan_read_only");
  if (
    facts.latest &&
    facts.latest.id !== facts.run.id &&
    isActivePlanRun(facts.latest.status)
  )
    return blocked("plan_run_active");
  return AVAILABLE;
}

/**
 * A resume continues only the newest ended, unfinished run of the plan, once.
 *
 * @remarks
 * Stop is terminal. Failed runs retain their durable results, including
 * control nodes and loop iterations, independently of checkpoint availability.
 */
export function resumeOption(
  facts: RecoveryFacts,
  plan: ResumePlan,
): AgentPlanRecoveryOption {
  const restart = restartOption(facts);
  if (!restart.available) return restart;
  const { run } = facts;
  if (isActivePlanRun(run.status)) return blocked("run_active");
  if (run.status === "succeeded") return blocked("succeeded");
  if (run.stopRequested || run.status === "cancelled")
    return blocked("cancelled_by_user");
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
 * Splits the durable run into completed results and unfinished work.
 *
 * @remarks
 * The stored run is authoritative even when a crash prevented an additional
 * checkpoint write. A skipped branch stays skipped. Native sessions are
 * selected individually; other nodes receive the saved context.
 */
export function planResume(
  facts: Pick<
    RecoveryFacts,
    "run" | "checkpoints" | "agentStepIds" | "groupIds"
  >,
): ResumePlan {
  const { run } = facts;
  const reused = run.steps.filter(
    (step) =>
      (step.status === "succeeded" || step.status === "skipped") &&
      !facts.groupIds.includes(step.id),
  );
  const retried = run.steps.filter(
    (step) => hasStarted(step) || hasStartedLoop(run.loops, step.id),
  );
  const retriedLoops = (run.loops ?? []).filter((loop) =>
    retried.some((step) => step.id === loop.id),
  );
  const loopMembers = (run.loops ?? []).flatMap((loop) => {
    const iteration = loop.iterations.at(-1);
    return iteration?.status === "succeeded"
      ? []
      : (iteration?.nodes.filter(
          (node) => node.status !== "succeeded" && node.status !== "skipped",
        ) ?? []);
  });
  const agents = [...retried, ...loopMembers].filter(
    (step) =>
      facts.agentStepIds.includes(step.id) &&
      !retriedLoops.some((loop) => loop.id === step.id),
  );
  const resumeSessions: Record<string, string> = {};
  for (const step of agents) {
    const sessionId = nativeSession(step);
    if (sessionId) {
      const loop = step.session?.loop;
      const group = step.groupId ?? step.id;
      const key = loop ? `${loop.loopId}/${group}#${loop.iteration}` : group;
      resumeSessions[key] = sessionId;
      resumeSessions[step.id] = sessionId;
    }
  }
  return {
    reused,
    retriedStepIds: [
      ...new Set([...retried, ...loopMembers].map((step) => step.id)),
    ],
    unverifiedStepIds: [],
    resumeSessions,
    canResumeNatively: Object.keys(resumeSessions).length > 0,
  };
}

/**
 * The session decision of a resume: the one the executor named, else the one the sessions allow.
 *
 * @param plan - What the resume runs again.
 * @param requested - An explicit decision; absent for the confirmation of a person.
 * @returns `native_resume` when any retried agent has a usable session,
 * with new sessions for the remaining nodes; `new_session` otherwise.
 * @throws {AgentPlanRecoveryError} `action_unavailable` for `live`, which an
 * ended run never has, and `native_resume_unavailable` for a named native
 * resume the sessions do not allow.
 */
export function resumeSessionMode(
  plan: Pick<ResumePlan, "canResumeNatively">,
  requested: AgentPlanRecoveryMode | undefined,
): Exclude<AgentPlanRecoveryMode, "live"> {
  if (requested === "live")
    throw new AgentPlanRecoveryError("action_unavailable");
  if (requested === "native_resume" && !plan.canResumeNatively)
    throw new AgentPlanRecoveryError("native_resume_unavailable");
  if (requested) return requested;
  return plan.canResumeNatively ? "native_resume" : "new_session";
}

/**
 * The started nodes the decision of the executor covers.
 *
 * @param plan - What the resume runs again.
 * @param decision - Single reviews, or the one confirmation of the whole continuation.
 * @returns The retried nodes, which the origin of the new run names as reviewed.
 * @throws {AgentPlanRecoveryError} `review_required` while a retried node is covered by neither.
 */
export function reviewedRetries(
  plan: Pick<ResumePlan, "retriedStepIds">,
  decision: {
    readonly reviewedStepIds?: readonly string[];
    readonly confirmContinue?: true;
  },
): readonly string[] {
  if (decision.confirmContinue === true) return plan.retriedStepIds;
  const reviewed = decision.reviewedStepIds ?? [];
  if (plan.retriedStepIds.some((id) => !reviewed.includes(id)))
    throw new AgentPlanRecoveryError("review_required");
  return reviewed;
}

/** The native session of a started agent node that its adapter can resume. */
function nativeSession(step: AgentPlanStepResult): string | null {
  const { session } = step;
  if (!session || session.runner === "api" || !isAcpProvider(session.runner))
    return null;
  return resumableSessionId(session);
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
                  node.status === "succeeded" || node.status === "skipped"
                    ? node
                    : waitingAgain(node),
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
