import { randomUUID } from "node:crypto";

import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { AgentError } from "@/backend/error/AgentErrors";

import { executeScriptProcess } from "./AgentPlanScriptProcess";
import { scriptInputJson } from "./AgentPlanScriptInputs";
import {
  createScriptResources,
  removeScriptResources,
} from "./AgentPlanScriptResources";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanScriptRun } from "@/definition/AgentPlanScript";
import type {
  AgentPlanScriptPreparation,
  AgentPlanScriptSnapshot,
} from "./AgentPlanScriptPreparation";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** The existing engine owns persistence, pause gates and cancellation. */
export interface ScriptRunControl {
  readonly signal: AbortSignal;
  readonly claimStart: () => void;
  readonly save: (record: AgentPlanScriptRun) => Promise<void>;
}

/** Executes script nodes as processes, with no model, agent identity or ACP session. */
export class AgentPlanScriptRunner {
  private readonly preparation: AgentPlanScriptPreparation;

  public constructor(preparation: AgentPlanScriptPreparation) {
    this.preparation = preparation;
  }

  /** Persists an attempt before spawn and returns only after its owned resources have settled. */
  public async run(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    script: AgentPlanScriptSnapshot,
    control: ScriptRunControl,
  ): Promise<Partial<AgentPlanStepResult>> {
    let record: AgentPlanScriptRun | undefined;
    try {
      const input = scriptInputJson(run, script);
      await this.preparation.reauthorize(run.userId, snapshot.plan, script);
      control.signal.throwIfAborted();
      record = initialRecord(run, script);
      await control.save(record);
      const resources = await createScriptResources(
        record.instanceId,
        script.step.content,
      );
      await this.preparation.reauthorize(run.userId, snapshot.plan, script);
      record = await executeScriptProcess({
        record,
        program: script.interpreter.path,
        resources,
        input,
        timeoutSeconds: script.step.timeoutSeconds,
        signal: control.signal,
        claimStart: control.claimStart,
        save: control.save,
      });
      if (record.closeout === "confirmed")
        await removeScriptResources(record.instanceId);
      return completedResult(record, script);
    } catch (error: unknown) {
      record = await closeUnstartedRecord(record);
      return refusedResult(error, record, control.signal);
    }
  }
}

function initialRecord(
  run: AgentPlanRun,
  script: AgentPlanScriptSnapshot,
): AgentPlanScriptRun {
  return {
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
  return {
    status,
    cancellation: scriptCancellation(record),
    output: script.step.outputs.length === 0 ? null : record.stdout,
    error,
    script: record,
  };
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
    await removeScriptResources(record.instanceId);
    return {
      ...record,
      closeout: "confirmed",
      endedAt: new Date().toISOString(),
    };
  } catch {
    return {
      ...record,
      closeout: "failed",
      failure: record.failure ?? "cleanup",
      endedAt: new Date().toISOString(),
    };
  }
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
