import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentError } from "@/backend/error/AgentErrors";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { readPlanSnapshot } from "./AgentPlanSnapshot";
import {
  loopSessionTerms,
  planSessionGroup,
} from "./loop/AgentPlanLoopSession";
import {
  storedPlanIteration,
  storedPlanNodeInput,
} from "./loop/AgentPlanStoredIteration";
import { sessionStart } from "./sessions/AgentSessionAttempts";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { LocalSessionLaunch } from "@/backend/agents/local/LocalSessionContracts";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentSessionStart } from "./sessions/AgentSessionAttempts";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

/** Rebuilds live authorization and credential resolvers inside the trusted session owner. */
export class AgentLocalSessionPreparation {
  private readonly runs: AgentPlanRunRepository;
  private readonly start: AgentPlanStepStart;

  public constructor(runs: AgentPlanRunRepository, start: AgentPlanStepStart) {
    this.runs = runs;
    this.start = start;
  }

  /** Uses the pinned original prompt only after checking its persisted attempt and digest. */
  public async prepare(launch: LocalSessionLaunch): Promise<{
    readonly input: AgentPlanSessionInput;
    readonly recording: AgentSessionStart;
  }> {
    const run = await this.requireRun(launch);
    const { result, record } = requireLaunchRecord(run, launch);
    const snapshot = readPlanSnapshot(await this.runs.snapshot(run.id));
    const step = snapshot.steps.find(
      (entry) => entry.step.id === launch.stepId,
    );
    if (!step) throw new AgentError("plan_context_changed");
    const stored = storedPlanNodeInput(run, step, result);
    const prepared = await this.start.prepare(
      stored.run,
      snapshot,
      stored.step,
    );
    const directory = record.requested.directory;
    if (
      !directory ||
      directory !== prepared.input.directory ||
      prepared.input.agent.connection.id !== record.requested.connectionId ||
      prepared.input.agent.model !== record.requested.model
    )
      throw new AgentError("plan_context_changed");
    const scope =
      planSessionGroup(
        step,
        loopSessionTerms(step, snapshot, storedPlanIteration(run, result)),
      ) ?? step.step.id;
    if (scope !== launch.sessionScopeId)
      throw new AgentError("plan_context_changed");
    const recording = sessionStart({ run, step, record }, launch.instanceId);
    if (!recording) throw new AgentError("plan_context_changed");
    return {
      recording,
      input: {
        ...prepared.input,
        prompt: launch.prompt,
        directory,
        instanceId: launch.instanceId,
        options: { ...prepared.options, timeoutMinutes: launch.timeoutMinutes },
        mcp: launch.mcp,
        resumeSessionId: launch.resumeSessionId,
        resourceContext: {
          runId: run.id,
          stepId: step.step.id,
          sessionScopeId: launch.sessionScopeId,
          ...(run.origin?.mode === "native_resume"
            ? { sourceRunId: run.origin.runId }
            : {}),
        },
      },
    };
  }
  private async requireRun(launch: LocalSessionLaunch): Promise<AgentPlanRun> {
    const run = await this.runs.find(launch.runId);
    if (
      !run ||
      run.userId !== launch.userId ||
      run.stopRequested ||
      !["running", "pausing", "paused"].includes(run.status)
    )
      throw new AgentError("plan_run_unavailable");
    return run;
  }
}

function requireLaunchRecord(
  run: AgentPlanRun,
  launch: LocalSessionLaunch,
): {
  readonly result: AgentPlanStepResult;
  readonly record: AgentPlanSessionRecord;
} {
  const result = allPlanRunResults(run).find(
    (step) =>
      step.id === launch.stepId && step.session?.attemptId === launch.attemptId,
  );
  const record = result?.session;
  if (
    !result ||
    !record ||
    record.instanceId !== launch.instanceId ||
    (!launch.isInstruction &&
      record.dispatchedPromptDigest !== planContentDigest(launch.prompt))
  )
    throw new AgentError("plan_context_changed");
  return { result, record };
}
