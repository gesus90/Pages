import { z } from "zod";

import { AGENT_STEP_REPORT_STATUSES } from "@/definition/AgentPlanStepReport";

import type { AgentPlanStepReport } from "@/definition/AgentPlanStepReport";

const MAXIMUM_TEXT = 2_000;
const identifier = z.string().trim().min(1).max(200);
const requiredText = z.string().trim().min(1).max(MAXIMUM_TEXT);
const optionalText = z.string().trim().max(MAXIMUM_TEXT);

const reportFields = {
  status: z.enum(AGENT_STEP_REPORT_STATUSES),
  message: requiredText,
  todos: z
    .array(z.strictObject({ id: identifier, status: z.enum(["done", "open"]) }))
    .max(1000)
    .default([]),
  criteria: z
    .array(
      z.strictObject({
        id: identifier,
        met: z.boolean(),
        evidence: optionalText,
      }),
    )
    .max(1000)
    .default([]),
  decisions: z.array(requiredText).max(20).default([]),
  summary: optionalText.default(""),
};

/** The arguments of `report_step_result`; `runId` and `stepId` only name what the caller believes it reports for. */
export const planStepReportCallSchema = z.strictObject({
  ...reportFields,
  runId: identifier.optional(),
  stepId: identifier.optional(),
});

const storedReportSchema = z.strictObject(reportFields);

/**
 * Reads a stored report.
 *
 * @param input - The parsed JSON of its row.
 * @returns The report; anything else throws, because a damaged row proves nothing.
 */
export function readPlanStepReport(input: unknown): AgentPlanStepReport {
  return storedReportSchema.parse(input);
}
