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
import type {
  AgentPlanExecutionInput,
  AgentPlanStepStart,
} from "./AgentPlanStepStart";
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

  /**
   * Uses the pinned original prompt only after checking its persisted attempt and digest.
   *
   * @param launch - The stored turn request, which carries no bearer.
   * @param bearer - The plan bridge bearer the owner holds in memory; required exactly when the turn offers Pages tools.
   * @throws {AgentError} `plan_mcp_unavailable` when the turn needs a bearer and none was handed over.
   */
  public async prepare(
    launch: LocalSessionLaunch,
    bearer: string | null,
  ): Promise<{
    readonly input: AgentPlanSessionInput;
    readonly recording: AgentSessionStart;
  }> {
    if (launch.mcp !== null && bearer === null)
      throw new AgentError("plan_mcp_unavailable");
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
    const directory = requirePreparedDirectory(record, prepared.input);
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
        mcp:
          launch.mcp === null || bearer === null
            ? null
            : { ...launch.mcp, token: bearer },
        resumeSessionId: launch.resumeSessionId,
        resourceContext: {
          runId: run.id,
          stepId: step.step.id,
          sessionScopeId: launch.sessionScopeId,
          ...(run.origin?.kind === "resume"
            ? { recoveryRunId: run.origin.runId }
            : {}),
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

/** Returns the stored directory while the prepared start still matches the stored request. */
function requirePreparedDirectory(
  record: AgentPlanSessionRecord,
  input: AgentPlanExecutionInput,
): string {
  const directory = record.requested.directory;
  if (
    !directory ||
    directory !== input.directory ||
    input.agent.connection.id !== record.requested.connectionId ||
    input.agent.model !== record.requested.model
  )
    throw new AgentError("plan_context_changed");
  return directory;
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
