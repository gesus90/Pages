import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";

import { AgentError } from "@/backend/error/AgentErrors";
import { scriptInputJson } from "@/backend/service/agents/AgentPlanScriptInputs";
import { planStackScriptInput } from "@/backend/service/agents/stack/AgentPlanStackInputs";
import { assessPlanScriptResult } from "@/backend/service/agents/AgentPlanScriptResult";
import { planPauseGate } from "@/backend/service/agents/AgentPlanPauseGate";

import { LOCAL_RUNNER_CONNECTION_ID } from "./LocalRunnerIdentity";
import { RunnerManagedJobs } from "./RunnerManagedJobs";

import type { ManagedRunnerTransport } from "./RunnerManagedJobs";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  RunnerExecution,
  RunnerInterpreter,
} from "@/definition/RunnerExecution";
import type { RunnerJobResult } from "@/definition/RunnerProtocol";
import type {
  AgentPlanScriptSnapshot,
  AgentPlanScriptPreparation,
} from "@/backend/service/agents/AgentPlanScriptPreparation";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { ScriptRunControl } from "@/backend/service/agents/AgentPlanScriptRunner";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";

type AuthorizeRemoteScript = (
  run: AgentPlanRun,
  snapshot: AgentPlanSnapshot,
  script: AgentPlanScriptSnapshot,
) => Promise<void>;

/** Dispatches outer and inner scripts with their original authorization and interpreter contracts. */
export class RunnerPlanScripts {
  private readonly preparation: AgentPlanScriptPreparation;
  private readonly runners: ManagedRunnerTransport;
  private readonly jobs: RunnerManagedJobs;
  private readonly authorizeRemote: AuthorizeRemoteScript;

  public constructor(
    preparation: AgentPlanScriptPreparation,
    runners: ManagedRunnerTransport,
    runs: AgentPlanRunRepository,
    authorizeRemote: AuthorizeRemoteScript,
  ) {
    this.preparation = preparation;
    this.authorizeRemote = authorizeRemote;
    this.runners = runners;
    this.jobs = new RunnerManagedJobs(runners, runs);
  }

  /** Freezes scripts through the same acknowledged worker control as model turns. */
  public setRunPaused(runId: string, isPaused: boolean): Promise<void> {
    return this.jobs.setRunPaused(runId, isPaused);
  }

  /** Returns only after a worker has proved its terminal state and resource cleanup. */
  public async run(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    source: AgentPlanScriptSnapshot,
    control: ScriptRunControl,
  ): Promise<Partial<AgentPlanStepResult>> {
    const script = await planStackScriptInput(source, {
      plan: snapshot.plan,
      run,
      readTask: (taskId) =>
        this.preparation.readTask(run.userId, snapshot.plan, taskId),
    });
    const remote = snapshot.remoteSteps?.find(
      (entry) => entry.step.id === script.step.id,
    );
    const connectionId =
      remote?.target.connectionId ?? LOCAL_RUNNER_CONNECTION_ID;
    const existing = run.steps.find((entry) => entry.id === script.step.id);
    const previous =
      existing?.status === "running" ? existing.script : undefined;
    const command = previous?.runnerJob
      ? null
      : await this.prepareCommand(run, snapshot, script);
    let record = previous?.runnerJob
      ? previous
      : initialScriptRecord(run, script);
    await control.save(record);
    if (!record.runnerJob) control.claimStart();
    const result = record.runnerJob
      ? await this.jobs.reattach(record.runnerJob, run.id, control.signal)
      : await this.jobs.run({
          userId: run.userId,
          connectionId,
          binding: {
            managed: true,
            ownerStepId: scriptOwnerStep(run, script.step.id),
            planId: run.planId,
            runId: run.id,
            stepId: script.step.id,
            attemptId: record.attemptId,
            planRevision: run.planRevision,
          },
          command: requireScriptCommand(command),
          signal: control.signal,
          dispatched: async (job) => {
            record = {
              ...record,
              runnerJob: {
                connectionId,
                jobId: job.jobId,
                attemptId: record.attemptId,
              },
            };
            await control.save(record);
          },
        });
    const ended = endedScriptRecord(record, result);
    await control.save(ended);
    if (!control.signal.aborted)
      await planPauseGate(run.id).wait(control.signal);
    return scriptResult(script.step, result, ended);
  }

  private async prepareCommand(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    script: AgentPlanScriptSnapshot,
  ): Promise<RunnerExecution> {
    const remote = snapshot.remoteSteps?.find(
      (entry) => entry.step.id === script.step.id,
    );
    if (remote) await this.authorizeRemote(run, snapshot, script);
    else await this.preparation.reauthorize(run.userId, snapshot.plan, script);
    const connectionId =
      remote?.target.connectionId ?? LOCAL_RUNNER_CONNECTION_ID;
    return scriptCommand(
      run,
      script,
      await this.interpreter(run.userId, connectionId, script),
    );
  }

  private async interpreter(
    userId: string,
    connectionId: string,
    script: AgentPlanScriptSnapshot,
  ): Promise<RunnerInterpreter> {
    const interpreters = await this.runners.ready(userId, connectionId);
    const selected =
      connectionId === LOCAL_RUNNER_CONNECTION_ID
        ? await realpath(script.interpreter.path)
        : script.interpreter.path;
    const interpreter = interpreters.find((entry) => entry.path === selected);
    if (!interpreter)
      throw new AgentError("plan_script_interpreter_unavailable");
    return interpreter;
  }
}

function scriptCommand(
  run: AgentPlanRun,
  script: AgentPlanScriptSnapshot,
  interpreter: RunnerInterpreter,
): RunnerExecution {
  const isRemote = script.step.executionTarget?.kind === "remote";
  return {
    version: 1,
    revision: run.planRevision,
    workspace: script.workspace.path,
    timeoutSeconds: script.step.timeoutSeconds,
    outputBytes: isRemote ? 65536 : 262144,
    ...(isRemote ? {} : { streamBytes: 131072 }),
    input: scriptInputJson(run, script),
    hasOutput: script.step.outputs.length > 0,
    managed: {},
    program: { kind: "script", interpreter, source: script.step.content },
  };
}

function initialScriptRecord(
  run: AgentPlanRun,
  script: AgentPlanScriptSnapshot,
): AgentPlanScriptRun {
  return {
    runnerOwned: true,
    attemptId: randomUUID(),
    instanceId: randomUUID(),
    interpreterProfileId: script.interpreter.id,
    directory: script.workspace.path,
    userId: run.userId,
    uid: process.getuid?.() ?? -1,
    gid: process.getgid?.() ?? -1,
    processId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    signal: null,
    failure: null,
    closeout: "pending",
    stdout: null,
    stderr: "",
  };
}

function endedScriptRecord(
  record: AgentPlanScriptRun,
  result: RunnerJobResult,
): AgentPlanScriptRun {
  return {
    ...record,
    endedAt: new Date().toISOString(),
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    closeout: result.closeout === "confirmed" ? "confirmed" : "failed",
    failure: scriptFailure(result),
    stdout: result.output,
    stderr: result.stderr ?? "",
  };
}

function scriptFailure(result: RunnerJobResult): AgentPlanScriptRun["failure"] {
  if (result.closeout !== "confirmed") return "cleanup";
  if (!result.reason) return result.exitCode === 0 ? null : "exit";
  if (result.reason === "timeout") return "timeout";
  if (result.reason === "cancelled") return "cancelled";
  if (result.reason === "output_limit") return "output_limit";
  if (result.reason === "encoding") return "encoding";
  if (result.reason === "credentials") return "credentials";
  if (result.reason === "exit") return result.signal ? "signal" : "exit";
  if (result.reason === "storage") return "io";
  return "spawn";
}

function scriptStatus(
  record: AgentPlanScriptRun,
): AgentPlanStepResult["status"] {
  if (record.failure === "cancelled") return "cancelled";
  return record.failure ? "failed" : "succeeded";
}

function scriptOwnerStep(run: AgentPlanRun, stepId: string): string {
  return (
    run.loops?.find((loop) =>
      loop.iterations.some((iteration) =>
        iteration.nodes.some((node) => node.id === stepId),
      ),
    )?.id ?? stepId
  );
}

function requireScriptCommand(
  command: RunnerExecution | null,
): RunnerExecution {
  if (!command) throw new AgentError("plan_context_changed");
  return command;
}

function scriptResult(
  step: AgentPlanScriptSnapshot["step"],
  result: RunnerJobResult,
  ended: AgentPlanScriptRun,
): Partial<AgentPlanStepResult> {
  return assessPlanScriptResult(step, {
    status: scriptStatus(ended),
    cancellation: ended.failure === "cancelled" ? "confirmed" : "none",
    output: step.outputs.length ? result.output : null,
    error: ended.failure ? `plan_script_${ended.failure}` : null,
    script: ended,
  });
}
