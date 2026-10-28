import { z } from "zod";

/** Largest stored summary or individual check detail, in characters. */
export const PLAN_SCRIPT_REPORT_TEXT_LIMIT = 4_000;
const shortText = z
  .string()
  .max(120)
  .refine((value) => value.trim().length > 0);
const detailText = z
  .string()
  .max(PLAN_SCRIPT_REPORT_TEXT_LIMIT)
  .refine((value) => value.trim().length > 0);
const status = z.enum(["passed", "failed", "partial"]);

/** An explicit script report keeps each observed check and its actual outcome. */
export const planScriptReportSchema = z
  .object({
    status,
    summary: detailText,
    checks: z
      .array(
        z
          .object({
            name: shortText,
            status,
            detail: detailText,
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict()
  .refine((report) => {
    const names = report.checks.map((check) => check.name);
    if (new Set(names).size !== names.length) return false;
    let actual: "passed" | "failed" | "partial" = "passed";
    if (report.checks.some((check) => check.status === "failed"))
      actual = "failed";
    else if (report.checks.some((check) => check.status === "partial"))
      actual = "partial";
    return report.status === actual;
  });

/** A bounded, non-sensitive assessment of the separately stored original report. */
export const planScriptAssessmentSchema = z
  .object({
    status,
    summary: detailText,
    checkCount: z.number().int().min(1).max(64),
    failedCount: z.number().int().min(0).max(64),
    partialCount: z.number().int().min(0).max(64),
  })
  .strict()
  .refine((value) => {
    if (value.failedCount + value.partialCount > value.checkCount) return false;
    if (value.failedCount > 0) return value.status === "failed";
    if (value.partialCount > 0) return value.status === "partial";
    return value.status === "passed";
  });

/** The original report is kept as the declared output, separate from this assessment. */
export type AgentPlanScriptAssessment = z.infer<
  typeof planScriptAssessmentSchema
>;

/** Projects a script check outcome into the existing run-report verdict vocabulary. */
export function scriptAssessmentVerdict(
  assessment: AgentPlanScriptAssessment | undefined,
): "accepted" | "open" | null {
  if (!assessment) return null;
  return assessment.status === "passed" ? "accepted" : "open";
}
