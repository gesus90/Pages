import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { LOCAL_RUNNER_CONNECTION_ID } from "./LocalRunnerIdentity";
import { projectManagedRunnerJob } from "./RunnerManagedProjection";
import { settleManagedRunnerLoops } from "./RunnerManagedLoops";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerService } from "./RunnerService";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

function savedClaims(
  run: AgentPlanRun,
): readonly NonNullable<AgentPlanSessionRecord["runnerJob"]>[] {
  const references = new Map(
    (run.runnerJobs ?? []).map((entry) => [entry.jobId, entry]),
  );
  const claims = new Map<
    string,
    NonNullable<AgentPlanSessionRecord["runnerJob"]>
  >(references);
  for (const step of allPlanRunResults(run)) {
    const reference = step.session?.runnerJob ?? step.script?.runnerJob;
    if (reference) claims.set(reference.jobId, reference);
  }
  return [...claims.values()];
}

/** Repairs the dispatch-to-observer crash window from the transactionally stored claim. */
export function restoreManagedRunnerClaims(run: AgentPlanRun): AgentPlanRun {
  const update = (step: AgentPlanStepResult): AgentPlanStepResult => {
    const session = step.session;
    const script = step.script;
    const reference = run.runnerJobs?.find(
      (job) =>
        job.stepId === step.id &&
        (Boolean(
          session?.attemptId && job.recordingAttemptId === session.attemptId,
        ) ||
          Boolean(script && job.attemptId === script.attemptId)),
    );
    if (!reference) return step;
    const runnerJob = {
      connectionId: reference.connectionId,
      jobId: reference.jobId,
      attemptId: reference.attemptId,
    };
    if (session && !session.runnerJob)
      return { ...step, session: { ...session, runnerOwned: true, runnerJob } };
    if (script && !script.runnerJob)
      return { ...step, script: { ...script, runnerOwned: true, runnerJob } };
    return step;
  };
  return {
    ...run,
    steps: run.steps.map(update),
    loops: run.loops?.map((loop) => ({
      ...loop,
      iterations: loop.iterations.map((iteration) => ({
        ...iteration,
        nodes: iteration.nodes.map(update),
      })),
    })),
  };
}

/** Replays durable closeout facts without a new worker message, scan, signal or model request. */
export async function recoverManagedRunnerRun(
  source: AgentPlanRun,
  runners: Pick<RunnerService, "progress">,
): Promise<AgentPlanRun> {
  if (isActivePlanRun(source.status)) return source;
  source = restoreManagedRunnerClaims(source);
  let run = source;
  for (const reference of savedClaims(source)) {
    const job = await runners.progress(
      reference.connectionId,
      source.id,
      reference.attemptId,
    );
    if (!job || job.jobId !== reference.jobId) continue;
    const result =
      job.outcome ??
      (job.cancellation?.closeout
        ? {
            output: null,
            exitCode: null,
            signal: null,
            reason: "cancelled" as const,
            closeout: job.cancellation.closeout,
          }
        : undefined);
    run = projectManagedRunnerJob(run, {
      connectionId: reference.connectionId,
      job,
      result,
      isDetached: true,
    });
  }
  const replacements = new Map<AgentPlanStepResult, AgentPlanStepResult>();
  for (const step of allPlanRunResults(run)) {
    const updated = await closeUnclaimedStep(run, step, runners);
    if (updated !== step) replacements.set(step, updated);
  }
  if (!replacements.size) return settleManagedRunnerLoops(run);
  const update = (step: AgentPlanStepResult): AgentPlanStepResult =>
    replacements.get(step) ?? step;
  return settleManagedRunnerLoops({
    ...run,
    steps: run.steps.map(update),
    loops: run.loops?.map((loop) => ({
      ...loop,
      iterations: loop.iterations.map((iteration) => ({
        ...iteration,
        nodes: iteration.nodes.map(update),
      })),
    })),
  });
}

async function closeUnclaimedStep(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
  runners: Pick<RunnerService, "progress">,
): Promise<AgentPlanStepResult> {
  if (step.status === "succeeded") return step;
  if (
    run.runnerJobs?.some(
      (job) => job.stepId === step.id && job.closeout !== "confirmed",
    )
  )
    return step;
  const session = step.session;
  if (session?.runnerOwned && !session.runnerJob && session.startedAt === null)
    return closeUnclaimedSession(step, session);
  const script = step.script;
  if (
    !script?.runnerOwned ||
    script.runnerJob ||
    script.closeout === "confirmed"
  )
    return step;
  return closeUnclaimedScript(run, step, script, runners);
}

function closeUnclaimedSession(
  step: AgentPlanStepResult,
  session: NonNullable<AgentPlanStepResult["session"]>,
): AgentPlanStepResult {
  return {
    ...step,
    session: {
      ...session,
      closeout: "not_needed",
      endedAt: session.endedAt ?? new Date().toISOString(),
    },
  };
}

async function closeUnclaimedScript(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
  script: NonNullable<AgentPlanStepResult["script"]>,
  runners: Pick<RunnerService, "progress">,
): Promise<AgentPlanStepResult> {
  const connectionId =
    step.execution?.target.kind === "remote"
      ? step.execution.target.connectionId
      : LOCAL_RUNNER_CONNECTION_ID;
  const job = await runners.progress(connectionId, run.id, script.attemptId);
  if (job) return step;
  // An ended run's dispatch fence forbids a later claim; no persisted claim means no worker ever launched.
  return {
    ...step,
    script: {
      ...script,
      closeout: "confirmed",
      failure: script.failure ?? "interrupted",
      endedAt: script.endedAt ?? new Date().toISOString(),
    },
  };
}
