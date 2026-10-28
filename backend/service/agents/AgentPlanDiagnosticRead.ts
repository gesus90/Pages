import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { scriptAssessmentVerdict } from "@/definition/AgentPlanScriptReport";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import { chunkAgentRead } from "./AgentReadChunking";
import { PLAN_OUTPUT_LIMIT, sanitizeArtifactText } from "./AgentPlanOutput";
import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanDiagnostic,
  AgentPlanDiagnosticStream,
} from "@/definition/AgentPlanDiagnostics";
import type { AgentPlanReadResult } from "@/definition/AgentPlanOperations";
import type { AgentPlanService } from "./AgentPlanService";

interface DiagnosticRequest {
  readonly planId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly loopId: string | null;
  readonly iteration: number | null;
  readonly cursor: unknown;
  readonly maxBytes: unknown;
}

function readRequest(input: unknown): DiagnosticRequest {
  const fields = readParameterRecord(input);
  requireParameterKeys(
    fields,
    ["planId", "runId", "stepId"],
    ["loopId", "iteration", "cursor", "maxBytes"],
  );
  const isLoop = fields.loopId !== undefined;
  if (isLoop !== (fields.iteration !== undefined))
    throw new AgentOperationError("INVALID_REQUEST");
  const iteration = fields.iteration;
  if (
    isLoop &&
    (typeof iteration !== "number" ||
      !Number.isSafeInteger(iteration) ||
      iteration < 1)
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    planId: readIdentifier(fields.planId),
    runId: readIdentifier(fields.runId),
    stepId: readIdentifier(fields.stepId),
    loopId: isLoop ? readIdentifier(fields.loopId) : null,
    iteration: typeof iteration === "number" ? iteration : null,
    cursor: fields.cursor,
    maxBytes: fields.maxBytes,
  };
}

function findStep(
  run: AgentPlanRun,
  request: DiagnosticRequest,
): AgentPlanStepResult {
  const steps =
    request.loopId === null
      ? run.steps
      : run.loops
          ?.find((loop) => loop.id === request.loopId)
          ?.iterations.find((entry) => entry.number === request.iteration)
          ?.nodes;
  const step = steps?.find((entry) => entry.id === request.stepId);
  if (!step) throw new AgentOperationError("NOT_FOUND");
  return step;
}

function duration(
  startedAt: string | null,
  endedAt: string | null,
): number | null {
  if (!startedAt || !endedAt) return null;
  const elapsed = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

function stream(
  text: string | null,
  completeness: AgentPlanDiagnosticStream["completeness"],
): AgentPlanDiagnosticStream {
  if (text === null)
    return { text: null, completeness: "missing", isFiltered: false };
  const safe = sanitizeArtifactText(text);
  return {
    text: safe,
    completeness: text.length > PLAN_OUTPUT_LIMIT ? "partial" : completeness,
    isFiltered: safe !== text,
  };
}

function safeText(text: string | null | undefined): string | null {
  return text === null || text === undefined
    ? null
    : sanitizeArtifactText(text);
}

function readTarget(step: AgentPlanStepResult): AgentPlanDiagnostic["target"] {
  const target = step.execution?.target;
  if (!target || target.kind === "local") return target ?? null;
  return {
    ...target,
    connectionName: sanitizeArtifactText(target.connectionName),
    workspaceName: sanitizeArtifactText(target.workspaceName),
    path: sanitizeArtifactText(target.path),
  };
}

function scriptCompleteness(
  step: AgentPlanStepResult,
): AgentPlanDiagnosticStream["completeness"] {
  const script = step.script;
  if (!script) return "unknown";
  if (
    [
      "output_limit",
      "timeout",
      "cancelled",
      "signal",
      "io",
      "encoding",
      "interrupted",
    ].includes(script.failure ?? "")
  )
    return "partial";
  if (script.failure === "spawn" || script.failure === "credentials")
    return "unknown";
  return script.closeout === "confirmed" ? "complete" : "unknown";
}

function hasUnconfirmedCloseout(step: AgentPlanStepResult): boolean {
  const scriptPending = step.script
    ? step.script.closeout !== "confirmed"
    : false;
  const remotePending = step.remote
    ? step.remote.closeout !== "confirmed"
    : false;
  return (
    scriptPending ||
    remotePending ||
    step.session?.closeout === "failed" ||
    step.session?.closeout === "pending"
  );
}

function nextAction(step: AgentPlanStepResult): string | null {
  if (step.isBlocked && step.blockedByStepId)
    return "Inspect the recorded predecessor before retrying this node.";
  if (hasUnconfirmedCloseout(step))
    return "Inspect recovery availability and keep the workspace reserved until closeout is confirmed.";
  const executionAction = nextExecutionAction(step);
  if (executionAction) return executionAction;
  if (
    step.session?.acceptance?.verdict === "open" ||
    step.session?.acceptance?.verdict === "rejected" ||
    (step.report !== undefined && step.report.status !== "passed")
  )
    return "Review the open or rejected checks before treating this report as complete.";
  return step.error
    ? "Inspect this attempt and its diagnostic output before an explicit retry."
    : null;
}

function nextExecutionAction(step: AgentPlanStepResult): string | null {
  if (step.error === "plan_script_result_invalid")
    return "Inspect stdout and correct the declared report format before an explicit retry.";
  if (step.error === "plan_script_result_sensitive")
    return "Inspect the filtered diagnostic, remove sensitive output and explicitly retry.";
  if (step.error === "plan_script_review_failed")
    return "Inspect the failed or partial checks, repair the cause and explicitly repeat the gate.";
  if (step.error === "opencode_acceptance_unavailable")
    return "Check current plan and ticket access, then explicitly retry after reviewing the attempt.";
  if (step.error === "opencode_acceptance_contract_unavailable")
    return "Inspect the retained result and explicitly start a new attempt with the current saved plan.";
  if (step.error === "opencode_acceptance_interrupted")
    return "Inspect the retained result and use an explicitly reviewed recovery action.";
  if (step.error === "plan_runner_payload_update_required")
    return "Update the selected Runner to 1.13.0 or newer before an explicit retry; the legacy answer remains diagnostic only.";
  if (
    step.script?.failure === "timeout" ||
    step.error === "plan_script_timeout"
  )
    return "Inspect the timeout and diagnostic output before an explicit retry.";
  if (
    step.script?.failure === "output_limit" ||
    step.error === "plan_script_output_limit"
  )
    return "Reduce the output before an explicit retry; captured streams may be partial.";
  return null;
}

function identity(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
  request: DiagnosticRequest,
): Pick<
  AgentPlanDiagnostic,
  | "planId"
  | "runId"
  | "stepId"
  | "loopId"
  | "iteration"
  | "planRevision"
  | "appliedPlanRevision"
  | "attemptId"
> {
  return {
    planId: run.planId,
    runId: run.id,
    stepId: step.id,
    loopId: request.loopId,
    iteration: request.iteration,
    planRevision: run.planRevision,
    appliedPlanRevision:
      step.execution?.planRevision ??
      run.continuation?.planRevision ??
      run.planRevision,
    attemptId:
      step.script?.attemptId ??
      (step.session ? sessionAttemptId(step.session, step.id) : undefined) ??
      step.execution?.attemptId ??
      null,
  };
}

function location(
  step: AgentPlanStepResult,
): Pick<AgentPlanDiagnostic, "target" | "workspace" | "directory"> {
  const execution = step.execution;
  return {
    target: readTarget(step),
    workspace: execution
      ? {
          ...execution.workspace,
          path: sanitizeArtifactText(execution.workspace.path),
        }
      : null,
    directory: safeText(
      execution?.workspace.path ??
        step.script?.directory ??
        step.session?.requested.directory,
    ),
  };
}

function timing(
  step: AgentPlanStepResult,
): Pick<
  AgentPlanDiagnostic,
  "startedAt" | "endedAt" | "durationMs" | "timingBasis"
> {
  const { script, session, remote } = step;
  const startedAt =
    script?.startedAt ?? session?.startedAt ?? remote?.startedAt ?? null;
  const endedAt =
    script?.endedAt ?? session?.endedAt ?? remote?.endedAt ?? null;
  return {
    startedAt,
    endedAt,
    durationMs: duration(startedAt, endedAt),
    timingBasis: timingBasis(step),
  };
}

function timingBasis(
  step: AgentPlanStepResult,
): AgentPlanDiagnostic["timingBasis"] {
  if (step.remote) return "remote_observation";
  if (step.script) return "process";
  if (step.session) return "session";
  return "unknown";
}

function configuration(
  step: AgentPlanStepResult,
): Pick<AgentPlanDiagnostic, "runner" | "model" | "interpreterProfileId"> {
  return {
    runner: safeText(
      step.session?.runner ?? step.execution?.modelAccess.provider,
    ),
    model: safeText(
      step.session?.requested.model ?? step.execution?.modelAccess.model,
    ),
    interpreterProfileId: safeText(
      step.script?.interpreterProfileId ?? step.execution?.interpreterProfileId,
    ),
  };
}

function exit(
  step: AgentPlanStepResult,
): Pick<AgentPlanDiagnostic, "exitCode" | "signal"> {
  const { script, session, remote } = step;
  return {
    exitCode:
      script?.exitCode ?? session?.exit?.code ?? remote?.exitCode ?? null,
    signal: script?.signal ?? session?.exit?.signal ?? remote?.signal ?? null,
  };
}

function processState(
  step: AgentPlanStepResult,
): Pick<AgentPlanDiagnostic, "failure" | "closeout" | "verdict"> {
  const { script, session, remote } = step;
  return {
    failure: safeText(script?.failure ?? remote?.reason ?? step.error),
    closeout: script?.closeout ?? session?.closeout ?? remote?.closeout ?? null,
    verdict:
      session?.acceptance?.verdict ?? scriptAssessmentVerdict(step.report),
  };
}

function isRemoteScript(step: AgentPlanStepResult): boolean {
  return (
    step.execution?.target.kind === "remote" &&
    step.execution.modelAccess.provider === "script"
  );
}

function remoteCompleteness(
  step: AgentPlanStepResult,
): AgentPlanDiagnosticStream["completeness"] {
  const reason = step.remote?.reason;
  return reason &&
    ["timeout", "cancelled", "output_limit", "lost", "storage"].includes(reason)
    ? "partial"
    : "unknown";
}

function resultStream(step: AgentPlanStepResult): AgentPlanDiagnosticStream {
  const script = step.script;
  const result = stream(
    step.output,
    script && script.stdout !== null && script.stdout === step.output
      ? scriptCompleteness(step)
      : "unknown",
  );
  return {
    ...result,
    isFiltered:
      result.isFiltered ||
      (isRemoteScript(step) &&
        step.remote?.stdoutIsFiltered === true &&
        step.remote.stdout === step.output),
  };
}

function stdoutStream(step: AgentPlanStepResult): AgentPlanDiagnosticStream {
  const isRemote = isRemoteScript(step);
  const stdout = isRemote
    ? (step.remote?.stdout ?? step.output)
    : (step.script?.stdout ?? null);
  const result = stream(
    stdout,
    isRemote ? remoteCompleteness(step) : scriptCompleteness(step),
  );
  return {
    ...result,
    isFiltered:
      result.isFiltered || (isRemote && step.remote?.stdoutIsFiltered === true),
  };
}

function stderrStream(step: AgentPlanStepResult): AgentPlanDiagnosticStream {
  const result = stream(
    step.script?.stderr ?? step.remote?.stderr ?? null,
    step.script ? scriptCompleteness(step) : "unknown",
  );
  return {
    ...result,
    isFiltered: result.isFiltered || step.remote?.stderrIsFiltered === true,
  };
}

function streams(
  step: AgentPlanStepResult,
): Pick<AgentPlanDiagnostic, "result" | "stdout" | "stderr"> {
  return {
    result: resultStream(step),
    stdout: stdoutStream(step),
    stderr: stderrStream(step),
  };
}

function diagnostic(
  run: AgentPlanRun,
  step: AgentPlanStepResult,
  request: DiagnosticRequest,
): AgentPlanDiagnostic {
  return {
    ...identity(run, step, request),
    retryAttempts: (step.session?.retry?.attempts ?? []).map(
      ({ attemptId, endedAt, code }) => ({ attemptId, endedAt, code }),
    ),
    name: sanitizeArtifactText(step.name),
    status: step.status,
    error: safeText(step.error),
    blockedByStepId: step.blockedByStepId ?? null,
    ...location(step),
    ...timing(step),
    ...configuration(step),
    ...exit(step),
    ...processState(step),
    ...streams(step),
    nextAction: nextAction(step),
  };
}

/** Reads one own attempt using the plan service's current run and resource checks. */
export async function readPlanDiagnostic(
  plans: Pick<AgentPlanService, "run">,
  userId: string,
  input: unknown,
): Promise<AgentPlanReadResult> {
  const request = readRequest(input);
  const run = await plans.run(userId, request.runId);
  if (run.planId !== request.planId) throw new AgentOperationError("NOT_FOUND");
  const result = {
    diagnostic: diagnostic(run, findStep(run, request), request),
  };
  return chunkAgentRead(result, {
    context: JSON.stringify([
      userId,
      "plans.run.diagnostics.read",
      request.planId,
      request.runId,
      request.stepId,
      request.loopId,
      request.iteration,
    ]),
    cursor: request.cursor,
    maxBytes: request.maxBytes,
  });
}
