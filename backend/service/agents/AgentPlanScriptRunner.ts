import { removePlanTemporaryStep } from "@/backend/agents/PlanRunTemporaryDirectory";
import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { AgentError } from "@/backend/error/AgentErrors";

import { planPauseGate } from "./AgentPlanPauseGate";
import {
  resumePlanScripts,
  suspendPlanScripts,
} from "./AgentPlanScriptProcess";
import {
  executeOwnedScript,
  settleUnstartedScript,
} from "./AgentPlanScriptOwner";
import {
  removeScriptResources,
  scriptRuntimeDirectory,
} from "./AgentPlanScriptResources";
import { planStackScriptInput } from "./stack/AgentPlanStackInputs";
import { scriptInputJson } from "./AgentPlanScriptInputs";
import { assessPlanScriptResult } from "./AgentPlanScriptResult";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";
import type {
  AgentPlanScriptPreparation,
  AgentPlanScriptSnapshot,
} from "./AgentPlanScriptPreparation";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { RunnerPlanScripts } from "@/backend/service/runner/RunnerPlanScripts";

/** The existing engine owns persistence, pause gates and cancellation. */
export interface ScriptRunControl {
  readonly signal: AbortSignal;
  readonly claimStart: () => void;
  readonly save: (record: AgentPlanScriptRun) => Promise<void>;
}

/** Executes script nodes as processes, with no model, agent identity or ACP session. */
export class AgentPlanScriptRunner {
  private readonly preparation: AgentPlanScriptPreparation;
  private readonly runner: RunnerPlanScripts;

  public constructor(
    preparation: AgentPlanScriptPreparation,
    runner: RunnerPlanScripts,
  ) {
    this.preparation = preparation;
    this.runner = runner;
  }

  /** Holds active script process groups without losing their execution state. */
  public suspend(runId: string): Set<string> {
    return suspendPlanScripts(runId);
  }

  /** Continues active script process groups after a run resumes or stops. */
  public resume(runId: string): void {
    resumePlanScripts(runId);
  }

  /** Persists an attempt before spawn and returns only after its owned resources have settled. */
  public async run(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    script: AgentPlanScriptSnapshot,
    control: ScriptRunControl,
  ): Promise<Partial<AgentPlanStepResult>> {
    const previous = run.steps.find(
      (step) => step.id === script.step.id,
    )?.script;
    const isLegacyOwner =
      snapshot.runnerProtocolVersion !== 1 &&
      previous?.closeout === "pending" &&
      !previous.runnerJob &&
      !previous.runnerOwned;
    if (!isLegacyOwner) return this.runner.run(run, snapshot, script, control);
    let record: AgentPlanScriptRun | undefined;
    try {
      script = await planStackScriptInput(script, {
        plan: snapshot.plan,
        run,
        readTask: (taskId) =>
          this.preparation.readTask(run.userId, snapshot.plan, taskId),
      });
      const input = scriptInputJson(run, script);
      await this.preparation.reauthorize(run.userId, snapshot.plan, script);
      control.signal.throwIfAborted();
      record = previous;
      if (!record) throw new AgentError("plan_context_changed");
      await control.save(record);
      const scope = record.temporaryScope;
      const resources = scriptRuntimeDirectory(record.instanceId, scope);
      await this.preparation.reauthorize(run.userId, snapshot.plan, script);
      record = await executeOwnedScript({
        runId: run.id,
        record,
        program: script.interpreter.path,
        resources,
        sharedEnvironment: "",
        input,
        timeoutSeconds: script.step.timeoutSeconds,
        signal: control.signal,
        claimStart: control.claimStart,
        save: control.save,
      });
      await planPauseGate(run.id).wait(control.signal);
      if (record.closeout === "confirmed") {
        await removeScriptResources(record.instanceId, record.temporaryScope);
        if (!(control.signal.reason instanceof AgentPlanPausedError))
          await removePlanTemporaryStep({
            runId: run.id,
            stepId: script.step.id,
          });
      }
      return completedResult(record, script);
    } catch (error: unknown) {
      record = await closeUnstartedRecord(record);
      return refusedResult(error, record, control.signal);
    }
  }
}

function completedResult(
  record: AgentPlanScriptRun,
  script: AgentPlanScriptSnapshot,
): Partial<AgentPlanStepResult> {
  let status: AgentPlanStepResult["status"] = "failed";
  if (record.failure === null) status = "succeeded";
  if (record.failure === "cancelled") status = "cancelled";
  if (record.closeout === "failed") status = "failed";
  let error = record.failure ? `plan_script_${record.failure}` : null;
  if (record.closeout === "failed") error = "plan_script_cleanup";
  return assessPlanScriptResult(script.step, {
    status,
    cancellation: scriptCancellation(record),
    output: script.step.outputs.length === 0 ? null : record.stdout,
    error,
    script: record,
  });
}

function scriptCancellation(
  record: AgentPlanScriptRun,
): AgentPlanStepResult["cancellation"] {
  if (record.failure !== "cancelled") return "none";
  return record.closeout === "confirmed" ? "confirmed" : "requested";
}

async function closeUnstartedRecord(
  record: AgentPlanScriptRun | undefined,
): Promise<AgentPlanScriptRun | undefined> {
  if (!record || record.closeout === "failed") return record;
  try {
    const settled = await settleUnstartedScript(record, "interrupted");
    if (settled.closeout !== "pending") return settled;
  } catch {
    // Failed evidence keeps the historical owner and its private resources reserved.
  }
  return {
    ...record,
    closeout: "failed",
    failure: record.failure ?? "cleanup",
  };
}

function refusedResult(
  error: unknown,
  record: AgentPlanScriptRun | undefined,
  signal: AbortSignal,
): Partial<AgentPlanStepResult> {
  const details = record ? { script: record } : {};
  if (record?.closeout === "failed")
    return { status: "failed", error: "plan_script_cleanup", ...details };
  if (
    error instanceof AgentPlanPausedError ||
    (signal.aborted && signal.reason instanceof AgentPlanPausedError)
  )
    return { status: "paused", ...details };
  if (signal.aborted)
    return { status: "cancelled", cancellation: "not_started", ...details };
  return {
    status: "failed",
    error: error instanceof AgentError ? error.code : "plan_script_spawn",
    ...details,
  };
}
