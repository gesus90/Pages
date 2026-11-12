import { planScriptDisabledOutput } from "@/definition/AgentPlanScript";
import {
  PLAN_SCRIPT_REPORT_TEXT_LIMIT,
  planScriptReportSchema,
} from "@/definition/AgentPlanScriptReport";

import { sanitizeArtifactText } from "./AgentPlanOutput";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";

/** Applies only an explicitly declared report policy after successful process closeout. */
export function assessPlanScriptResult(
  script: AgentPlanScript,
  result: Partial<AgentPlanStepResult>,
  options?: { readonly isSkipped?: boolean },
): Partial<AgentPlanStepResult> {
  const policy = script.outputs[0]?.policy;
  if (result.status !== "succeeded") return result;
  if (hasSensitiveOutput(result.output))
    return {
      ...result,
      status: "failed",
      error: "plan_script_result_sensitive",
    };
  if (!policy) return result;
  if (!options?.isSkipped && !isScriptCloseoutConfirmed(result))
    return { ...result, status: "failed", error: "plan_script_cleanup" };
  return assessScriptReport(result, policy);
}

function isScriptCloseoutConfirmed(
  result: Partial<AgentPlanStepResult>,
): boolean {
  return (
    result.script?.closeout === "confirmed" ||
    result.remote?.closeout === "confirmed"
  );
}

function assessScriptReport(
  result: Partial<AgentPlanStepResult>,
  policy: NonNullable<AgentPlanScript["outputs"][number]["policy"]>,
): Partial<AgentPlanStepResult> {
  let value: unknown;
  try {
    value = JSON.parse(result.output ?? "");
  } catch {
    return { ...result, status: "failed", error: "plan_script_result_invalid" };
  }
  const parsed = planScriptReportSchema.safeParse(value);
  if (!parsed.success)
    return { ...result, status: "failed", error: "plan_script_result_invalid" };
  const { status, summary, checks } = parsed.data;
  const report = {
    status,
    summary: safeSummary(summary),
    checkCount: checks.length,
    failedCount: checks.filter((check) => check.status === "failed").length,
    partialCount: checks.filter((check) => check.status === "partial").length,
  };
  if (policy === "gate" && status !== "passed")
    return {
      ...result,
      status: "failed",
      error: "plan_script_review_failed",
      report,
    };
  return { ...result, report };
}

/** A disabled script succeeds without a process and returns its declared replacement. */
export function skippedPlanScriptResult(
  script: AgentPlanScript,
): Partial<AgentPlanStepResult> {
  return {
    ...assessPlanScriptResult(
      script,
      {
        status: "succeeded",
        output: planScriptDisabledOutput(script),
        error: null,
        cancellation: "none",
        isBlocked: false,
      },
      { isSkipped: true },
    ),
    skipped: true,
  };
}

function hasSensitiveOutput(output: string | null | undefined): boolean {
  return (
    output !== null &&
    output !== undefined &&
    sanitizeArtifactText(output) !== output
  );
}

function safeSummary(summary: string): string {
  const safe = sanitizeArtifactText(summary);
  if (safe.length <= PLAN_SCRIPT_REPORT_TEXT_LIMIT) return safe;
  const marker = " [truncated]";
  return `${safe.slice(0, PLAN_SCRIPT_REPORT_TEXT_LIMIT - marker.length)}${marker}`;
}
