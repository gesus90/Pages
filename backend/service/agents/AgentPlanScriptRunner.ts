import { randomUUID } from "node:crypto";

import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { assessGitCloseoutResult } from "./AgentPlanGitCloseout";
import { executeScriptProcess } from "./AgentPlanScriptProcess";
import { planStackScriptInput } from "./stack/AgentPlanStackInputs";
import { scriptInputJson } from "./AgentPlanScriptInputs";
import { assessPlanScriptResult } from "./AgentPlanScriptResult";
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
import type {
  AgentPlanGitCloseoutAccess,
  AgentPlanGitCloseoutRuntime,
} from "./AgentPlanGitCloseout";

/** The existing engine owns persistence, pause gates and cancellation. */
export interface ScriptRunControl {
  readonly signal: AbortSignal;
  readonly claimStart: () => void;
  readonly save: (record: AgentPlanScriptRun) => Promise<void>;
}

/** Executes script nodes as processes, with no model, agent identity or ACP session. */
export class AgentPlanScriptRunner {
  private readonly preparation: AgentPlanScriptPreparation;
  private readonly gitCloseout: Pick<
    AgentPlanGitCloseoutRuntime,
    "open"
  > | null;

  public constructor(
    preparation: AgentPlanScriptPreparation,
    gitCloseout: Pick<AgentPlanGitCloseoutRuntime, "open"> | null = null,
  ) {
    this.preparation = preparation;
    this.gitCloseout = gitCloseout;
  }

  /** Persists an attempt before spawn and returns only after its owned resources have settled. */
  public async run(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    script: AgentPlanScriptSnapshot,
    control: ScriptRunControl,
  ): Promise<Partial<AgentPlanStepResult>> {
    let record: AgentPlanScriptRun | undefined;
    let access: AgentPlanGitCloseoutAccess | null = null;
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
      record = initialRecord(run, script);
      await control.save(record);
      const resources = await createScriptResources(
        record.instanceId,
        script.step.content,
      );
      await this.preparation.reauthorize(run.userId, snapshot.plan, script);
      access = await this.openGitCloseout(run, snapshot, script, record);
      record = await executeScriptProcess({
        record,
        program: script.interpreter.path,
        resources,
        input: access?.input ?? input,
        timeoutSeconds: script.step.timeoutSeconds,
        environment: access?.environment,
        signal: control.signal,
        claimStart: control.claimStart,
        save: gitCloseoutSave(access, control.save),
      });
      if (record.closeout === "confirmed")
        await removeScriptResources(record.instanceId);
      return completedResult(redactedRecord(record, access), script);
    } catch (error: unknown) {
      record = await closeUnstartedRecord(record);
      return refusedResult(error, record, control.signal);
    } finally {
      await closeGitCloseout(access);
    }
  }

  private async openGitCloseout(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    script: AgentPlanScriptSnapshot,
    record: AgentPlanScriptRun,
  ): Promise<AgentPlanGitCloseoutAccess | null> {
    if (!script.gitCloseout) return null;
    if (!this.gitCloseout)
      throw new AgentError("plan_script_interpreter_unavailable");
    return this.gitCloseout.open({
      run,
      plan: snapshot.plan,
      closeout: script.gitCloseout,
      workspace: script.workspace,
      instanceId: record.instanceId,
    });
  }
}

/** The namespace proves the end of the processes when a crash leaves the credentials behind. */
function gitCloseoutSave(
  access: AgentPlanGitCloseoutAccess | null,
  save: ScriptRunControl["save"],
): ScriptRunControl["save"] {
  if (!access) return save;
  return async (record) => {
    if (record.namespace) await access.recordNamespace(record.namespace);
    await save(record);
  };
}

function redactedRecord(
  record: AgentPlanScriptRun,
  access: AgentPlanGitCloseoutAccess | null,
): AgentPlanScriptRun {
  if (!access) return record;
  return {
    ...record,
    stderr: access.redact(record.stderr),
    stdout: record.stdout === null ? null : access.redact(record.stdout),
  };
}

/** A failed removal is logged where it happens; it must not hide the result of the step. */
async function closeGitCloseout(
  access: AgentPlanGitCloseoutAccess | null,
): Promise<void> {
  try {
    await access?.cleanup();
  } catch (error: unknown) {
    logCaughtError("AgentPlanScriptRunner", error);
  }
}

function initialRecord(
  run: AgentPlanRun,
  script: AgentPlanScriptSnapshot,
): AgentPlanScriptRun {
  return {
    attemptId:
      run.steps.find((step) => step.id === script.step.id)?.execution
        ?.attemptId ?? randomUUID(),
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
  const assessed = assessPlanScriptResult(script.step, {
    status,
    cancellation: scriptCancellation(record),
    output: script.step.outputs.length === 0 ? null : record.stdout,
    error,
    script: record,
  });
  return script.gitCloseout ? assessGitCloseoutResult(assessed) : assessed;
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
